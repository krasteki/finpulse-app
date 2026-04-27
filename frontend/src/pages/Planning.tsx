import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Target, BarChart3, FlaskConical,
  TrendingUp, TrendingDown,
  CheckCircle2, Info, Sparkles,
} from 'lucide-react'
import { usePortfolioSummary, useRebalanceSuggestions, useWhatIf } from '@/hooks'
import { useLanguage } from '@/contexts/LanguageContext'
import { useCurrency } from '@/contexts/CurrencyContext'
import type { RebalanceSuggestion } from '@/types'

const USD_TO_EUR = 0.92

// ─── Tooltip helper ───────────────────────────────────────────────────────────
function Tooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative inline-block">
      <Info
        size={14}
        className="text-zinc-600 hover:text-zinc-400 cursor-pointer"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      />
      {show && (
        <div className="absolute z-50 left-5 top-0 w-64 bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-300 shadow-xl">
          {text}
        </div>
      )}
    </div>
  )
}

// ─── Goal Tracker ─────────────────────────────────────────────────────────────
function GoalTracker() {
  const { data: summary } = usePortfolioSummary()

  const [targetMonthly, setTargetMonthly] = useState<number>(500)
  const [targetYear, setTargetYear] = useState<number>(2028)

  useEffect(() => {
    const stored = localStorage.getItem('finpulse_goal')
    if (stored) {
      try {
        const { monthly, year } = JSON.parse(stored)
        setTargetMonthly(monthly)
        setTargetYear(year)
      } catch { /* ignore */ }
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('finpulse_goal', JSON.stringify({ monthly: targetMonthly, year: targetYear }))
  }, [targetMonthly, targetYear])

  const currentMonthlyEUR = (summary?.monthly_income_usd ?? 0) * USD_TO_EUR
  const progressPct = Math.min(100, (currentMonthlyEUR / targetMonthly) * 100)
  const remaining = Math.max(0, targetMonthly - currentMonthlyEUR)
  const now = new Date()
  const monthsLeft = Math.max(1, (targetYear - now.getFullYear()) * 12 - now.getMonth() + 11)
  const monthlyGrowthNeeded = remaining > 0 ? remaining / monthsLeft : 0
  const achieved = currentMonthlyEUR >= targetMonthly

  const barColor =
    progressPct >= 100 ? 'bg-green-500' :
    progressPct >= 60  ? 'bg-blue-500' :
    progressPct >= 30  ? 'bg-amber-500' : 'bg-red-500'

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Target size={18} className="text-blue-400" />
        <h2 className="text-lg font-semibold text-zinc-100">Целеви трекер</h2>
        <Tooltip text={`Текущ доход: $${(summary?.monthly_income_usd ?? 0).toFixed(2)}/мес (≈€${currentMonthlyEUR.toFixed(2)}). Промените се запазват автоматично.`} />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-start gap-8">
        <div className="flex-1 min-w-[220px] space-y-2">
          <div className="flex justify-between">
            <span className="text-xs text-zinc-500">Целеви месечен доход</span>
            <span className="text-blue-400 font-bold">€{targetMonthly}/мес</span>
          </div>
          <input
            type="range" min={50} max={5000} step={50}
            value={targetMonthly}
            onChange={e => setTargetMonthly(Number(e.target.value))}
            className="w-full accent-blue-500 h-2 cursor-pointer"
          />
          <div className="flex justify-between text-xs text-zinc-600">
            <span>€50</span><span>€5 000</span>
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-xs text-zinc-500">Целева година</span>
          <div className="flex flex-wrap gap-1">
            {[2026,2027,2028,2030,2032,2035].map(y => (
              <button key={y} onClick={() => setTargetYear(y)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  targetYear === y
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}>{y}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Big numbers */}
      <div className="flex items-end justify-between">
        <div>
          <span className="text-4xl font-bold text-zinc-100">€{currentMonthlyEUR.toFixed(0)}</span>
          <span className="text-zinc-500 ml-1">/мес</span>
        </div>
        <div className="text-right">
          <span className="text-zinc-500 text-sm">цел </span>
          <span className="text-xl font-bold text-blue-400">€{targetMonthly}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="relative h-5 bg-zinc-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: `${progressPct}%` }} />
          {[25,50,75].map(m => (
            <div key={m} className="absolute top-0 bottom-0 w-px bg-zinc-700" style={{ left: `${m}%` }} />
          ))}
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white/80">
            {progressPct.toFixed(0)}%
          </span>
        </div>
        <div className="flex justify-between text-xs text-zinc-600">
          <span>0</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
        </div>
      </div>

      {/* Status */}
      {achieved ? (
        <div className="flex items-center gap-2 bg-green-900/30 border border-green-700/50 rounded-xl px-4 py-3 text-green-400 font-semibold">
          <CheckCircle2 size={16} />
          Целта е постигната! 🎉
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-zinc-800 rounded-xl p-3 space-y-1">
            <p className="text-xs text-zinc-500">Оставащо</p>
            <p className="text-lg font-bold text-amber-400">€{remaining.toFixed(0)}</p>
            <p className="text-xs text-zinc-600">до целта</p>
          </div>
          <div className="bg-zinc-800 rounded-xl p-3 space-y-1">
            <p className="text-xs text-zinc-500">Нужен ръст</p>
            <p className="text-lg font-bold text-zinc-300">€{monthlyGrowthNeeded.toFixed(1)}</p>
            <p className="text-xs text-zinc-600">на месец</p>
          </div>
          <div className="bg-zinc-800 rounded-xl p-3 space-y-1">
            <p className="text-xs text-zinc-500">Оставащо</p>
            <p className="text-lg font-bold text-zinc-300">{monthsLeft}</p>
            <p className="text-xs text-zinc-600">месеца до {targetYear}</p>
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Rebalancing Suggestions ──────────────────────────────────────────────────
function RebalanceSection() {
  const navigate = useNavigate()
  const { data, isLoading, isError } = useRebalanceSuggestions()

  const withData = data?.filter(s => s.action !== 'NO_DATA') ?? []
  const noData   = data?.filter(s => s.action === 'NO_DATA') ?? []

  const actionCfg: Record<string, { label: string; cls: string }> = {
    BUY:    { label: 'КУПИ',    cls: 'bg-green-900/60 text-green-300 border border-green-700' },
    HOLD:   { label: 'ЗАДРЪЖ', cls: 'bg-zinc-800 text-zinc-400 border border-zinc-700' },
    REDUCE: { label: 'НАМАЛИ', cls: 'bg-amber-900/60 text-amber-300 border border-amber-700' },
  }
  const zoneColor: Record<string, string> = {
    BUY: 'text-green-400', HOLD: 'text-yellow-400', SELL: 'text-red-400', TRIM: 'text-orange-400',
  }

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
      <div className="flex items-center gap-2">
        <BarChart3 size={18} className="text-purple-400" />
        <h2 className="text-lg font-semibold text-zinc-100">Препоръки за ребаланс</h2>
        <Tooltip text="Базирано на AI ценови зони (BUY/HOLD/SELL). Кликни върху карта за да отвориш анализа. Тикъри без данни изискват генериран AI анализ." />
      </div>

      {isLoading && <p className="text-zinc-500 text-sm animate-pulse">Зареждане…</p>}
      {isError   && <p className="text-red-400 text-sm">Грешка при зареждане</p>}

      {/* Cards for tickers WITH data */}
      {withData.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {withData.map(s => {
            const cfg = actionCfg[s.action] ?? actionCfg.HOLD
            return (
              <div key={s.ticker}
                className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4 space-y-3 hover:border-zinc-500 transition-colors cursor-pointer"
                onClick={() => navigate(`/analysis/${s.ticker}`)}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-bold text-zinc-100 text-base">{s.ticker}</div>
                    <div className="text-xs text-zinc-500 truncate max-w-[130px]">{s.instrument_name}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${cfg.cls}`}>
                    {cfg.label}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <div>
                    <span className="text-zinc-500 text-xs">Зона </span>
                    <span className={`font-semibold ${
                      s.current_zone ? zoneColor[s.current_zone] ?? 'text-zinc-400' : 'text-zinc-600'
                    }`}>{s.current_zone ?? '—'}</span>
                  </div>
                  <span className="text-zinc-700">·</span>
                  <div>
                    <span className="text-zinc-500 text-xs">Тегло </span>
                    <span className="text-zinc-300 font-semibold">{s.weight_pct ?? '—'}%</span>
                  </div>
                  <span className="text-zinc-700">·</span>
                  <span className="text-zinc-300 font-semibold">${s.current_price.toFixed(2)}</span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">{s.reason}</p>
              </div>
            )
          })}
        </div>
      )}

      {/* NO_DATA tickers — clickable chips to go run AI */}
      {noData.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Info size={12} />
            <span>Тикъри без AI анализ — кликни за да генерираш и получиш препоръка:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {noData.map(s => (
              <button key={s.ticker}
                onClick={() => navigate(`/analysis/${s.ticker}`)}
                className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-blue-500 rounded-xl text-sm transition-colors group"
              >
                <span className="font-semibold text-zinc-300 group-hover:text-blue-400">{s.ticker}</span>
                <span className="text-zinc-600 text-xs">{s.weight_pct}%</span>
                <Sparkles size={12} className="text-zinc-600 group-hover:text-blue-400" />
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-600">
            Анализ акции → Генерирай AI анализ → Върни се тук за препоръка
          </p>
        </div>
      )}
    </section>
  )
}

// ─── What-If Simulator ────────────────────────────────────────────────────────
function WhatIfSimulator() {
  const { fmt } = useCurrency()
  const { data: rebalance } = useRebalanceSuggestions()

  const [ticker, setTicker] = useState('QYLD')
  const [unitsStr, setUnitsStr] = useState('100')
  const [queryTicker, setQueryTicker] = useState('')
  const [queryUnits, setQueryUnits] = useState(0)
  const [triggered, setTriggered] = useState(false)

  const units = parseFloat(unitsStr) || 0
  const { data, isFetching, isError } = useWhatIf(queryTicker, queryUnits, triggered)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const t = ticker.trim().toUpperCase()
    if (!t || units <= 0) return
    setQueryTicker(t)
    setQueryUnits(units)
    setTriggered(true)
  }

  const buyPicks = rebalance?.filter(s => s.action === 'BUY').slice(0, 4) ?? []

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
      <div className="flex items-center gap-2">
        <FlaskConical size={18} className="text-cyan-400" />
        <h2 className="text-lg font-semibold text-zinc-100">What-If Симулатор</h2>
        <Tooltip text="Въведи тикър и брой акции. Виж как се променят стойността, месечния доход и диверсификацията — преди да купиш." />
      </div>
      <p className="text-sm text-zinc-500">
        Въведи тикър + брой акции → виж ефекта върху портфейла преди да купиш.
      </p>

      {buyPicks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-600">Бързо избери (BUY зона):</span>
          {buyPicks.map(s => (
            <button key={s.ticker}
              onClick={() => { setTicker(s.ticker); setTriggered(false) }}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                ticker === s.ticker
                  ? 'bg-green-900/60 border-green-600 text-green-300'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-green-600 hover:text-green-400'
              }`}
            >{s.ticker}</button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">Тикър</label>
          <input
            type="text"
            value={ticker}
            onChange={e => { setTicker(e.target.value.toUpperCase()); setTriggered(false) }}
            placeholder="QYLD"
            maxLength={12}
            className="w-28 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 uppercase focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">Брой акции</label>
          <input
            type="number"
            min={1} step={1}
            value={unitsStr}
            onChange={e => { setUnitsStr(e.target.value); setTriggered(false) }}
            placeholder="100"
            className="w-28 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-blue-500"
          />
        </div>
        <button type="submit" disabled={!ticker || units <= 0}
          className="px-5 py-2 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white text-sm rounded-lg font-medium transition-colors">
          Симулирай →
        </button>
      </form>

      {isFetching && (
        <div className="flex items-center gap-2 text-zinc-500 text-sm animate-pulse">
          <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
          Изчислявам…
        </div>
      )}
      {isError && !isFetching && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg px-4 py-3 text-red-400 text-sm">
          Неуспешно — провери дали тикърът е валиден.
        </div>
      )}

      {triggered && !isFetching && data && (
        <div className="space-y-4">
          <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4">
            <div className="text-sm text-zinc-500 mb-2">{data.units_added} акции × {data.ticker} — {data.ticker_name}</div>
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-xs text-zinc-500">Цена за покупка</p>
                <p className="text-2xl font-bold text-zinc-100">{data.cost_to_add != null ? fmt(data.cost_to_add) : '—'}</p>
              </div>
              {data.annual_div_rate != null && data.annual_div_rate > 0 && (
                <div>
                  <p className="text-xs text-zinc-500">Год. дивидент/акция</p>
                  <p className="text-2xl font-bold text-green-400">${data.annual_div_rate.toFixed(3)}</p>
                </div>
              )}
              {(!data.annual_div_rate || data.annual_div_rate === 0) && (
                <div className="flex items-center gap-1 text-xs text-zinc-600 mt-4">
                  <Info size={12} />
                  Няма дивидентни данни за {data.ticker} в Yahoo Finance
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center text-xs text-zinc-500 font-semibold">
            <div>ПОКАЗАТЕЛ</div>
            <div>ПРЕДИ</div>
            <div className="text-cyan-400">СЛЕД</div>
          </div>

          {[
            { label: 'Стойност', before: fmt(data.current_value), after: fmt(data.new_value), delta: data.delta_value, fmtD: (v: number) => `${v >= 0 ? '+' : ''}${fmt(Math.abs(v))}`, invert: false },
            { label: 'Месечен доход', before: `$${data.current_monthly_income.toFixed(2)}`, after: `$${data.new_monthly_income.toFixed(2)}`, delta: data.delta_monthly_income, fmtD: (v: number) => `${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(2)}`, invert: false },
            { label: 'Доходност', before: `${data.current_yield_pct.toFixed(2)}%`, after: `${data.new_yield_pct.toFixed(2)}%`, delta: data.delta_yield_pct, fmtD: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, invert: false },
            { label: `Тегло ${data.ticker}`, before: `${data.ticker_weight_before.toFixed(1)}%`, after: `${data.ticker_weight_after.toFixed(1)}%`, delta: data.ticker_weight_after - data.ticker_weight_before, fmtD: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`, invert: true },
            { label: 'Топ концентрация', before: '—', after: `${data.top_concentration_after.toFixed(1)}%`, delta: 0, fmtD: () => '', invert: true },
          ].map(row => (
            <div key={row.label} className="grid grid-cols-3 gap-3 items-center py-2.5 border-b border-zinc-800/50">
              <div className="text-sm text-zinc-400">{row.label}</div>
              <div className="text-center text-sm text-zinc-500">{row.before}</div>
              <div className="text-center">
                <span className="text-sm font-semibold text-zinc-100">{row.after}</span>
                {row.delta !== 0 && (
                  <div className={`text-xs mt-0.5 ${
                    row.invert
                      ? (row.delta > 0 ? 'text-amber-400' : 'text-green-400')
                      : (row.delta > 0 ? 'text-green-400' : 'text-red-400')
                  }`}>
                    {row.delta > 0
                      ? <TrendingUp size={10} className="inline mr-0.5" />
                      : <TrendingDown size={10} className="inline mr-0.5" />
                    }
                    {row.fmtD(row.delta)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function Planning() {
  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-5xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-zinc-100">Планиране</h1>
        <p className="text-sm text-zinc-500">
          Постави цел за пасивен доход, виж дали си в графика, и симулирай покупки преди да ги направиш.
        </p>
      </div>
      <GoalTracker />
      <RebalanceSection />
      <WhatIfSimulator />
    </div>
  )
}
