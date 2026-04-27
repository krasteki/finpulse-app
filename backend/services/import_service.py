"""
eToro XLSX Import Service.

Парсира eToro account statement и зарежда:
  1. positions        — от Account Activity (Open Position редове)
  2. dividend_payments — от Dividends sheet
  3. transactions     — от Account Activity (Open Position редове)

Usage:
    result = await import_etoro_xlsx(file_path, db)
"""
import logging
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend.database.models import (
    Position, DividendPayment, Transaction, ImportRun,
)

logger = logging.getLogger(__name__)

# ─── Instrument Name → Ticker mapping ──────────────────────────────────────
# Covers all instrument names seen in the eToro Dividends sheet.
INSTRUMENT_TO_TICKER: dict[str, str] = {
    "BHP Group Ltd ADR": "BHP",
    "Canadian Natural Resources Ltd": "CNQ",
    "Energy Transfer LP": "ET",
    "Global SuperDividend US ETF": "DIV",
    "Global X Nasdaq 100 Covered Call ETF": "QYLD",
    "International Business Machines Corporation (IBM)": "IBM",
    "Invesco QQQ": "QQQ",
    "Invesco S&P 500 High Dividend Low Volatility ETF": "SPHD",
    "Jpmorgan Equity Premium Inco": "JEPI",
    "Prospect Capital Corp": "PSEC",
    "Vanguard Total Stock Market ETF": "VTI",
    # SXR8.DE pays no dividends (accumulating ETF)
}


# ─── Helpers ────────────────────────────────────────────────────────────────

def _parse_date(value: Any) -> date | None:
    """Парсира дата от различни формати на eToro."""
    if pd.isna(value):
        return None
    if isinstance(value, (datetime, pd.Timestamp)):
        return value.date()
    if isinstance(value, date):
        return value
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(value).strip(), fmt).date()
        except ValueError:
            continue
    return None


def _parse_decimal(value: Any) -> Decimal | None:
    if pd.isna(value):
        return None
    try:
        return Decimal(str(value).strip().replace(",", ""))
    except InvalidOperation:
        return None


def _ticker_from_details(details: str) -> str:
    """'QYLD/USD' → 'QYLD',  'SXR8.DE/EUR' → 'SXR8.DE'"""
    return details.split("/")[0].strip()


# ─── Main import logic ───────────────────────────────────────────────────────

async def import_etoro_xlsx(file_path: str | Path, db: AsyncSession) -> dict:
    """
    Imports an eToro XLSX statement into the database.

    Returns a summary dict with counts of added/updated records.
    Idempotent: re-running with the same file is safe (upsert logic).
    """
    file_path = Path(file_path)
    filename = file_path.name

    run = ImportRun(filename=filename, status="pending")
    db.add(run)
    await db.flush()  # get run.id

    try:
        xl = pd.ExcelFile(file_path)
        result = await _do_import(xl, db)

        run.status = "success"
        run.rows_processed = result["rows_processed"]
        run.dividends_added = result["dividends_added"]
        run.transactions_added = result["transactions_added"]
        run.positions_updated = result["positions_updated"]
        await db.commit()
        logger.info(f"Import complete: {result}")
        return result

    except Exception as exc:
        run.status = "error"
        run.error_message = str(exc)
        await db.commit()
        logger.error(f"Import failed: {exc}", exc_info=True)
        raise


