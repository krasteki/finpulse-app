import { useState } from 'react'
import { useTaxReport } from '@/hooks'
import { useLanguage } from '@/contexts/LanguageContext'

const YEARS = [2022, 2023, 2024, 2025, 2026]

function fmt(n: number, digits = 2) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs text-zinc-500 uppercase tracking-wide">{label}</span>
      <span className="text-xl font-bold text-zinc-100">{value}</span>
      {sub && <span className="text-xs text-zinc-500">{sub}</span>}
    </div>
  )
}

export function TaxReport() {
  const { t } = useLanguage()
  const [year, setYear] = useState(2025)
  const { data, isLoading, error } = useTaxReport(year)

  const exportUrl = `/api/tax/report/export?year=${year}`
  const pdfUrl = `/api/tax/report/pdf?year=${year}`

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-3 sm:items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">{t('tax_title')}</h1>
          <p className="text-sm text-zinc-500 mt-0.5">{t('tax_subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Year selector */}
          <div className="flex flex-wrap gap-1">
            {YEARS.map(y => (
              <button
                key={y}
                onClick={() => setYear(y)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  y === year
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
          {/* PDF export */}
          <a
            href={pdfUrl}
            download
            className="px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white text-sm rounded font-medium transition-colors whitespace-nowrap"
          >
            ↓ PDF
          </a>
          {/* CSV export */}
          <a
            href={exportUrl}
            download
            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm rounded font-medium transition-colors whitespace-nowrap"
          >
            ↓ CSV
          </a>
        </div>
      </div>

      {/* Info box */}
      <div className="bg-blue-950/40 border border-blue-800/50 rounded-lg p-4 text-sm text-blue-200 space-y-1">
        <p className="font-semibold text-blue-300">{t('tax_info_title')}</p>
        <p>{t('tax_info_line1')}</p>
        <p>{t('tax_info_line2')}</p>
        <p className="text-blue-400 text-xs">{t('tax_info_note')}</p>
      </div>

      {isLoading && (
        <div className="text-zinc-500 text-sm py-8 text-center">
          {t('tax_loading')} — {t('tax_loading_ecb')}
        </div>
      )}

      {error && (
        <div className="text-red-400 text-sm py-4 text-center">
          {t('tax_error')}
        </div>
      )}

      {data && (
        <>
          {/* EUR rate source */}
          {data.eur_rates_source === 'fallback(0.92)' && (
            <div className="text-xs text-amber-400 bg-amber-900/20 border border-amber-700/40 rounded px-3 py-2">
              ⚠ {t('tax_fallback_rate')}
            </div>
          )}

          {/* KPI summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              label={t('tax_gross_total')}
              value={`€${fmt(data.summary.total_gross_eur)}`}
              sub={t('tax_app8_col4')}
            />
            <KpiCard
              label={t('tax_withholding_total')}
              value={`€${fmt(data.summary.total_withholding_eur)}`}
              sub={t('tax_app8_col5')}
            />
            <KpiCard
              label={t('tax_bg_due')}
              value={`€${fmt(data.summary.total_bg_tax_eur)}`}
              sub={`5% × ${t('tax_gross_total').toLowerCase()}`}
            />
            <KpiCard
              label={t('tax_additional')}
              value={`€${fmt(data.summary.total_additional_bg_tax_eur)}`}
              sub={data.summary.total_additional_bg_tax_eur === 0 ? t('tax_credit_covers') : t('tax_must_pay')}
            />
          </div>

          {/* By-country table — Приложение 8 */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-200">{t('tax_by_country')}</h2>
              <span className="text-xs text-zinc-500">{t('tax_app8_label')}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                    <th className="text-left px-4 py-2">{t('tax_country')}</th>
                    <th className="text-right px-4 py-2">{t('tax_payments')}</th>
                    <th className="text-right px-4 py-2">{t('tax_wh_rate')}</th>
                    <th className="text-right px-4 py-2">{t('tax_gross_eur')} (кол.4)</th>
                    <th className="text-right px-4 py-2">{t('tax_withholding_eur')} (кол.5)</th>
                    <th className="text-right px-4 py-2">{t('tax_net_eur')}</th>
                    <th className="text-right px-4 py-2">{t('tax_bg_5pct')}</th>
                    <th className="text-right px-4 py-2">{t('tax_additional_due')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.summary.by_country.map(c => (
                    <tr key={c.country} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-4 py-2 text-zinc-200 font-medium">{c.country}</td>
                      <td className="px-4 py-2 text-right text-zinc-400">{c.count}</td>
                      <td className="px-4 py-2 text-right text-zinc-400">{c.withholding_rate_pct}%</td>
                      <td className="px-4 py-2 text-right text-zinc-200">€{fmt(c.gross_eur)}</td>
                      <td className="px-4 py-2 text-right text-red-400">€{fmt(c.withholding_eur)}</td>
                      <td className="px-4 py-2 text-right text-zinc-300">€{fmt(c.net_eur)}</td>
                      <td className="px-4 py-2 text-right text-zinc-400">€{fmt(c.bg_tax_eur)}</td>
                      <td className={`px-4 py-2 text-right font-medium ${c.additional_bg_tax_eur > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {c.additional_bg_tax_eur > 0 ? `€${fmt(c.additional_bg_tax_eur)}` : '✓ 0'}
                      </td>
                    </tr>
                  ))}
                  {data.summary.by_country.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-zinc-500 text-sm">
                        {t('tax_no_data')} {year}
                      </td>
                    </tr>
                  )}
                </tbody>
                {data.summary.by_country.length > 1 && (
                  <tfoot>
                    <tr className="border-t border-zinc-700 bg-zinc-800/30 font-semibold text-zinc-200">
                      <td className="px-4 py-2">TOTAL</td>
                      <td className="px-4 py-2 text-right text-zinc-400">{data.dividends.length}</td>
                      <td className="px-4 py-2" />
                      <td className="px-4 py-2 text-right">€{fmt(data.summary.total_gross_eur)}</td>
                      <td className="px-4 py-2 text-right text-red-400">€{fmt(data.summary.total_withholding_eur)}</td>
                      <td className="px-4 py-2 text-right">€{fmt(data.summary.total_net_eur)}</td>
                      <td className="px-4 py-2 text-right">€{fmt(data.summary.total_bg_tax_eur)}</td>
                      <td className={`px-4 py-2 text-right ${data.summary.total_additional_bg_tax_eur > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {data.summary.total_additional_bg_tax_eur > 0
                          ? `€${fmt(data.summary.total_additional_bg_tax_eur)}`
                          : '✓ 0'}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Detailed dividend list */}
          {data.dividends.length > 0 && (
            <details className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
              <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-zinc-200 hover:bg-zinc-800/30 select-none">
                {t('tax_details')} ({data.dividends.length})
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-t border-b border-zinc-800 text-zinc-500">
                      <th className="text-left px-3 py-2">{t('tax_date')}</th>
                      <th className="text-left px-3 py-2">{t('tax_ticker')}</th>
                      <th className="text-left px-3 py-2">{t('tax_country')}</th>
                      <th className="text-right px-3 py-2">Net USD</th>
                      <th className="text-right px-3 py-2">Gross USD</th>
                      <th className="text-right px-3 py-2">EUR rate</th>
                      <th className="text-right px-3 py-2">Net EUR</th>
                      <th className="text-right px-3 py-2">Gross EUR</th>
                      <th className="text-right px-3 py-2">Withh. EUR</th>
                      <th className="text-right px-3 py-2">BG tax 5%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dividends.map((d, i) => (
                      <tr key={i} className="border-b border-zinc-800/30 hover:bg-zinc-800/20">
                        <td className="px-3 py-1.5 text-zinc-400">{d.date}</td>
                        <td className="px-3 py-1.5 text-zinc-200 font-medium">{d.ticker}</td>
                        <td className="px-3 py-1.5 text-zinc-400">{d.country}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-300">${fmt(d.net_usd, 4)}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-300">${fmt(d.gross_usd, 4)}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-500">{fmt(d.eur_rate, 4)}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-300">€{fmt(d.net_eur, 4)}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-200">€{fmt(d.gross_eur, 4)}</td>
                        <td className="px-3 py-1.5 text-right text-red-400">€{fmt(d.withholding_eur, 4)}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-400">€{fmt(d.bg_tax_eur, 4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {/* Приложение 5 — capital gains */}
          {(data.capital_gains_summary?.transactions_count ?? 0) > 0 ? (
            <div className="space-y-3">
              {/* Summary KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard
                  label={t('tax_cg_gain_loss')}
                  value={`€${fmt(data.capital_gains_summary.total_gain_loss_eur)}`}
                  sub="Приложение 5"
                />
                <KpiCard
                  label={t('tax_cg_transactions')}
                  value={String(data.capital_gains_summary.transactions_count)}
                  sub={`${data.capital_gains_summary.profitable_count} profit / ${data.capital_gains_summary.loss_count} loss`}
                />
              </div>

              {/* Detailed FIFO table */}
              <details className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-zinc-200 hover:bg-zinc-800/30 select-none">
                  {t('tax_cg_title')} ({data.capital_gains.length})
                </summary>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-t border-b border-zinc-800 text-zinc-500">
                        <th className="text-left px-3 py-2">{t('tax_ticker')}</th>
                        <th className="text-right px-3 py-2">Units</th>
                        <th className="text-right px-3 py-2">Acq. date</th>
                        <th className="text-right px-3 py-2">Sell date</th>
                        <th className="text-right px-3 py-2">Acq. cost EUR (кол.4)</th>
                        <th className="text-right px-3 py-2">Proceeds EUR (кол.5)</th>
                        <th className="text-right px-3 py-2">Gain/Loss EUR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.capital_gains.map((g, i) => (
                        <tr key={i} className="border-b border-zinc-800/30 hover:bg-zinc-800/20">
                          <td className="px-3 py-1.5 text-zinc-200 font-medium">{g.ticker}</td>
                          <td className="px-3 py-1.5 text-right text-zinc-400">{g.units_sold}</td>
                          <td className="px-3 py-1.5 text-right text-zinc-400">{g.acq_date}</td>
                          <td className="px-3 py-1.5 text-right text-zinc-400">{g.sell_date}</td>
                          <td className="px-3 py-1.5 text-right text-zinc-300">€{fmt(g.acq_cost_eur, 4)}</td>
                          <td className="px-3 py-1.5 text-right text-zinc-300">€{fmt(g.proceeds_eur, 4)}</td>
                          <td className={`px-3 py-1.5 text-right font-medium ${g.gain_loss_eur >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {g.gain_loss_eur >= 0 ? '+' : ''}€{fmt(g.gain_loss_eur, 4)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-zinc-700 bg-zinc-800/30 font-semibold text-zinc-200">
                        <td colSpan={6} className="px-3 py-2 text-right">TOTAL Gain/Loss EUR</td>
                        <td className={`px-3 py-2 text-right ${data.capital_gains_summary.total_gain_loss_eur >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {data.capital_gains_summary.total_gain_loss_eur >= 0 ? '+' : ''}€{fmt(data.capital_gains_summary.total_gain_loss_eur)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </details>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-4 text-sm text-zinc-500">
              {t('tax_cg_no_sells')} {year}
            </div>
          )}
        </>
      )}
    </div>
  )
}
