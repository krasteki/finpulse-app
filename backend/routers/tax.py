"""
Tax report router — /api/tax

GET /api/tax/report?year=2025        — JSON report for Приложение 8 (ЗДДФЛ)
GET /api/tax/report/export?year=2025 — CSV download

Логика:
  - amount_usd в БД = нетна сума (след eToro withholding)
  - gross = net / (1 - rate), withholding = gross - net
  - EUR конверсия: frankfurter.app (ECB rates, без API ключ)
  - BG данък: 5% върху брутото, кредит за платения чужд данък
  - Приложение 5: FIFO за SELL транзакции
"""
import asyncio
import collections
import csv
import io
import json as _json
import logging
import urllib.request
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.expression import extract

from backend.database.db import get_async_session
from backend.database.models import DividendPayment, Transaction

logger = logging.getLogger(__name__)
router = APIRouter()

# ─── Country / withholding config ────────────────────────────────────────────

# Страна на регистрация (определя withholding rate).
# BHP е листван като ADR на NYSE → прилага се US withholding.
TICKER_COUNTRY: dict[str, str] = {
    "QYLD": "United States",
    "BHP":  "United States",   # NYSE ADR
    "CNQ":  "Canada",
    "DIV":  "United States",
    "SPHD": "United States",
    "ET":   "United States",
    "PSEC": "United States",
    "VTI":  "United States",
    "IBM":  "United States",
    "RKLB": "United States",
    "SXR8.DE": "Ireland",      # iShares UCITS ETF
}

# Ставки по спогодбите за избягване на двойно данъчно облагане с България.
# Предполага се подаден W-8BEN → US 15% вместо 30%.
WITHHOLDING_RATES: dict[str, float] = {
    "United States":   0.15,
    "Canada":          0.15,
    "Australia":       0.15,  # via US ADR
    "Ireland":         0.00,  # UCITS ETF — няма withholding
    "United Kingdom":  0.00,
    "Germany":         0.26375,  # 25% KapESt + 5.5% Solidaritätszuschlag
    "Netherlands":     0.15,
    "France":          0.128,
    "Switzerland":     0.35,
    "Luxembourg":      0.15,
}
DEFAULT_WITHHOLDING = 0.15

# ЗДДФЛ чл.38 ал.1 — данък върху дивидентен доход от чужбина
BG_TAX_RATE = 0.05


# ─── Country lookup ───────────────────────────────────────────────────────────

# Runtime cache so we don't call yfinance twice for the same ticker
_country_cache: dict[str, str] = {}


def _lookup_country_sync(ticker: str) -> str:
    """Fetch country from yfinance for tickers not in the static map."""
    if ticker in _country_cache:
        return _country_cache[ticker]
    try:
        import yfinance as yf
        info = yf.Ticker(ticker).info
        country = info.get("country", "") or ""
        if country:
            _country_cache[ticker] = country
            logger.info("tax: %s → country=%s (yfinance)", ticker, country)
            return country
    except Exception as exc:
        logger.warning("tax: country lookup failed for %s: %s", ticker, exc)
    _country_cache[ticker] = "United States"
    return "United States"


def _get_country(ticker: str, unknown_tickers: set[str]) -> str:
    if ticker in TICKER_COUNTRY:
        return TICKER_COUNTRY[ticker]
    if ticker in unknown_tickers:
        return _lookup_country_sync(ticker)
    return "United States"


# ─── EUR rate helpers ─────────────────────────────────────────────────────────

