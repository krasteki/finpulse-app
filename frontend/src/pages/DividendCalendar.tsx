import { CalendarDays, Clock, TrendingUp, AlertCircle } from 'lucide-react'
import { useDividendCalendar } from '@/hooks'
import { useLanguage } from '@/contexts/LanguageContext'
import { useCurrency } from '@/contexts/CurrencyContext'
import type { DividendCalendarEntry } from '@/types'

function DaysBadge({ days }: { days: number }) {
  if (days === 0) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
        Today
      </span>
    )
  }
  if (days > 0) {
    const color =
      days <= 7  ? 'bg-green-500/20 text-green-300 border-green-500/30' :
      days <= 30 ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' :
                   'bg-zinc-700/50 text-zinc-400 border-zinc-600/30'
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${color}`}>
        +{days}d
      </span>
    )
  }
  // Past
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-zinc-800 text-zinc-500 border border-zinc-700">
      {days}d
    </span>
  )
}

function CalendarRow({ entry, fmt }: { entry: DividendCalendarEntry; fmt: (n: number | null | undefined) => string }) {
  const isPast = entry.days_to_ex_div < 0
  return (
    <tr className={`border-b border-zinc-800 hover:bg-zinc-800/40 transition-colors ${isPast ? 'opacity-50' : ''}`}>
      <td className="py-3 px-4">
        <div className="font-bold text-white">{entry.ticker}</div>
        <div className="text-xs text-zinc-500 truncate max-w-[160px]">{entry.instrument_name}</div>
      </td>
      <td className="py-3 px-4 text-zinc-300 text-sm">{entry.ex_div_date}</td>
      <td className="py-3 px-4">
        <DaysBadge days={entry.days_to_ex_div} />
      </td>
      <td className="py-3 px-4 text-zinc-300 text-sm text-right">
        {entry.dividend_rate_usd != null ? fmt(entry.dividend_rate_usd) : '—'}
      </td>
      <td className="py-3 px-4 text-zinc-300 text-sm text-right">
        {entry.dividend_yield_pct != null ? (
          <span className="text-green-400">{entry.dividend_yield_pct}%</span>
        ) : '—'}
      </td>
      <td className="py-3 px-4 text-zinc-300 text-sm text-right">
        {entry.payout_ratio_pct != null ? (
          <span className={
            entry.payout_ratio_pct > 85 ? 'text-red-400' :
            entry.payout_ratio_pct > 65 ? 'text-yellow-400' : 'text-green-400'
          }>
            {entry.payout_ratio_pct}%
          </span>
        ) : '—'}
      </td>
      <td className="py-3 px-4 text-zinc-300 text-sm text-right">
        {entry.units.toFixed(2)}
      </td>
      <td className="py-3 px-4 text-right">
        {entry.est_payment_usd != null ? (
          <span className="text-blue-300 font-semibold">{fmt(entry.est_payment_usd)}</span>
        ) : '—'}
      </td>
    </tr>
  )
}

export function DividendCalendar() {
  const { t } = useLanguage()
  const { fmt } = useCurrency()
  const { data, isLoading, error } = useDividendCalendar()

  const upcoming = data?.filter(e => e.days_to_ex_div >= 0) ?? []
  const past     = data?.filter(e => e.days_to_ex_div < 0)  ?? []

  // Next 30 days income estimate
  const next30 = upcoming
    .filter(e => e.days_to_ex_div <= 30 && e.est_payment_usd)
    .reduce((sum, e) => sum + (e.est_payment_usd ?? 0), 0)

  const columns = [
    { label: t('col_ticker'),        align: '' },
    { label: t('cal_ex_div_date'),   align: '' },
    { label: t('cal_days'),          align: '' },
    { label: t('cal_annual_rate'),   align: 'text-right' },
    { label: t('cal_yield'),         align: 'text-right' },
    { label: t('cal_payout'),        align: 'text-right' },
    { label: t('cal_units'),         align: 'text-right' },
    { label: t('cal_est_payment'),   align: 'text-right' },
  ]

  if (isLoading) {
    return (
      <div className="p-8 text-zinc-400 flex items-center gap-2">
        <Clock className="w-4 h-4 animate-spin" />
        {t('cal_loading')}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8 text-red-400 flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        Error loading calendar
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarDays className="w-6 h-6 text-blue-400" />
          <h1 className="text-2xl font-bold">{t('cal_title')}</h1>
        </div>
        {next30 > 0 && (
          <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-2">
            <TrendingUp className="w-4 h-4 text-green-400" />
            <span className="text-sm text-zinc-400">Next 30 days:</span>
            <span className="font-bold text-green-400">{fmt(next30)}</span>
          </div>
        )}
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 ? (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-green-400">{t('cal_upcoming')}</span>
            <span className="text-xs text-zinc-500">({upcoming.length})</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  {columns.map(c => (
                    <th key={c.label} className={`py-2 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider ${c.align}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {upcoming.map(e => <CalendarRow key={e.ticker} entry={e} fmt={fmt} />)}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center text-zinc-500">
          {t('cal_no_data')}
        </div>
      )}

      {/* Past (last 90 days) */}
      {past.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{t('cal_past')}</span>
            <span className="text-xs text-zinc-600">({past.length})</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  {columns.map(c => (
                    <th key={c.label} className={`py-2 px-4 text-xs font-semibold text-zinc-600 uppercase tracking-wider ${c.align}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {past.map(e => <CalendarRow key={e.ticker} entry={e} fmt={fmt} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-400"></span> ≤ 7 days
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-400"></span> ≤ 30 days
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-zinc-500"></span> {'>'} 30 days
        </span>
        <span className="ml-4">Payout: <span className="text-green-400">{'<'}65%</span> safe · <span className="text-yellow-400">65-85%</span> moderate · <span className="text-red-400">{'>'}85%</span> at risk</span>
      </div>
    </div>
  )
}
