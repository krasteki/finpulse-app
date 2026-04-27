"""
Portfolio router — /api/portfolio

Endpoints:
  GET    /api/portfolio/summary              — KPI summary
  GET    /api/portfolio/positions            — All positions enriched with live prices
  GET    /api/portfolio/transactions         — All transactions
  POST   /api/portfolio/transactions         — Add a manual transaction
  DELETE /api/portfolio/transactions/{id}    — Delete a transaction
  GET    /api/portfolio/xirr                 — XIRR
  GET    /api/portfolio/cashflow             — Monthly deposits vs dividends
  GET    /api/portfolio/export/transactions  — CSV export
  GET    /api/portfolio/export/dividends     — CSV export
  GET    /api/portfolio/targets              — AI price zones (from cache)
  GET    /api/portfolio/benchmark            — Portfolio vs S&P500 / VTI
  GET    /api/portfolio/calendar             — Dividend calendar
"""
import csv
import io
import json
import logging
from datetime import date as date_type
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_session
from backend.database.models import Position, DividendPayment, Transaction
from backend.schemas.portfolio import PortfolioSummary, PositionOut
from backend.services.price_service import get_cached_prices

logger = logging.getLogger(__name__)
router = APIRouter()

ZERO = Decimal("0")


# ─── GET /api/portfolio/summary ─────────────────────────────────────────────

@router.get("/summary", response_model=PortfolioSummary)
async def get_portfolio_summary(db: AsyncSession = Depends(get_async_session)):
    positions = (await db.execute(select(Position))).scalars().all()
    prices = await get_cached_prices(db)

    total_invested = sum(p.units * p.open_rate for p in positions)
    current_value = ZERO
    last_updated = None

    for pos in positions:
        price_data = prices.get(pos.ticker)
        if price_data:
            current_value += pos.units * price_data["current_price"]
            if last_updated is None or (price_data["fetched_at"] and price_data["fetched_at"] > last_updated):
                last_updated = price_data["fetched_at"]
        else:
            # No price yet — use cost basis
            current_value += pos.units * pos.open_rate

    # Total dividends ever received
    div_result = await db.execute(
        select(func.coalesce(func.sum(DividendPayment.amount_usd), ZERO))
    )
    total_dividends = div_result.scalar() or ZERO

    # Trailing 12-month dividends anchored to last known data date
    ttm_result = await db.execute(
        text("""
            SELECT COALESCE(SUM(amount_usd), 0)
            FROM dividend_payments
            WHERE payment_date >= (
                SELECT MAX(payment_date) FROM dividend_payments
            ) - INTERVAL '12 months'
        """)
    )
    annual_income = ttm_result.scalar() or ZERO

    # Divide by actual months with data in that window
    months_result = await db.execute(
        text("""
            SELECT COUNT(DISTINCT TO_CHAR(payment_date, 'YYYY-MM'))
            FROM dividend_payments
            WHERE payment_date >= (
                SELECT MAX(payment_date) FROM dividend_payments
            ) - INTERVAL '12 months'
        """)
    )
    months_with_data = months_result.scalar() or 1
    monthly_income = annual_income / months_with_data

    unrealized_pnl = current_value - total_invested
    unrealized_pnl_pct = (unrealized_pnl / total_invested * 100) if total_invested else ZERO
    total_return = unrealized_pnl + total_dividends
    total_return_pct = (total_return / total_invested * 100) if total_invested else ZERO
    yield_on_cost = (annual_income / total_invested * 100) if total_invested else ZERO

    return PortfolioSummary(
        total_invested_usd=round(total_invested, 2),
        current_value_usd=round(current_value, 2),
        total_dividends_usd=round(total_dividends, 2),
        unrealized_pnl_usd=round(unrealized_pnl, 2),
        unrealized_pnl_pct=round(unrealized_pnl_pct, 2),
        total_return_usd=round(total_return, 2),
        total_return_pct=round(total_return_pct, 2),
        monthly_income_usd=round(monthly_income, 2),
        annual_income_usd=round(annual_income, 2),
        yield_on_cost_pct=round(yield_on_cost, 2),
        positions_count=len(positions),
        last_updated=last_updated,
    )


# ─── GET /api/portfolio/positions ───────────────────────────────────────────

