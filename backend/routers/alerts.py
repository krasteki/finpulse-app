"""
Alerts router — /api/alerts

GET    /api/alerts          — list all alerts
POST   /api/alerts          — create alert
DELETE /api/alerts/{id}     — delete alert
POST   /api/alerts/check    — manually trigger check (dev/debug)
"""
import logging
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_session
from backend.database.models import Alert
from backend.services.price_service import get_cached_prices

logger = logging.getLogger(__name__)
router = APIRouter()

VALID_TYPES = {"PRICE_ABOVE", "PRICE_BELOW", "YIELD_ABOVE", "RSI_BELOW", "RSI_ABOVE"}


class AlertCreate(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=20)
    alert_type: str
    threshold: float = Field(..., gt=0)
    note: str | None = None


# ─── GET /api/alerts ─────────────────────────────────────────────────────────

@router.get("")
async def list_alerts(db: AsyncSession = Depends(get_async_session)):
    rows = (await db.execute(
        select(Alert).order_by(Alert.created_at.desc())
    )).scalars().all()

    return [
        {
            "id": r.id,
            "ticker": r.ticker,
            "alert_type": r.alert_type,
            "threshold": float(r.threshold),
            "note": r.note,
            "is_active": r.is_active,
            "triggered_at": r.triggered_at.isoformat() if r.triggered_at else None,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


# ─── POST /api/alerts ────────────────────────────────────────────────────────

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_alert(
    body: AlertCreate,
    db: AsyncSession = Depends(get_async_session),
):
    if body.alert_type not in VALID_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid alert_type. Valid values: {sorted(VALID_TYPES)}",
        )

    alert = Alert(
        ticker=body.ticker.upper(),
        alert_type=body.alert_type,
        threshold=Decimal(str(body.threshold)),
        note=body.note,
        is_active=True,
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)

    return {
        "id": alert.id,
        "ticker": alert.ticker,
        "alert_type": alert.alert_type,
        "threshold": float(alert.threshold),
        "note": alert.note,
        "is_active": alert.is_active,
        "triggered_at": None,
        "created_at": alert.created_at.isoformat(),
    }


# ─── DELETE /api/alerts/{id} ─────────────────────────────────────────────────

@router.delete("/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert(
    alert_id: int,
    db: AsyncSession = Depends(get_async_session),
):
    alert = await db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    await db.delete(alert)
    await db.commit()


# ─── POST /api/alerts/check — manual trigger ─────────────────────────────────

@router.post("/check")
async def check_alerts(db: AsyncSession = Depends(get_async_session)):
    """
    Evaluate all active alerts against current cached prices.
    Marks triggered_at on those that fire.
    """
    from datetime import datetime, timezone

    active = (await db.execute(
        select(Alert).where(Alert.is_active == True)  # noqa: E712
    )).scalars().all()

    if not active:
        return {"checked": 0, "triggered": 0}

    prices = await get_cached_prices(db)
    triggered_count = 0

    for alert in active:
        price_data = prices.get(alert.ticker)
        if not price_data:
            continue

        current_price = float(price_data.get("current_price", 0))
        threshold = float(alert.threshold)
        fired = False

        if alert.alert_type == "PRICE_ABOVE" and current_price >= threshold:
            fired = True
        elif alert.alert_type == "PRICE_BELOW" and current_price <= threshold:
            fired = True
        # YIELD_ABOVE / RSI checks would need additional data — skip for now

        if fired:
            alert.is_active = False
            alert.triggered_at = datetime.now(timezone.utc)
            triggered_count += 1
            logger.info("Alert %d fired: %s %s %.4f (current: %.4f)",
                        alert.id, alert.ticker, alert.alert_type, threshold, current_price)

    await db.commit()
    return {"checked": len(active), "triggered": triggered_count}


# ─── Standalone scheduler job ─────────────────────────────────────────────────

async def run_alert_check_job() -> None:
    """Callable by APScheduler — creates its own DB session."""
    from backend.database.db import AsyncSessionLocal
    from datetime import datetime, timezone

    async with AsyncSessionLocal() as db:
        active = (await db.execute(
            select(Alert).where(Alert.is_active == True)  # noqa: E712
        )).scalars().all()

        if not active:
            return

        prices = await get_cached_prices(db)
        triggered_count = 0

        for alert in active:
            price_data = prices.get(alert.ticker)
            if not price_data:
                continue

            current_price = float(price_data.get("current_price", 0))
            threshold = float(alert.threshold)
            fired = False

            if alert.alert_type == "PRICE_ABOVE" and current_price >= threshold:
                fired = True
            elif alert.alert_type == "PRICE_BELOW" and current_price <= threshold:
                fired = True

            if fired:
                alert.is_active = False
                alert.triggered_at = datetime.now(timezone.utc)
                triggered_count += 1
                logger.info("Alert %d fired: %s %s %.4f (current: %.4f)",
                            alert.id, alert.ticker, alert.alert_type, threshold, current_price)

        await db.commit()
        if triggered_count:
            logger.info("Alert check complete — %d triggered", triggered_count)
