"""
Import router — POST /api/import/xlsx
                GET  /api/import/history
"""
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_session as get_db
from backend.database.models import ImportRun
from backend.services.import_service import (
    import_etoro_xlsx,
    import_trading212_csv,
    import_ibkr_csv,
    import_revolut_csv,
)

router = APIRouter()

ALLOWED_CONTENT_TYPES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
    "application/zip",  # some browsers send .xlsx as zip
}


@router.post("/xlsx")
async def upload_xlsx(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload eToro account statement XLSX.
    Idempotent — safe to re-upload the same file or overlapping periods.
    Deduplication:
      • dividends  → skip if (ticker, date, amount) already exists
      • transactions → skip if etoro_id already exists
      • positions  → UPSERT by ticker (update units / avg cost)
    """
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are accepted")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(content) > 50 * 1024 * 1024:  # 50 MB guard
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")

    # Write to a temp file so pandas/openpyxl can open it
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        result = await import_etoro_xlsx(tmp_path, db)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        tmp_path.unlink(missing_ok=True)

    return {
        "ok": True,
        "filename": file.filename,
        **result,
    }


_CSV_BROKERS = {"trading212", "ibkr", "revolut"}


@router.post("/csv")
async def upload_csv(
    broker: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload broker CSV activity export.
    broker query param: trading212 | ibkr | revolut
    """
    broker = broker.lower().strip()
    if broker not in _CSV_BROKERS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported broker '{broker}'. Accepted: {', '.join(sorted(_CSV_BROKERS))}",
        )

    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are accepted")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")

    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        if broker == "trading212":
            result = await import_trading212_csv(tmp_path, db)
        elif broker == "ibkr":
            result = await import_ibkr_csv(tmp_path, db)
        else:  # revolut
            result = await import_revolut_csv(tmp_path, db)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        tmp_path.unlink(missing_ok=True)

    return {"ok": True, "filename": file.filename, **result}


@router.get("/history")
async def import_history(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """Return last N import runs."""
    rows = await db.execute(
        select(ImportRun).order_by(desc(ImportRun.imported_at)).limit(limit)
    )
    runs = rows.scalars().all()
    return [
        {
            "id": r.id,
            "filename": r.filename,
            "status": r.status,
            "rows_processed": r.rows_processed,
            "dividends_added": r.dividends_added,
            "transactions_added": r.transactions_added,
            "positions_updated": r.positions_updated,
            "error_message": r.error_message,
            "imported_at": r.imported_at.isoformat() if r.imported_at else None,
        }
        for r in runs
    ]