async def _do_import(xl: pd.ExcelFile, db: AsyncSession) -> dict:
    counts = {
        "rows_processed": 0,
        "positions_updated": 0,
        "transactions_added": 0,
        "dividends_added": 0,
    }

    # ── 1. Parse open positions & transactions from Account Activity ─────────
    df_act = xl.parse("Account Activity")
    open_rows = df_act[df_act["Type"] == "Open Position"].copy()
    counts["rows_processed"] += len(df_act)

    # Pre-load existing transaction IDs and existing positions from DB
    result = await db.execute(select(Transaction.etoro_id))
    existing_ids = {row[0] for row in result.fetchall() if row[0]}

    pos_result = await db.execute(select(Position))
    existing_positions: dict[str, Position] = {
        p.ticker: p for p in pos_result.scalars().all()
    }

    # Accumulate ONLY NEW transactions (not already in DB) into positions_data
    # This makes partial imports safe: if a transaction was already imported,
    # its units/cost are already reflected in the existing position.
    new_positions_data: dict[str, dict] = {}
    for _, row in open_rows.iterrows():
        details = str(row.get("Details", "")).strip()
        if "/" not in details:
            continue
        pos_id = str(row.get("Position ID", "")).strip()
        if pos_id in existing_ids:
            continue  # already imported — skip for position merge too

        ticker = _ticker_from_details(details)
        units = _parse_decimal(row.get("Units / Contracts"))
        amount = _parse_decimal(row.get("Amount"))
        open_date = _parse_date(row.get("Date"))
        asset_type = str(row.get("Asset type", "")).strip().lower()

        if units is None or amount is None or units == 0:
            continue

        if ticker not in new_positions_data:
            new_positions_data[ticker] = {
                "total_units": Decimal("0"),
                "total_cost": Decimal("0"),
                "first_date": open_date,
                "etoro_position_id": pos_id,
                "instrument_type": _map_asset_type(asset_type, ticker),
            }

        npd = new_positions_data[ticker]
        npd["total_units"] += units
        npd["total_cost"] += abs(amount)
        if open_date and (npd["first_date"] is None or open_date < npd["first_date"]):
            npd["first_date"] = open_date

    # Upsert positions: merge new data with existing to preserve partial-import safety
    for ticker, npd in new_positions_data.items():
        existing = existing_positions.get(ticker)
        if existing:
            # Merge: existing units + new units, weighted avg cost
            merged_units = existing.units + npd["total_units"]
            merged_cost = (existing.units * existing.open_rate) + npd["total_cost"]
            merged_avg = merged_cost / merged_units if merged_units else Decimal("0")
            merged_open_date = min(
                filter(None, [existing.open_date, npd["first_date"]]),
                default=existing.open_date,
            )
            stmt = pg_insert(Position).values(
                ticker=ticker,
                instrument_name=_instrument_name_for(ticker),
                instrument_type=npd["instrument_type"],
                units=merged_units,
                open_rate=merged_avg,
                open_date=merged_open_date,
                etoro_position_id=npd["etoro_position_id"],
            ).on_conflict_do_update(
                index_elements=["ticker"],
                set_={
                    "units": merged_units,
                    "open_rate": merged_avg,
                    "open_date": merged_open_date,
                },
            )
        else:
            # New position — insert with all data from file
            avg_rate = npd["total_cost"] / npd["total_units"] if npd["total_units"] else Decimal("0")
            stmt = pg_insert(Position).values(
                ticker=ticker,
                instrument_name=_instrument_name_for(ticker),
                instrument_type=npd["instrument_type"],
                units=npd["total_units"],
                open_rate=avg_rate,
                open_date=npd["first_date"],
                etoro_position_id=npd["etoro_position_id"],
            ).on_conflict_do_update(
                index_elements=["ticker"],
                set_={
                    "units": npd["total_units"],
                    "open_rate": avg_rate,
                    "open_date": npd["first_date"],
                    "instrument_name": _instrument_name_for(ticker),
                },
            )
        await db.execute(stmt)
        counts["positions_updated"] += 1

    # ── 2. Save transactions (one row per Open Position activity row) ────────
    # existing_ids already loaded above

    tx_added = 0
    for _, row in open_rows.iterrows():
        details = str(row.get("Details", "")).strip()
        if "/" not in details:
            continue
        pos_id = str(row.get("Position ID", "")).strip()
        if pos_id in existing_ids:
            continue

        ticker = _ticker_from_details(details)
        units = _parse_decimal(row.get("Units / Contracts"))
        amount = _parse_decimal(row.get("Amount"))
        tx_date = _parse_date(row.get("Date"))

        if units is None or amount is None or tx_date is None:
            continue

        db.add(Transaction(
            etoro_id=pos_id,
            ticker=ticker,
            action="BUY",
            units=units,
            price=abs(amount) / units,
            amount_usd=abs(amount),
            transaction_date=tx_date,
        ))
        existing_ids.add(pos_id)
        tx_added += 1

    counts["transactions_added"] = tx_added

    # ── 3. Parse dividends ───────────────────────────────────────────────────
    df_div = xl.parse("Dividends")
    counts["rows_processed"] += len(df_div)

    # Load existing (ticker, payment_date, amount) to avoid duplicates
    existing_divs = set()
    result = await db.execute(
        select(DividendPayment.ticker, DividendPayment.payment_date, DividendPayment.amount_usd)
    )
    for row in result.fetchall():
        existing_divs.add((row[0], row[1], float(row[2])))

    # Load position_id → Position.id map
    pos_result = await db.execute(select(Position.ticker, Position.id))
    ticker_to_pos_id: dict[str, int] = {row[0]: row[1] for row in pos_result.fetchall()}

    div_added = 0
    for _, row in df_div.iterrows():
        instrument = str(row.get("Instrument Name", "")).strip()
        ticker = INSTRUMENT_TO_TICKER.get(instrument)
        if not ticker:
            logger.warning(f"Unknown instrument in dividends: {repr(instrument)}")
            continue

        amount = _parse_decimal(row.get("Net Dividend Received (USD)"))
        pay_date = _parse_date(row.get("Date of Payment"))

        if amount is None or pay_date is None or amount <= 0:
            continue

        key = (ticker, pay_date, float(amount))
        if key in existing_divs:
            continue

        pos_id = ticker_to_pos_id.get(ticker)
        if pos_id is None:
            logger.warning(f"No position found for dividend ticker: {ticker}")
            continue

        db.add(DividendPayment(
            position_id=pos_id,
            ticker=ticker,
            amount_usd=amount,
            payment_date=pay_date,
        ))
        existing_divs.add(key)
        div_added += 1

    counts["dividends_added"] = div_added
    return counts


