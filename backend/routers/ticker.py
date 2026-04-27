"""
Ticker router — /api/ticker

Endpoints:
  GET /api/ticker/search?q=...   — Autocomplete search (name or symbol)
  GET /api/ticker/info/{ticker}  — Live info for ANY ticker via yfinance
"""
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

import yfinance as yf
from fastapi import APIRouter, HTTPException, Query

router = APIRouter()
logger = logging.getLogger(__name__)
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="yf-ticker")

# Types we care about for investing
_GOOD_TYPES = {"equity", "etf", "fund", "mutualfund", "index"}


def _do_search(q: str, max_results: int) -> list[dict]:
    try:
        results = yf.Search(q, max_results=max_results + 5)
        quotes = results.quotes or []
    except Exception as e:
        logger.warning(f"yfinance search failed for '{q}': {e}")
        return []

    out = []
    for item in quotes:
        symbol = item.get("symbol", "")
        if not symbol:
            continue
        type_disp = (item.get("typeDisp") or item.get("quoteType") or "").lower()
        # Skip futures, currencies, warrants, etc.
        if type_disp and type_disp not in _GOOD_TYPES:
            continue
        name = item.get("longname") or item.get("shortname") or symbol
        exchange = item.get("exchange") or item.get("fullExchangeName") or ""
        out.append({
            "symbol": symbol,
            "name": name,
            "exchange": exchange,
            "type": type_disp or "equity",
        })
        if len(out) >= max_results:
            break
    return out


@router.get("/search")
async def search_tickers(
    q: str = Query(..., min_length=1, max_length=50),
    limit: int = Query(default=8, ge=1, le=20),
):
    """Autocomplete search — returns matching tickers by symbol or company name."""
    q = q.strip()
    if not q:
        return []

    loop = asyncio.get_event_loop()
    try:
        results = await loop.run_in_executor(_executor, _do_search, q, limit)
    except Exception as e:
        logger.error(f"Search executor error for '{q}': {e}")
        return []

    return results


def _fetch_info(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    info = t.info or {}
    fast = t.fast_info

    # Prefer fast_info for prices (faster, more reliable)
    current_price = None
    try:
        current_price = float(fast.last_price) if fast.last_price else None
    except Exception:
        pass
    if current_price is None:
        current_price = info.get("regularMarketPrice") or info.get("currentPrice")

    prev_close = None
    try:
        prev_close = float(fast.previous_close) if fast.previous_close else None
    except Exception:
        pass
    if prev_close is None:
        prev_close = info.get("regularMarketPreviousClose")

    change_pct = None
    if current_price and prev_close and prev_close != 0:
        change_pct = round(((current_price - prev_close) / prev_close) * 100, 2)

    high_52w = None
    low_52w = None
    try:
        high_52w = float(fast.year_high) if fast.year_high else None
        low_52w = float(fast.year_low) if fast.year_low else None
    except Exception:
        pass
    if high_52w is None:
        high_52w = info.get("fiftyTwoWeekHigh")
    if low_52w is None:
        low_52w = info.get("fiftyTwoWeekLow")

    market_cap = info.get("marketCap")
    try:
        if market_cap is None:
            market_cap = int(fast.market_cap) if fast.market_cap else None
    except Exception:
        pass

    name = (
        info.get("longName")
        or info.get("shortName")
        or ticker
    )
    currency = info.get("currency", "USD")
    exchange = info.get("exchange") or info.get("fullExchangeName", "")
    sector = info.get("sector", "")
    industry = info.get("industry", "")
    description = info.get("longBusinessSummary", "")

    return {
        "ticker": ticker.upper(),
        "name": name,
        "currency": currency,
        "exchange": exchange,
        "sector": sector,
        "industry": industry,
        "current_price": current_price,
        "prev_close": prev_close,
        "change_pct_day": change_pct,
        "high_52w": high_52w,
        "low_52w": low_52w,
        "market_cap": market_cap,
        "description": description,
        "found": current_price is not None,
    }


@router.get("/info/{ticker}")
async def get_ticker_info(ticker: str):
    ticker = ticker.upper().strip()
    if not ticker or len(ticker) > 15:
        raise HTTPException(status_code=400, detail="Invalid ticker")

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(_executor, _fetch_info, ticker)
    except Exception as e:
        logger.error(f"yfinance info failed for {ticker}: {e}")
        raise HTTPException(status_code=502, detail=f"Could not fetch data for {ticker}")

    if not result["found"]:
        raise HTTPException(status_code=404, detail=f"Ticker '{ticker}' not found or has no price data")

    return result


def _fetch_news_sync(ticker: str) -> list[dict]:
    try:
        t = yf.Ticker(ticker)
        raw = t.news or []
    except Exception as e:
        logger.warning(f"yfinance news failed for {ticker}: {e}")
        return []

    out = []
    for item in raw[:8]:
        content = item.get("content") or {}
        title = content.get("title") or item.get("title") or ""
        if not title:
            continue
        # Publication date
        pub_date = ""
        pub_raw = content.get("pubDate") or item.get("providerPublishTime")
        if pub_raw:
            try:
                from datetime import datetime, timezone
                if isinstance(pub_raw, (int, float)):
                    pub_date = datetime.fromtimestamp(int(pub_raw), tz=timezone.utc).strftime("%Y-%m-%d")
                else:
                    pub_date = str(pub_raw)[:10]
            except Exception:
                pass
        # URL
        url = ""
        canonical = content.get("canonicalUrl") or {}
        url = canonical.get("url") or item.get("link") or ""
        # Source / publisher
        provider = content.get("provider") or item.get("publisher") or {}
        source = provider.get("displayName") if isinstance(provider, dict) else str(provider)

        out.append({
            "title": title,
            "date": pub_date,
            "url": url,
            "source": source or "",
        })
    return out


@router.get("/news/{ticker}")
async def get_ticker_news(ticker: str):
    """Return up to 8 recent news items for any ticker via yfinance."""
    ticker = ticker.upper().strip()
    if not ticker or len(ticker) > 15:
        raise HTTPException(status_code=400, detail="Invalid ticker")

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(_executor, _fetch_news_sync, ticker)
    except Exception as e:
        logger.error(f"news fetch failed for {ticker}: {e}")
        return []

    return result
