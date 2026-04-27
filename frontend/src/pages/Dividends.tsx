import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import { useDividendsSummary, useMonthlyDividends } from '@/hooks'
import { KpiCard } from '@/components/ui/KpiCard'
import { useLanguage } from '@/contexts/LanguageContext'
import { useCurrency } from '@/contexts/CurrencyContext'

const fmtPct = (n: number | null | undefined) =>
  n == null ? '—' : `${n.toFixed(2)}%`

const TICKER_COLORS: Record<string, string> = {
  QYLD: '#3b82f6', BHP: '#22c55e', CNQ: '#f59e0b', DIV: '#a855f7',
  SPHD: '#06b6d4', ET: '#f97316', PSEC: '#ec4899', VTI: '#84cc16',
  IBM: '#64748b', 'SXR8.DE': '#6366f1', RKLB: '#ef4444',
}
const DEFAULT_COLOR = '#71717a'

export function Dividends() {
  const { data: summary, isLoading } = useDividendsSummary()
  const { data: monthly } = useMonthlyDividends(36)
  const { t } = useLanguage()
  const { fmt } = useCurrency()
  const [csvYear, setCsvYear] = useState(new Date().getFullYear())

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-zinc-500">{t('loading')}</div>
  }

  const tickers = monthly?.tickers ?? []
  const pieData = summary?.by_ticker.map(r => ({ name: r.ticker, value: r.total_usd })) ?? []

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-100">{t('dividends_title')}</h1>
        <div className="flex items-center gap-2">
          <select
            value={csvYear}
            onChange={e => setCsvYear(Number(e.target.value))}
            className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm rounded px-2 py-1.5 focus:outline-none"
          >
            {[2022, 2023, 2024, 2025, 2026].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <a
            href={`/api/portfolio/export/dividends?year=${csvYear}`}
            download
            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm rounded font-medium transition-colors"
          >
            ↓ CSV
          </a>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={t('total_received')}
          value={fmt(summary?.total_usd)}
          sub={t('all_time')}
          trend="up"
        />
        <KpiCard
          label={t('trailing_12m_label')}
          value={fmt(summary?.ttm_usd)}
          sub={t('last_12_months')}
          trend="up"
        />
        <KpiCard
          label={t('monthly_average')}
          value={fmt(summary?.monthly_avg_usd)}
          sub={t('trailing_12m_div12')}
          trend="neutral"
        />
        <KpiCard
          label={t('tickers_paying')}
          value={String(summary?.by_ticker.length ?? '—')}
          sub={t('active_payers')}
          trend="neutral"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Stacked bar chart — 36 months */}
        <div className="xl:col-span-2 bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-base font-semibold text-zinc-200 mb-4">{t('monthly_36m_chart')}</h2>
          {monthly?.data && monthly.data.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthly.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fill: '#71717a', fontSize: 10 }} interval={2} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickFormatter={v => fmt(v, 0)} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                  formatter={(v: number) => [fmt(v)]}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
                {tickers.map(ticker => (
                  <Bar key={ticker} dataKey={ticker} stackId="a" fill={TICKER_COLORS[ticker] ?? DEFAULT_COLOR} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[280px] text-zinc-600">{t('no_data')}</div>
          )}
        </div>

        {/* Pie chart — share by ticker */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-base font-semibold text-zinc-200 mb-4">{t('alltime_share_chart')}</h2>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {pieData.map(entry => (
                    <Cell key={entry.name} fill={TICKER_COLORS[entry.name] ?? DEFAULT_COLOR} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                  formatter={(v: number) => [fmt(v)]}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[280px] text-zinc-600">{t('no_data')}</div>
          )}
        </div>
      </div>

      {/* Per-ticker breakdown table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-200">{t('breakdown_by_ticker')}</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500 text-left">
              <th className="px-6 py-3 font-medium">{t('col_ticker')}</th>
              <th className="px-6 py-3 font-medium text-right">{t('col_total_received')}</th>
              <th className="px-6 py-3 font-medium text-right">{t('col_payments')}</th>
              <th className="px-6 py-3 font-medium text-right">{t('col_yoc')}</th>
              <th className="px-6 py-3 font-medium text-right">{t('col_last_payment')}</th>
              <th className="px-6 py-3 font-medium text-right">{t('col_share')}</th>
            </tr>
          </thead>
          <tbody>
            {(summary?.by_ticker ?? []).map((row, i) => {
              const share = summary ? (row.total_usd / summary.total_usd) * 100 : 0
              const color = TICKER_COLORS[row.ticker] ?? DEFAULT_COLOR
              return (
                <tr
                  key={row.ticker}
                  className={`border-b border-zinc-800/60 hover:bg-zinc-800/40 transition-colors ${i % 2 === 0 ? '' : 'bg-zinc-800/20'}`}
                >
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="font-semibold text-zinc-100">{row.ticker}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-right text-zinc-100 tabular-nums">{fmt(row.total_usd)}</td>
                  <td className="px-6 py-3 text-right text-zinc-400 tabular-nums">{row.payments_count}</td>
                  <td className="px-6 py-3 text-right">
                    <span className="text-emerald-400 font-medium tabular-nums">{fmtPct(row.yield_on_cost_pct)}</span>
                  </td>
                  <td className="px-6 py-3 text-right text-zinc-400 tabular-nums">{row.last_payment ?? '—'}</td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-20 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: color }} />
                      </div>
                      <span className="text-zinc-400 tabular-nums w-10 text-right">{share.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-zinc-800/30 text-zinc-300 font-semibold">
              <td className="px-6 py-3">{t('total')}</td>
              <td className="px-6 py-3 text-right tabular-nums">{fmt(summary?.total_usd)}</td>
              <td className="px-6 py-3 text-right tabular-nums">
                {summary?.by_ticker.reduce((s, r) => s + r.payments_count, 0) ?? '—'}
              </td>
              <td className="px-6 py-3 text-right" />
              <td className="px-6 py-3 text-right" />
              <td className="px-6 py-3 text-right text-zinc-500">100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
