"""
AI Analysis service — uses GitHub Models (free) or OpenAI as fallback.
GitHub Models endpoint: https://models.inference.ai.azure.com
Requires: GITHUB_TOKEN in .env  (Settings → Developer settings → PAT → no scopes needed)
Fallback:  OPENAI_API_KEY in .env
"""

import json
import logging
from datetime import datetime, timedelta, timezone

from openai import AsyncOpenAI
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database.models import AIAnalysis

logger = logging.getLogger(__name__)

# ─── Client factory ──────────────────────────────────────────────────────────

def _make_client() -> tuple[AsyncOpenAI, str]:
    """Returns (client, model_name). Prefers GitHub Models, falls back to OpenAI."""
    if settings.github_token:
        return (
            AsyncOpenAI(
                base_url="https://models.inference.ai.azure.com",
                api_key=settings.github_token,
            ),
            "gpt-4o-mini",
        )
    if settings.openai_api_key:
        return (
            AsyncOpenAI(api_key=settings.openai_api_key),
            "gpt-4o-mini",
        )
    raise ValueError("No AI key configured. Set GITHUB_TOKEN or OPENAI_API_KEY in .env")


# ─── Prompt builder ───────────────────────────────────────────────────────────

def _build_prompt(ticker: str, context: dict, lang: str = "en") -> str:
    pos   = context.get("position")
    div   = context.get("dividends")
    price = context.get("price")
    fund  = context.get("fundamentals", {})

    lang_name = "Bulgarian" if lang == "bg" else "English"
    lang_instruction = (
        f"CRITICAL LANGUAGE REQUIREMENT: Write ALL text values in {lang_name}. "
        f"JSON keys stay in English. Do NOT use any other language."
    )

    lines = [
        lang_instruction,
        f"\nYou are a senior equity research analyst (CFA charterholder) at a top-tier asset management firm. "
        f"Write a rigorous, data-driven investment research note for {ticker}. "
        f"Use the data below. Be specific and quantitative. Avoid generic statements. "
        f"Reference actual numbers from the data in your analysis.",
    ]

    # ── BUSINESS CONTEXT ──────────────────────────────────────────────────────
    if fund.get("business_summary"):
        sector = fund.get("sector") or fund.get("fund_category") or "N/A"
        industry = fund.get("industry") or "N/A"
        lines.append(f"""
COMPANY / FUND OVERVIEW:
- Sector: {sector} | Industry: {industry}
- Business: {fund['business_summary']}
""")

    # ── INVESTOR POSITION ─────────────────────────────────────────────────────
    if pos:
        lines.append(f"""
INVESTOR POSITION:
- Units: {pos.get('units')}  |  Avg cost: ${pos.get('open_rate')}
- Current price: ${pos.get('current_price')}  |  Market value: ${pos.get('current_value')}
- Unrealized P&L: ${pos.get('unrealized_pnl')} ({pos.get('unrealized_pnl_pct')}%)
- Total dividends/distributions received: ${pos.get('total_dividends')}
""")

    # ── MARKET DATA ───────────────────────────────────────────────────────────
    if price:
        cur = pos.get('current_price') if pos else None
        yh  = price.get('year_high')
        yl  = price.get('year_low')
        dh  = round(((cur - yh) / yh) * 100, 1) if cur and yh else None
        dl  = round(((cur - yl) / yl) * 100, 1) if cur and yl else None
        sma50  = fund.get("fifty_day_avg")
        sma200 = fund.get("two_hundred_day_avg")
        beta   = fund.get("beta")
        short  = fund.get("short_percent_float")
        w52chg = fund.get("fifty_two_week_change_pct")

        lines.append(f"""
PRICE & TECHNICAL:
- Current: ${cur}  |  52w High: ${yh} ({dh}%)  |  52w Low: ${yl} ({dl}%)
- SMA 50d: ${sma50}  |  SMA 200d: ${sma200}  |  52w Return: {w52chg}%
- Beta: {beta}  |  Short interest: {short}%
""")

    # ── VALUATION MULTIPLES ───────────────────────────────────────────────────
    v_fields = {
        "Trailing P/E":  fund.get("trailing_pe"),
        "Forward P/E":   fund.get("forward_pe"),
        "EV/EBITDA":     fund.get("ev_to_ebitda"),
        "P/Book":        fund.get("price_to_book"),
        "PEG ratio":     fund.get("peg_ratio"),
        "Trailing EPS":  fund.get("trailing_eps"),
        "Forward EPS":   fund.get("forward_eps"),
    }
    v_lines = [f"- {k}: {v}" for k, v in v_fields.items() if v is not None]
    if v_lines:
        lines.append("VALUATION MULTIPLES:\n" + "\n".join(v_lines) + "\n")

    # ── PROFITABILITY & GROWTH ────────────────────────────────────────────────
    p_fields = {
        "Gross margin":      fund.get("gross_margin_pct"),
        "Operating margin":  fund.get("operating_margin_pct"),
        "Net margin":        fund.get("profit_margin_pct"),
        "ROE":               fund.get("roe_pct"),
        "ROA":               fund.get("roa_pct"),
        "Revenue growth YoY": fund.get("revenue_growth_pct"),
        "Earnings growth YoY": fund.get("earnings_growth_pct"),
    }
    p_lines = [f"- {k}: {v}%" for k, v in p_fields.items() if v is not None]
    if p_lines:
        lines.append("PROFITABILITY & GROWTH:\n" + "\n".join(p_lines) + "\n")

    # ── CASH FLOW & BALANCE SHEET ─────────────────────────────────────────────
    cf_fields = {
        "Free cash flow (FCF)":    (fund.get("free_cashflow_m"), "M"),
        "Operating cash flow":     (fund.get("operating_cashflow_m"), "M"),
        "FCF yield":               (fund.get("fcf_yield_pct"), "%"),
        "Total debt":              (fund.get("total_debt_b"), "B"),
        "Total cash":              (fund.get("total_cash_b"), "B"),
        "Net debt":                (fund.get("net_debt_b"), "B"),
        "Net debt / EBITDA":       (fund.get("net_debt_ebitda"), "x"),
        "Debt/Equity":             (fund.get("debt_to_equity"), ""),
        "Current ratio":           (fund.get("current_ratio"), "x"),
    }
    cf_lines = [f"- {k}: ${v}{u}" if u in ("M", "B") else f"- {k}: {v}{u}"
                for k, (v, u) in cf_fields.items() if v is not None]
    if cf_lines:
        lines.append("CASH FLOW & BALANCE SHEET:\n" + "\n".join(cf_lines) + "\n")

    # ── DIVIDEND DATA ─────────────────────────────────────────────────────────
    d_fields = {
        "Annual dividend/distribution rate": (fund.get("dividend_rate_usd"), "$/share"),
        "Dividend yield":         (fund.get("dividend_yield_pct"), "%"),
        "5-year avg yield":       (fund.get("five_yr_avg_yield_pct"), "%"),
        "Payout ratio (EPS)":     (fund.get("payout_ratio_pct"), "%"),
        "Ex-dividend date":       (fund.get("ex_dividend_date"), ""),
    }
    if div:
        d_fields["Yield on cost (this position)"] = (div.get("yield_on_cost_pct"), "%")
        d_fields["Est. annual income (this pos)"] = (div.get("annual_income"), "$")
        d_fields["Est. monthly income (this pos)"] = (div.get("monthly_income"), "$")
    d_lines = [f"- {k}: {v}{u}" for k, (v, u) in d_fields.items() if v is not None]
    if d_lines:
        lines.append("DIVIDEND / INCOME DATA:\n" + "\n".join(d_lines) + "\n")

    # ── ANALYST CONSENSUS ─────────────────────────────────────────────────────
    at_mean = fund.get("analyst_target_mean")
    at_high = fund.get("analyst_target_high")
    at_low  = fund.get("analyst_target_low")
    at_cnt  = fund.get("analyst_count")
    at_rec  = fund.get("analyst_rec_label")
    cur_px  = pos.get("current_price") if pos else None
    upside  = round(((at_mean - cur_px) / cur_px) * 100, 1) if at_mean and cur_px else None

    if any(x is not None for x in [at_mean, at_cnt, at_rec]):
        lines.append(f"""ANALYST CONSENSUS ({at_cnt or 'N/A'} analysts):
- Wall Street consensus: {at_rec or 'N/A'}
- Price target: mean ${at_mean} (low ${at_low} – high ${at_high})  |  Implied upside: {upside}%
""")

    # ── RECENT NEWS ───────────────────────────────────────────────────────────
    recent_news = fund.get("recent_news", [])
    if recent_news:
        news_lines = []
        for n in recent_news:
            date_str = f"[{n['date']}] " if n.get("date") else ""
            pub_str  = f" ({n['publisher']})" if n.get("publisher") else ""
            news_lines.append(f"- {date_str}{n['title']}{pub_str}")
        lines.append(
            "RECENT NEWS (last headlines — identify current catalysts and market sentiment):\n"
            + "\n".join(news_lines) + "\n"
        )

    # ── QUARTERLY FINANCIALS ──────────────────────────────────────────────────
    quarterly = fund.get("quarterly_results", [])
    if quarterly:
        q_lines = []
        for q in quarterly:
            rev = f"Rev ${q['revenue_m']}M" if q.get("revenue_m") is not None else ""
            ni  = f"Net Income ${q['net_income_m']}M" if q.get("net_income_m") is not None else ""
            parts = [p for p in [rev, ni] if p]
            if parts:
                q_lines.append(f"- {q['period']}: {' | '.join(parts)}")
        if q_lines:
            lines.append(
                "LATEST QUARTERLY RESULTS (most recent first — reference these when discussing financial health and growth trend):\n"
                + "\n".join(q_lines) + "\n"
            )

    # ── FUNDAMENTAL SCORECARD (FMP multi-year) ───────────────────────────────
    fsc = context.get("financial_scorecard", {})
    if fsc:
        def _sig_icon(s: str) -> str:
            return "🟢" if s == "green" else ("🔴" if s == "red" else "🟡")

        rev = fsc.get("revenue", {})
        nm  = fsc.get("net_margin", {})
        dp  = fsc.get("debt_payoff", {})
        fcf_sc = fsc.get("fcf", {})
        yrs = fsc.get("data_years", "?")

        rev_hist  = [d["value"] for d in rev.get("data",  [])]
        nm_hist   = [d["value"] for d in nm.get("data",   [])]
        fcf_hist  = [d["value"] for d in fcf_sc.get("data", [])]

        lines.append(f"""
FUNDAMENTAL SCORECARD ({yrs}-year yfinance data — use these to calibrate financial_health.rating and commentary):
- Revenue {_sig_icon(rev.get('signal','yellow'))}: ${rev.get('latest_b')}B latest | {yrs}yr trend (oldest→newest $B): {rev_hist}
- Net margin {_sig_icon(nm.get('signal','yellow'))}: {nm.get('latest_pct')}% latest | trend (%): {nm_hist}
- Debt payoff {_sig_icon(dp.get('signal','yellow'))}: {dp.get('years','N/A')} years | debt ${dp.get('debt_b')}B / FCF ${dp.get('fcf_b')}B
- Free cash flow {_sig_icon(fcf_sc.get('signal','yellow'))}: ${fcf_sc.get('latest_b')}B latest | trend ($B): {fcf_hist}
Signal key: 🟢 healthy (revenue/FCF CAGR >3%, margin improving, debt<3yr FCF), 🟡 neutral, 🔴 concern.
""")

    # ── INSTRUCTIONS TO THE MODEL ─────────────────────────────────────────────
    is_etf = bool(fund.get("fund_category") or
                  (ticker in ("QYLD","SPHD","DIV","VTI","SPY","QQQ","JEPI","JEPQ")))

    etf_note = (
        "\nNOTE: This is an ETF/fund. Analyse distribution sustainability, NAV trend, "
        "total return (price + distributions), expense ratio impact, and whether "
        "distributions represent real income vs return-of-capital / NAV erosion."
        if is_etf else ""
    )

    lines.append(f"""
ANALYTICAL FRAMEWORK — apply the following when writing the research note:{etf_note}

1. BUSINESS MOAT: What competitive advantages protect this company? (brand, network effects, switching costs, cost leadership, regulatory moat)
2. VALUATION: Is the stock cheap, fairly valued, or expensive? Compare P/E / EV/EBITDA to sector median norms (tech: 20-30x P/E, utilities: 14-18x, REITs/ETFs: yield-based). Reference the specific multiples from the data.
3. FINANCIAL QUALITY: Assess revenue growth trend, margin trajectory, FCF generation vs net income (FCF/NI ratio), and debt sustainability (net debt/EBITDA < 2x is healthy, >4x is concerning).
4. DIVIDEND SAFETY (if applicable): 
   - Payout ratio < 65% EPS = very safe; 65-85% = moderate; >85% = at risk
   - FCF payout ratio (dividends/FCF) is more reliable than EPS payout ratio  
   - Dividend growth track record (is it growing, flat, or was it cut?)
   - For covered-call ETFs (QYLD etc.): warn about NAV erosion and total return vs distribution
5. MANAGEMENT & STRATEGY: What does the business description reveal about strategic direction? Any recent guidance signals?
6. TECHNICAL SETUP: Is price above/below SMA 50d and 200d? Golden cross or death cross? Where is price in the 52w range?
7. CATALYSTS: What near-term events (earnings, ex-div, product launch, rate decisions) could be positive or negative catalysts?
8. PRICE TARGETS: 
   - BUY below: level where margin of safety is attractive (typically 15-20% below fair value)
   - HOLD range: fair value range — you MUST provide both hold_range_low and hold_range_high as numbers
   - TRIM/SELL above: materially overvalued level — you MUST provide sell_above as a number
   - Use analyst consensus target as one data point but form your own view
   - NOTE: hold_range_low, hold_range_high and sell_above are MANDATORY numeric fields. Only set them null for bonds or cash-equivalent instruments with no meaningful price target.

Write ALL text fields in {lang_name}.

Respond ONLY with a valid JSON object (no markdown, no code fences):
{{
  "business_overview": "2 sentences: what this company/fund does and its key competitive position or strategy",
  "summary": "4-5 sentence comprehensive investment thesis covering business quality, valuation, financial health and key risk",
  "price_targets": {{
    "buy_below": <number or null>,
    "hold_range_low": <number or null>,
    "hold_range_high": <number or null>,
    "sell_above": <number or null>,
    "analyst_consensus": {at_mean or "null"},
    "analyst_count": {at_cnt or "null"},
    "current_zone": "BUY | HOLD | SELL | TRIM"
  }},
  "valuation": "2-3 sentences: cheap/fair/expensive with specific multiples vs sector norms",
  "financial_health": {{
    "rating": "Strong | Moderate | Weak",
    "commentary": "2-3 sentences on revenue growth, margins, FCF generation and debt load"
  }},
  "strengths": ["4 specific quantitative strengths referencing actual data"],
  "risks": ["4 specific quantitative risks referencing actual data"],
  "dividend_outlook": "3-4 sentences: payout ratio assessment, FCF coverage, sustainability verdict, growth or cut outlook",
  "management_guidance": "1-2 sentences on strategic direction, any notable guidance or capital allocation signals from the business overview",
  "catalysts": ["2-3 near-term positive or negative catalysts with specific dates/events where known"],
  "recommendation": "STRONG BUY | BUY | HOLD | TRIM | SELL",
  "recommendation_reason": "3 sentences with specific price references and the single most important thesis driver",
  "confidence": "HIGH | MEDIUM | LOW"
}}""")

    return "\n".join(lines)


