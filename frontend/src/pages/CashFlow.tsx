import { useState, useMemo } from 'react'
import { ArrowLeftRight, TrendingUp, PiggyBank, Zap, Star } from 'lucide-react'
import { useCashFlow } from '@/hooks'
import { usePortfolioSummary } from '@/hooks'
import { useLanguage } from '@/contexts/LanguageContext'
import type { CashFlowMonth } from '@/types'

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 0) {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtMonth(m: string) {
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1).toLocaleString('default', {
    month: 'short', year: '2-digit',
  })
}

// ─── Summary Card ────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  color = 'text-white',
}: {
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  )
}

// ─── Mini Bar ────────────────────────────────────────────────────────────────

function MiniBar({ dep, div, maxVal }: { dep: number; div: number; maxVal: number }) {
  const depW = maxVal > 0 ? (dep / maxVal) * 100 : 0
  const divW = maxVal > 0 ? (div / maxVal) * 100 : 0
  return (
    <div className="flex flex-col gap-0.5 w-16">
      <div className="h-1.5 rounded-full bg-zinc-700 overflow-hidden">
        <div className="h-full rounded-full bg-blue-500" style={{ width: `${depW}%` }} />
      </div>
      <div className="h-1.5 rounded-full bg-zinc-700 overflow-hidden">
        <div className="h-full rounded-full bg-green-500" style={{ width: `${divW}%` }} />
      </div>
    </div>
  )
}

// ─── History Table ───────────────────────────────────────────────────────────

