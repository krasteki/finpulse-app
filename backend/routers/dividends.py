"""
Dividends router — /api/dividends

Endpoints:
  GET /api/dividends/summary     — KPI: total, TTM, monthly avg, YoC per ticker
  GET /api/dividends/monthly     — Monthly totals for bar chart (last N months)
  GET /api/dividends/{ticker}    — All payments for a single ticker
"""
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import select, func, text, extract
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_session
from backend.database.models import DividendPayment, Position

router = APIRouter()
ZERO = Decimal("0")


# ─── GET /api/dividends/summary ─────────────────────────────────────────────

@router.get("/summary")
async def get_dividends_summary(db: AsyncSession = Depends(get_async_session)):
    # Total ever
    total_result = await db.execute(
        select(func.coalesce(func.sum(DividendPayment.amount_usd), ZERO))
    )
    total = total_result.scalar() or ZERO

    # TTM: 12 months ending at the last date with data (not CURRENT_DATE)
    # This avoids penalizing months with no data due to data cutoff
    ttm_result = await db.execute(
        text("""
            SELECT COALESCE(SUM(amount_usd), 0)
            FROM dividend_payments
            WHERE payment_date >= (
                SELECT MAX(payment_date) FROM dividend_payments
            ) - INTERVAL '12 months'
        """)
    )
    ttm = ttm_result.scalar() or ZERO

    # Count distinct months with actual payments in that TTM window
    months_count_result = await db.execute(
        text("""
            SELECT COUNT(DISTINCT TO_CHAR(payment_date, 'YYYY-MM'))
            FROM dividend_payments
            WHERE payment_date >= (
                SELECT MAX(payment_date) FROM dividend_payments
            ) - INTERVAL '12 months'
        """)
    )
    months_with_data = months_count_result.scalar() or 1
    monthly_avg = Decimal(str(ttm)) / months_with_data

    # Per-ticker breakdown
    per_ticker = await db.execute(
        select(
            DividendPayment.ticker,
            func.sum(DividendPayment.amount_usd).label("total"),
            func.count(DividendPayment.id).label("payments"),
            func.max(DividendPayment.payment_date).label("last_payment"),
        ).group_by(DividendPayment.ticker)
        .order_by(func.sum(DividendPayment.amount_usd).desc())
    )

    positions_result = await db.execute(select(Position))
    positions = {p.ticker: p for p in positions_result.scalars().all()}

    tickers = []
    for row in per_ticker.fetchall():
        pos = positions.get(row.ticker)
        invested = (pos.units * pos.open_rate) if pos else ZERO
        yoc = (Decimal(str(row.total)) / invested * 100) if invested else ZERO
        tickers.append({
            "ticker": row.ticker,
            "total_usd": round(Decimal(str(row.total)), 2),
            "payments_count": row.payments,
            "last_payment": row.last_payment.isoformat() if row.last_payment else None,
            "yield_on_cost_pct": round(yoc, 2),
        })

    return {
        "total_usd": round(total, 2),
        "ttm_usd": round(Decimal(str(ttm)), 2),
        "monthly_avg_usd": round(monthly_avg, 2),
        "by_ticker": tickers,
    }


# ─── GET /api/dividends/monthly ─────────────────────────────────────────────

@router.get("/monthly")
async def get_monthly_dividends(
    months: int = 36,
    db: AsyncSession = Depends(get_async_session),
):
    """Returns monthly dividend totals per ticker for stacked bar chart."""
    result = await db.execute(
        text(f"""
            SELECT
                TO_CHAR(payment_date, 'YYYY-MM') AS month,
                ticker,
                SUM(amount_usd) AS total
            FROM dividend_payments
            WHERE payment_date >= CURRENT_DATE - INTERVAL '{months} months'
            GROUP BY month, ticker
            ORDER BY month ASC, ticker ASC
        """)
    )
    rows = result.fetchall()

    # Pivot into [{month, QYLD: x, BHP: y, ...}, ...]
    months_map: dict[str, dict] = {}
    tickers_seen: set[str] = set()
    for row in rows:
        m = row[0]
        t = row[1]
        v = float(row[2])
        tickers_seen.add(t)
        if m not in months_map:
            months_map[m] = {"month": m}
        months_map[m][t] = round(v, 2)

    return {
        "tickers": sorted(tickers_seen),
        "data": list(months_map.values()),
    }


# ─── GET /api/dividends/{ticker} ────────────────────────────────────────────

@router.get("/{ticker}")
async def get_ticker_dividends(
    ticker: str,
    db: AsyncSession = Depends(get_async_session),
):
    ticker = ticker.upper()
    result = await db.execute(
        select(DividendPayment)
        .where(DividendPayment.ticker == ticker)
        .order_by(DividendPayment.payment_date.desc())
    )
    payments = result.scalars().all()
    return [
        {
            "id": p.id,
            "ticker": p.ticker,
            "amount_usd": float(p.amount_usd),
            "payment_date": p.payment_date.isoformat(),
        }
        for p in payments
    ]