# ─── Cache helpers ────────────────────────────────────────────────────────────

async def _get_cached(db: AsyncSession, ticker: str, lang: str = "en") -> dict | None:
    now = datetime.now(timezone.utc)
    cache_key = f"{ticker}_{lang}"
    row = await db.scalar(
        select(AIAnalysis)
        .where(AIAnalysis.ticker == cache_key, AIAnalysis.expires_at > now)
        .order_by(AIAnalysis.created_at.desc())
        .limit(1)
    )
    if row:
        return json.loads(row.analysis_json)
    return None


async def _save_cache(db: AsyncSession, ticker: str, lang: str, data: dict, model: str, tokens: int | None) -> None:
    cache_key = f"{ticker}_{lang}"
    # Remove old entries for this ticker+lang
    await db.execute(delete(AIAnalysis).where(AIAnalysis.ticker == cache_key))
    expires = datetime.now(timezone.utc) + timedelta(hours=settings.ai_cache_hours)
    db.add(AIAnalysis(
        ticker=cache_key,
        analysis_json=json.dumps(data),
        model_used=model,
        tokens_used=tokens,
        expires_at=expires,
    ))
    await db.commit()


# ─── Main entry point ─────────────────────────────────────────────────────────

async def get_ai_analysis(ticker: str, context: dict, db: AsyncSession, lang: str = "en") -> dict:
    """
    Returns AI analysis dict for the given ticker+lang.
    Uses cache (6h by default). On miss, calls GitHub Models / OpenAI.
    """
    cached = await _get_cached(db, ticker, lang)
    if cached:
        logger.info(f"AI cache hit for {ticker} ({lang})")
        return {**cached, "cached": True}

    logger.info(f"Calling AI for {ticker} (lang={lang})...")
    client, model = _make_client()
    prompt = _build_prompt(ticker, context, lang)

    lang_label = "Bulgarian" if lang == "bg" else "English"
    system_msg = (
        f"You are a senior equity research analyst. "
        f"You MUST write ALL text content exclusively in {lang_label}. "
        f"This is a strict requirement — do not use any other language. "
        f"JSON keys must remain in English exactly as specified."
    )

    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_msg},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
        max_tokens=2000,
    )

    raw = response.choices[0].message.content or ""
    tokens = response.usage.total_tokens if response.usage else None

    # Parse JSON — strip accidental markdown fences if present
    raw = raw.strip()
    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()
    # Fallback: extract first {...} block to handle extra text before/after JSON
    if not raw.startswith("{"):
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1:
            raw = raw[start:end + 1]
        else:
            logger.error(f"AI returned non-JSON for {ticker}: {raw[:200]}")
            raise ValueError(f"AI response is not valid JSON for {ticker}")
    try:
        result = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.error(f"JSON parse error for {ticker}: {exc} | raw[:300]={raw[:300]}")
        raise ValueError(f"AI returned malformed JSON for {ticker}: {exc}")

    await _save_cache(db, ticker, lang, result, model, tokens)
    logger.info(f"AI analysis for {ticker} ({lang}) done ({tokens} tokens, model={model})")
    return {**result, "cached": False, "model": model}
