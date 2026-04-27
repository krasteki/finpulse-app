"""
SQLAlchemy 2.0 ORM models — all 9 FinPulse tables.
"""
from datetime import datetime, date
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    BigInteger, Boolean, DateTime, Date, ForeignKey, Index,
    Integer, Numeric, String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database.db import Base


# ─── 1. POSITIONS ──────────────────────────────────────────────────────────

class Position(Base):
    __tablename__ = "positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    instrument_name: Mapped[str] = mapped_column(String(200), nullable=False)
    instrument_type: Mapped[str] = mapped_column(String(10), nullable=False)  # stock|etf|cfd
    units: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    open_rate: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    open_date: Mapped[Optional[date]] = mapped_column(Date)
    etoro_position_id: Mapped[Optional[str]] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    dividends: Mapped[list["DividendPayment"]] = relationship(back_populates="position")


# ─── 2. TRANSACTIONS ───────────────────────────────────────────────────────

class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    etoro_id: Mapped[Optional[str]] = mapped_column(String(50), unique=True)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False)
    action: Mapped[str] = mapped_column(String(10), nullable=False)  # BUY|SELL
    units: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    amount_usd: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_transactions_ticker_date", "ticker", "transaction_date"),
    )


# ─── 3. DIVIDEND PAYMENTS ──────────────────────────────────────────────────

class DividendPayment(Base):
    __tablename__ = "dividend_payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    position_id: Mapped[int] = mapped_column(ForeignKey("positions.id"), nullable=False)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False)
    amount_usd: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    units_at_payment: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 6))
    dps: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 6))  # dividend per share
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    position: Mapped["Position"] = relationship(back_populates="dividends")

    __table_args__ = (
        Index("idx_divpayments_ticker_date", "ticker", "payment_date"),
    )


# ─── 4. PRICE CACHE ────────────────────────────────────────────────────────

class PriceCache(Base):
    __tablename__ = "price_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    current_price: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    change_pct_day: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 4))
    high_52w: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 6))
    low_52w: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 6))
    market_cap: Mapped[Optional[Decimal]] = mapped_column(Numeric(24, 2))
    source: Mapped[str] = mapped_column(String(20), default="fmp")
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── 5. PRICE HISTORY ──────────────────────────────────────────────────────

class PriceHistory(Base):
    __tablename__ = "price_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    open: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    high: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    low: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    close: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    volume: Mapped[Optional[int]] = mapped_column(BigInteger)

    __table_args__ = (
        UniqueConstraint("ticker", "date", name="uq_pricehistory_ticker_date"),
        Index("idx_pricehistory_ticker_date", "ticker", "date"),
    )


# ─── 6. AI ANALYSES ────────────────────────────────────────────────────────

class AIAnalysis(Base):
    __tablename__ = "ai_analyses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False)
    analysis_json: Mapped[str] = mapped_column(Text, nullable=False)  # full JSON
    model_used: Mapped[str] = mapped_column(String(50), default="gpt-4o-mini")
    tokens_used: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("idx_aianalyses_ticker_created", "ticker", "created_at"),
    )


# ─── 7. IMPORT RUNS ────────────────────────────────────────────────────────

class ImportRun(Base):
    __tablename__ = "import_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    rows_processed: Mapped[int] = mapped_column(Integer, default=0)
    dividends_added: Mapped[int] = mapped_column(Integer, default=0)
    transactions_added: Mapped[int] = mapped_column(Integer, default=0)
    positions_updated: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|success|error
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── 8. APP SETTINGS ───────────────────────────────────────────────────────

class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ─── 9. DIVIDEND HISTORY ───────────────────────────────────────────────────

class DividendHistory(Base):
    __tablename__ = "dividend_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    annual_dps: Mapped[Decimal] = mapped_column(Numeric(12, 6), nullable=False)
    payments_count: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str] = mapped_column(String(20), default="fmp")
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("ticker", "year", name="uq_divhistory_ticker_year"),
        Index("idx_divhistory_ticker_year", "ticker", "year"),
    )


# ─── 10. ALERTS ────────────────────────────────────────────────────────────

class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False)
    alert_type: Mapped[str] = mapped_column(String(20), nullable=False)  # PRICE_ABOVE|PRICE_BELOW|YIELD_ABOVE|RSI_BELOW|RSI_ABOVE
    threshold: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    triggered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_alerts_ticker_active", "ticker", "is_active"),
    )


# ─── 11. WATCHLIST ─────────────────────────────────────────────────────────

class WatchlistItem(Base):
    __tablename__ = "watchlist"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    target_price: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 6))
    note: Mapped[Optional[str]] = mapped_column(Text)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