def _fetch_eur_rates_sync(year: int) -> dict[str, float]:
    """Изтегля всички USD→EUR курсове за годината от frankfurter.app (ECB, безплатно)."""
    today = date.today()
    end_date = f"{year}-12-31" if year < today.year else today.isoformat()
    url = (
        f"https://api.frankfurter.app/{year}-01-01..{end_date}"
        f"?from=USD&to=EUR"
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "FinPulse/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = _json.loads(resp.read())
        # {"rates": {"2025-01-02": {"EUR": 0.9232}, ...}}
        return {k: v["EUR"] for k, v in data.get("rates", {}).items()}
    except Exception as exc:
        logger.warning("frankfurter.app error: %s — using fallback EUR rate 0.92", exc)
        return {}


def _find_rate(rates: dict[str, float], target: date, fallback: float = 0.92) -> float:
    """Връща EUR/USD курса за датата, търсейки назад до 7 дни (уикенди/празници)."""
    for delta in range(8):
        key = (target - timedelta(days=delta)).isoformat()
        if key in rates:
            return rates[key]
    return fallback


# ─── FIFO capital gains (Приложение 5) ───────────────────────────────────────

def _fifo_gains(txns: list, eur_rates: dict[str, float]) -> list[dict]:
    """
    FIFO изчисление на капиталовите печалби от SELL транзакции.
    Връща списък с реализирани сделки готови за Приложение 5.
    """
    # Group by ticker, sort by date
    by_ticker: dict[str, list] = collections.defaultdict(list)
    for t in txns:
        by_ticker[t.ticker].append(t)

    gains = []
    for ticker, rows in by_ticker.items():
        rows.sort(key=lambda r: r.transaction_date)
        # FIFO queue: [(date, units, price_usd), ...]
        buy_queue: collections.deque = collections.deque()

        for row in rows:
            units = float(row.units)
            price = float(row.price)

            if row.action == "BUY":
                buy_queue.append({
                    "date": row.transaction_date,
                    "units": units,
                    "price": price,
                })
            elif row.action == "SELL":
                remaining_sell = units
                sell_date = row.transaction_date
                sell_eur_rate = _find_rate(eur_rates, sell_date)

                while remaining_sell > 1e-6 and buy_queue:
                    lot = buy_queue[0]
                    matched = min(lot["units"], remaining_sell)
                    buy_eur_rate = _find_rate(eur_rates, lot["date"])

                    acq_usd = matched * lot["price"]
                    proceeds_usd = matched * price
                    gain_usd = proceeds_usd - acq_usd

                    gains.append({
                        "ticker": ticker,
                        "units_sold": round(matched, 6),
                        "acq_date": lot["date"].isoformat(),
                        "sell_date": sell_date.isoformat(),
                        "acq_price_usd": round(lot["price"], 4),
                        "sell_price_usd": round(price, 4),
                        "acq_cost_usd": round(acq_usd, 4),
                        "proceeds_usd": round(proceeds_usd, 4),
                        "gain_loss_usd": round(gain_usd, 4),
                        "acq_eur_rate": round(buy_eur_rate, 6),
                        "sell_eur_rate": round(sell_eur_rate, 6),
                        "acq_cost_eur": round(acq_usd * buy_eur_rate, 4),
                        "proceeds_eur": round(proceeds_usd * sell_eur_rate, 4),
                        "gain_loss_eur": round(
                            proceeds_usd * sell_eur_rate - acq_usd * buy_eur_rate, 4
                        ),
                    })

                    lot["units"] -= matched
                    remaining_sell -= matched
                    if lot["units"] < 1e-6:
                        buy_queue.popleft()

    return gains


# ─── Dividend calculation ─────────────────────────────────────────────────────

def _build_report(rows: list, eur_rates: dict[str, float], unknown_tickers: set[str]) -> dict:
    """Изгражда данъчния отчет от редовете на БД и курсовете."""
    dividends = []
    by_country: dict[str, dict] = {}

    for row in rows:
        ticker = row.ticker
        country = _get_country(ticker, unknown_tickers)
        wh_rate = WITHHOLDING_RATES.get(country, DEFAULT_WITHHOLDING)

        net_usd = float(row.amount_usd)
        # amount_usd е нетна сума след eToro withholding → изчисляваме брутото
        if wh_rate < 1.0:
            gross_usd = net_usd / (1.0 - wh_rate)
        else:
            gross_usd = net_usd
        withholding_usd = gross_usd - net_usd

        eur_rate = _find_rate(eur_rates, row.payment_date)
        net_eur = round(net_usd * eur_rate, 4)
        gross_eur = round(gross_usd * eur_rate, 4)
        withholding_eur = round(withholding_usd * eur_rate, 4)

        # БГ данък 5% върху брутото, с кредит за платения чужд данък
        bg_tax_eur = round(gross_eur * BG_TAX_RATE, 4)
        additional_bg_tax_eur = round(max(0.0, bg_tax_eur - withholding_eur), 4)

        dividends.append({
            "date": row.payment_date.isoformat(),
            "ticker": ticker,
            "country": country,
            "net_usd": round(net_usd, 4),
            "gross_usd": round(gross_usd, 4),
            "withholding_usd": round(withholding_usd, 4),
            "withholding_rate_pct": round(wh_rate * 100, 1),
            "eur_rate": round(eur_rate, 6),
            "net_eur": net_eur,
            "gross_eur": gross_eur,
            "withholding_eur": withholding_eur,
            "bg_tax_eur": bg_tax_eur,
            "additional_bg_tax_eur": additional_bg_tax_eur,
        })

        if country not in by_country:
            by_country[country] = {
                "country": country,
                "gross_eur": 0.0,
                "withholding_eur": 0.0,
                "net_eur": 0.0,
                "bg_tax_eur": 0.0,
                "additional_bg_tax_eur": 0.0,
                "count": 0,
                "withholding_rate_pct": round(wh_rate * 100, 1),
            }
        c = by_country[country]
        c["gross_eur"] = round(c["gross_eur"] + gross_eur, 4)
        c["withholding_eur"] = round(c["withholding_eur"] + withholding_eur, 4)
        c["net_eur"] = round(c["net_eur"] + net_eur, 4)
        c["bg_tax_eur"] = round(c["bg_tax_eur"] + bg_tax_eur, 4)
        c["additional_bg_tax_eur"] = round(c["additional_bg_tax_eur"] + additional_bg_tax_eur, 4)
        c["count"] += 1

    return {
        "dividends": dividends,
        "by_country": list(by_country.values()),
        "total_gross_eur": round(sum(d["gross_eur"] for d in dividends), 2),
        "total_withholding_eur": round(sum(d["withholding_eur"] for d in dividends), 2),
        "total_net_eur": round(sum(d["net_eur"] for d in dividends), 2),
        "total_bg_tax_eur": round(sum(d["bg_tax_eur"] for d in dividends), 2),
        "total_additional_bg_tax_eur": round(sum(d["additional_bg_tax_eur"] for d in dividends), 2),
    }


# ─── GET /api/tax/report ─────────────────────────────────────────────────────

@router.get("/report")
async def get_tax_report(
    year: int = Query(default=2025, ge=2000, le=2100),
    db: AsyncSession = Depends(get_async_session),
):
    """
    JSON отчет за Приложение 8 (дивиденти) + Приложение 5 (капиталови печалби) на ЗДДФЛ.
    """
    div_rows = (await db.execute(
        select(DividendPayment)
        .where(extract("year", DividendPayment.payment_date) == year)
        .order_by(DividendPayment.payment_date, DividendPayment.ticker)
    )).scalars().all()

    # All transactions (all years) needed for FIFO — SELL in target year needs prior BUYs
    all_txns = (await db.execute(
        select(Transaction)
        .where(Transaction.action.in_(["BUY", "SELL"]))
        .order_by(Transaction.ticker, Transaction.transaction_date)
    )).scalars().all()
    # Filter: only SELLs in target year — but keep all BUYs for FIFO
    sell_tickers_this_year = {
        t.ticker for t in all_txns
        if t.action == "SELL" and t.transaction_date.year == year
    }
    fifo_txns = [t for t in all_txns if t.ticker in sell_tickers_this_year]

    # Tickers not in static map → need yfinance lookup (run in executor)
    known_tickers = set(TICKER_COUNTRY.keys())
    all_tickers = {r.ticker for r in div_rows} | {t.ticker for t in fifo_txns}
    unknown_tickers = all_tickers - known_tickers

    loop = asyncio.get_running_loop()

    def _run_all():
        rates = _fetch_eur_rates_sync(year)
        # Pre-warm country cache for unknown tickers
        for ticker in unknown_tickers:
            _lookup_country_sync(ticker)
        return rates

    eur_rates = await loop.run_in_executor(None, _run_all)
    calc = _build_report(div_rows, eur_rates, unknown_tickers)
    gains = _fifo_gains(fifo_txns, eur_rates)

    # Filter gains to target year SELLs only
    gains_this_year = [g for g in gains if g["sell_date"].startswith(str(year))]
    total_gain_eur = round(sum(g["gain_loss_eur"] for g in gains_this_year), 2)
    total_gain_usd = round(sum(g["gain_loss_usd"] for g in gains_this_year), 2)

    empty_summary = {
        "total_gross_eur": 0, "total_withholding_eur": 0, "total_net_eur": 0,
        "total_bg_tax_eur": 0, "total_additional_bg_tax_eur": 0, "by_country": [],
    }

    return {
        "year": year,
        "bg_tax_rate_pct": BG_TAX_RATE * 100,
        "eur_rates_source": "frankfurter.app" if eur_rates else "fallback(0.92)",
        # Приложение 8 — дивиденти
        "dividends": calc["dividends"] if div_rows else [],
        "summary": {
            "total_gross_eur": calc["total_gross_eur"],
            "total_withholding_eur": calc["total_withholding_eur"],
            "total_net_eur": calc["total_net_eur"],
            "total_bg_tax_eur": calc["total_bg_tax_eur"],
            "total_additional_bg_tax_eur": calc["total_additional_bg_tax_eur"],
            "by_country": calc["by_country"],
        } if div_rows else empty_summary,
        # Приложение 5 — капиталови печалби
        "capital_gains": gains_this_year,
        "capital_gains_summary": {
            "total_gain_loss_eur": total_gain_eur,
            "total_gain_loss_usd": total_gain_usd,
            "transactions_count": len(gains_this_year),
            "profitable_count": sum(1 for g in gains_this_year if g["gain_loss_eur"] > 0),
            "loss_count": sum(1 for g in gains_this_year if g["gain_loss_eur"] < 0),
        },
    }


# ─── GET /api/tax/report/export ──────────────────────────────────────────────

@router.get("/report/export")
async def export_tax_report_csv(
    year: int = Query(default=2025, ge=2000, le=2100),
    db: AsyncSession = Depends(get_async_session),
):
    """CSV с Приложение 8 (дивиденти) + Приложение 5 (капиталови печалби)."""
    div_rows = (await db.execute(
        select(DividendPayment)
        .where(extract("year", DividendPayment.payment_date) == year)
        .order_by(DividendPayment.payment_date, DividendPayment.ticker)
    )).scalars().all()

    all_txns = (await db.execute(
        select(Transaction)
        .where(Transaction.action.in_(["BUY", "SELL"]))
        .order_by(Transaction.ticker, Transaction.transaction_date)
    )).scalars().all()
    sell_tickers_this_year = {
        t.ticker for t in all_txns
        if t.action == "SELL" and t.transaction_date.year == year
    }
    fifo_txns = [t for t in all_txns if t.ticker in sell_tickers_this_year]

    known_tickers = set(TICKER_COUNTRY.keys())
    all_tickers = {r.ticker for r in div_rows} | {t.ticker for t in fifo_txns}
    unknown_tickers = all_tickers - known_tickers

    loop = asyncio.get_running_loop()

    def _run_all():
        rates = _fetch_eur_rates_sync(year)
        for ticker in unknown_tickers:
            _lookup_country_sync(ticker)
        return rates

    eur_rates = await loop.run_in_executor(None, _run_all)
    calc = _build_report(div_rows, eur_rates, unknown_tickers)
    gains = [g for g in _fifo_gains(fifo_txns, eur_rates)
             if g["sell_date"].startswith(str(year))]

    buf = io.StringIO()
    w = csv.writer(buf)

    # ── Приложение 8 ─────────────────────────────────────────────────────────
    w.writerow([f"=== ПРИЛОЖЕНИЕ 8 — Дивиденти {year} ==="])
    w.writerow([
        "Date", "Ticker", "Country",
        "Net USD (received)", "Gross USD (before tax)", "Withholding USD",
        "EUR/USD rate",
        "Net EUR", "Gross EUR (App.8 col.4)", "Withholding EUR (App.8 col.5)",
        "BG tax 5% EUR", "Additional BG tax EUR",
    ])
    for d in calc["dividends"]:
        w.writerow([
            d["date"], d["ticker"], d["country"],
            d["net_usd"], d["gross_usd"], d["withholding_usd"],
            d["eur_rate"],
            d["net_eur"], d["gross_eur"], d["withholding_eur"],
            d["bg_tax_eur"], d["additional_bg_tax_eur"],
        ])

    w.writerow([])
    w.writerow([f"=== ОБОБЩЕНИЕ ПО ДЪРЖАВА — Приложение 8 / {year} ==="])
    w.writerow([
        "Country", "# payments",
        "Gross EUR (кол.4)", "Withholding EUR (кол.5)", "Net EUR",
        "BG tax 5%", "Additional due",
    ])
    for c in calc["by_country"]:
        w.writerow([
            c["country"], c["count"],
            c["gross_eur"], c["withholding_eur"], c["net_eur"],
            c["bg_tax_eur"], c["additional_bg_tax_eur"],
        ])
    w.writerow([
        "TOTAL", "",
        calc["total_gross_eur"], calc["total_withholding_eur"], calc["total_net_eur"],
        calc["total_bg_tax_eur"], calc["total_additional_bg_tax_eur"],
    ])

    # ── Приложение 5 ─────────────────────────────────────────────────────────
    w.writerow([])
    w.writerow([f"=== ПРИЛОЖЕНИЕ 5 — Капиталови печалби {year} ==="])
    if gains:
        w.writerow([
            "Ticker", "Units sold",
            "Acq. date", "Sell date",
            "Acq. price USD", "Sell price USD",
            "Acq. cost USD", "Proceeds USD", "Gain/Loss USD",
            "Acq. EUR rate", "Sell EUR rate",
            "Acq. cost EUR (кол.4)", "Proceeds EUR (кол.5)", "Gain/Loss EUR",
        ])
        for g in gains:
            w.writerow([
                g["ticker"], g["units_sold"],
                g["acq_date"], g["sell_date"],
                g["acq_price_usd"], g["sell_price_usd"],
                g["acq_cost_usd"], g["proceeds_usd"], g["gain_loss_usd"],
                g["acq_eur_rate"], g["sell_eur_rate"],
                g["acq_cost_eur"], g["proceeds_eur"], g["gain_loss_eur"],
            ])
        total_gain = round(sum(g["gain_loss_eur"] for g in gains), 2)
        w.writerow([])
        w.writerow(["TOTAL gain/loss EUR", "", "", "", "", "", "", "", "", "", "", "", "", total_gain])
    else:
        w.writerow(["No SELL transactions in", year])

    filename = f"finpulse_tax_{year}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─── PDF generation helper ────────────────────────────────────────────────────

def _generate_tax_pdf(year: int, calc: dict, gains_this_year: list) -> bytes:
    """Builds a PDF tax report using fpdf2. Returns raw bytes."""
    from fpdf import FPDF  # lazy import — only when PDF is requested
    from fpdf.enums import XPos, YPos

    # ── Helpers ───────────────────────────────────────────────────────────────
    MARGIN = 12.0
    PAGE_W = 210.0
    USABLE = PAGE_W - 2 * MARGIN  # 186 mm

    # By-country table columns (sum = 186 mm)
    COL_COUNTRY  = 42.0
    COL_PMTS     = 14.0
    COL_WH_PCT   = 14.0
    COL_GROSS    = 28.0
    COL_WH_EUR   = 28.0
    COL_NET      = 22.0
    COL_BGTAX    = 22.0
    COL_DUE      = 16.0

    # Capital gains table columns
    CG_TICKER    = 18.0
    CG_ACQ       = 22.0
    CG_SELL      = 22.0
    CG_UNITS     = 14.0
    CG_COST      = 28.0
    CG_PROCEEDS  = 30.0
    CG_GAIN      = 32.0

    GREY   = (245, 245, 248)
    BLUE   = (59, 130, 246)
    DARK   = (30, 30, 30)
    MUTED  = (120, 120, 120)
    GREEN  = (22, 163, 74)
    RED    = (220, 38, 38)
    AMBER  = (217, 119, 6)

    def _set_color(pdf: "FPDF", rgb: tuple) -> None:
        pdf.set_text_color(*rgb)

    def _section_title(pdf: "FPDF", text: str) -> None:
        pdf.set_font("Helvetica", "B", 12)
        _set_color(pdf, BLUE)
        pdf.cell(USABLE, 7, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_draw_color(*BLUE)
        pdf.line(MARGIN, pdf.get_y(), PAGE_W - MARGIN, pdf.get_y())
        pdf.ln(4)
        _set_color(pdf, DARK)

    def _kpi_row(pdf: "FPDF", items: list[tuple[str, str, tuple]]) -> None:
        """Draw a row of KPI boxes: [(label, value, value_color), ...]"""
        n = len(items)
        box_w = USABLE / n
        box_h = 16.0
        y0 = pdf.get_y()
        x0 = MARGIN
        for label, value, vcolor in items:
            pdf.set_fill_color(*GREY)
            pdf.rect(x0, y0, box_w - 2, box_h, "F")
            pdf.set_xy(x0 + 1, y0 + 1)
            pdf.set_font("Helvetica", "", 7)
            _set_color(pdf, MUTED)
            pdf.cell(box_w - 3, 5, label)
            pdf.set_xy(x0 + 1, y0 + 6)
            pdf.set_font("Helvetica", "B", 10)
            _set_color(pdf, vcolor)
            pdf.cell(box_w - 3, 8, value)
            x0 += box_w
        pdf.set_xy(MARGIN, y0 + box_h + 2)
        _set_color(pdf, DARK)

    def _th(pdf: "FPDF", cols: list[tuple[str, float]], h: float = 6.5) -> None:
        """Draw table header row."""
        pdf.set_font("Helvetica", "B", 7)
        pdf.set_fill_color(55, 65, 81)
        _set_color(pdf, (255, 255, 255))
        for text, w in cols:
            pdf.cell(w, h, text, fill=True)
        pdf.ln()
        _set_color(pdf, DARK)

    def _tr(pdf: "FPDF", cols: list[tuple[str, float]], row_idx: int, h: float = 6.0) -> None:
        """Draw table data row (alternating bg)."""
        pdf.set_font("Helvetica", "", 7)
        if row_idx % 2 == 0:
            pdf.set_fill_color(*GREY)
            fill = True
        else:
            fill = False
        _set_color(pdf, DARK)
        for text, w in cols:
            pdf.cell(w, h, str(text), fill=fill)
        pdf.ln()

    # ── Build PDF ─────────────────────────────────────────────────────────────
    class TaxPDF(FPDF):
        def header(self):
            self.set_font("Helvetica", "", 7)
            _set_color(self, MUTED)
            self.cell(USABLE, 5, f"FinPulse — Tax Report {year}",
                      new_x=XPos.LMARGIN, new_y=YPos.NEXT, align="R")

        def footer(self):
            self.set_y(-10)
            self.set_font("Helvetica", "", 6.5)
            _set_color(self, MUTED)
            today = date.today().isoformat()
            self.cell(
                USABLE, 5,
                f"Generated by FinPulse on {today} | For informational purposes only — not an official tax document | Page {self.page_no()}",
                align="C",
            )

    pdf = TaxPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.set_margins(MARGIN, MARGIN, MARGIN)
    pdf.add_page()

    # ── Title ─────────────────────────────────────────────────────────────────
    pdf.set_font("Helvetica", "B", 22)
    _set_color(pdf, BLUE)
    pdf.cell(USABLE, 11, "FinPulse", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_font("Helvetica", "", 13)
    _set_color(pdf, DARK)
    pdf.cell(USABLE, 7, f"Tax Report {year}  |  ZDDFL Art.50 (Bulgaria)",
             new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_font("Helvetica", "", 8)
    _set_color(pdf, MUTED)
    pdf.cell(USABLE, 5, f"EUR/USD rates: ECB via frankfurter.app  |  BG income tax: 5% (Art.38 ZDDFL)",
             new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(5)

    # ── App.8 — Dividends ─────────────────────────────────────────────────────
    _section_title(pdf, "ANNEX 8 — Foreign Dividends (App. 8 ZDDFL)")

    g = calc.get("total_gross_eur", 0)
    wh = calc.get("total_withholding_eur", 0)
    bgt = calc.get("total_bg_tax_eur", 0)
    due = calc.get("total_additional_bg_tax_eur", 0)

    _kpi_row(pdf, [
        ("Gross Dividends EUR",    f"EUR {g:.2f}",   DARK),
        ("Withholding Tax EUR",    f"EUR {wh:.2f}",  AMBER),
        ("BG Tax 5% EUR",          f"EUR {bgt:.2f}", DARK),
        ("Additional Due EUR",     f"EUR {due:.2f}", RED if due > 0 else GREEN),
    ])

    by_country = calc.get("by_country", [])
    if by_country:
        _th(pdf, [
            ("Country",        COL_COUNTRY),
            ("Pmts",           COL_PMTS),
            ("WH%",            COL_WH_PCT),
            ("Gross EUR",      COL_GROSS),
            ("Withholding EUR",COL_WH_EUR),
            ("Net EUR",        COL_NET),
            ("BG Tax 5%",      COL_BGTAX),
            ("Addl Due EUR",   COL_DUE),
        ])
        for i, c in enumerate(sorted(by_country, key=lambda x: -x["gross_eur"])):
            _tr(pdf, [
                (c["country"],                              COL_COUNTRY),
                (str(c["count"]),                          COL_PMTS),
                (f'{c["withholding_rate_pct"]:.1f}%',      COL_WH_PCT),
                (f'{c["gross_eur"]:.2f}',                  COL_GROSS),
                (f'{c["withholding_eur"]:.2f}',            COL_WH_EUR),
                (f'{c["net_eur"]:.2f}',                    COL_NET),
                (f'{c["bg_tax_eur"]:.2f}',                 COL_BGTAX),
                (f'{c["additional_bg_tax_eur"]:.2f}',      COL_DUE),
            ], i)
        # Totals row
        pdf.set_font("Helvetica", "B", 7)
        _set_color(pdf, DARK)
        pdf.set_fill_color(220, 220, 230)
        totals_h = 6.5
        pdf.cell(COL_COUNTRY + COL_PMTS + COL_WH_PCT, totals_h, "TOTAL", fill=True)
        pdf.cell(COL_GROSS,  totals_h, f'{g:.2f}',   fill=True)
        pdf.cell(COL_WH_EUR, totals_h, f'{wh:.2f}',  fill=True)
        pdf.cell(COL_NET,    totals_h, f'{g - wh:.2f}', fill=True)
        pdf.cell(COL_BGTAX,  totals_h, f'{bgt:.2f}', fill=True)
        pdf.cell(COL_DUE,    totals_h, f'{due:.2f}', fill=True)
        pdf.ln(totals_h + 2)
    else:
        pdf.set_font("Helvetica", "I", 9)
        _set_color(pdf, MUTED)
        pdf.cell(USABLE, 7, f"No dividend records for {year}.",
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(4)

    # ── App.5 — Capital Gains ─────────────────────────────────────────────────
    _section_title(pdf, "ANNEX 5 — Capital Gains / Losses (App. 5 ZDDFL)")

    total_gain = round(sum(g["gain_loss_eur"] for g in gains_this_year), 2) if gains_this_year else 0
    profitable = sum(1 for g in gains_this_year if g["gain_loss_eur"] > 0)
    loss_count = sum(1 for g in gains_this_year if g["gain_loss_eur"] < 0)

    _kpi_row(pdf, [
        ("Total Transactions",    str(len(gains_this_year)),  DARK),
        ("Profitable Sells",      str(profitable),             GREEN),
        ("Loss Sells",            str(loss_count),             RED if loss_count > 0 else DARK),
        ("Net Gain/Loss EUR",     f"EUR {total_gain:.2f}",     GREEN if total_gain >= 0 else RED),
    ])

    if gains_this_year:
        _th(pdf, [
            ("Ticker",       CG_TICKER),
            ("Acq Date",     CG_ACQ),
            ("Sell Date",    CG_SELL),
            ("Units",        CG_UNITS),
            ("Cost EUR",     CG_COST),
            ("Proceeds EUR", CG_PROCEEDS),
            ("Gain/Loss EUR",CG_GAIN),
        ])
        for i, g in enumerate(gains_this_year):
            gain_val = g["gain_loss_eur"]
            _tr(pdf, [
                (g["ticker"],                       CG_TICKER),
                (g["acq_date"],                     CG_ACQ),
                (g["sell_date"],                    CG_SELL),
                (f'{g["units_sold"]:.4f}',          CG_UNITS),
                (f'{g["acq_cost_eur"]:.2f}',        CG_COST),
                (f'{g["proceeds_eur"]:.2f}',        CG_PROCEEDS),
                (f'{gain_val:+.2f}',                CG_GAIN),
            ], i)
        # Totals
        pdf.set_font("Helvetica", "B", 7)
        _set_color(pdf, DARK)
        pdf.set_fill_color(220, 220, 230)
        totals_h = 6.5
        total_cost = round(sum(g["acq_cost_eur"] for g in gains_this_year), 2)
        total_proc = round(sum(g["proceeds_eur"] for g in gains_this_year), 2)
        pdf.cell(CG_TICKER + CG_ACQ + CG_SELL + CG_UNITS, totals_h, "TOTAL", fill=True)
        pdf.cell(CG_COST,     totals_h, f'{total_cost:.2f}',   fill=True)
        pdf.cell(CG_PROCEEDS, totals_h, f'{total_proc:.2f}',   fill=True)
        pdf.cell(CG_GAIN,     totals_h, f'{total_gain:+.2f}',  fill=True)
        pdf.ln(totals_h)
    else:
        pdf.set_font("Helvetica", "I", 9)
        _set_color(pdf, MUTED)
        pdf.cell(USABLE, 7, f"No SELL transactions in {year}.",
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    # ── Disclaimer ────────────────────────────────────────────────────────────
    pdf.ln(8)
    pdf.set_font("Helvetica", "I", 7)
    _set_color(pdf, MUTED)
    pdf.multi_cell(USABLE, 4.5, (
        "IMPORTANT: This document is generated by FinPulse for informational purposes only. "
        "It is NOT an official tax declaration. EUR/USD exchange rates are sourced from the European Central Bank "
        "via frankfurter.app. Withholding tax rates are based on double-taxation treaties with Bulgaria "
        "(assuming W-8BEN filed for US securities). Always consult a licensed tax advisor before filing. "
        "Official forms: portal.nap.bg → Income Tax Return Art.50 ZDDFL → Annex 5 & Annex 8."
    ))

    return pdf.output()


# ─── GET /api/tax/report/pdf ──────────────────────────────────────────────────

@router.get("/report/pdf")
async def export_tax_report_pdf(
    year: int = Query(default=2025, ge=2000, le=2100),
    db: AsyncSession = Depends(get_async_session),
):
    """PDF report: Annex 8 (dividends) + Annex 5 (capital gains) ready for ZDDFL Art.50."""
    div_rows = (await db.execute(
        select(DividendPayment)
        .where(extract("year", DividendPayment.payment_date) == year)
        .order_by(DividendPayment.payment_date, DividendPayment.ticker)
    )).scalars().all()

    all_txns = (await db.execute(
        select(Transaction)
        .where(Transaction.action.in_(["BUY", "SELL"]))
        .order_by(Transaction.ticker, Transaction.transaction_date)
    )).scalars().all()
    sell_tickers_this_year = {
        t.ticker for t in all_txns
        if t.action == "SELL" and t.transaction_date.year == year
    }
    fifo_txns = [t for t in all_txns if t.ticker in sell_tickers_this_year]

    known_tickers = set(TICKER_COUNTRY.keys())
    all_tickers = {r.ticker for r in div_rows} | {t.ticker for t in fifo_txns}
    unknown_tickers = all_tickers - known_tickers

    loop = asyncio.get_running_loop()

    def _run_all():
        rates = _fetch_eur_rates_sync(year)
        for ticker in unknown_tickers:
            _lookup_country_sync(ticker)
        return rates

    eur_rates = await loop.run_in_executor(None, _run_all)

    empty_calc = {
        "total_gross_eur": 0, "total_withholding_eur": 0,
        "total_net_eur": 0, "total_bg_tax_eur": 0,
        "total_additional_bg_tax_eur": 0, "by_country": [],
    }
    calc = _build_report(div_rows, eur_rates, unknown_tickers) if div_rows else empty_calc
    all_gains = _fifo_gains(fifo_txns, eur_rates)
    gains_this_year = [g for g in all_gains if g["sell_date"].startswith(str(year))]

    pdf_bytes = await loop.run_in_executor(
        None, _generate_tax_pdf, year, calc, gains_this_year
    )

    filename = f"FinPulse_Tax_{year}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