@router.get("/positions", response_model=list[PositionOut])
async def get_positions(db: AsyncSession = Depends(get_async_session)):
    positions = (await db.execute(
        select(Position).order_by(Position.ticker)
    )).scalars().all()

    prices = await get_cached_prices(db)

    # Total dividends per ticker
    div_result = await db.execute(
        select(DividendPayment.ticker, func.sum(DividendPayment.amount_usd))
        .group_by(DividendPayment.ticker)
    )
    div_totals: dict[str, Decimal] = {row[0]: row[1] for row in div_result.fetchall()}

    out = []
    for pos in positions:
        price_data = prices.get(pos.ticker)
        current_price = price_data["current_price"] if price_data else None
        current_value = pos.units * current_price if current_price else None
        invested = pos.units * pos.open_rate
        pnl = (current_value - invested) if current_value is not None else None
        pnl_pct = (pnl / invested * 100) if (pnl is not None and invested) else None

        out.append(PositionOut(
            id=pos.id,
            ticker=pos.ticker,
            instrument_name=pos.instrument_name,
            instrument_type=pos.instrument_type,
            units=pos.units,
            open_rate=pos.open_rate,
            open_date=pos.open_date,
            current_price=round(current_price, 4) if current_price else None,
            current_value=round(current_value, 2) if current_value else None,
            unrealized_pnl=round(pnl, 2) if pnl is not None else None,
            unrealized_pnl_pct=round(pnl_pct, 2) if pnl_pct is not None else None,
            change_pct_day=price_data["change_pct_day"] if price_data else None,
            total_dividends=round(div_totals.get(pos.ticker, ZERO), 2),
        ))

    return out


# ─── GET /api/portfolio/transactions ────────────────────────────────────────

@router.get("/transactions")
async def get_transactions(
    ticker: str | None = None,
    db: AsyncSession = Depends(get_async_session),
):
    """
    All buy transactions — useful for tax declaration.
    Optional ?ticker=QYLD filter.
    """
    q = select(Transaction).order_by(Transaction.transaction_date.desc(), Transaction.ticker)
    if ticker:
        q = q.where(Transaction.ticker == ticker.upper())
    rows = (await db.execute(q)).scalars().all()

    # Total dividends per ticker for YoC context
    div_result = await db.execute(
        select(DividendPayment.ticker, func.sum(DividendPayment.amount_usd))
        .group_by(DividendPayment.ticker)
    )
    div_by_ticker: dict[str, Decimal] = {r[0]: r[1] for r in div_result.fetchall()}

    return [
        {
            "id": r.id,
            "etoro_id": r.etoro_id,
            "ticker": r.ticker,
            "action": r.action,
            "units": float(r.units),
            "price": float(r.price),
            "amount_usd": float(r.amount_usd),
            "transaction_date": r.transaction_date.isoformat(),
            "total_dividends_since": float(div_by_ticker.get(r.ticker, ZERO)),
        }
        for r in rows
    ]


# ─── POST /api/portfolio/transactions ───────────────────────────────────────

class TransactionCreate(BaseModel):
    ticker: str
    action: str       # BUY | SELL
    units: float
    price: float
    transaction_date: str   # YYYY-MM-DD

    @field_validator("action")
    @classmethod
    def validate_action(cls, v: str) -> str:
        v = v.upper()
        if v not in ("BUY", "SELL"):
            raise ValueError("action must be BUY or SELL")
        return v

    @field_validator("units", "price")
    @classmethod
    def validate_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("must be positive")
        return v