# ─── Helpers ────────────────────────────────────────────────────────────────

def _map_asset_type(asset_type: str, ticker: str) -> str:
    """Maps eToro asset type string to our instrument_type enum."""
    if "cfd" in asset_type:
        return "cfd"
    if ticker in ("QYLD", "DIV", "SPHD", "VTI", "SXR8.DE"):
        return "etf"
    return "stock"


# Canonical instrument names per ticker
_TICKER_NAMES: dict[str, str] = {
    "QYLD": "Global X Nasdaq 100 Covered Call ETF",
    "BHP": "BHP Group Ltd ADR",
    "CNQ": "Canadian Natural Resources Ltd",
    "DIV": "Global SuperDividend US ETF",
    "SPHD": "Invesco S&P 500 High Dividend Low Volatility ETF",
    "SXR8.DE": "iShares Core S&P 500 UCITS ETF (SXR8)",
    "ET": "Energy Transfer LP",
    "PSEC": "Prospect Capital Corp",
    "VTI": "Vanguard Total Stock Market ETF",
    "IBM": "International Business Machines Corporation",
    "RKLB": "Rocket Lab USA Inc",
}


def _instrument_name_for(ticker: str) -> str:
    return _TICKER_NAMES.get(ticker, ticker)


_ETF_TICKERS = {
    "QYLD", "DIV", "SPHD", "VTI", "SPY", "QQQ", "JEPI", "JEPQ",
    "SXR8.DE", "CSPX", "VUSA", "IWDA", "SWRD", "EQQQ",
}


def _is_etf(ticker: str) -> bool:
    return ticker in _ETF_TICKERS


def _parse_date_iso(value: Any) -> date | None:
    """Parse ISO-style date: '2024-01-15 10:30:00' or '2024-01-15'."""
    if not value or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (datetime, pd.Timestamp)):
        return value.date() if hasattr(value, "date") and callable(value.date) else value
    s = str(value).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


async def _upsert_positions_from_data(
    new_positions_data: dict,
    existing_positions: dict,
    db: AsyncSession,
) -> int:
    """Upsert positions dict → DB. Returns count of upserted rows."""
    count = 0
    for ticker, npd in new_positions_data.items():
        if npd["total_units"] == 0:
            continue
        avg_rate = npd["total_cost"] / npd["total_units"]
        existing = existing_positions.get(ticker)
        if existing:
            merged_units = existing.units + npd["total_units"]
            merged_cost = (existing.units * existing.open_rate) + npd["total_cost"]
            merged_avg = merged_cost / merged_units if merged_units else Decimal("0")
            merged_date = min(
                filter(None, [existing.open_date, npd["first_date"]]),
                default=npd["first_date"],
            )
            stmt = pg_insert(Position).values(
                ticker=ticker,
                instrument_name=_instrument_name_for(ticker),
                instrument_type=npd["instrument_type"],
                units=merged_units,
                open_rate=merged_avg,
                open_date=merged_date,
            ).on_conflict_do_update(
                index_elements=["ticker"],
                set_={"units": merged_units, "open_rate": merged_avg, "open_date": merged_date},
            )
        else:
            stmt = pg_insert(Position).values(
                ticker=ticker,
                instrument_name=_instrument_name_for(ticker),
                instrument_type=npd["instrument_type"],
                units=npd["total_units"],
                open_rate=avg_rate,
                open_date=npd["first_date"],
            ).on_conflict_do_update(
                index_elements=["ticker"],
                set_={"units": npd["total_units"], "open_rate": avg_rate, "open_date": npd["first_date"]},
            )
        await db.execute(stmt)
        count += 1
    return count


