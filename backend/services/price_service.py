"""
Price Service — yfinance batch quote fetch + PostgreSQL cache.

Strategy:
  1. APScheduler calls refresh_all_prices() every 15 min → yfinance batch fetch (no API key needed)
  2. Store results in price_cache
  3. API reads from price_cache → <50ms (pure DB read)
  4. Fallback: if yfinance fails, return last known cached prices
"""
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from decimal import Decimal

import yfinance as yf
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database.db import AsyncSessionLocal
from backend.database.models import PriceCache

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="yfinance-price")


# ─── Public API ─────────────────────────────────────────────────────────────

async def refresh_all_prices() -> dict[str, Decimal]:
    """
    Fetches current prices for all known tickers via yfinance (no API key needed).
    Stores results in price_cache. Returns {ticker: price} dict.
    Called by APScheduler every PRICE_REFRESH_INTERVAL minutes.
    """
    async with AsyncSessionLocal() as db:
        return await _refresh_prices(db)


async def get_cached_prices(db: AsyncSession) -> dict[str, dict]:
    """
    Returns price_cache rows as {ticker: {price, change_pct_day, high_52w, low_52w, fetched_at}}.
    Does NOT trigger a refresh — caller decides when to refresh.
    """
    result = await db.execute(select(PriceCache))
    rows = result.scalars().all()
    return {
        row.ticker: {
            "current_price": row.current_price,
            "change_pct_day": row.change_pct_day,
            "high_52w": row.high_52w,
            "low_52w": row.low_52w,
            "market_cap": row.market_cap,
            "fetched_at": row.fetched_at,
        }
        for row in rows
    }


# ─── Internal ────────────────────────────────────────────────────────────────

def _fetch_quotes_sync(tickers: list[str]) -> list[dict]:
    """
    Runs in thread pool executor. Batch-fetches current quotes via yfinance fast_info.
    One network call per ticker (yfinance batches internally).
    """
    try:
        batch = yf.Tickers(" ".join(tickers))
        results = []
        for sym in tickers:
            try:
                fi = batch.tickers[sym].fast_info
                price = fi.last_price
                if price is None:
                    continue
                prev = fi.previous_close or price
                change_pct = ((price - prev) / prev * 100) if prev else None
                results.append({
                    "symbol": sym,
                    "price": price,
                    "change_pct": change_pct,
                    "high_52w": fi.year_high,
                    "low_52w": fi.year_low,
                    "market_cap": getattr(fi, "market_cap", None),
                })
            except Exception as e:
                logger.debug(f"fast_info failed for {sym}: {e}")
        return results
    except Exception as e:
        logger.error(f"yfinance batch fetch failed: {e}")
        return []


async def _refresh_prices(db: AsyncSession) -> dict[str, Decimal]:
    tickers = settings.known_tickers
    loop = asyncio.get_event_loop()

    try:
        data = await loop.run_in_executor(_executor, _fetch_quotes_sync, tickers)
    except Exception as e:
        logger.error(f"Price refresh executor failed: {e}")
        return {}

    if not data:
        logger.warning("yfinance returned no price data")
        return {}

    prices: dict[str, Decimal] = {}
    now = datetime.now(timezone.utc)

    for item in data:
        ticker = item["symbol"]
        price = item["price"]
        if price is None:
            continue

        stmt = pg_insert(PriceCache).values(
            ticker=ticker,
            current_price=Decimal(str(price)),
            change_pct_day=_safe_decimal(item.get("change_pct")),
            high_52w=_safe_decimal(item.get("high_52w")),
            low_52w=_safe_decimal(item.get("low_52w")),
            market_cap=_safe_decimal(item.get("market_cap")),
            source="yfinance",
            fetched_at=now,
        ).on_conflict_do_update(
            index_elements=["ticker"],
            set_={
                "current_price": Decimal(str(price)),
                "change_pct_day": _safe_decimal(item.get("change_pct")),
                "high_52w": _safe_decimal(item.get("high_52w")),
                "low_52w": _safe_decimal(item.get("low_52w")),
                "market_cap": _safe_decimal(item.get("market_cap")),
                "source": "yfinance",
                "fetched_at": now,
            },
        )
        await db.execute(stmt)
        prices[ticker] = Decimal(str(price))

    await db.commit()
    logger.info(f"Price refresh OK: {len(prices)} tickers")
    return prices


def _safe_decimal(value) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


# ─── FMP Financial Health (multi-year) ────────────────────────────────────────