@router.post("/transactions", status_code=201)
async def create_transaction(
    data: TransactionCreate,
    db: AsyncSession = Depends(get_async_session),
):
    """Manually add a single BUY or SELL transaction."""
    try:
        tx_date = date_type.fromisoformat(data.transaction_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date. Use YYYY-MM-DD")

    ticker = data.ticker.strip().upper()
    units = Decimal(str(data.units))
    price = Decimal(str(data.price))

    tx = Transaction(
        ticker=ticker,
        action=data.action,
        units=units,
        price=price,
        amount_usd=units * price,
        transaction_date=tx_date,
    )
    db.add(tx)
    await db.commit()
    await db.refresh(tx)
    return {
        "id": tx.id,
        "ticker": tx.ticker,
        "action": tx.action,
        "units": float(tx.units),
        "price": float(tx.price),
        "amount_usd": float(tx.amount_usd),
        "transaction_date": tx.transaction_date.isoformat(),
    }


# ─── DELETE /api/portfolio/transactions/{tx_id} ──────────────────────────────

@router.delete("/transactions/{tx_id}")
async def delete_transaction(
    tx_id: int,
    db: AsyncSession = Depends(get_async_session),
):
    """Delete a transaction by ID."""
    tx = await db.get(Transaction, tx_id)
    if tx is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    await db.delete(tx)
    await db.commit()
    return {"deleted": tx_id}


# ─── GET /api/portfolio/xirr ────────────────────────────────────────────────

@router.get("/xirr")
async def get_xirr(db: AsyncSession = Depends(get_async_session)):
    """
    XIRR — Internal Rate of Return accounting for timing of cash flows.
    Cash outflows: each BUY transaction (negative).
    Cash inflows: all dividends received + current portfolio value (positive).
    """
    txs = (await db.execute(
        select(Transaction).order_by(Transaction.transaction_date)
    )).scalars().all()

    if not txs:
        return {"xirr_pct": None, "message": "No transactions"}

    divs = (await db.execute(select(DividendPayment))).scalars().all()

    positions = (await db.execute(select(Position))).scalars().all()
    prices = await get_cached_prices(db)

    current_value = sum(
        float(pos.units) * (float(prices[pos.ticker]["current_price"]) if pos.ticker in prices else float(pos.open_rate))
        for pos in positions
    )

    # Build cash flow list: (date, amount)
    flows: list[tuple[date_type, float]] = []
    for tx in txs:
        flows.append((tx.transaction_date, -float(tx.amount_usd)))  # outflow
    for div in divs:
        flows.append((div.payment_date, float(div.amount_usd)))     # inflow
    # Terminal value: current portfolio value today
    flows.append((date_type.today(), current_value))

    flows.sort(key=lambda x: x[0])
    dates = [f[0] for f in flows]
    amounts = [f[1] for f in flows]

    xirr_val = _xirr(dates, amounts)
    return {
        "xirr_pct": round(xirr_val * 100, 2) if xirr_val is not None else None,
        "cash_flows": len(flows),
        "current_value_usd": round(current_value, 2),
    }


# ─── GET /api/portfolio/cashflow ────────────────────────────────────────────

@router.get("/cashflow")
async def get_cashflow(db: AsyncSession = Depends(get_async_session)):
    """
    Monthly cash flow history: deposits (BUY txns) vs dividends received.
    Returns per-month data + summary stats.
    """
    from datetime import date as date_type
    from collections import defaultdict

    # ── Deposits: aggregate BUY transactions by month ──
    dep_rows = (await db.execute(
        select(Transaction.transaction_date, Transaction.amount_usd)
        .where(Transaction.action == "BUY")
        .order_by(Transaction.transaction_date)
    )).all()

    # ── Dividends: aggregate by month ──
    div_rows = (await db.execute(
        select(DividendPayment.payment_date, DividendPayment.amount_usd)
        .order_by(DividendPayment.payment_date)
    )).all()

    deposits_by_month: dict[str, float] = defaultdict(float)
    for row in dep_rows:
        key = row.transaction_date.strftime("%Y-%m")
        deposits_by_month[key] += float(row.amount_usd)

    dividends_by_month: dict[str, float] = defaultdict(float)
    for row in div_rows:
        key = row.payment_date.strftime("%Y-%m")
        dividends_by_month[key] += float(row.amount_usd)

    # Union of all months
    all_months = sorted(set(deposits_by_month) | set(dividends_by_month))

    monthly = [
        {
            "month": m,
            "deposits_usd": round(deposits_by_month.get(m, 0.0), 2),
            "dividends_usd": round(dividends_by_month.get(m, 0.0), 2),
        }
        for m in all_months
    ]

    # ── Summary ──
    total_deposited = sum(r.amount_usd for r in dep_rows)
    total_dividends = sum(r.amount_usd for r in div_rows)

    # Average monthly deposit — last 12 months with at least 1 deposit
    dep_months_12 = [
        deposits_by_month[m] for m in all_months[-12:]
        if deposits_by_month.get(m, 0) > 0
    ]
    avg_monthly_deposit = sum(dep_months_12) / len(dep_months_12) if dep_months_12 else 0.0

    self_sufficiency_pct = (
        round(float(total_dividends) / float(total_deposited) * 100, 1)
        if total_deposited > 0 else 0.0
    )

    return {
        "monthly": monthly,
        "summary": {
            "total_deposited_usd": round(float(total_deposited), 2),
            "total_dividends_usd": round(float(total_dividends), 2),
            "avg_monthly_deposit_usd": round(avg_monthly_deposit, 2),
            "self_sufficiency_pct": self_sufficiency_pct,
        },
    }


# ─── GET /api/portfolio/export/transactions ──────────────────────────────────

@router.get("/export/transactions")
async def export_transactions_csv(
    year: int | None = Query(default=None, ge=2000, le=2100),
    db: AsyncSession = Depends(get_async_session),
):
    """Download transactions as CSV. Optional ?year=2025 filter."""
    q = select(Transaction).order_by(Transaction.transaction_date.desc())
    if year:
        q = q.where(func.extract("year", Transaction.transaction_date) == year)
    rows = (await db.execute(q)).scalars().all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Date", "Ticker", "Action", "Units", "Price (USD)", "Amount (USD)"])
    for r in rows:
        writer.writerow([
            r.transaction_date.isoformat(),
            r.ticker,
            r.action,
            float(r.units),
            float(r.price),
            float(r.amount_usd),
        ])

    filename = f"transactions_{year or 'all'}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─── GET /api/portfolio/export/dividends ────────────────────────────────────

@router.get("/export/dividends")
async def export_dividends_csv(
    year: int | None = Query(default=None, ge=2000, le=2100),
    db: AsyncSession = Depends(get_async_session),
):
    """Download dividend payments as CSV. Optional ?year=2025 filter."""
    q = select(DividendPayment).order_by(DividendPayment.payment_date.desc())
    if year:
        q = q.where(func.extract("year", DividendPayment.payment_date) == year)
    rows = (await db.execute(q)).scalars().all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Date", "Ticker", "Amount (USD)"])
    for r in rows:
        writer.writerow([
            r.payment_date.isoformat(),
            r.ticker,
            float(r.amount_usd),
        ])

    filename = f"dividends_{year or 'all'}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─── GET /api/portfolio/targets ──────────────────────────────────────────────

@router.get("/targets")
async def get_portfolio_targets(db: AsyncSession = Depends(get_async_session)):
    """
    Returns AI-derived price zone for each portfolio ticker (only cached analyses).
    No new AI calls — reads from ai_analyses table.
    """
    from backend.database.models import AIAnalysis

    positions = (await db.execute(select(Position))).scalars().all()
    tickers = {p.ticker for p in positions}
    if not tickers:
        return []

    # Fetch cached analyses (non-expired) for portfolio tickers
    rows = (await db.execute(
        select(AIAnalysis.ticker, AIAnalysis.analysis_json, AIAnalysis.expires_at)
        .where(AIAnalysis.expires_at > text("NOW()"))
    )).fetchall()

    # Build ticker → analysis map (strip _en/_bg suffix)
    cache: dict[str, dict] = {}
    for row in rows:
        raw_ticker = row.ticker
        base = raw_ticker.replace("_en", "").replace("_bg", "")
        if base in tickers and base not in cache:
            try:
                cache[base] = json.loads(row.analysis_json)
            except Exception:
                pass

    out = []
    for ticker in sorted(tickers):
        analysis = cache.get(ticker)
        pt = analysis.get("price_targets") if analysis else None
        out.append({
            "ticker": ticker,
            "current_zone": pt.get("current_zone") if pt else None,
            "buy_below": pt.get("buy_below") if pt else None,
            "hold_range_low": pt.get("hold_range_low") if pt else None,
            "hold_range_high": pt.get("hold_range_high") if pt else None,
            "sell_above": pt.get("sell_above") if pt else None,
        })
    return out


# ─── GET /api/portfolio/benchmark ────────────────────────────────────────────

@router.get("/benchmark")
async def get_benchmark(
    period: str = Query(default="1Y", regex="^(1Y|3Y|5Y)$"),
    db: AsyncSession = Depends(get_async_session),
):
    """Compare portfolio return vs S&P500 (^GSPC) and VTI over the same period."""
    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    import yfinance as yf
    from datetime import date as date_type, timedelta

    period_days = {"1Y": 365, "3Y": 1095, "5Y": 1825}
    days = period_days[period]
    end_date = date_type.today()
    start_date = end_date - timedelta(days=days)

    def _fetch_index(symbol: str) -> float | None:
        try:
            df = yf.download(symbol, start=start_date.isoformat(), end=end_date.isoformat(),
                             progress=False, auto_adjust=True)
            if df.empty:
                return None
            close = df["Close"].squeeze().dropna()
            if close.empty:
                return None
            first = float(close.iloc[0])
            last = float(close.iloc[-1])
            if first == 0:
                return None
            return round((last - first) / first * 100, 2)
        except Exception:
            return None

    executor = ThreadPoolExecutor(max_workers=2)
    loop = asyncio.get_event_loop()
    sp500_task = loop.run_in_executor(executor, _fetch_index, "SPY")
    vti_task = loop.run_in_executor(executor, _fetch_index, "VTI")

    # Portfolio return: value at start_date vs value today
    # Holdings at start_date = positions that had transactions BEFORE start_date
    positions = (await db.execute(select(Position))).scalars().all()
    prices = await get_cached_prices(db)

    # Aggregate units held per ticker at start_date (using transactions)
    all_txs = (await db.execute(
        select(Transaction).where(Transaction.transaction_date <= start_date)
        .order_by(Transaction.transaction_date)
    )).scalars().all()

    # Units per ticker at start_date
    units_at_start: dict[str, float] = {}
    for tx in all_txs:
        units_at_start[tx.ticker] = units_at_start.get(tx.ticker, 0) + (
            float(tx.units) if tx.action == "BUY" else -float(tx.units)
        )
    units_at_start = {k: v for k, v in units_at_start.items() if v > 0}

    portfolio_return: float | None = None
    if units_at_start:
        tickers_needed = list(units_at_start.keys())

        def _fetch_start_prices(tickers: list[str]) -> dict[str, float]:
            """Fetch closing prices on/around start_date for each ticker."""
            result: dict[str, float] = {}
            try:
                from datetime import timedelta as td
                s = (start_date - td(days=5)).isoformat()
                e = (start_date + td(days=5)).isoformat()
                for tk in tickers:
                    try:
                        df = yf.download(tk, start=s, end=e,
                                         progress=False, auto_adjust=True)
                        if df.empty:
                            continue
                        close = df["Close"].squeeze().dropna()
                        if not close.empty:
                            result[tk] = float(close.iloc[-1])
                    except Exception:
                        pass
            except Exception:
                pass
            return result

        start_price_map = await loop.run_in_executor(executor, _fetch_start_prices, tickers_needed)

        value_at_start = sum(
            units_at_start[tk] * start_price_map[tk]
            for tk in units_at_start
            if tk in start_price_map
        )
        value_now = sum(
            float(pos.units) * (float(prices[pos.ticker]["current_price"]) if pos.ticker in prices else float(pos.open_rate))
            for pos in positions
        )

        # Cash flows AFTER start_date (Modified Dietz method)
        # BUY = capital inflow (+), SELL = capital outflow (-)
        later_txs = (await db.execute(
            select(Transaction).where(Transaction.transaction_date > start_date)
        )).scalars().all()

        total_days = max((end_date - start_date).days, 1)
        net_cf = 0.0
        weighted_cf = 0.0
        for tx in later_txs:
            tx_date = tx.transaction_date if hasattr(tx.transaction_date, "toordinal") else date_type.fromisoformat(str(tx.transaction_date)[:10])
            cost = float(tx.units) * float(tx.price)
            cf = cost if tx.action == "BUY" else -cost
            days_remaining = max((end_date - tx_date).days, 0)
            w = days_remaining / total_days
            net_cf += cf
            weighted_cf += w * cf

        denominator = value_at_start + weighted_cf
        if denominator > 0:
            portfolio_return = round((value_now - value_at_start - net_cf) / denominator * 100, 2)

    sp500_return, vti_return = await asyncio.gather(sp500_task, vti_task)

    outperformance = None
    if portfolio_return is not None and sp500_return is not None:
        outperformance = round(portfolio_return - sp500_return, 2)

    return {
        "period": period,
        "portfolio_return_pct": portfolio_return,
        "sp500_return_pct": sp500_return,
        "vti_return_pct": vti_return,
        "outperformance_pct": outperformance,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
    }


# ─── GET /api/portfolio/calendar ────────────────────────────────────────────

@router.get("/calendar")
async def get_dividend_calendar(db: AsyncSession = Depends(get_async_session)):
    """
    Dividend calendar — upcoming ex-dividend dates for all open positions.
    Fetches ex_dividend_date + dividend_rate from yfinance fundamentals for each ticker.
    Returns sorted list (soonest first). Only future dates included.
    """
    from datetime import date as date_type
    import asyncio
    from backend.services.price_service import get_fundamentals

    positions = (await db.execute(select(Position))).scalars().all()
    if not positions:
        return []

    # Fetch fundamentals for all tickers concurrently
    tasks = [get_fundamentals(pos.ticker) for pos in positions]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    today = date_type.today()
    calendar = []

    for pos, fund in zip(positions, results):
        if isinstance(fund, Exception) or not fund:
            continue
        ex_div_raw = fund.get("ex_dividend_date")
        if not ex_div_raw:
            continue
        try:
            ex_div = date_type.fromisoformat(ex_div_raw)
        except Exception:
            continue

        days_to = (ex_div - today).days

        calendar.append({
            "ticker": pos.ticker,
            "instrument_name": pos.instrument_name,
            "ex_div_date": ex_div.isoformat(),
            "days_to_ex_div": days_to,
            "dividend_rate_usd": fund.get("dividend_rate_usd"),
            "dividend_yield_pct": fund.get("dividend_yield_pct"),
            "dividend_frequency": fund.get("dividend_frequency"),
            "payout_ratio_pct": fund.get("payout_ratio_pct"),
            "units": float(pos.units),
            "est_payment_usd": round(
                float(pos.units) * fund["dividend_rate_usd"] / (fund.get("dividend_frequency") or 4), 2
            ) if fund.get("dividend_rate_usd") else None,
        })

    # Sort: upcoming first (ascending), then past (most recent first)
    calendar.sort(key=lambda x: x["days_to_ex_div"])
    return calendar


# ─── GET /api/portfolio/rebalance ────────────────────────────────────────────

@router.get("/rebalance")
async def get_rebalance_suggestions(db: AsyncSession = Depends(get_async_session)):
    """
    Rebalancing suggestions based on AI price zones and portfolio weights.
    Only uses cached AI analyses — no new AI calls.
    """
    from backend.database.models import AIAnalysis

    positions = (await db.execute(
        select(Position).order_by(Position.ticker)
    )).scalars().all()
    if not positions:
        return []

    prices = await get_cached_prices(db)

    total_value = sum(
        float(pos.units) * (
            float(prices[pos.ticker]["current_price"]) if pos.ticker in prices
            else float(pos.open_rate)
        )
        for pos in positions
    )

    # Cached AI analyses (non-expired)
    tickers = {p.ticker for p in positions}
    rows = (await db.execute(
        select(AIAnalysis.ticker, AIAnalysis.analysis_json)
        .where(AIAnalysis.expires_at > text("NOW()"))
    )).fetchall()

    cache: dict[str, dict] = {}
    for row in rows:
        base = row.ticker.replace("_en", "").replace("_bg", "")
        if base in tickers and base not in cache:
            try:
                cache[base] = json.loads(row.analysis_json)
            except Exception:
                pass

    ORDER = {"BUY": 0, "REDUCE": 1, "HOLD": 2, "NO_DATA": 3}
    suggestions = []
    for pos in positions:
        price_data = prices.get(pos.ticker)
        current_price = float(price_data["current_price"]) if price_data else float(pos.open_rate)
        current_value = float(pos.units) * current_price
        weight_pct = round(current_value / total_value * 100, 1) if total_value else None

        analysis = cache.get(pos.ticker)
        pt = analysis.get("price_targets") if analysis else None
        current_zone = pt.get("current_zone") if pt else None
        buy_below = pt.get("buy_below") if pt else None
        sell_above = pt.get("sell_above") if pt else None

        if not pt:
            action, reason = "NO_DATA", "No AI analysis cached — run analysis first"
        elif current_zone == "BUY":
            action = "BUY"
            reason = f"Price is in BUY zone (buy below {buy_below}). Consider adding."
        elif current_zone in ("SELL", "TRIM"):
            action = "REDUCE"
            if weight_pct and weight_pct > 25:
                reason = f"Price above sell target ({sell_above}) and high concentration ({weight_pct}%). Trim."
            else:
                reason = f"Price above sell target ({sell_above}). Consider reducing."
        elif current_zone == "HOLD":
            if weight_pct and weight_pct > 30:
                action = "REDUCE"
                reason = f"HOLD zone but high concentration ({weight_pct}%). Consider rebalancing."
            else:
                action = "HOLD"
                reason = "Price in hold range. Maintain current position."
        else:
            action, reason = "HOLD", "Maintain current position."

        suggestions.append({
            "ticker": pos.ticker,
            "instrument_name": pos.instrument_name,
            "current_zone": current_zone,
            "action": action,
            "reason": reason,
            "current_price": round(current_price, 4),
            "units": float(pos.units),
            "current_value": round(current_value, 2),
            "weight_pct": weight_pct,
            "buy_below": buy_below,
            "sell_above": sell_above,
        })

    suggestions.sort(key=lambda x: ORDER.get(x["action"], 4))
    return suggestions


# ─── GET /api/portfolio/whatif ────────────────────────────────────────────────

@router.get("/whatif")
async def get_whatif(
    ticker: str = Query(..., min_length=1, max_length=20),
    units: float = Query(..., gt=0, le=1_000_000),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Simulate adding `units` shares of `ticker` to the portfolio.
    Returns current vs new portfolio metrics.
    """
    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    import yfinance as yf

    ticker = ticker.upper().strip()

    positions = (await db.execute(select(Position))).scalars().all()
    prices = await get_cached_prices(db)

    current_value = sum(
        float(pos.units) * (
            float(prices[pos.ticker]["current_price"]) if pos.ticker in prices
            else float(pos.open_rate)
        )
        for pos in positions
    )

    # Current monthly income (TTM / 12)
    ttm_result = await db.execute(
        text("""
            SELECT COALESCE(SUM(amount_usd), 0)
            FROM dividend_payments
            WHERE payment_date >= (
                SELECT MAX(payment_date) FROM dividend_payments
            ) - INTERVAL '12 months'
        """)
    )
    ttm_income = float(ttm_result.scalar() or 0)
    current_monthly_income = ttm_income / 12

    # Weight of ticker before
    ticker_pos = next((p for p in positions if p.ticker == ticker), None)
    ticker_value_before = 0.0
    if ticker_pos:
        tp = float(prices[ticker]["current_price"]) if ticker in prices else float(ticker_pos.open_rate)
        ticker_value_before = float(ticker_pos.units) * tp
    ticker_weight_before = round(ticker_value_before / current_value * 100, 1) if current_value else 0.0

    # Fetch live price + dividend rate
    def _fetch_ticker_data(sym: str) -> dict:
        try:
            t = yf.Ticker(sym)
            price = float(getattr(t.fast_info, "last_price", None) or 0)
            full_info = t.info
            div_rate = float(full_info.get("dividendRate") or 0)
            name = full_info.get("shortName") or full_info.get("longName") or sym
            return {"price": price, "div_rate": div_rate, "name": name}
        except Exception:
            return {"price": 0.0, "div_rate": 0.0, "name": sym}

    loop = asyncio.get_event_loop()
    executor = ThreadPoolExecutor(max_workers=1)
    ticker_data = await loop.run_in_executor(executor, _fetch_ticker_data, ticker)

    current_price = ticker_data["price"]
    div_rate = ticker_data["div_rate"]  # annual USD per share
    cost_to_add = round(current_price * units, 2) if current_price else None

    new_value = current_value + (current_price * units if current_price else 0)
    new_monthly_income = current_monthly_income + (div_rate * units / 12 if div_rate else 0)

    ticker_value_after = ticker_value_before + (current_price * units if current_price else 0)
    ticker_weight_after = round(ticker_value_after / new_value * 100, 1) if new_value else 0.0

    pos_weights = {
        pos.ticker: float(pos.units) * (
            float(prices[pos.ticker]["current_price"]) if pos.ticker in prices else float(pos.open_rate)
        )
        for pos in positions
    }
    pos_weights[ticker] = pos_weights.get(ticker, 0.0) + (current_price * units if current_price else 0)
    top_concentration_after = round(max(pos_weights.values()) / new_value * 100, 1) if new_value else 0.0

    current_yield_pct = round(current_monthly_income * 12 / current_value * 100, 2) if current_value else 0.0
    new_yield_pct = round(new_monthly_income * 12 / new_value * 100, 2) if new_value else 0.0

    return {
        "ticker": ticker,
        "ticker_name": ticker_data["name"],
        "units_added": units,
        "current_price": round(current_price, 4) if current_price else None,
        "cost_to_add": cost_to_add,
        "annual_div_rate": round(div_rate, 4) if div_rate else None,
        "current_value": round(current_value, 2),
        "current_monthly_income": round(current_monthly_income, 2),
        "current_yield_pct": current_yield_pct,
        "ticker_weight_before": ticker_weight_before,
        "new_value": round(new_value, 2),
        "new_monthly_income": round(new_monthly_income, 2),
        "new_yield_pct": new_yield_pct,
        "ticker_weight_after": ticker_weight_after,
        "top_concentration_after": top_concentration_after,
        "delta_value": round(new_value - current_value, 2),
        "delta_monthly_income": round(new_monthly_income - current_monthly_income, 2),
        "delta_yield_pct": round(new_yield_pct - current_yield_pct, 2),
    }


# ─── GET /api/portfolio/history ──────────────────────────────────────────────

@router.get("/history")
async def get_portfolio_history(
    days: int = Query(default=365, ge=30, le=3650),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Daily portfolio value (USD) for the last N days.
    Uses price_history table (populated by chart_service) + transactions.
    Returns [{date, value_usd}, ...] — only trading days with price data.
    """
    from datetime import timedelta
    from backend.database.models import PriceHistory
    from sqlalchemy import and_

    today = date.today()
    start_date = today - timedelta(days=days)

    # All BUY/SELL transactions sorted by date
    txns = (await db.execute(
        select(Transaction)
        .where(Transaction.action.in_(["BUY", "SELL"]))
        .order_by(Transaction.transaction_date)
    )).scalars().all()

    if not txns:
        return []

    positions = (await db.execute(select(Position))).scalars().all()
    all_tickers = list({p.ticker for p in positions} | {t.ticker for t in txns})

    # Price history from DB
    hist_rows = (await db.execute(
        select(PriceHistory)
        .where(
            and_(
                PriceHistory.ticker.in_(all_tickers),
                PriceHistory.date >= start_date,
            )
        )
        .order_by(PriceHistory.date)
    )).scalars().all()

    # {ticker: {date: close}}
    prices_by_ticker: dict[str, dict] = {}
    for row in hist_rows:
        prices_by_ticker.setdefault(row.ticker, {})[row.date] = float(row.close)

    # Build initial holdings state (all transactions BEFORE start_date)
    holdings: dict[str, float] = {}
    for t in txns:
        if t.transaction_date < start_date:
            u = float(t.units)
            holdings[t.ticker] = holdings.get(t.ticker, 0.0) + (u if t.action == "BUY" else -u)

    # Pending transactions (within window)
    pending = [t for t in txns if t.transaction_date >= start_date]
    pending_idx = 0

    last_prices: dict[str, float] = {}
    results = []
    current = start_date

    while current <= today:
        # Apply transactions for this day
        while pending_idx < len(pending) and pending[pending_idx].transaction_date <= current:
            t = pending[pending_idx]
            u = float(t.units)
            holdings[t.ticker] = holdings.get(t.ticker, 0.0) + (u if t.action == "BUY" else -u)
            pending_idx += 1

        # Forward-fill prices
        has_new_price = False
        for ticker in all_tickers:
            p = prices_by_ticker.get(ticker, {}).get(current)
            if p is not None:
                last_prices[ticker] = p
                has_new_price = True

        # Only add data points for trading days (days with at least one price)
        if has_new_price:
            value = sum(
                units * last_prices[ticker]
                for ticker, units in holdings.items()
                if units > 0.001 and ticker in last_prices
            )
            if value > 0:
                results.append({"date": current.isoformat(), "value_usd": round(value, 2)})

        current += timedelta(days=1)

    return results


def _xirr(dates: list, amounts: list, guess: float = 0.1) -> float | None:
    """Newton-Raphson XIRR. Returns annual rate or None if no convergence."""
    from datetime import date as date_type
    if not dates:
        return None
    d0 = dates[0]
    years = [(d - d0).days / 365.25 for d in dates]

    rate = guess
    for _ in range(200):
        try:
            npv = sum(a / (1 + rate) ** t for a, t in zip(amounts, years))
            dnpv = sum(-t * a / (1 + rate) ** (t + 1) for a, t in zip(amounts, years))
            if dnpv == 0:
                break
            new_rate = rate - npv / dnpv
            if abs(new_rate - rate) < 1e-7:
                return new_rate
            rate = new_rate
        except (ZeroDivisionError, OverflowError):
            break
    return None