# ─── Trading 212 CSV Parser ───────────────────────────────────────────────────

async def import_trading212_csv(file_path: str | Path, db: AsyncSession) -> dict:
    """
    Import Trading 212 activity CSV.
    Handles: Market buy/sell, Limit buy/sell, Dividend (Ordinary/ETF/Return of capital).
    Idempotent via ID column dedup.
    """
    file_path = Path(file_path)
    run = ImportRun(filename=file_path.name, status="pending")
    db.add(run)
    await db.flush()
    try:
        df = pd.read_csv(file_path)
        df.columns = [c.strip() for c in df.columns]
        result = await _do_import_t212(df, db)
        run.status = "success"
        run.rows_processed = result["rows_processed"]
        run.dividends_added = result["dividends_added"]
        run.transactions_added = result["transactions_added"]
        run.positions_updated = result["positions_updated"]
        await db.commit()
        logger.info(f"T212 import complete: {result}")
        return result
    except Exception as exc:
        run.status = "error"
        run.error_message = str(exc)
        await db.commit()
        logger.error(f"T212 import failed: {exc}", exc_info=True)
        raise


async def _do_import_t212(df: pd.DataFrame, db: AsyncSession) -> dict:
    counts = {"rows_processed": len(df), "positions_updated": 0, "transactions_added": 0, "dividends_added": 0}

    result = await db.execute(select(Transaction.etoro_id))
    existing_ids = {r[0] for r in result.fetchall() if r[0]}

    pos_result = await db.execute(select(Position))
    existing_positions: dict[str, Position] = {p.ticker: p for p in pos_result.scalars().all()}

    new_positions_data: dict[str, dict] = {}
    tx_added = 0

    for _, row in df.iterrows():
        action_raw = str(row.get("Action", "")).strip().lower()
        if not any(k in action_raw for k in ("buy", "sell", "dividend")):
            continue

        ticker = str(row.get("Ticker", "")).strip().upper()
        if not ticker:
            continue

        tx_id = f"t212_{str(row.get('ID', '')).strip()}"

        if "dividend" in action_raw:
            # Handled in second pass below
            continue

        if tx_id in existing_ids:
            continue

        tx_date = _parse_date_iso(row.get("Time"))
        if tx_date is None:
            continue

        units = _parse_decimal(row.get("No. of shares"))
        price = _parse_decimal(row.get("Price / share"))
        if units is None or price is None or units == 0:
            continue

        amount_usd = abs(units * price)
        action = "BUY" if "buy" in action_raw else "SELL"

        db.add(Transaction(
            etoro_id=tx_id,
            ticker=ticker,
            action=action,
            units=abs(units),
            price=price,
            amount_usd=amount_usd,
            transaction_date=tx_date,
        ))
        existing_ids.add(tx_id)
        tx_added += 1

        if action == "BUY":
            if ticker not in new_positions_data:
                new_positions_data[ticker] = {
                    "total_units": Decimal("0"),
                    "total_cost": Decimal("0"),
                    "first_date": tx_date,
                    "instrument_type": "etf" if _is_etf(ticker) else "stock",
                }
            npd = new_positions_data[ticker]
            npd["total_units"] += abs(units)
            npd["total_cost"] += amount_usd
            if tx_date < npd["first_date"]:
                npd["first_date"] = tx_date

    counts["transactions_added"] = tx_added

    # Dividends pass
    existing_divs: set = set()
    result2 = await db.execute(
        select(DividendPayment.ticker, DividendPayment.payment_date, DividendPayment.amount_usd)
    )
    for r in result2.fetchall():
        existing_divs.add((r[0], r[1], float(r[2])))

    pos_map_result = await db.execute(select(Position.ticker, Position.id))
    ticker_to_pos_id: dict[str, int] = {r[0]: r[1] for r in pos_map_result.fetchall()}

    div_added = 0
    for _, row in df.iterrows():
        action_raw = str(row.get("Action", "")).strip().lower()
        if "dividend" not in action_raw:
            continue
        # Skip return of capital (not income)
        if "return of capital" in action_raw:
            continue

        ticker = str(row.get("Ticker", "")).strip().upper()
        if not ticker:
            continue

        tx_date = _parse_date_iso(row.get("Time"))
        if tx_date is None:
            continue

        # T212 dividend: price_per_share * units = gross; Total (EUR) may differ due to FX
        units = _parse_decimal(row.get("No. of shares"))
        dps = _parse_decimal(row.get("Price / share"))
        total_eur = _parse_decimal(row.get("Total (EUR)"))

        if units and dps and units > 0 and dps > 0:
            amount = abs(units * dps)
        elif total_eur and total_eur > 0:
            amount = total_eur
        else:
            continue

        key = (ticker, tx_date, float(amount))
        if key in existing_divs:
            continue

        pos_id = ticker_to_pos_id.get(ticker)
        if pos_id is None:
            logger.warning(f"T212 dividend: no position for {ticker} — skipping")
            continue

        db.add(DividendPayment(
            position_id=pos_id,
            ticker=ticker,
            amount_usd=amount,
            payment_date=tx_date,
        ))
        existing_divs.add(key)
        div_added += 1

    counts["dividends_added"] = div_added
    counts["positions_updated"] = await _upsert_positions_from_data(new_positions_data, existing_positions, db)
    return counts


