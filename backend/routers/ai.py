"""
AI Analysis router — /api/ai

Endpoints:
  GET /api/ai/analysis/{ticker}   — AI analysis (cached 6h)
  DELETE /api/ai/analysis/{ticker} — Invalidate cache (force refresh)
"""
import asyncio
import logging
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database.db import get_async_session
from backend.database.models import AIAnalysis, Position, PriceCache, DividendPayment
from backend.services.ai_service import get_ai_analysis
from backend.services.price_service import get_fundamentals, get_financial_health_fmp

router = APIRouter()
logger = logging.getLogger(__name__)


def _dec(v) -> float | None:
    if v is None:
        return None
    return float(v)


@router.get("/analysis/{ticker}")
async def ai_analysis(ticker: str, lang: str = "en", db: AsyncSession = Depends(get_async_session)):
    ticker = ticker.upper()

    if not settings.github_token and not settings.openai_api_key:
        raise HTTPException(
            status_code=503,
            detail="No AI key configured. Set GITHUB_TOKEN or OPENAI_API_KEY in .env",
        )

    # Build context from DB
    position_row = await db.scalar(
        select(Position).where(Position.ticker == ticker).limit(1)
    )
    price_row = await db.scalar(
        select(PriceCache).where(PriceCache.ticker == ticker).limit(1)
    )

    # Dividend summary for this ticker
    from sqlalchemy import func
    div_result = await db.execute(
        select(
            func.sum(DividendPayment.amount_usd).label("total"),
            func.count(DividendPayment.id).label("count"),
        ).where(DividendPayment.ticker == ticker)
    )
    div_row = div_result.one()

    context: dict = {}

    if position_row and price_row:
        current_price = _dec(price_row.current_price)
        units = _dec(position_row.units)
        open_rate = _dec(position_row.open_rate)
        current_value = round(units * current_price, 2) if units and current_price else None
        cost_basis = round(units * open_rate, 2) if units and open_rate else None
        unrealized_pnl = round(current_value - cost_basis, 2) if current_value and cost_basis else None
        unrealized_pnl_pct = round((unrealized_pnl / cost_basis) * 100, 2) if unrealized_pnl and cost_basis else None
        context["position"] = {
            "units": units,
            "open_rate": open_rate,
            "current_price": current_price,
            "current_value": current_value,
            "unrealized_pnl": unrealized_pnl,
            "unrealized_pnl_pct": unrealized_pnl_pct,
            "total_dividends": _dec(div_row.total) if div_row.total else 0,
        }
    elif position_row:
        context["position"] = {
            "units": _dec(position_row.units),
            "open_rate": _dec(position_row.open_rate),
            "current_price": None,
            "current_value": None,
            "unrealized_pnl": None,
            "unrealized_pnl_pct": None,
            "total_dividends": _dec(div_row.total) if div_row.total else 0,
        }

    if price_row:
        context["price"] = {
            "year_high": _dec(price_row.high_52w),
            "year_low": _dec(price_row.low_52w),
            "market_cap": _dec(price_row.market_cap),
        }

    if div_row.total and position_row:
        units_f = float(position_row.units) if position_row.units else 0
        open_rate_f = float(position_row.open_rate) if position_row.open_rate else 0
        annual = float(div_row.total) / 3  # rough 3-year average
        context["dividends"] = {
            "yield_on_cost_pct": round(
                annual / (units_f * open_rate_f) * 100, 2
            ) if units_f and open_rate_f else None,
            "annual_income": round(annual, 2),
            "monthly_income": round(annual / 12, 2),
        }

    # Fetch fundamentals + FMP financial health in parallel
    fundamentals: dict = {}
    scorecard: dict = {}
    try:
        res_fund, res_score = await asyncio.gather(
            get_fundamentals(ticker),
            get_financial_health_fmp(ticker),
            return_exceptions=True,
        )
        if isinstance(res_fund, dict) and res_fund:
            fundamentals = res_fund
            context["fundamentals"] = fundamentals
        elif isinstance(res_fund, Exception):
            logger.warning(f"fundamentals fetch failed for {ticker}: {res_fund}")

        if isinstance(res_score, dict) and res_score:
            scorecard = res_score
            context["financial_scorecard"] = scorecard
        elif isinstance(res_score, Exception):
            logger.warning(f"financial_health_fmp failed for {ticker}: {res_score}")
    except Exception as e:
        logger.warning(f"data gather failed for {ticker}: {e}")

    try:
        result = await get_ai_analysis(ticker, context, db, lang=lang)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"AI analysis failed for {ticker}: {e}")
        raise HTTPException(status_code=502, detail=f"AI service error: {e}")

    return {
        "ticker": ticker,
        **result,
        **({"fundamental_scorecard": scorecard} if scorecard else {}),
    }


@router.delete("/analysis/{ticker}")
async def invalidate_ai_cache(ticker: str, db: AsyncSession = Depends(get_async_session)):
    ticker = ticker.upper()
    # Delete all language variants: QYLD_en, QYLD_bg, and legacy QYLD
    from sqlalchemy import or_
    await db.execute(
        delete(AIAnalysis).where(
            or_(
                AIAnalysis.ticker == ticker,
                AIAnalysis.ticker == f"{ticker}_en",
                AIAnalysis.ticker == f"{ticker}_bg",
            )
        )
    )
    await db.commit()
    return {"ticker": ticker, "cache": "cleared"}