async def get_financial_health_fmp(ticker: str) -> dict:
    """
    Fetches multi-year financial health data from FMP (income statement, cash flow,
    balance sheet). Returns structured scorecard with green/yellow/red signals.
    Returns empty dict for ETFs or when FMP key is missing.
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _fetch_fmp_health_sync, ticker)


def _fetch_fmp_health_sync(ticker: str) -> dict:
    """
    Fetches multi-year financial health using yfinance annual statements.
    Returns empty dict for ETFs (no revenue data).
    """
    try:
        import pandas as pd
        t = yf.Ticker(ticker)

        # ── Annual income statement ───────────────────────────────────────────
        inc = None
        for attr in ("income_stmt", "financials"):
            try:
                inc = getattr(t, attr)
                if inc is not None and not inc.empty:
                    break
            except Exception:
                pass

        if inc is None or inc.empty:
            return {}  # ETF or no data

        def _row(df, *names):
            for n in names:
                if n in df.index:
                    return df.loc[n]
            return None

        rev_row = _row(inc, "Total Revenue", "Operating Revenue")
        ni_row  = _row(inc, "Net Income", "Net Income Common Stockholders")

        if rev_row is None:
            return {}  # ETF / fund

        # ── Annual cash flow ──────────────────────────────────────────────────
        cf = None
        for attr in ("cash_flow_stmt", "cashflow"):
            try:
                cf = getattr(t, attr)
                if cf is not None and not cf.empty:
                    break
            except Exception:
                pass
        fcf_row = _row(cf, "Free Cash Flow") if cf is not None and not cf.empty else None

        # ── Balance sheet (latest) ────────────────────────────────────────────
        bs = None
        for attr in ("balance_sheet",):
            try:
                bs = getattr(t, attr)
                if bs is not None and not bs.empty:
                    break
            except Exception:
                pass
        debt_row = _row(bs, "Total Debt", "Long Term Debt") if bs is not None and not bs.empty else None

        # ── Build sorted series (columns = FY dates, newest first) ───────────
        cols = list(inc.columns)  # newest → oldest

        revenues: list[tuple[str, float]] = []
        margins:  list[tuple[str, float]] = []
        for col in cols:
            yr = col.strftime("%Y") if hasattr(col, "strftime") else str(col)[:4]
            rev = None
            if rev_row is not None:
                v = rev_row.get(col)
                if v is not None and not pd.isna(v):
                    rev = float(v)
            if rev is not None:
                revenues.append((yr, rev))
            ni = None
            if ni_row is not None:
                v = ni_row.get(col)
                if v is not None and not pd.isna(v):
                    ni = float(v)
            if rev and rev != 0 and ni is not None:
                margins.append((yr, round(ni / rev * 100, 1)))

        fcfs: list[tuple[str, float]] = []
        if fcf_row is not None and cf is not None:
            for col in list(cf.columns):
                yr = col.strftime("%Y") if hasattr(col, "strftime") else str(col)[:4]
                v = fcf_row.get(col)
                if v is not None and not pd.isna(v):
                    fcfs.append((yr, float(v)))

        latest_debt = 0.0
        if debt_row is not None and bs is not None:
            bc = list(bs.columns)
            if bc:
                v = debt_row.get(bc[0])
                if v is not None and not pd.isna(v):
                    latest_debt = float(v)

        latest_fcf = fcfs[0][1] if fcfs else 0.0

        # ── Signal helpers ────────────────────────────────────────────────────

        def _cagr_signal(values: list) -> str:
            if len(values) < 2:
                return "yellow"
            recent, old = values[0][1], values[-1][1]
            years = len(values) - 1
            if old == 0:
                return "yellow"
            try:
                cagr = (recent / old) ** (1 / years) - 1
            except Exception:
                return "yellow"
            return "green" if cagr > 0.03 else ("red" if cagr < 0 else "yellow")

        def _margin_signal(values: list) -> str:
            if len(values) < 2:
                return "yellow"
            latest = values[0][1]
            older  = values[min(2, len(values) - 1)][1]
            delta  = latest - older
            return "green" if delta > 1.0 else ("red" if delta < -1.0 else "yellow")

        def _debt_signal(debt: float, fcf: float) -> tuple[str, float | None]:
            if debt == 0:
                return "green", 0.0
            if fcf <= 0:
                return "red", None
            yrs = round(debt / fcf, 1)
            sig = "green" if yrs <= 3 else ("yellow" if yrs <= 5 else "red")
            return sig, yrs

        rev_signal    = _cagr_signal(revenues)
        margin_signal = _margin_signal(margins)
        fcf_signal    = _cagr_signal(fcfs)
        d_sig, d_yrs  = _debt_signal(latest_debt, latest_fcf)

        def _fmt5_b(items: list) -> list:
            return [{"year": y, "value": round(v / 1e9, 2)} for y, v in reversed(items[:4])]

        def _fmt5_pct(items: list) -> list:
            return [{"year": y, "value": v} for y, v in reversed(items[:4])]

        return {
            "revenue": {
                "signal":   rev_signal,
                "data":     _fmt5_b(revenues),
                "latest_b": round(revenues[0][1] / 1e9, 2) if revenues else None,
            },
            "net_margin": {
                "signal":     margin_signal,
                "data":       _fmt5_pct(margins),
                "latest_pct": margins[0][1] if margins else None,
            },
            "debt_payoff": {
                "signal": d_sig,
                "years":  d_yrs,
                "debt_b": round(latest_debt / 1e9, 2) if latest_debt else 0,
                "fcf_b":  round(latest_fcf / 1e9, 2) if latest_fcf > 0 else None,
            },
            "fcf": {
                "signal":   fcf_signal,
                "data":     _fmt5_b(fcfs),
                "latest_b": round(fcfs[0][1] / 1e9, 2) if fcfs else None,
            },
            "data_years": len(revenues),
            "source":     "yfinance",
        }

    except Exception as e:
        logger.warning(f"financial_health({ticker}) failed: {e}")
        return {}


# ─── Fundamentals fetch ───────────────────────────────────────────────────────

async def get_fundamentals(ticker: str) -> dict:
    """
    Fetches fundamental / valuation data for a single ticker via yfinance .info.
    Runs in thread executor (yfinance is synchronous).
    Returns an empty dict on failure — caller should handle gracefully.
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _fetch_fundamentals_sync, ticker)


