import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePortfolioSummary, useDividendsSummary, useMonthlyDividends, usePortfolioHistory } from '@/hooks'
import { KpiCard } from '@/components/ui/KpiCard'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useLanguage } from '@/contexts/LanguageContext'
import { useCurrency } from '@/contexts/CurrencyContext'

// Colors for stacked bar chart per ticker
const TICKER_COLORS: Record<string, string> = {
  QYLD: '#3b82f6', BHP: '#22c55e', CNQ: '#f59e0b', DIV: '#a855f7',
  SPHD: '#06b6d4', ET: '#f97316', PSEC: '#ec4899', VTI: '#84cc16',
  IBM: '#64748b', SXR8: '#6366f1', RKLB: '#ef4444',
}

const PERIOD_DAYS: Record<string, number> = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365, 'ALL': 3650 }

export function Dashboard() {
  const navigate = useNavigate()
  const { data: summary, isLoading: loadingSummary } = usePortfolioSummary()
  const { data: divSummary } = useDividendsSummary()
  const { data: monthly } = useMonthlyDividends(18)
  const { t } = useLanguage()
  const { fmt, currency } = useCurrency()
  const [histPeriod, setHistPeriod] = useState<string>('1Y')
  const { data: historyData } = usePortfolioHistory(PERIOD_DAYS[histPeriod])

  const historyChart = (historyData ?? []).map(p => ({
    date: p.date,
    value: currency === 'EUR' ? Math.round(p.value_usd / 1.08) : p.value_usd,
  }))

  const fmtPct = (n: number | null | undefined) =>
    n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

  if (loadingSummary) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        {t('loading')}
      </div>
    )
  }

  const pnlTrend = summary && summary.unrealized_pnl_usd >= 0 ? 'up' : 'down'
  const returnTrend = summary && summary.total_return_usd >= 0 ? 'up' : 'down'

  return (
    <div className="p-4 sm:p-8 space-y-6 sm:space-y-8">
      <h1 className="text-2xl font-bold text-zinc-100">{t('dashboard_title')}</h1>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={t('portfolio_value')}
          value={fmt(summary?.current_value_usd)}
          sub={`${t('invested')}: ${fmt(summary?.total_invested_usd)}`}
          trend="neutral"
          href="/portfolio"
        />
        <KpiCard
          label={t('unrealized_pnl')}
          value={fmt(summary?.unrealized_pnl_usd)}
          sub={fmtPct(summary?.unrealized_pnl_pct)}
          trend={pnlTrend}
          href="/analytics"
        />
        <KpiCard
          label={t('total_dividends')}
          value={fmt(summary?.total_dividends_usd)}
          sub={`${t('yoc_label')}: ${summary?.yield_on_cost_pct?.toFixed(2)}%`}
          trend="up"
          href="/dividends"
        />
        <KpiCard
          label={t('total_return')}
          value={fmt(summary?.total_return_usd)}
          sub={fmtPct(summary?.total_return_pct)}
          trend={returnTrend}
          href="/analytics"
        />
        <KpiCard
          label={t('monthly_income')}
          value={fmt(summary?.monthly_income_usd)}
          sub={t('trailing_12m_avg')}
          trend="neutral"
          href="/dividends"
        />
        <KpiCard
          label={t('annual_income')}
          value={fmt(summary?.annual_income_usd)}
          sub={t('trailing_12m')}
          trend="neutral"
          href="/dividends"
        />
        <KpiCard
          label={t('positions')}
          value={String(summary?.positions_count ?? '—')}
          sub={t('open_positions')}
          trend="neutral"
          href="/portfolio"
        />
        <KpiCard
          label={t('yield_on_cost')}
          value={`${summary?.yield_on_cost_pct?.toFixed(2) ?? '—'}%`}
          sub={t('based_on_invested')}
          trend="neutral"
          href="/analytics"
        />
      </div>

      {/* Portfolio Value History */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-base font-semibold text-zinc-200">Portfolio Value</h2>
          <div className="flex gap-1">
            {Object.keys(PERIOD_DAYS).map(p => (
              <button
                key={p}
                onClick={() => setHistPeriod(p)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  histPeriod === p
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        {historyChart.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={historyChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="date"
                tick={{ fill: '#71717a', fontSize: 11 }}
                tickFormatter={d => d.slice(5)}  /* MM-DD */
                interval={Math.floor(historyChart.length / 8)}
              />
              <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickFormatter={v => fmt(v, 0)} width={68} />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                formatter={(v: number) => [fmt(v), 'Portfolio']}
                labelStyle={{ color: '#a1a1aa' }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-zinc-500 text-sm">No history data yet. Price history is collected daily.</p>
        )}
      </div>

      {/* Monthly Dividends Chart */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h2 className="text-base font-semibold text-zinc-200 mb-4">{t('monthly_div_income_chart')}</h2>
        {monthly?.data && monthly.data.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={monthly.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="month" tick={{ fill: '#71717a', fontSize: 11 }} />
              <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickFormatter={v => fmt(v, 0)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                formatter={(v: number) => [fmt(v)]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {monthly.tickers.map(ticker => (
                <Bar
                  key={ticker}
                  dataKey={ticker}
                  stackId="div"
                  fill={TICKER_COLORS[ticker] ?? '#6b7280'}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-zinc-500 text-sm">No dividend data yet.</p>
        )}
      </div>

      {/* Top dividend payers */}
      {divSummary && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-base font-semibold text-zinc-200 mb-4">{t('breakdown_by_ticker')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 text-left border-b border-zinc-800">
                  <th className="pb-2 font-medium">{t('col_ticker')}</th>
                  <th className="pb-2 font-medium text-right">{t('total')}</th>
                  <th className="pb-2 font-medium text-right">{t('col_payments')}</th>
                  <th className="pb-2 font-medium text-right">{t('col_yoc')}</th>
                  <th className="pb-2 font-medium text-right">{t('col_last_payment')}</th>
                </tr>
              </thead>
              <tbody>
                {divSummary.by_ticker.map(row => (
                  <tr
                    key={row.ticker}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/analysis/${row.ticker}`)}
                  >
                    <td className="py-2 font-medium text-blue-400 group-hover:text-blue-300">{row.ticker} <span className="text-zinc-600 text-xs">→</span></td>
                    <td className="py-2 text-right">{fmt(row.total_usd)}</td>
                    <td className="py-2 text-right text-zinc-400">{row.payments_count}</td>
                    <td className="py-2 text-right text-green-400">{row.yield_on_cost_pct.toFixed(2)}%</td>
                    <td className="py-2 text-right text-zinc-400">{row.last_payment ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
