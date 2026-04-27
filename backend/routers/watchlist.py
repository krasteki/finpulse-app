"""
Watchlist router — /api/watchlist

GET    /api/watchlist         — list all items enriched with live prices
POST   /api/watchlist         — add ticker  {"ticker": "AAPL", "target_price": 150, "note": "..."}
DELETE /api/watchlist/{id}    — remove item
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_session
from backend.database.models import WatchlistItem
from backend.services.price_service import get_cached_prices

logger = logging.getLogger(__name__)
router = APIRouter()


class WatchlistCreate(BaseModel):
    ticker: str
    target_price: float | None = None
    note: str | None = None


@router.get("")
async def get_watchlist(db: AsyncSession = Depends(get_async_session)):
    """Return all watchlist items enriched with current price from cache."""
    items = (await db.execute(
        select(WatchlistItem).order_by(WatchlistItem.added_at.desc())
    )).scalars().all()

    if not items:
        return []

    prices = await get_cached_prices(db)

    result = []
    for item in items:
        ticker = item.ticker.upper()
        price_data = prices.get(ticker, {})
        current_price = float(price_data["current_price"]) if price_data.get("current_price") else None
        change_pct = float(price_data["change_pct_day"]) if price_data.get("change_pct_day") else None

        # Distance to target
        dist_to_target = None
        if current_price and item.target_price:
            dist_to_target = round(
                (float(item.target_price) - current_price) / current_price * 100, 2
            )

        result.append({
            "id": item.id,
            "ticker": ticker,
            "name": item.name,
            "target_price": float(item.target_price) if item.target_price else None,
            "note": item.note,
            "added_at": item.added_at.isoformat(),
            "current_price": current_price,
            "change_pct_day": change_pct,
            "dist_to_target_pct": dist_to_target,
        })

    return result


@router.post("")
async def add_to_watchlist(
    body: WatchlistCreate,
    db: AsyncSession = Depends(get_async_session),
):
    ticker = body.ticker.upper().strip()
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker is required")

    # Check duplicate
    existing = (await db.execute(
        select(WatchlistItem).where(WatchlistItem.ticker == ticker)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail=f"{ticker} is already in watchlist")

    # Try to get name from price cache
    prices = await get_cached_prices(db)
    name = ticker  # fallback
    # (yfinance name lookup happens lazily — we store ticker as name for now,
    #  frontend can enrich via /api/ticker/info/{ticker} separately)

    item = WatchlistItem(
        ticker=ticker,
        name=name,
        target_price=body.target_price,
        note=body.note,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)

    return {"id": item.id, "ticker": item.ticker, "added": True}


@router.delete("/{item_id}")
async def remove_from_watchlist(
    item_id: int,
    db: AsyncSession = Depends(get_async_session),
):
    item = (await db.execute(
        select(WatchlistItem).where(WatchlistItem.id == item_id)
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Watchlist item not found")

    await db.delete(item)
    await db.commit()
    return {"deleted": True, "id": item_id}