# ─── IBKR Activity Statement CSV Parser ──────────────────────────────────────

def _parse_ibkr_sections(file_path: Path) -> dict[str, "pd.DataFrame"]:
    """
    Parse IBKR multi-section activity CSV into {section_name: DataFrame}.
    Each line: SectionName, Header|Data|Total, col1, col2, ...
    """
    import csv as _csv
    sections: dict[str, list] = {}
    headers: dict[str, list] = {}

    with open(file_path, encoding="utf-8-sig", newline="") as f:
        reader = _csv.reader(f)
        for raw in reader:
            if len(raw) < 2:
                continue
            section = raw[0].strip()
            row_type = raw[1].strip()
            data = raw[2:]
            if row_type == "Header":
                headers[section] = [c.strip() for c in data]
                sections.setdefault(section, [])
            elif row_type == "Data":
                sections.setdefault(section, []).append(data)

    result: dict[str, pd.DataFrame] = {}
    for section, rows in sections.items():
        if not rows:
            continue
        if section in headers:
            cols = headers[section]
            padded = [r[:len(cols)] + [""] * max(0, len(cols) - len(r)) for r in rows]
            result[section] = pd.DataFrame(padded, columns=cols)
        else:
            result[section] = pd.DataFrame(rows)
    return result


async def import_ibkr_csv(file_path: str | Path, db: AsyncSession) -> dict:
    """
    Import IBKR activity statement CSV (multi-section format).
    Sections used: Trades, Dividends.
    Idempotent via (ticker, datetime, qty) key.
    """
    file_path = Path(file_path)
    run = ImportRun(filename=file_path.name, status="pending")
    db.add(run)
    await db.flush()
    try:
        sections = _parse_ibkr_sections(file_path)
        result = await _do_import_ibkr(sections, db)
        run.status = "success"
        run.rows_processed = result["rows_processed"]
        run.dividends_added = result["dividends_added"]
        run.transactions_added = result["transactions_added"]
        run.positions_updated = result["positions_updated"]
        await db.commit()
        logger.info(f"IBKR import complete: {result}")
        return result
    except Exception as exc:
        run.status = "error"
        run.error_message = str(exc)
        await db.commit()
        logger.error(f"IBKR import failed: {exc}", exc_info=True)
        raise


