import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, TrendingUp, TrendingDown, RefreshCw, Search } from 'lucide-react'
import { useChartData, usePositions, useAiAnalysis, useTickerInfo, useTickerNews } from '@/hooks'
import { searchTickers } from '@/api/client'
import { CandlestickChart } from '@/components/charts/CandlestickChart'
import { useLanguage } from '@/contexts/LanguageContext'
import { useCurrency } from '@/contexts/CurrencyContext'
import type { ChartPeriod, TickerInfo, TickerSearchResult } from '@/types'

const PERIODS: ChartPeriod[] = ['1W', '1M', '3M', '6M', '1Y', '5Y', 'MAX']

const fmtPct = (n: number | null | undefined) =>
  n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

type Tab = 'chart' | 'signals' | 'scenario' | 'ai'

export function StockAnalysis() {
  const { ticker } = useParams<{ ticker: string }>()
  const navigate = useNavigate()
  const [period, setPeriod] = useState<ChartPeriod>('1Y')
  const [tab, setTab] = useState<Tab>('chart')
  const [searchInput, setSearchInput] = useState('')
  const [suggestions, setSuggestions] = useState<TickerSearchResult[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 1) { setSuggestions([]); setShowSuggestions(false); return }
    setSearchLoading(true)
    try {
      const results = await searchTickers(q)
      setSuggestions(results)
      setShowSuggestions(results.length > 0)
    } catch {
      setSuggestions([])
    } finally {
      setSearchLoading(false)
    }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase()
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 280)
  }

  const handleSelectSuggestion = (s: TickerSearchResult) => {
    setShowSuggestions(false)
    setSearchInput('')
    setSuggestions([])
    setTab('chart')
    navigate(`/analysis/${s.symbol}`)
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const t = searchInput.trim().toUpperCase()
    if (t) {
      setShowSuggestions(false)
      setSearchInput('')
      setSuggestions([])
      setTab('chart')
      navigate(`/analysis/${t}`)
    }
  }

  const { data: chartData, isLoading: chartLoading } = useChartData(ticker ?? '', period)
  const { data: positions } = usePositions()
  const { data: tickerInfo, isLoading: infoLoading } = useTickerInfo(ticker ?? '')
  const position = positions?.find(p => p.ticker === ticker)
  const { t } = useLanguage()
  const { fmt, fmtCompact } = useCurrency()

  if (!ticker) return null

  const lastCandle = chartData?.candles.at(-1)
  const firstCandle = chartData?.candles.at(0)
  const periodReturn =
    lastCandle && firstCandle
      ? ((lastCandle.close - firstCandle.open) / firstCandle.open) * 100
      : null

  // Use position data if available, else fall back to tickerInfo
  const displayPrice = position?.current_price ?? tickerInfo?.current_price ?? null
  const displayChangePct = position?.change_pct_day ?? tickerInfo?.change_pct_day ?? null
  const displayName = position?.instrument_name || tickerInfo?.name || ticker
  const inPortfolio = !!position

  const fmtMktCap = (v: number | null | undefined) => fmtCompact(v)

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-zinc-100">{ticker}</h1>
            {!inPortfolio && tickerInfo && (
              <span className="px-2 py-0.5 rounded text-xs bg-zinc-800 text-zinc-500 border border-zinc-700">
                {t('not_in_portfolio')}
              </span>
            )}
          </div>
          <p className="text-sm text-zinc-500 mt-0.5">
            {infoLoading ? '…' : displayName}
            {tickerInfo?.exchange && <span className="ml-1 text-zinc-600">· {tickerInfo.exchange}</span>}
            {tickerInfo?.sector && <span className="ml-1 text-zinc-600">· {tickerInfo.sector}</span>}
          </p>
        </div>

        {/* Ticker search with autocomplete */}
        <div className="ml-4 relative">
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
              {searchLoading && (
                <RefreshCw size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 animate-spin" />
              )}
              <input
                ref={inputRef}
                type="text"
                value={searchInput}
                onChange={handleInputChange}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                placeholder={t('search_ticker_placeholder')}
                maxLength={50}
                className="pl-8 pr-8 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 w-56"
              />
            </div>
            <button
              type="submit"
              className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg text-sm transition-colors"
            >
              {t('analyse')}
            </button>
          </form>

          {/* Autocomplete dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute top-full mt-1 left-0 w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden"
            >
              {suggestions.map((s) => (
                <button
                  key={s.symbol}
                  onMouseDown={() => handleSelectSuggestion(s)}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-zinc-100 text-sm w-20 shrink-0">{s.symbol}</span>
                    <span className="text-zinc-400 text-xs truncate max-w-[140px]">{s.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-zinc-600 text-xs">{s.exchange}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${s.type === 'etf' ? 'bg-blue-500/10 text-blue-400' : 'bg-zinc-800 text-zinc-500'}`}>
                      {s.type.toUpperCase()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Quick stats — always visible if we have any data */}
        {(displayPrice != null || infoLoading) && (
          <div className="ml-auto flex items-center gap-6 text-sm flex-wrap">
            <div className="text-right">
              <p className="text-zinc-500 text-xs">{t('price_label')}</p>
              <p className="text-zinc-100 font-semibold tabular-nums">
                {infoLoading ? '…' : fmt(displayPrice)}
                {tickerInfo?.currency && tickerInfo.currency !== 'USD' && (
                  <span className="text-zinc-600 ml-1 text-xs">{tickerInfo.currency}</span>
                )}
              </p>
            </div>
            <div className="text-right">
              <p className="text-zinc-500 text-xs">{t('today_label')}</p>
              <p className={`font-semibold tabular-nums ${(displayChangePct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {infoLoading ? '…' : fmtPct(displayChangePct)}
              </p>
            </div>
            {(tickerInfo?.high_52w || tickerInfo?.low_52w) && (
              <div className="text-right">
                <p className="text-zinc-500 text-xs">{t('range_52w')}</p>
                <p className="text-zinc-300 font-medium tabular-nums text-xs">
                  {fmt(tickerInfo.low_52w, 2)} — {fmt(tickerInfo.high_52w, 2)}
                </p>
              </div>
            )}
            {tickerInfo?.market_cap && (
              <div className="text-right">
                <p className="text-zinc-500 text-xs">{t('market_cap_label')}</p>
                <p className="text-zinc-300 font-medium tabular-nums text-xs">{fmtMktCap(tickerInfo.market_cap)}</p>
              </div>
            )}
            {inPortfolio && (
              <>
                <div className="text-right border-l border-zinc-700 pl-6">
                  <p className="text-zinc-500 text-xs">{t('units_label')}</p>
                  <p className="text-zinc-100 font-semibold tabular-nums">{Number(position.units).toFixed(2)}</p>
                </div>
                <div className="text-right">
                  <p className="text-zinc-500 text-xs">{t('pnl_label')}</p>
                  <div className={`font-semibold tabular-nums flex items-center gap-1 justify-end ${(position.unrealized_pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {(position.unrealized_pnl ?? 0) >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                    <span>{fmt(position.unrealized_pnl)}</span>
                    <span className="text-xs opacity-70">({fmtPct(position.unrealized_pnl_pct)})</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-zinc-500 text-xs">{t('dividends_label')}</p>
                  <p className="text-emerald-400 font-semibold tabular-nums">{fmt(position.total_dividends)}</p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 w-fit">
        {(['chart', 'signals', 'scenario', 'ai'] as Tab[]).map(tabKey => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
              tab === tabKey
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {tabKey === 'ai' ? t('tab_ai') : tabKey === 'signals' ? t('tab_signals') : tabKey === 'scenario' ? t('tab_scenario') : t('tab_chart')}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'chart' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          {/* Period selector + period return */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
            <div className="flex gap-1">
              {PERIODS.map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    period === p
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            {periodReturn != null && (
              <span className={`text-sm font-medium tabular-nums ${periodReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {fmtPct(periodReturn)} {t('this_period')}
              </span>
            )}
          </div>

          {/* Chart */}
          <div className="p-4">
            {chartLoading ? (
              <div className="flex items-center justify-center h-[420px] text-zinc-500">
                {t('loading_chart')}
              </div>
            ) : !chartData?.candles.length ? (
              <div className="flex items-center justify-center h-[420px] text-zinc-600">
                {t('no_price_data')}
              </div>
            ) : (
              <CandlestickChart data={chartData} />
            )}
          </div>

          {/* Chart footer */}
          {chartData && chartData.candles_count > 0 && (
            <div className="px-6 py-3 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-500">
              <span>{chartData.candles_count} candles · {chartData.data_from} → {chartData.data_to}</span>
              <span>{t('source_yahoo')}</span>
            </div>
          )}
        </div>
      )}

      {tab === 'signals' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8">
          <SignalsTab ticker={ticker} chartData={chartData} />
        </div>
      )}

      {tab === 'scenario' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8">
          <ScenarioTab ticker={ticker} position={position} tickerInfo={tickerInfo} />
        </div>
      )}

      {tab === 'ai' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8">
          <AiTab ticker={ticker} />
        </div>
      )}
    </div>
  )
}

// ─── Signals Tab ─────────────────────────────────────────────────────────────
function SignalsTab({ ticker, chartData }: { ticker: string; chartData: ReturnType<typeof useChartData>['data'] }) {
  const { t } = useLanguage()
  const { fmt } = useCurrency()

  if (!chartData?.candles.length) {
    return <p className="text-zinc-500 text-center">{t('load_chart_first')}</p>
  }

  const candles = chartData.candles
  const last = candles.at(-1)!
  const sma50 = chartData.sma.sma50.at(-1)?.value ?? null
  const sma200 = chartData.sma.sma200.at(-1)?.value ?? null
  const price = last.close

  // Translation helper for signal values
  const sigT = (s: string) => {
    const map: Record<string, string> = {
      'BULLISH': t('signal_bullish'),
      'BEARISH': t('signal_bearish'),
      'GOLDEN CROSS': t('signal_golden_cross'),
      'DEATH CROSS': t('signal_death_cross'),
      'NEAR HIGH': t('signal_near_high'),
      'NEAR LOW': t('signal_near_low'),
      'MID RANGE': t('signal_mid_range'),
      'NEUTRAL': t('signal_neutral'),
    }
    return map[s] ?? s
  }

  // Simple signals
  const signals = [
    {
      name: t('signal_price_sma50'),
      value: sma50 ? `${fmt(price)} vs ${fmt(sma50)}` : '—',
      signal: sma50 ? (price > sma50 ? 'BULLISH' : 'BEARISH') : 'N/A',
      bullish: sma50 ? price > sma50 : null,
    },
    {
      name: t('signal_price_sma200'),
      value: sma200 ? `${fmt(price)} vs ${fmt(sma200)}` : '—',
      signal: sma200 ? (price > sma200 ? 'BULLISH' : 'BEARISH') : 'N/A',
      bullish: sma200 ? price > sma200 : null,
    },
    {
      name: t('signal_golden_death'),
      value: sma50 && sma200 ? `SMA50 ${fmt(sma50)} vs SMA200 ${fmt(sma200)}` : '—',
      signal: sma50 && sma200 ? (sma50 > sma200 ? 'GOLDEN CROSS' : 'DEATH CROSS') : 'N/A',
      bullish: sma50 && sma200 ? sma50 > sma200 : null,
    },
    {
      name: t('signal_52w_range'),
      value: (() => {
        const prices = candles.slice(-252).map(c => c.close)
        const hi = Math.max(...prices)
        const lo = Math.min(...prices)
        const pct = ((price - lo) / (hi - lo)) * 100
        return `${pct.toFixed(0)}% ${t('of_range')} (${fmt(lo)} – ${fmt(hi)})`
      })(),
      signal: (() => {
        const prices = candles.slice(-252).map(c => c.close)
        const hi = Math.max(...prices)
        const lo = Math.min(...prices)
        const pct = ((price - lo) / (hi - lo)) * 100
        return pct > 70 ? 'NEAR HIGH' : pct < 30 ? 'NEAR LOW' : 'MID RANGE'
      })(),
      bullish: (() => {
        const prices = candles.slice(-252).map(c => c.close)
        const hi = Math.max(...prices)
        const lo = Math.min(...prices)
        const pct = ((price - lo) / (hi - lo)) * 100
        return pct > 50
      })(),
    },
  ]

  const bullishCount = signals.filter(s => s.bullish === true).length
  const bearishCount = signals.filter(s => s.bullish === false).length
  const overall = bullishCount > bearishCount ? 'BULLISH' : bearishCount > bullishCount ? 'BEARISH' : 'NEUTRAL'
  const overallColor = overall === 'BULLISH' ? 'text-green-400' : overall === 'BEARISH' ? 'text-red-400' : 'text-yellow-400'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h3 className="text-lg font-semibold text-zinc-100">{t('signals_title')} — {ticker}</h3>
        <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
          overall === 'BULLISH' ? 'border-green-500/30 bg-green-500/10 text-green-400'
          : overall === 'BEARISH' ? 'border-red-500/30 bg-red-500/10 text-red-400'
          : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400'
        }`}>{sigT(overall)}</span>
      </div>

      <div className="grid gap-3">
        {signals.map(s => (
          <div key={s.name} className="flex items-center justify-between p-4 bg-zinc-800/50 rounded-xl border border-zinc-700/50">
            <div>
              <p className="text-zinc-200 font-medium text-sm">{s.name}</p>
              <p className="text-zinc-500 text-xs mt-0.5">{s.value}</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${
              s.bullish === true ? 'bg-green-500/10 text-green-400'
              : s.bullish === false ? 'bg-red-500/10 text-red-400'
              : 'bg-zinc-700 text-zinc-400'
            }`}>{sigT(s.signal)}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-zinc-600">{t('not_financial_advice')}</p>
    </div>
  )
}

// ─── Scenario Tab ─────────────────────────────────────────────────────────────
function ScenarioTab({
  ticker,
  position,
  tickerInfo,
}: {
  ticker: string
  position: ReturnType<typeof usePositions>['data'] extends (infer T)[] | undefined ? T | undefined : never
  tickerInfo: TickerInfo | undefined
}) {
  const { t } = useLanguage()
  const { fmt } = useCurrency()
  const [annualGrowth, setAnnualGrowth] = useState(7)
  const [years, setYears] = useState(10)
  const [annualDivGrowth, setAnnualDivGrowth] = useState(3)
  // For non-portfolio tickers: hypothetical investment
  const [hypotheticalAmount, setHypotheticalAmount] = useState(1000)
  const [hypotheticalDivYield, setHypotheticalDivYield] = useState(3)

  const inPortfolio = !!position
  const currentPrice = position?.current_price
    ?? tickerInfo?.current_price
    ?? null

  // Compute inputs based on portfolio position OR hypothetical
  const invested = inPortfolio
    ? Number(position.units) * Number(position.open_rate)
    : hypotheticalAmount

  const currentValue = inPortfolio
    ? Number(position.units) * (currentPrice ?? Number(position.open_rate))
    : hypotheticalAmount  // for hypothetical, "current value" = investment

  const annualDiv = inPortfolio
    ? (position.total_dividends ? Number(position.total_dividends) * 12 / 36 * 12 : 0)
    : (hypotheticalAmount * hypotheticalDivYield / 100)

  const projections = Array.from({ length: years }, (_, i) => {
    const y = i + 1
    const value = currentValue * Math.pow(1 + annualGrowth / 100, y)
    const dividends = annualDivGrowth === 0
      ? annualDiv * y
      : annualDiv * ((Math.pow(1 + annualDivGrowth / 100, y + 1) - (1 + annualDivGrowth / 100)) / (annualDivGrowth / 100))
    return { year: y, value: Math.round(value), dividends: Math.round(dividends) }
  })

  const final = projections.at(-1)

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-zinc-100">{t('scenario_title')} — {ticker}</h3>

      {/* Hypothetical investment inputs for non-portfolio tickers */}
      {!inPortfolio && (
        <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
          <p className="text-xs text-blue-400 font-medium mb-3 uppercase tracking-wide">{t('hypothetical_invest')}</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">{t('investment_amount_label')}</label>
              <input
                type="number"
                min={100}
                max={1000000}
                step={100}
                value={hypotheticalAmount}
                onChange={e => setHypotheticalAmount(Number(e.target.value))}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">{t('expected_div_yield')}</label>
              <input
                type="number"
                min={0}
                max={30}
                step={0.5}
                value={hypotheticalDivYield}
                onChange={e => setHypotheticalDivYield(Number(e.target.value))}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
              />
            </div>
          </div>
          {currentPrice && (
            <p className="text-xs text-zinc-600 mt-2">
              ≈ {(hypotheticalAmount / currentPrice).toFixed(2)} {t('units_label')} за {fmt(currentPrice)}/акция
            </p>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="grid grid-cols-3 gap-6">
        {[
          { label: t('annual_growth_ctrl'), value: annualGrowth, set: setAnnualGrowth, min: -10, max: 30, step: 1, suffix: '%' },
          { label: t('horizon_ctrl'), value: years, set: setYears, min: 1, max: 30, step: 1, suffix: t('yr_suffix') },
          { label: t('div_growth_ctrl'), value: annualDivGrowth, set: setAnnualDivGrowth, min: 0, max: 20, step: 1, suffix: '%' },
        ].map(ctrl => (
          <div key={ctrl.label}>
            <label className="block text-xs text-zinc-500 mb-2">{ctrl.label}</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={ctrl.min}
                max={ctrl.max}
                step={ctrl.step}
                value={ctrl.value}
                onChange={e => ctrl.set(Number(e.target.value))}
                className="flex-1 accent-blue-500"
              />
              <span className="text-zinc-100 font-semibold w-14 text-right tabular-nums">
                {ctrl.value}{ctrl.suffix}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: inPortfolio ? t('current_value_label') : t('invested'), value: fmt(currentValue, 0) },
          { label: `${t('col_value')} +${years}${t('yr_suffix')}`, value: fmt(final?.value ?? 0, 0), highlight: true },
          { label: t('total_div_label'), value: fmt(final?.dividends ?? 0, 0), highlight: true },
          { label: t('total_return_label'), value: fmt((final?.value ?? 0) + (final?.dividends ?? 0) - invested, 0), highlight: true },
        ].map(item => (
          <div key={item.label} className={`p-4 rounded-xl border ${item.highlight ? 'bg-blue-500/10 border-blue-500/20' : 'bg-zinc-800/50 border-zinc-700/50'}`}>
            <p className="text-xs text-zinc-500">{item.label}</p>
            <p className={`text-lg font-bold mt-1 tabular-nums ${item.highlight ? 'text-blue-400' : 'text-zinc-100'}`}>{item.value}</p>
          </div>
        ))}
      </div>

      {/* Year-by-year table */}
      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-800/50 text-zinc-500 text-left">
              <th className="px-5 py-3 font-medium">{t('yr_col')}</th>
              <th className="px-5 py-3 font-medium text-right">{t('portfolio_value_col')}</th>
              <th className="px-5 py-3 font-medium text-right">{t('cum_div_col')}</th>
              <th className="px-5 py-3 font-medium text-right">{t('total_col')}</th>
            </tr>
          </thead>
          <tbody>
            {projections.map(row => (
              <tr key={row.year} className="border-t border-zinc-800/60 hover:bg-zinc-800/30 transition-colors">
                <td className="px-5 py-2.5 text-zinc-400">+{row.year}{t('yr_suffix')}</td>
                <td className="px-5 py-2.5 text-right text-zinc-200 tabular-nums">{fmt(row.value, 0)}</td>
                <td className="px-5 py-2.5 text-right text-emerald-400 tabular-nums">{fmt(row.dividends, 0)}</td>
                <td className="px-5 py-2.5 text-right text-blue-400 font-medium tabular-nums">{fmt(row.value + row.dividends, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-600">{t('scenario_disclaimer')}</p>
    </div>
  )
}

// ─── Fundamental Scorecard component ─────────────────────────────────────────

type FscSignal = 'green' | 'yellow' | 'red'

function SignalDot({ signal }: { signal?: FscSignal | string }) {
  const color =
    signal === 'green' ? 'bg-green-400' :
    signal === 'red'   ? 'bg-red-400'   :
    'bg-yellow-400'
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color} shrink-0`} />
}

function MiniSparkline({ data, signal }: { data: { year: string; value: number }[]; signal?: string }) {
  if (!data.length) return null
  const vals = data.map(d => d.value)
  const min  = Math.min(...vals)
  const max  = Math.max(...vals)
  const range = max - min || 1
  const W = 80, H = 24, pad = 3

  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1 || 1)) * (W - pad * 2)
    const y = H - pad - ((v - min) / range) * (H - pad * 2)
    return `${x},${y}`
  }).join(' ')

  const stroke =
    signal === 'green' ? '#4ade80' :
    signal === 'red'   ? '#f87171' :
    '#facc15'

  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {vals.map((_, i) => {
        const x = pad + (i / (vals.length - 1 || 1)) * (W - pad * 2)
        const y = H - pad - ((vals[i] - min) / range) * (H - pad * 2)
        return <circle key={i} cx={x} cy={y} r={2} fill={stroke} />
      })}
    </svg>
  )
}

function FundamentalScorecard({
  scorecard,
  t,
}: {
  scorecard: Record<string, unknown>
  t: (k: string) => string
}) {
  const fsc = scorecard as {
    revenue:    { signal: string; data: { year: string; value: number }[]; latest_b: number | null }
    net_margin: { signal: string; data: { year: string; value: number }[]; latest_pct: number | null }
    debt_payoff:{ signal: string; years: number | null; debt_b: number; fcf_b: number | null }
    fcf:        { signal: string; data: { year: string; value: number }[]; latest_b: number | null }
    data_years: number
  }

  const items: {
    label: string
    signal: string
    value: string
    sub: string
    data?: { year: string; value: number }[]
  }[] = [
    {
      label:  t('fs_revenue'),
      signal: fsc.revenue?.signal ?? 'yellow',
      value:  fsc.revenue?.latest_b != null ? `$${fsc.revenue.latest_b}${t('fs_b_suffix')}` : '—',
      sub:    fsc.data_years ? `${fsc.data_years}yr CAGR` : '',
      data:   fsc.revenue?.data,
    },
    {
      label:  t('fs_net_margin'),
      signal: fsc.net_margin?.signal ?? 'yellow',
      value:  fsc.net_margin?.latest_pct != null ? `${fsc.net_margin.latest_pct}%` : '—',
      sub:    'vs 2yr ago',
      data:   fsc.net_margin?.data,
    },
    {
      label:  t('fs_debt_payoff'),
      signal: fsc.debt_payoff?.signal ?? 'yellow',
      value:  fsc.debt_payoff?.years != null
                ? `${fsc.debt_payoff.years} yr`
                : fsc.debt_payoff?.fcf_b == null ? '—' : '—',
      sub:    fsc.debt_payoff?.debt_b != null
                ? `$${fsc.debt_payoff.debt_b}${t('fs_b_suffix')} debt`
                : '',
    },
    {
      label:  t('fs_fcf'),
      signal: fsc.fcf?.signal ?? 'yellow',
      value:  fsc.fcf?.latest_b != null ? `$${fsc.fcf.latest_b}${t('fs_b_suffix')}` : '—',
      sub:    fsc.data_years ? `${fsc.data_years}yr CAGR` : '',
      data:   fsc.fcf?.data,
    },
  ]

  return (
    <div className="p-4 bg-zinc-800/40 rounded-xl border border-zinc-700/50">
      <div className="flex items-center gap-2 mb-3">
        <p className="text-xs text-zinc-400 font-semibold uppercase tracking-wide">{t('fs_title')}</p>
        <span className="text-xs text-zinc-600">{fsc.data_years}yr · yfinance</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {items.map(item => (
          <div key={item.label} className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-700/30">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-zinc-500">{item.label}</span>
              <SignalDot signal={item.signal} />
            </div>
            <p className="text-sm font-bold text-zinc-200 tabular-nums">{item.value}</p>
            {item.data && item.data.length > 1 ? (
              <div className="mt-1.5">
                <MiniSparkline data={item.data} signal={item.signal} />
                <p className="text-[10px] text-zinc-600 mt-0.5">
                  {item.data[0].year} → {item.data[item.data.length - 1].year}
                </p>
              </div>
            ) : (
              <p className="text-[10px] text-zinc-600 mt-0.5">{item.sub}</p>
            )}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-zinc-700 mt-2">
        🟢 CAGR &gt;3% / марж расте / дълг &lt;3yr FCF &nbsp;·&nbsp; 🟡 неутрално &nbsp;·&nbsp; 🔴 проблем
      </p>
    </div>
  )
}

function AiTab({ ticker }: { ticker: string }) {
  const { t, lang } = useLanguage()
  const [triggered, setTriggered] = useState(false)
  const { data, isLoading, error, refetch } = useAiAnalysis(ticker, triggered, lang)
  const { data: news } = useTickerNews(ticker)
  const recColor = data?.recommendation === 'BUY'
    ? 'text-green-400 border-green-500/30 bg-green-500/10'
    : data?.recommendation === 'SELL'
    ? 'text-red-400 border-red-500/30 bg-red-500/10'
    : 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10'

  const confColor = data?.confidence === 'HIGH'
    ? 'text-green-400'
    : data?.confidence === 'LOW'
    ? 'text-red-400'
    : 'text-yellow-400'

  if (!triggered) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-5 text-center">
        <div className="w-14 h-14 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-3xl">
          🤖
        </div>
        <div>
          <h3 className="text-lg font-semibold text-zinc-200 mb-1">{t('ai_analysis_title')} — {ticker}</h3>
          <p className="text-zinc-500 text-sm max-w-sm">
            {t('ai_intro_desc')}
          </p>
        </div>
        <button
          onClick={() => setTriggered(true)}
          className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium text-sm transition-colors"
        >
          {t('generate_analysis')}
        </button>
        <p className="text-zinc-600 text-xs">{t('ai_model_note')}</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
        <RefreshCw size={22} className="animate-spin text-purple-400" />
        <p className="text-sm">{t('analyzing')} {ticker}…</p>
        <p className="text-xs text-zinc-600">{t('usually_takes')}</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <p className="text-red-400 font-medium">{t('analysis_failed')}</p>
        <p className="text-zinc-500 text-sm max-w-sm">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
        <p className="text-zinc-600 text-xs">{t('ensure_github_token')}</p>
        <button
          onClick={() => { setTriggered(false); setTimeout(() => setTriggered(true), 50) }}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors"
        >
          {t('retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header: Recommendation + Confidence */}
      <div className="flex items-center gap-4 flex-wrap">
        <h3 className="text-lg font-semibold text-zinc-100">{t('ai_analysis_title')} — {ticker}</h3>
        <span className={`px-3 py-1 rounded-full text-sm font-bold border ${recColor}`}>
          {data.recommendation}
        </span>
        <span className={`text-xs font-medium ${confColor}`}>
          {data.confidence} {t('confidence_suffix')}
        </span>
        {data.cached && <span className="text-xs text-zinc-600">• {t('cached_label')}</span>}
        <button
          onClick={() => refetch()}
          title={t('refresh_analysis')}
          className="ml-auto p-1.5 text-zinc-600 hover:text-zinc-300 transition-colors"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Business Overview */}
      {data.business_overview && (
        <div className="p-4 bg-blue-500/5 rounded-xl border border-blue-500/20">
          <p className="text-xs text-blue-400 font-semibold uppercase tracking-wide mb-2">{t('business_overview_label')}</p>
          <p className="text-zinc-300 text-sm leading-relaxed">{data.business_overview}</p>
        </div>
      )}

      {/* Summary */}
      <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700/50">
        <p className="text-zinc-300 text-sm leading-relaxed">{data.summary}</p>
      </div>

      {/* Price Targets + Analyst Consensus */}
      {data.price_targets && (
        <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700/50 space-y-3">
          <p className="text-xs text-zinc-400 font-semibold uppercase tracking-wide">{t('price_targets_title')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
              <p className="text-xs text-green-400 font-medium mb-1">{t('buy_below')}</p>
              <p className="text-zinc-100 font-bold tabular-nums text-sm">
                {data.price_targets.buy_below != null ? `$${data.price_targets.buy_below}` : '—'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-center">
              <p className="text-xs text-yellow-400 font-medium mb-1">{t('hold_range')}</p>
              <p className="text-zinc-100 font-bold tabular-nums text-xs">
                {data.price_targets.hold_range_low != null && data.price_targets.hold_range_high != null
                  ? `$${data.price_targets.hold_range_low} – $${data.price_targets.hold_range_high}`
                  : '—'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-center">
              <p className="text-xs text-red-400 font-medium mb-1">{t('sell_above')}</p>
              <p className="text-zinc-100 font-bold tabular-nums text-sm">
                {data.price_targets.sell_above != null ? `$${data.price_targets.sell_above}` : '—'}
              </p>
            </div>
            <div className={`p-3 rounded-lg border text-center ${
              data.price_targets.current_zone === 'BUY' ? 'bg-green-500/10 border-green-500/30' :
              data.price_targets.current_zone === 'SELL' || data.price_targets.current_zone === 'TRIM' ? 'bg-red-500/10 border-red-500/30' :
              'bg-yellow-500/10 border-yellow-500/30'
            }`}>
              <p className="text-xs text-zinc-400 font-medium mb-1">{t('current_zone')}</p>
              <p className={`font-bold text-sm ${
                data.price_targets.current_zone === 'BUY' ? 'text-green-400' :
                data.price_targets.current_zone === 'SELL' || data.price_targets.current_zone === 'TRIM' ? 'text-red-400' :
                'text-yellow-400'
              }`}>{data.price_targets.current_zone}</p>
            </div>
          </div>
          {/* Analyst consensus row */}
          {data.price_targets.analyst_consensus != null && (
            <div className="flex items-center gap-4 pt-1 border-t border-zinc-700/40 text-sm flex-wrap">
              <span className="text-zinc-500 text-xs uppercase tracking-wide">{t('analyst_consensus_label')}</span>
              <span className="text-zinc-200 font-semibold">{t('analyst_target_label')}: ${data.price_targets.analyst_consensus}</span>
              {data.price_targets.analyst_count != null && (
                <span className="text-zinc-500 text-xs">({data.price_targets.analyst_count} analysts)</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Recommendation reason */}
      <div className="p-4 bg-purple-500/5 rounded-xl border border-purple-500/20">
        <p className="text-xs text-purple-400 font-medium mb-1 uppercase tracking-wide">{t('recommendation_label')}</p>
        <p className="text-zinc-200 text-sm leading-relaxed">{data.recommendation_reason}</p>
      </div>

      {/* Valuation */}
      {data.valuation && (
        <div className="p-4 bg-zinc-800/40 rounded-xl border border-zinc-700/50">
          <p className="text-xs text-cyan-400 font-semibold uppercase tracking-wide mb-2">{t('valuation_label')}</p>
          <p className="text-zinc-300 text-sm leading-relaxed">{data.valuation}</p>
        </div>
      )}

      {/* Financial Health */}
      {data.financial_health && (
        <div className="p-4 bg-zinc-800/40 rounded-xl border border-zinc-700/50">
          <div className="flex items-center gap-3 mb-2">
            <p className="text-xs text-zinc-400 font-semibold uppercase tracking-wide">{t('financial_health_label')}</p>
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${
              data.financial_health.rating === 'Strong' ? 'bg-green-500/20 text-green-400' :
              data.financial_health.rating === 'Weak' ? 'bg-red-500/20 text-red-400' :
              'bg-yellow-500/20 text-yellow-400'
            }`}>
              {data.financial_health.rating === 'Strong' ? t('financial_health_strong') :
               data.financial_health.rating === 'Weak' ? t('financial_health_weak') :
               t('financial_health_moderate')}
            </span>
          </div>
          <p className="text-zinc-300 text-sm leading-relaxed">{data.financial_health.commentary}</p>
        </div>
      )}

      {/* Fundamental Scorecard */}
      {data.fundamental_scorecard && (
        <FundamentalScorecard scorecard={data.fundamental_scorecard} t={t} />
      )}

      {/* Strengths + Risks */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 bg-green-500/5 rounded-xl border border-green-500/20">
          <p className="text-xs text-green-400 font-medium mb-3 uppercase tracking-wide">{t('strengths_title')}</p>
          <ul className="space-y-2">
            {data.strengths.map((s: string, i: number) => (
              <li key={i} className="flex gap-2 text-sm text-zinc-300">
                <span className="text-green-500 mt-0.5 flex-shrink-0">✓</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="p-4 bg-red-500/5 rounded-xl border border-red-500/20">
          <p className="text-xs text-red-400 font-medium mb-3 uppercase tracking-wide">{t('risks_title')}</p>
          <ul className="space-y-2">
            {data.risks.map((r: string, i: number) => (
              <li key={i} className="flex gap-2 text-sm text-zinc-300">
                <span className="text-red-500 mt-0.5 flex-shrink-0">✗</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Dividend Outlook */}
      <div className="p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/20">
        <p className="text-xs text-emerald-400 font-medium mb-1 uppercase tracking-wide">{t('dividend_outlook_label')}</p>
        <p className="text-zinc-300 text-sm leading-relaxed">{data.dividend_outlook}</p>
      </div>

      {/* Management & Strategy */}
      {data.management_guidance && (
        <div className="p-4 bg-zinc-800/40 rounded-xl border border-zinc-700/50">
          <p className="text-xs text-orange-400 font-semibold uppercase tracking-wide mb-2">{t('management_guidance_label')}</p>
          <p className="text-zinc-300 text-sm leading-relaxed">{data.management_guidance}</p>
        </div>
      )}

      {/* Catalysts */}
      {data.catalysts && data.catalysts.length > 0 && (
        <div className="p-4 bg-zinc-800/40 rounded-xl border border-zinc-700/50">
          <p className="text-xs text-amber-400 font-semibold uppercase tracking-wide mb-3">{t('catalysts_label')}</p>
          <ul className="space-y-2">
            {data.catalysts.map((c: string, i: number) => (
              <li key={i} className="flex gap-2 text-sm text-zinc-300">
                <span className="text-amber-400 mt-0.5 flex-shrink-0">◆</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recent News */}
      {news && news.length > 0 && (
        <div className="p-4 bg-zinc-800/40 rounded-xl border border-zinc-700/50">
          <p className="text-xs text-zinc-400 font-semibold uppercase tracking-wide mb-3">{t('recent_news_label')}</p>
          <ul className="space-y-2.5">
            {news.map((item, i) => (
              <li key={i} className="flex items-start gap-3 group">
                <span className="text-zinc-600 text-xs mt-0.5 tabular-nums shrink-0 w-20">{item.date}</span>
                <div className="flex-1 min-w-0">
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-300 text-sm hover:text-blue-400 transition-colors line-clamp-2 leading-snug"
                    >
                      {item.title}
                    </a>
                  ) : (
                    <p className="text-zinc-300 text-sm line-clamp-2 leading-snug">{item.title}</p>
                  )}
                  {item.source && <p className="text-zinc-600 text-xs mt-0.5">{item.source}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-zinc-600">
        {t('ai_disclaimer')}
        {data.model && ` · Model: ${data.model}`}
      </p>
    </div>
  )
}
