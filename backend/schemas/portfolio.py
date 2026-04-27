"""
Pydantic schemas for portfolio responses.
"""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, field_serializer


class PortfolioSummary(BaseModel):
    total_invested_usd: Decimal
    current_value_usd: Decimal
    total_dividends_usd: Decimal
    unrealized_pnl_usd: Decimal
    unrealized_pnl_pct: Decimal
    total_return_usd: Decimal
    total_return_pct: Decimal
    monthly_income_usd: Decimal
    annual_income_usd: Decimal
    yield_on_cost_pct: Decimal
    positions_count: int
    last_updated: Optional[datetime]

    @field_serializer(
        'total_invested_usd', 'current_value_usd', 'total_dividends_usd',
        'unrealized_pnl_usd', 'unrealized_pnl_pct', 'total_return_usd',
        'total_return_pct', 'monthly_income_usd', 'annual_income_usd',
        'yield_on_cost_pct',
    )
    def serialize_decimal(self, v: Decimal) -> float:
        return float(v)


class PositionOut(BaseModel):
    id: int
    ticker: str
    instrument_name: str
    instrument_type: str
    units: Decimal
    open_rate: Decimal
    open_date: Optional[date]
    current_price: Optional[Decimal] = None
    current_value: Optional[Decimal] = None
    unrealized_pnl: Optional[Decimal] = None
    unrealized_pnl_pct: Optional[Decimal] = None
    change_pct_day: Optional[Decimal] = None
    total_dividends: Optional[Decimal] = None

    model_config = {"from_attributes": True}

    @field_serializer(
        'units', 'open_rate', 'current_price', 'current_value',
        'unrealized_pnl', 'unrealized_pnl_pct', 'change_pct_day', 'total_dividends',
    )
    def serialize_decimal(self, v: Optional[Decimal]) -> Optional[float]:
        return float(v) if v is not None else None