async def _do_import_ibkr(sections: dict, db: AsyncSession) -> dict:
    counts = {"rows_processed": 0, "positions_updated": 0, "transactions_added": 0, "dividends_added": 0}

    result = await db.execute(select(Transaction.etoro_id))
    existing_ids = {r[0] for r in result.fetchall() if r[0]}

    pos_result = await db.execute(select(Position))
    existing_positions: dict[str, Position] = {p.ticker: p for p in pos_result.scalars().all()}

    new_positions_data: dict[str, dict] = {}
    tx_added = 0

    trades_df = sections.get("Trades")
    if trades_df is not None and not trades_df.empty:
        counts["rows_processed"] += len(trades_df)
        for _, row in trades_df.iterrows():
            asset_cat = str(row.get("Asset Category", "")).strip()
            if asset_cat not in ("Stocks", "ETFs", "Stocks/ETFs", ""):
                continue
            disc = str(row.get("DataDiscriminator", "")).strip()
            if disc == "Total":
                continue

            symbol = str(row.get("Symbol", "")).strip().upper().split()[0]
            if not symbol:
                continue

            qty_raw = _parse_decimal(row.get("Quantity"))
            price_raw = _parse_decimal(row.get("T. Price"))
            if qty_raw is None or price_raw is None or qty_raw == 0:
                continue

            # Date/Time: "2024-01-15, 10:30:45" — remove the extra comma
            dt_raw = str(row.get("Date/Time", "")).strip().replace(", ", " ")
            tx_date = _parse_date_iso(dt_raw)
            if tx_date is None:
                continue

            action = "BUY" if qty_raw > 0 else "SELL"
            units = abs(qty_raw)
            amount_usd = units * price_raw
            tx_key = f"ibkr_{symbol}_{dt_raw}_{float(qty_raw):.4f}"
            if tx_key in existing_ids:
                continue

            db.add(Transaction(
                etoro_id=tx_key,
                ticker=symbol,
                action=action,
                units=units,
                price=price_raw,
                amount_usd=amount_usd,
                transaction_date=tx_date,
            ))
            existing_ids.add(tx_key)
            tx_added += 1

            if action == "BUY":
                if symbol not in new_positions_data:
                    new_positions_data[symbol] = {
                        "total_units": Decimal("0"),
                        "total_cost": Decimal("0"),
                        "first_date": tx_date,
                        "instrument_type": "etf" if _is_etf(symbol) else "stock",
                    }
                npd = new_positions_data[symbol]
                npd["total_units"] += units
                npd["total_cost"] += amount_usd
                if tx_date < npd["first_date"]:
                    npd["first_date"] = tx_date

    counts["transactions_added"] = tx_added

    # Dividends
    existing_divs: set = set()
    result2 = await db.execute(
        select(DividendPayment.ticker, DividendPayment.payment_date, DividendPayment.amount_usd)
    )
    for r in result2.fetchall():
        existing_divs.add((r[0], r[1], float(r[2])))

    pos_map_result = await db.execute(select(Position.ticker, Position.id))
    ticker_to_pos_id: dict[str, int] = {r[0]: r[1] for r in pos_map_result.fetchall()}

    div_added = 0
    divs_df = sections.get("Dividends")
    if divs_df is not None and not divs_df.empty:
        counts["rows_processed"] += len(divs_df)
        for _, row in divs_df.iterrows():
            desc = str(row.get("Description", "")).strip()
            if not desc:
                continue
            # Skip withholding tax rows
            if "withholding" in desc.lower() or "tax" in desc.lower():
                continue
            # Extract ticker: "AAPL(US...) Cash Dividend ..."
            ticker = desc.split("(")[0].strip().upper() if "(" in desc else ""
            if not ticker:
                continue

            amount = _parse_decimal(row.get("Amount"))
            if amount is None or amount <= 0:
                continue

            date_raw = str(row.get("Date", "")).strip()
            pay_date = _parse_date_iso(date_raw)
            if pay_date is None:
                # Try mm/dd/yyyy
                try:
                    pay_date = datetime.strptime(date_raw, "%m/%d/%Y").date()
                except ValueError:
                    continue

            key = (ticker, pay_date, float(amount))
            if key in existing_divs:
                continue

            pos_id = ticker_to_pos_id.get(ticker)
            if pos_id is None:
                logger.warning(f"IBKR dividend: no position for {ticker} — skipping")
                continue

            db.add(DividendPayment(
                position_id=pos_id,
                ticker=ticker,
                amount_usd=amount,
                payment_date=pay_date,
            ))
            existing_divs.add(key)
            div_added += 1

    counts["dividends_added"] = div_added
    counts["positions_updated"] = await _upsert_positions_from_data(new_positions_data, existing_positions, db)
    return counts


# ─── Revolut Trading CSV Parser ───────────────────────────────────────────────