function HistoryTable({ rows }: { rows: CashFlowMonth[] }) {
  const { t } = useLanguage()
  const maxVal = Math.max(...rows.map(r => Math.max(r.deposits_usd, r.dividends_usd)), 1)
  const reversed = [...rows].reverse()

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800">
        <span className="text-sm font-semibold text-zinc-300">{t('cf_history')}</span>
      </div>
      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-900">
            <tr className="border-b border-zinc-800">
              <th className="py-2 px-4 text-left text-xs text-zinc-500 uppercase tracking-wider">{t('cf_month')}</th>
              <th className="py-2 px-4 text-right text-xs text-zinc-500 uppercase tracking-wider">{t('cf_deposits')}</th>
              <th className="py-2 px-4 text-right text-xs text-zinc-500 uppercase tracking-wider">{t('cf_dividends')}</th>
              <th className="py-2 px-4 text-right text-xs text-zinc-500 uppercase tracking-wider">{t('cf_difference')}</th>
              <th className="py-2 px-4 text-xs text-zinc-500 uppercase tracking-wider"></th>
            </tr>
          </thead>
          <tbody>
            {reversed.map(row => {
              const diff = row.dividends_usd - row.deposits_usd
              return (
                <tr key={row.month} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                  <td className="py-2 px-4 text-zinc-300 font-mono text-xs">{fmtMonth(row.month)}</td>
                  <td className="py-2 px-4 text-right text-blue-300">${fmt(row.deposits_usd)}</td>
                  <td className="py-2 px-4 text-right text-green-400">${fmt(row.dividends_usd, 2)}</td>
                  <td className={`py-2 px-4 text-right text-xs ${diff >= 0 ? 'text-green-400' : 'text-zinc-500'}`}>
                    {diff >= 0 ? '+' : ''}{fmt(diff, 2)}
                  </td>
                  <td className="py-2 px-4">
                    <MiniBar dep={row.deposits_usd} div={row.dividends_usd} maxVal={maxVal} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {/* Legend */}
      <div className="px-4 py-2 border-t border-zinc-800 flex items-center gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" />{t('cf_deposits')}</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" />{t('cf_dividends')}</span>
      </div>
    </div>
  )
}

// ─── Projection Calculator ───────────────────────────────────────────────────

interface ProjectionRow {
  year: number
  calYear: number
  portfolioValue: number
  annualDividends: number
  monthlyDividends: number
  selfSufficiency: number
  isIndependence: boolean
}

function ProjectionCalculator({
  avgMonthlyDeposit,
  currentPortfolio,
  currentDivYield,
}: {
  avgMonthlyDeposit: number
  currentPortfolio: number
  currentDivYield: number   // annual %
}) {
  const { t } = useLanguage()
  const currentYear = new Date().getFullYear()

  const [monthlyDeposit, setMonthlyDeposit] = useState(Math.round(avgMonthlyDeposit))
  const [divGrowth, setDivGrowth] = useState(5)
  const [portGrowth, setPortGrowth] = useState(3)
  const [horizon, setHorizon] = useState(15)
  const [reinvest, setReinvest] = useState(true)

  const rows = useMemo<ProjectionRow[]>(() => {
    let portfolio = currentPortfolio
    // Start with current yield, grow it each year
    let yieldPct = currentDivYield > 0 ? currentDivYield : 4.0  // fallback 4%
    let independenceFound = false
    const result: ProjectionRow[] = []

    for (let yr = 1; yr <= horizon; yr++) {
      // Apply portfolio appreciation
      portfolio = portfolio * (1 + portGrowth / 100)
      // Add yearly deposits
      portfolio += monthlyDeposit * 12
      // Calculate dividends on this portfolio
      const annualDivs = portfolio * (yieldPct / 100)
      // Optionally reinvest
      if (reinvest) {
        portfolio += annualDivs
      }
      // Grow yield rate for next year
      yieldPct = yieldPct * (1 + divGrowth / 100)

      const monthlyDivs = annualDivs / 12
      const selfSuff = monthlyDeposit > 0
        ? Math.min((monthlyDivs / monthlyDeposit) * 100, 999)
        : 0
      const isIndep = selfSuff >= 100 && !independenceFound
      if (isIndep) independenceFound = true

      result.push({
        year: yr,
        calYear: currentYear + yr,
        portfolioValue: portfolio,
        annualDividends: annualDivs,
        monthlyDividends: monthlyDivs,
        selfSufficiency: selfSuff,
        isIndependence: isIndep,
      })
    }
    return result
  }, [monthlyDeposit, divGrowth, portGrowth, horizon, reinvest, currentPortfolio, currentDivYield])

  const independenceRow = rows.find(r => r.selfSufficiency >= 100)

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-purple-400" />
          {t('cf_proj_title')}
        </span>
        {independenceRow && (
          <span className="flex items-center gap-1.5 text-xs bg-green-500/10 border border-green-500/20 text-green-400 rounded-full px-3 py-1">
            <Star className="w-3 h-3" />
            {t('cf_proj_independence')}: {independenceRow.calYear}
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-4 border-b border-zinc-800">
        {/* Monthly Deposit */}
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">{t('cf_proj_monthly_dep')}</label>
          <div className="flex items-center gap-2">
            <input
              type="range" min={0} max={5000} step={50}
              value={monthlyDeposit}
              onChange={e => setMonthlyDeposit(Number(e.target.value))}
              className="flex-1 accent-blue-500"
            />
            <span className="text-sm font-bold text-blue-300 w-16 text-right">${fmt(monthlyDeposit)}</span>
          </div>
        </div>

        {/* Dividend Growth */}
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">{t('cf_proj_div_growth')}</label>
          <div className="flex items-center gap-2">
            <input
              type="range" min={0} max={15} step={0.5}
              value={divGrowth}
              onChange={e => setDivGrowth(Number(e.target.value))}
              className="flex-1 accent-green-500"
            />
            <span className="text-sm font-bold text-green-400 w-12 text-right">{divGrowth}%</span>
          </div>
        </div>

        {/* Portfolio Growth */}
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">{t('cf_proj_port_growth')}</label>
          <div className="flex items-center gap-2">
            <input
              type="range" min={0} max={15} step={0.5}
              value={portGrowth}
              onChange={e => setPortGrowth(Number(e.target.value))}
              className="flex-1 accent-purple-500"
            />
            <span className="text-sm font-bold text-purple-400 w-12 text-right">{portGrowth}%</span>
          </div>
        </div>

        {/* Horizon */}
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">{t('cf_proj_horizon')}</label>
          <div className="flex items-center gap-2">
            <input
              type="range" min={5} max={30} step={1}
              value={horizon}
              onChange={e => setHorizon(Number(e.target.value))}
              className="flex-1 accent-zinc-400"
            />
            <span className="text-sm font-bold text-zinc-300 w-10 text-right">{horizon}y</span>
          </div>
        </div>

        {/* Reinvest toggle */}
        <div className="flex items-center gap-3 col-span-2">
          <button
            onClick={() => setReinvest(v => !v)}
            className={`w-9 h-5 rounded-full transition-colors relative ${reinvest ? 'bg-green-500' : 'bg-zinc-600'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${reinvest ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
          <span className="text-xs text-zinc-400">{t('cf_proj_reinvest')}</span>
        </div>
      </div>

      {/* Projection Table */}
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-900">
            <tr className="border-b border-zinc-800">
              <th className="py-2 px-4 text-left text-xs text-zinc-500 uppercase tracking-wider">{t('cf_proj_year')}</th>
              <th className="py-2 px-4 text-right text-xs text-zinc-500 uppercase tracking-wider">{t('cf_proj_portfolio')}</th>
              <th className="py-2 px-4 text-right text-xs text-zinc-500 uppercase tracking-wider">{t('cf_proj_annual_div')}</th>
              <th className="py-2 px-4 text-right text-xs text-zinc-500 uppercase tracking-wider">{t('cf_proj_monthly_div')}</th>
              <th className="py-2 px-4 text-right text-xs text-zinc-500 uppercase tracking-wider">{t('cf_proj_sufficiency')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr
                key={row.year}
                className={`border-b transition-colors ${
                  row.isIndependence
                    ? 'bg-green-500/10 border-green-500/30'
                    : row.selfSufficiency >= 100
                    ? 'bg-green-500/5 border-zinc-800/50'
                    : 'border-zinc-800/50 hover:bg-zinc-800/30'
                }`}
              >
                <td className="py-2 px-4">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-300 font-mono">{row.calYear}</span>
                    {row.isIndependence && (
                      <span className="flex items-center gap-1 text-xs text-green-400 bg-green-500/15 rounded-full px-1.5 py-0.5">
                        <Star className="w-2.5 h-2.5" /> DIV FREE
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2 px-4 text-right text-zinc-200 font-mono">${fmt(row.portfolioValue)}</td>
                <td className="py-2 px-4 text-right text-green-400 font-mono">${fmt(row.annualDividends)}</td>
                <td className="py-2 px-4 text-right text-green-300 font-mono">${fmt(row.monthlyDividends, 0)}</td>
                <td className="py-2 px-4 text-right">
                  <span className={`text-xs font-bold ${
                    row.selfSufficiency >= 100 ? 'text-green-400' :
                    row.selfSufficiency >= 50  ? 'text-yellow-400' : 'text-zinc-400'
                  }`}>
                    {fmt(row.selfSufficiency, 1)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-zinc-800 text-xs text-zinc-600 italic">
        * Projection assumes dividends reinvested {reinvest ? 'yes' : 'no'}. Portfolio growth {portGrowth}%/yr. Dividend yield growth {divGrowth}%/yr. Not financial advice.
      </div>
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function CashFlow() {
  const { t } = useLanguage()
  const { data, isLoading } = useCashFlow()
  const { data: summary } = usePortfolioSummary()

  const currentPortfolio = summary?.current_value_usd ?? 0
  // Estimate current dividend yield from portfolio summary
  const currentDivYield = (summary && currentPortfolio > 0)
    ? (summary.annual_income_usd / currentPortfolio) * 100
    : 4.0

  if (isLoading || !data) {
    return (
      <div className="p-8 text-zinc-400 flex items-center gap-2">
        <ArrowLeftRight className="w-4 h-4 animate-pulse" />
        Loading cash flow data...
      </div>
    )
  }

  const { monthly, summary: cf } = data

  const selfColor =
    cf.self_sufficiency_pct >= 100 ? 'text-green-400' :
    cf.self_sufficiency_pct >= 50  ? 'text-yellow-400' : 'text-blue-300'

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ArrowLeftRight className="w-6 h-6 text-blue-400" />
        <h1 className="text-2xl font-bold">{t('cf_title')}</h1>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label={t('cf_total_deposited')}
          value={`$${fmt(cf.total_deposited_usd)}`}
          sub="all time"
          color="text-blue-300"
        />
        <SummaryCard
          label={t('cf_total_dividends')}
          value={`$${fmt(cf.total_dividends_usd, 2)}`}
          sub="all time"
          color="text-green-400"
        />
        <SummaryCard
          label={t('cf_self_sufficiency')}
          value={`${cf.self_sufficiency_pct}%`}
          sub="dividends / deposits"
          color={selfColor}
        />
        <SummaryCard
          label={t('cf_avg_monthly')}
          value={`$${fmt(cf.avg_monthly_deposit_usd)}`}
          sub="last 12 months"
          color="text-zinc-200"
        />
      </div>

      {/* History */}
      {monthly.length > 0 ? (
        <HistoryTable rows={monthly} />
      ) : (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center text-zinc-500">
          No transaction history found.
        </div>
      )}

      {/* Projection Calculator */}
      <ProjectionCalculator
        avgMonthlyDeposit={cf.avg_monthly_deposit_usd}
        currentPortfolio={currentPortfolio}
        currentDivYield={currentDivYield}
      />
    </div>
  )
}
