import asyncio
import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import settings
from backend.database.db import create_all_tables
from backend.routers import portfolio, charts, dividends, ai, ticker, import_xlsx, alerts, tax
from backend.routers import watchlist as watchlist_router
from backend.routers.alerts import run_alert_check_job
from backend.services.price_service import refresh_all_prices
from backend.services.chart_service import preload_chart_history

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


# ─── Lifespan ────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Ensure all tables exist (idempotent)
    await create_all_tables()

    # 2. Immediate price refresh (don't wait 15 min for first data)
    asyncio.create_task(refresh_all_prices())

    # 3. Background chart history preload (non-blocking)
    asyncio.create_task(preload_chart_history())

    # 4. Scheduled price refresh every N minutes
    scheduler.add_job(
        refresh_all_prices,
        "interval",
        minutes=settings.price_refresh_interval,
        id="price_refresh",
    )
    scheduler.add_job(
        run_alert_check_job,
        "interval",
        minutes=30,
        id="alert_check",
    )
    scheduler.start()
    logger.info(f"FinPulse API started — price refresh every {settings.price_refresh_interval} min")

    yield  # Application runs here

    scheduler.shutdown()
    logger.info("FinPulse API stopped")


# ─── App ─────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="FinPulse API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ─────────────────────────────────────────────────────────────────

app.include_router(portfolio.router, prefix="/api/portfolio", tags=["portfolio"])
app.include_router(charts.router, prefix="/api/charts", tags=["charts"])
app.include_router(dividends.router, prefix="/api/dividends", tags=["dividends"])
app.include_router(ai.router, prefix="/api/ai", tags=["ai"])
app.include_router(ticker.router, prefix="/api/ticker", tags=["ticker"])
app.include_router(import_xlsx.router, prefix="/api/import", tags=["import"])
app.include_router(alerts.router, prefix="/api/alerts", tags=["alerts"])
app.include_router(tax.router,    prefix="/api/tax",    tags=["tax"])
app.include_router(watchlist_router.router, prefix="/api/watchlist", tags=["watchlist"])


# ─── Health check ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}
