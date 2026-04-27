"""
Chart Service — yfinance historical OHLCV fetch + PostgreSQL cache + SMA calculation.

Strategy:
  1. Check price_history table — if data exists for ticker, return from DB (<50ms)
  2. If no data → fetch full history from yfinance, bulk INSERT (one-time, ~2-5s)
  3. All subsequent requests: pure PostgreSQL → <100ms
  4. Works for ANY ticker — not just portfolio positions

No API key required (yfinance is free/unofficial Yahoo Finance).
SMA calculation is done in Python (not SQL) to keep it simple and fast.
"""
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

import yfinance as yf
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database.db import AsyncSessionLocal
from backend.database.models import PriceHistory

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="yfinance-chart")

# Period → how many calendar days to return
PERIOD_DAYS = {
    "1W": 7,
    "1M": 31,
    "3M": 92,
    "6M": 183,
    "1Y": 365,
    "5Y": 365 * 5,
    "MAX": 365 * 25,
}


# ─── Public API ──────────────────────────────────────────────────────────────

async def has_price_history(ticker: str, db: AsyncSession) -> bool:
    """Returns True if price_history has any rows for this ticker."""
    result = await db.execute(
        select(func.count()).select_from(PriceHistory).where(PriceHistory.ticker == ticker)
    )
    return (result.scalar() or 0) > 0


async def get_chart_data(ticker: str, period: str, db: AsyncSession) -> dict:
    """
    Returns OHLCV candles + SMA50 + SMA200 for the requested period.
    Fetches from yfinance if price_history is empty for this ticker.
    Works for ANY valid ticker symbol.
    """
    # Ensure data exists — fetch on demand for unknown tickers
    if not await has_price_history(ticker, db):
        await fetch_and_store_full_history(ticker, db)

    # Fetch candles for the period from DB
    days = PERIOD_DAYS.get(period, 365)
    cutoff = date.today() - timedelta(days=days)

    # For SMA200, we need 200 extra days of history before the cutoff
    sma_lookback = max(200, days)
    sma_cutoff = date.today() - timedelta(days=days + sma_lookback)

    result = await db.execute(
        select(PriceHistory)
        .where(PriceHistory.ticker == ticker)
        .where(PriceHistory.date >= sma_cutoff)
        .order_by(PriceHistory.date.asc())
    )
    all_rows = result.scalars().all()

    if not all_rows:
        return _empty_response(ticker, period)

    # Split: full set for SMA calc, trimmed for candles
    candles = []
    closes_all = []

    for row in all_rows:
        closes_all.append(float(row.close))
        if row.date >= cutoff:
            candles.append({
                "time": int(datetime.combine(row.date, datetime.min.time()).timestamp()),
                "open": float(row.open),
                "high": float(row.high),
                "low": float(row.low),
                "close": float(row.close),
                "volume": row.volume or 0,
            })

    # Calculate SMAs aligned to the candle window
    sma50 = _calc_sma(all_rows, cutoff, 50)
    sma200 = _calc_sma(all_rows, cutoff, 200)

    return {
        "ticker": ticker,
        "period": period,
        "candles": candles,
        "sma": {
            "sma50": sma50,
            "sma200": sma200,
        },
        "data_from": all_rows[0].date.isoformat() if all_rows else None,
        "data_to": all_rows[-1].date.isoformat() if all_rows else None,
        "candles_count": len(candles),
    }


def _fetch_history_sync(ticker: str) -> list[dict]:
    """
    Runs in thread pool executor. Downloads full OHLCV history from yfinance.
    Returns list of row dicts ready for bulk DB insert.
    """
    import pandas as pd

    logger.info(f"Fetching full price history for {ticker} from yfinance...")
    df = yf.download(ticker, period="max", auto_adjust=True, progress=False)
    if df is None or df.empty:
        logger.warning(f"yfinance returned no data for {ticker}")
        return []

    # yfinance returns MultiIndex columns when downloading single ticker too
    # Flatten if needed
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    rows = []
    for dt, row in df.iterrows():
        try:
            rows.append({
                "ticker": ticker,
                "date": dt.date(),
                "open": Decimal(str(round(float(row["Open"]), 6))),
                "high": Decimal(str(round(float(row["High"]), 6))),
                "low": Decimal(str(round(float(row["Low"]), 6))),
                "close": Decimal(str(round(float(row["Close"]), 6))),
                "volume": int(row["Volume"]) if not pd.isna(row["Volume"]) else 0,
            })
        except Exception as e:
            logger.debug(f"Skipping malformed row for {ticker} on {dt}: {e}")

    return rows


async def fetch_and_store_full_history(ticker: str, db: AsyncSession) -> int:
    """
    Fetches full OHLCV history from yfinance and bulk-upserts into price_history.
    Returns number of rows inserted. One-time operation — subsequent calls served from DB.
    """
    loop = asyncio.get_event_loop()
    try:
        rows = await loop.run_in_executor(_executor, _fetch_history_sync, ticker)
    except Exception as e:
        logger.error(f"yfinance history fetch failed for {ticker}: {e}")
        raise

    if not rows:
        return 0

    # Bulk upsert in chunks of 500
    inserted = 0
    chunk_size = 500
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i: i + chunk_size]
        stmt = pg_insert(PriceHistory).values(chunk).on_conflict_do_nothing(
            constraint="uq_pricehistory_ticker_date"
        )
        await db.execute(stmt)
        inserted += len(chunk)

    await db.commit()
    logger.info(f"Stored {inserted} candles for {ticker}")
    return inserted


# ─── Background preload ──────────────────────────────────────────────────────

async def preload_chart_history() -> None:
    """
    Called at startup via asyncio.create_task() — non-blocking.
    Pre-loads price_history for all known portfolio tickers so first chart open is instant.
    """
    async with AsyncSessionLocal() as db:
        for ticker in settings.known_tickers:
            try:
                if not await has_price_history(ticker, db):
                    await fetch_and_store_full_history(ticker, db)
                    await asyncio.sleep(0.5)  # brief pause between tickers
                else:
                    logger.debug(f"Chart history already cached: {ticker}")
            except Exception as e:
                logger.warning(f"Preload failed for {ticker}: {e} (non-critical)")


# ─── SMA helper ──────────────────────────────────────────────────────────────

def _calc_sma(rows: list, cutoff: date, window: int) -> list[dict]:
    """
    Calculates SMA(window) for all rows that fall on or after cutoff.
    Returns [{time: unix_ts, value: float}, ...] aligned with candle times.
    """
    if len(rows) < window:
        return []

    closes = [float(r.close) for r in rows]
    results = []

    for i, row in enumerate(rows):
        if row.date < cutoff:
            continue
        if i < window - 1:
            continue  # not enough history yet
        sma_val = sum(closes[i - window + 1 : i + 1]) / window
        results.append({
            "time": int(datetime.combine(row.date, datetime.min.time()).timestamp()),
            "value": round(sma_val, 4),
        })

    return results


def _empty_response(ticker: str, period: str) -> dict:
    return {
        "ticker": ticker,
        "period": period,
        "candles": [],
        "sma": {"sma50": [], "sma200": []},
        "data_from": None,
        "data_to": None,
        "candles_count": 0,
    }
