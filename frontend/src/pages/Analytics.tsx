import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine,
  ScatterChart, Scatter, ZAxis,
} from 'recharts'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, RefreshCw } from 'lucide-react'
import { usePositions, usePortfolioSummary, useDividendsSummary, useBenchmark } from '@/hooks'
import { searchTickers } from '@/api/client'
import { KpiCard } from '@/components/ui/KpiCard'
import type { TickerSearchResult } from '@/types'

import { useLanguage } from '@/contexts/LanguageContext'
import { useCurrency } from '@/contexts/CurrencyContext'

const TICKER_COLORS: Record<string, string> = {
  QYLD: '#3b82f6', BHP: '#22c55e', CNQ: '#f59e0b', DIV: '#a855f7',
  SPHD: '#06b6d4', ET: '#f97316', PSEC: '#ec4899', VTI: '#84cc16',
  IBM: '#64748b', 'SXR8.DE': '#6366f1', RKLB: '#ef4444',
}
const DEFAULT_COLOR = '#71717a'

const fmtPct = (n: number | null | undefined) =>
  n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

export function Analytics() {
  const navigate = useNavigate()
  const { data: positions } = usePositions()
  const { data: summary } = usePortfolioSummary()
  const { data: divSummary } = useDividendsSummary()
  const { t } = useLanguage()
  const { fmt } = useCurrency()

  const [benchmarkPeriod, setBenchmarkPeriod] = useState<'1Y' | '3Y' | '5Y'>('1Y')
  const { data: benchmark, isFetching: benchmarkLoading } = useBenchmark(benchmarkPeriod)

  // ── Ticker search state ──────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState('')
  const [suggestions, setSuggestions] = useState<TickerSearchResult[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) setShowSuggestions(false)
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
    } catch { setSuggestions([]) }
    finally { setSearchLoading(false) }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 280)
  }

  const handleSelect = (s: TickerSearchResult) => {
    setShowSuggestions(false); setSearchInput(''); setSuggestions([])
    navigate(`/analysis/${s.symbol}`)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const t = searchInput.trim().toUpperCase()
    if (t) { setShowSuggestions(false); setSearchInput(''); navigate(`/analysis/${t}`) }
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (!positions || !summary) {
    return <div className="flex items-center justify-center h-full text-zinc-500">{t('loading')}…</div>
  }

  const totalValue = summary.current_value_usd
  const totalInvested = summary.total_invested_usd

  // Allocation by value
  const allocationData = positions
    .filter(p => p.current_value != null)
    .map(p => ({
      ticker: p.ticker,
      value: p.current_value as number,
      pct: ((p.current_value as number) / totalValue) * 100,
    }))
    .sort((a, b) => b.value - a.value)

  // P&L per position
  const pnlData = positions
    .filter(p => p.unrealized_pnl != null)
    .map(p => ({
      ticker: p.ticker,
      pnl: p.unrealized_pnl as number,
      pnlPct: p.unrealized_pnl_pct as number,
      invested: Number(p.units) * Number(p.open_rate),
    }))
    .sort((a, b) => b.pnlPct - a.pnlPct)

  // Dividend yield on cost per ticker
  const yocData = (divSummary?.by_ticker ?? [])
    .map(r => ({ ticker: r.ticker, yoc: r.yield_on_cost_pct }))
    .sort((a, b) => b.yoc - a.yoc)

  // Risk/Return scatter: x = pnlPct, y = allocation%, size = value
  const scatterData = positions
    .filter(p => p.unrealized_pnl_pct != null && p.current_value != null)
    .map(p => ({
      ticker: p.ticker,
      x: p.unrealized_pnl_pct as number,
      y: ((p.current_value as number) / totalValue) * 100,
      z: p.current_value as number,
    }))

  // Summary metrics
  const winners = pnlData.filter(p => p.pnl > 0).length
  const losers = pnlData.filter(p => p.pnl < 0).length
  const bestPosition = pnlData[0]
  const worstPosition = pnlData.at(-1)
  const concentration = allocationData[0]?.pct ?? 0  // top holding %

  return (
    <div className="p-4 sm:p-8 space-y-8">
      {/* Header row: title + search */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold text-zinc-100">{t('analytics_title')}</h1>

        {/* Search any ticker */}
        <div className="relative">
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
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
                placeholder={t('search_placeholder')}
                maxLength={50}
                className="pl-8 pr-8 py-2 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 w-64"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-xl text-sm font-medium transition-colors"
            >
              {t('analyse_btn')}
            </button>
          </form>

          {/* Autocomplete dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute top-full mt-1 right-0 w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden"
            >
              {suggestions.map(s => (
                <button
                  key={s.symbol}
                  onMouseDown={() => handleSelect(s)}
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
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={t('winners_losers')}
          value={`${winners} / ${losers}`}
          sub={`${positions.length} ${t('positions_count')}`}
          trend={winners >= losers ? 'up' : 'down'}
        />
        <KpiCard
          label={t('best_performer')}
          value={bestPosition?.ticker ?? '—'}
          sub={fmtPct(bestPosition?.pnlPct)}
          trend="up"
        />
        <KpiCard
          label={t('worst_performer')}
          value={worstPosition?.ticker ?? '—'}
          sub={fmtPct(worstPosition?.pnlPct)}
          trend="down"
        />
        <KpiCard
          label={t('top_concentration')}
          value={allocationData[0]?.ticker ?? '—'}
          sub={`${concentration.toFixed(1)}% ${t('of_portfolio')}`}
          trend={concentration > 30 ? 'down' : 'neutral'}
        />
      </div>

      {/* Row: Allocation pie + P&L bar */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* Allocation */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-base font-semibold text-zinc-200 mb-4">{t('portfolio_allocation')}</h2>
          <div className="flex gap-6 items-center">
            <ResponsiveContainer width={200} height={200}>
              <PieChart>
                <Pie data={allocationData} dataKey="value" nameKey="ticker"
                  cx="50%" cy="50%" outerRadius={90} innerRadius={45}>
                  {allocationData.map(e => (
                    <Cell key={e.ticker} fill={TICKER_COLORS[e.ticker] ?? DEFAULT_COLOR} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                  formatter={(v: number) => [`${fmt(v, 0)}`]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-1.5">
              {allocationData.map(e => (
                <div key={e.ticker} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: TICKER_COLORS[e.ticker] ?? DEFAULT_COLOR }} />
                    <span className="text-zinc-300 font-medium w-16">{e.ticker}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-20 h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${e.pct}%`, backgroundColor: TICKER_COLORS[e.ticker] ?? DEFAULT_COLOR }} />
                    </div>
                    <span className="text-zinc-400 tabular-nums w-10 text-right">{e.pct.toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* P&L per position */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-base font-semibold text-zinc-200 mb-4">{t('unrealized_pnl_by_pos')}</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={pnlData} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fill: '#71717a', fontSize: 10 }} tickFormatter={v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`} />
              <YAxis type="category" dataKey="ticker" tick={{ fill: '#a1a1aa', fontSize: 11 }} width={52} />
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
              <ReferenceLine x={0} stroke="#52525b" />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                formatter={(v: number) => [`${v >= 0 ? '+' : ''}${v.toFixed(2)}%`]}
                labelFormatter={label => `${label}`}
              />
              <Bar dataKey="pnlPct" radius={[0, 3, 3, 0]}>
                {pnlData.map(e => (
                  <Cell key={e.ticker} fill={e.pnl >= 0 ? '#22c55e' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row: YoC bar + absolute P&L table */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* Yield on Cost */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-base font-semibold text-zinc-200 mb-4">{t('yoc_by_ticker')}</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={yocData} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fill: '#71717a', fontSize: 10 }} tickFormatter={v => `${v}%`} />
              <YAxis type="category" dataKey="ticker" tick={{ fill: '#a1a1aa', fontSize: 11 }} width={52} />
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                formatter={(v: number) => [`${v.toFixed(2)}%`]}
              />
              <Bar dataKey="yoc" radius={[0, 3, 3, 0]}>
                {yocData.map(e => (
                  <Cell key={e.ticker} fill={TICKER_COLORS[e.ticker] ?? DEFAULT_COLOR} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Position summary table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800">
            <h2 className="text-base font-semibold text-zinc-200">{t('portfolio_summary_title')}</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-left">
                <th className="px-5 py-3 font-medium">{t('col_ticker')}</th>
                <th className="px-5 py-3 font-medium text-right">{t('col_invested')}</th>
                <th className="px-5 py-3 font-medium text-right">{t('col_curr_value')}</th>
                <th className="px-5 py-3 font-medium text-right">{t('col_pnl_label')}</th>
              </tr>
            </thead>
            <tbody>
              {pnlData.map((row, i) => (
                <tr key={row.ticker} className={`border-b border-zinc-800/60 hover:bg-zinc-800/40 transition-colors ${i % 2 === 0 ? '' : 'bg-zinc-800/20'}`}>
                  <td className="px-5 py-2.5 font-semibold text-zinc-100">{row.ticker}</td>
                  <td className="px-5 py-2.5 text-right text-zinc-400 tabular-nums">{fmt(row.invested, 0)}</td>
                  <td className="px-5 py-2.5 text-right text-zinc-200 tabular-nums">
                    {fmt((allocationData.find(a => a.ticker === row.ticker)?.value) ?? null, 0)}
                  </td>
                  <td className={`px-5 py-2.5 text-right font-medium tabular-nums ${row.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {fmt(row.pnl, 0)} <span className="text-xs opacity-70">({fmtPct(row.pnlPct)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-zinc-800/30 text-zinc-300 font-semibold border-t border-zinc-700">
                <td className="px-5 py-3">{t('total')}</td>
                <td className="px-5 py-3 text-right tabular-nums">{fmt(totalInvested, 0)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{fmt(totalValue, 0)}</td>
                <td className={`px-5 py-3 text-right tabular-nums ${summary.unrealized_pnl_usd >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {fmt(summary.unrealized_pnl_usd, 0)} <span className="text-xs opacity-70">({fmtPct(summary.unrealized_pnl_pct)})</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ─── Benchmark ────────────────────────────────────────────── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-zinc-200">{t('benchmark_title')}</h2>
          <div className="flex gap-1">
            {(['1Y', '3Y', '5Y'] as const).map(p => (
              <button
                key={p}
                onClick={() => setBenchmarkPeriod(p)}
                className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                  benchmarkPeriod === p
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {benchmarkLoading ? (
          <div className="text-center text-zinc-500 text-sm py-4">{t('loading')}…</div>
        ) : benchmark ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-zinc-800/50 rounded-xl p-4 text-center">
              <p className="text-xs text-zinc-500 mb-1">{t('benchmark_portfolio')}</p>
              <p className={`text-xl font-bold ${
                benchmark.portfolio_return_pct == null ? 'text-zinc-500' :
                benchmark.portfolio_return_pct >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {benchmark.portfolio_return_pct == null ? '—' : `${benchmark.portfolio_return_pct >= 0 ? '+' : ''}${benchmark.portfolio_return_pct.toFixed(2)}%`}
              </p>
            </div>
            <div className="bg-zinc-800/50 rounded-xl p-4 text-center">
              <p className="text-xs text-zinc-500 mb-1">{t('benchmark_sp500')}</p>
              <p className={`text-xl font-bold ${
                benchmark.sp500_return_pct == null ? 'text-zinc-500' :
                benchmark.sp500_return_pct >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {benchmark.sp500_return_pct == null ? '—' : `${benchmark.sp500_return_pct >= 0 ? '+' : ''}${benchmark.sp500_return_pct.toFixed(2)}%`}
              </p>
            </div>
            <div className="bg-zinc-800/50 rounded-xl p-4 text-center">
              <p className="text-xs text-zinc-500 mb-1">{t('benchmark_vti')}</p>
              <p className={`text-xl font-bold ${
                benchmark.vti_return_pct == null ? 'text-zinc-500' :
                benchmark.vti_return_pct >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {benchmark.vti_return_pct == null ? '—' : `${benchmark.vti_return_pct >= 0 ? '+' : ''}${benchmark.vti_return_pct.toFixed(2)}%`}
              </p>
            </div>
            <div className="bg-zinc-800/50 rounded-xl p-4 text-center">
              <p className="text-xs text-zinc-500 mb-1">{t('benchmark_outperformance')}</p>
              <p className={`text-xl font-bold ${
                benchmark.outperformance_pct == null ? 'text-zinc-500' :
                benchmark.outperformance_pct >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {benchmark.outperformance_pct == null ? '—' : `${benchmark.outperformance_pct >= 0 ? '+' : ''}${benchmark.outperformance_pct.toFixed(2)}%`}
              </p>
              <p className="text-xs text-zinc-600 mt-1">{t('benchmark_period')}: {benchmark.period}</p>
            </div>
          </div>
        ) : (
          <div className="text-center text-zinc-600 text-sm py-4">—</div>
        )}
      </div>
    </div>
  )
}