async def import_revolut_csv(file_path: str | Path, db: AsyncSession) -> dict:
    """
    Import Revolut trading activity CSV.
    Columns: Date, Ticker, Type, Quantity, Price per share, Total Amount, Currency, FX Rate
    Types: BUY, SELL, DIVIDEND, CUSTODY FEE (skip).
    Idempotent via composite key.
    """
    file_path = Path(file_path)
    run = ImportRun(filename=file_path.name, status="pending")
    db.add(run)
    await db.flush()
    try:
        df = pd.read_csv(file_path)
        df.columns = [c.strip() for c in df.columns]
        result = await _do_import_revolut(df, db)
        run.status = "success"
        run.rows_processed = result["rows_processed"]
        run.dividends_added = result["dividends_added"]
        run.transactions_added = result["transactions_added"]
        run.positions_updated = result["positions_updated"]
        await db.commit()
        logger.info(f"Revolut import complete: {result}")
        return result
    except Exception as exc:
        run.status = "error"
        run.error_message = str(exc)
        await db.commit()
        logger.error(f"Revolut import failed: {exc}", exc_info=True)
        raise


async def _do_import_revolut(df: pd.DataFrame, db: AsyncSession) -> dict:
    counts = {"rows_processed": len(df), "positions_updated": 0, "transactions_added": 0, "dividends_added": 0}

    result = await db.execute(select(Transaction.etoro_id))
    existing_ids = {r[0] for r in result.fetchall() if r[0]}

    pos_result = await db.execute(select(Position))
    existing_positions: dict[str, Position] = {p.ticker: p for p in pos_result.scalars().all()}

    existing_divs: set = set()
    result2 = await db.execute(
        select(DividendPayment.ticker, DividendPayment.payment_date, DividendPayment.amount_usd)
    )
    for r in result2.fetchall():
        existing_divs.add((r[0], r[1], float(r[2])))

    pos_map_result = await db.execute(select(Position.ticker, Position.id))
    ticker_to_pos_id: dict[str, int] = {r[0]: r[1] for r in pos_map_result.fetchall()}

    new_positions_data: dict[str, dict] = {}
    tx_added = 0
    div_added = 0

    for _, row in df.iterrows():
        row_type = str(row.get("Type", "")).strip().upper()
        if row_type in ("CUSTODY FEE", "CASH TOP-UP", "CASH WITHDRAWAL", "TRANSFER"):
            continue

        ticker = str(row.get("Ticker", "")).strip().upper()
        if not ticker:
            continue

        date_raw = str(row.get("Date", "")).strip()
        tx_date = _parse_date_iso(date_raw)
        if tx_date is None:
            continue

        qty = _parse_decimal(row.get("Quantity"))
        price = _parse_decimal(row.get("Price per share"))
        total = _parse_decimal(row.get("Total Amount"))

        if row_type == "DIVIDEND":
            amount = total if (total and total > 0) else (abs(qty * price) if qty and price else None)
            if amount is None or amount <= 0:
                continue
            key = (ticker, tx_date, float(amount))
            if key in existing_divs:
                continue
            pos_id = ticker_to_pos_id.get(ticker)
            if pos_id is None:
                logger.warning(f"Revolut dividend: no position for {ticker} — skipping")
                continue
            db.add(DividendPayment(
                position_id=pos_id,
                ticker=ticker,
                amount_usd=amount,
                payment_date=tx_date,
            ))
            existing_divs.add(key)
            div_added += 1
            continue

        if row_type not in ("BUY", "SELL"):
            continue

        if qty is None or price is None or qty == 0:
            continue

        amount_usd = abs(total) if total else abs(qty * price)
        tx_key = f"rev_{ticker}_{date_raw}_{row_type}_{float(qty):.6f}_{float(price):.4f}"
        if tx_key in existing_ids:
            continue

        db.add(Transaction(
            etoro_id=tx_key,
            ticker=ticker,
            action=row_type,
            units=abs(qty),
            price=price,
            amount_usd=amount_usd,
            transaction_date=tx_date,
        ))
        existing_ids.add(tx_key)
        tx_added += 1

        if row_type == "BUY":
            if ticker not in new_positions_data:
                new_positions_data[ticker] = {
                    "total_units": Decimal("0"),
                    "total_cost": Decimal("0"),
                    "first_date": tx_date,
                    "instrument_type": "etf" if _is_etf(ticker) else "stock",
                }
            npd = new_positions_data[ticker]
            npd["total_units"] += abs(qty)
            npd["total_cost"] += amount_usd
            if tx_date < npd["first_date"]:
                npd["first_date"] = tx_date

    counts["transactions_added"] = tx_added
    counts["dividends_added"] = div_added
    counts["positions_updated"] = await _upsert_positions_from_data(new_positions_data, existing_positions, db)
    return counts
