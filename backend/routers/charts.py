"""
Charts router — /api/charts

Endpoints:
  GET /api/charts/{ticker}?period=1Y  — OHLCV candles + SMA50 + SMA200
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_session
from backend.services.chart_service import get_chart_data

router = APIRouter()

ChartPeriod = Literal["1W", "1M", "3M", "6M", "1Y", "5Y", "MAX"]


@router.get("/{ticker}")
async def get_chart(
    ticker: str,
    period: ChartPeriod = "1Y",
    db: AsyncSession = Depends(get_async_session),
):
    ticker = ticker.upper()
    try:
        return await get_chart_data(ticker, period, db)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Chart data unavailable: {e}")