def _fetch_fundamentals_sync(ticker: str) -> dict:
    from datetime import date as date_type
    try:
        t = yf.Ticker(ticker)
        info = t.info
        if not info or len(info) < 5:
            return {}

        def pct(v):
            return round(float(v) * 100, 1) if v is not None else None

        def num(v):
            return round(float(v), 2) if v is not None else None

        def bil(v):
            return round(float(v) / 1e9, 2) if v is not None else None

        def mil(v):
            return round(float(v) / 1e6, 1) if v is not None else None

        market_cap = info.get("marketCap")
        free_cashflow = info.get("freeCashflow")
        fcf_yield = None
        if free_cashflow and market_cap and market_cap > 0:
            fcf_yield = pct(free_cashflow / market_cap)

        total_debt = info.get("totalDebt") or 0
        total_cash = info.get("totalCash") or 0
        net_debt = total_debt - total_cash

        ebitda = info.get("ebitda")
        net_debt_ebitda = None
        if net_debt and ebitda and ebitda > 0:
            net_debt_ebitda = round(net_debt / ebitda, 2)

        # Ex-dividend date
        ex_div_date = None
        ex_div_raw = info.get("exDividendDate")
        if ex_div_raw:
            try:
                ex_div_date = date_type.fromtimestamp(int(ex_div_raw)).isoformat()
            except Exception:
                pass

        # Next earnings
        next_earnings = None
        for key in ("earningsTimestamp", "earningsTimestampStart"):
            raw = info.get(key)
            if raw:
                try:
                    next_earnings = date_type.fromtimestamp(int(raw)).isoformat()
                    break
                except Exception:
                    pass

        # Business summary — truncated at 550 chars
        biz = info.get("longBusinessSummary", "") or ""
        if len(biz) > 550:
            biz = biz[:550].rsplit(" ", 1)[0] + "…"

        # Analyst recommendation label
        rec_key = info.get("recommendationKey") or ""
        rec_label = {
            "strongbuy": "Strong Buy", "buy": "Buy",
            "hold": "Hold", "underperform": "Underperform", "sell": "Sell",
        }.get(rec_key.lower(), rec_key.capitalize() if rec_key else None)

        # Dividend frequency — count payments in last 12 months from history
        div_frequency = 4  # default quarterly
        try:
            divs = t.dividends
            if divs is not None and not divs.empty:
                import pandas as pd
                one_year_ago = pd.Timestamp.now(tz="UTC") - pd.DateOffset(years=1)
                recent = divs[divs.index >= one_year_ago]
                cnt = len(recent)
                if cnt >= 10:
                    div_frequency = 12   # monthly
                elif cnt >= 3:
                    div_frequency = 4    # quarterly
                elif cnt == 2:
                    div_frequency = 2    # semi-annual
                elif cnt == 1:
                    div_frequency = 1    # annual
        except Exception:
            pass

        result = {
            # Business identity
            "sector": info.get("sector") or info.get("fundFamily"),
            "industry": info.get("industry") or info.get("legalType"),
            "fund_category": info.get("category"),
            "business_summary": biz,

            # Valuation
            "trailing_pe": num(info.get("trailingPE")),
            "forward_pe": num(info.get("forwardPE")),
            "price_to_book": num(info.get("priceToBook")),
            "ev_to_ebitda": num(info.get("enterpriseToEbitda")),
            "peg_ratio": num(info.get("pegRatio")),
            "trailing_eps": num(info.get("trailingEps")),
            "forward_eps": num(info.get("forwardEps")),

            # Profitability
            "profit_margin_pct": pct(info.get("profitMargins")),
            "operating_margin_pct": pct(info.get("operatingMargins")),
            "gross_margin_pct": pct(info.get("grossMargins")),
            "roe_pct": pct(info.get("returnOnEquity")),
            "roa_pct": pct(info.get("returnOnAssets")),

            # Growth (YoY)
            "revenue_growth_pct": pct(info.get("revenueGrowth")),
            "earnings_growth_pct": pct(info.get("earningsGrowth")),

            # Cash flow
            "free_cashflow_m": mil(free_cashflow),
            "operating_cashflow_m": mil(info.get("operatingCashflow")),
            "fcf_yield_pct": fcf_yield,

            # Balance sheet
            "total_debt_b": bil(total_debt) if total_debt else None,
            "total_cash_b": bil(total_cash) if total_cash else None,
            "net_debt_b": bil(net_debt),
            "net_debt_ebitda": net_debt_ebitda,
            "debt_to_equity": num(info.get("debtToEquity")),
            "current_ratio": num(info.get("currentRatio")),

            # Dividend
            "dividend_yield_pct": num(info.get("dividendYield")),   # yfinance returns already as % (e.g. 6.95)
            "payout_ratio_pct": pct(info.get("payoutRatio")),
            "five_yr_avg_yield_pct": num(info.get("fiveYearAvgDividendYield")),
            "dividend_rate_usd": num(info.get("dividendRate")),
            "dividend_frequency": div_frequency,
            "ex_dividend_date": ex_div_date,

            # Technical / market
            "beta": num(info.get("beta")),
            "fifty_day_avg": num(info.get("fiftyDayAverage")),
            "two_hundred_day_avg": num(info.get("twoHundredDayAverage")),
            "short_percent_float": pct(info.get("shortPercentOfFloat")),
            "fifty_two_week_change_pct": pct(info.get("52WeekChange")),

            # Analyst consensus
            "analyst_target_mean": num(info.get("targetMeanPrice")),
            "analyst_target_high": num(info.get("targetHighPrice")),
            "analyst_target_low": num(info.get("targetLowPrice")),
            "analyst_count": info.get("numberOfAnalystOpinions"),
            "analyst_rec_label": rec_label,
        }

        # ── Recent news (last 5 headlines) ───────────────────────────────────
        news_items = []
        try:
            raw_news = t.news or []
            for item in raw_news[:5]:
                # yfinance >= 0.2.50 wraps everything inside item['content']
                content = item.get("content") or item
                title = content.get("title") or content.get("headline") or ""
                pub_str = content.get("pubDate") or content.get("displayTime") or ""
                pub_date = pub_str[:10] if pub_str else None  # ISO "2026-04-23T..."
                # publisher: nested provider.displayName or flat publisher/source
                provider = content.get("provider") or {}
                publisher = (provider.get("displayName")
                             or item.get("publisher")
                             or content.get("source") or "")
                if title:
                    news_items.append({"title": title, "publisher": publisher, "date": pub_date})
        except Exception as ne:
            logger.debug(f"news fetch skipped for {ticker}: {ne}")

        result["recent_news"] = news_items

        # ── Quarterly financials (last 4 quarters) ────────────────────────────
        quarterly_results = []
        try:
            import pandas as pd
            qf = None
            try:
                qf = t.quarterly_income_stmt
            except Exception:
                pass
            if qf is None or (hasattr(qf, "empty") and qf.empty):
                try:
                    qf = t.quarterly_financials
                except Exception:
                    pass
            if qf is not None and not qf.empty:
                # Try multiple possible revenue row names
                rev_row = next((r for r in ["Total Revenue", "Operating Revenue", "Net Revenue"]
                                if r in qf.index), None)
                ni_row  = next((r for r in ["Net Income", "Net Income Common Stockholders",
                                            "Net Income From Continuing Operation Net Minority Interest"]
                                if r in qf.index), None)
                for col in list(qf.columns)[:4]:
                    try:
                        q_date = (col.strftime("%Y-%m-%d")
                                  if hasattr(col, "strftime") else str(col)[:10])
                        rev = qf.loc[rev_row, col] if rev_row else None
                        ni  = qf.loc[ni_row,  col] if ni_row  else None
                        rev_m = round(float(rev) / 1e6, 1) if rev is not None and not pd.isna(rev) else None
                        ni_m  = round(float(ni)  / 1e6, 1) if ni  is not None and not pd.isna(ni)  else None
                        quarterly_results.append({"period": q_date, "revenue_m": rev_m, "net_income_m": ni_m})
                    except Exception:
                        pass
        except Exception as qe:
            logger.debug(f"quarterly_financials skipped for {ticker}: {qe}")

        result["quarterly_results"] = quarterly_results
        return result

    except Exception as e:
        logger.warning(f"get_fundamentals({ticker}) failed: {e}")
        return {}
