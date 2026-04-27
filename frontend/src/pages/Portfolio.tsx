import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePositions, usePrefetchChart, useTransactions, useXirr, usePortfolioTargets, useAddTransaction, useDeleteTransaction } from '@/hooks'
import { TrendingUp, TrendingDown, Minus, Plus, Trash2, X } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import { useCurrency } from '@/contexts/CurrencyContext'

const fmtPct = (n: number | null | undefined) =>
  n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

function PnlCell({ value, pct, fmt }: { value: number | null; pct: number | null; fmt: (v: number | null | undefined, d?: number) => string }) {
  const color = value == null ? 'text-zinc-400' : value >= 0 ? 'text-green-400' : 'text-red-400'
  const Icon = value == null ? Minus : value >= 0 ? TrendingUp : TrendingDown
  return (
    <div className={`flex items-center gap-1 justify-end ${color}`}>
      <Icon size={13} />
      <span>{fmt(value)}</span>
      <span className="text-xs opacity-70">({fmtPct(pct)})</span>
    </div>
  )
}

const ZONE_STYLES: Record<string, string> = {
  BUY: 'bg-green-900/40 text-green-400 border-green-800',
  HOLD: 'bg-blue-900/40 text-blue-400 border-blue-800',
  TRIM: 'bg-yellow-900/40 text-yellow-400 border-yellow-800',
  SELL: 'bg-red-900/40 text-red-400 border-red-800',
}

function ZoneBadge({ zone }: { zone: string | null | undefined }) {
  if (!zone) return <span className="text-zinc-700 text-xs">—</span>
  const cls = ZONE_STYLES[zone] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700'
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-bold border ${cls}`}>
      {zone}
    </span>
  )
}

export function Portfolio() {
  const { data: positions, isLoading } = usePositions()
  const navigate = useNavigate()
  const prefetchChart = usePrefetchChart()
  const hoverTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const { t } = useLanguage()
  const { fmt } = useCurrency()
  const [tab, setTab] = useState<'positions' | 'transactions'>('positions')
  const [filterTicker, setFilterTicker] = useState('')
  const { data: transactions, isLoading: txLoading } = useTransactions()
  const { data: xirr } = useXirr()
  const { data: targets } = usePortfolioTargets()
  const addTx = useAddTransaction()
  const deleteTx = useDeleteTransaction()

  // Add-transaction form state
  const [showForm, setShowForm] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ ticker: '', action: 'BUY' as 'BUY' | 'SELL', units: '', price: '', date: today })
  const [formErr, setFormErr] = useState('')

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormErr('')
    if (!form.ticker.trim()) { setFormErr(t('txn_form_err_ticker')); return }
    const u = parseFloat(form.units)
    const p = parseFloat(form.price)
    if (!u || u <= 0) { setFormErr(t('txn_form_err_units')); return }
    if (!p || p <= 0) { setFormErr(t('txn_form_err_price')); return }
    try {
      await addTx.mutateAsync({ ticker: form.ticker.trim().toUpperCase(), action: form.action, units: u, price: p, transaction_date: form.date })
      setShowForm(false)
      setForm({ ticker: '', action: 'BUY', units: '', price: '', date: today })
    } catch (err: unknown) {
      setFormErr(err instanceof Error ? err.message : 'Failed')
    }
  }

  // Build ticker → zone map
  const zoneMap = Object.fromEntries((targets ?? []).map(t => [t.ticker, t.current_zone]))

  const uniqueTickers = [...new Set((transactions ?? []).map(tx => tx.ticker))].sort()
  const filteredTxns = filterTicker
    ? (transactions ?? []).filter(tx => tx.ticker === filterTicker)
    : (transactions ?? [])

  const handleMouseEnter = (ticker: string) => {
    hoverTimers.current[ticker] = setTimeout(() => prefetchChart(ticker), 300)
  }
  const handleMouseLeave = (ticker: string) => {
    clearTimeout(hoverTimers.current[ticker])
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-zinc-500">{t('loading')}</div>
  }

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-100">
          {t('portfolio_title')} <span className="text-zinc-500 text-lg">({positions?.length ?? 0})</span>
        </h1>
        {xirr?.xirr_pct != null && (
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2" title={t('xirr_tooltip')}>
            <span className="text-zinc-400 text-sm">{t('xirr_label')}</span>
            <span className={`font-bold text-lg ${xirr.xirr_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {xirr.xirr_pct >= 0 ? '+' : ''}{xirr.xirr_pct.toFixed(2)}%
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-800">
        {(['positions', 'transactions'] as const).map(tabKey => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`px-5 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === tabKey
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t(tabKey === 'positions' ? 'tab_positions' : 'tab_transactions')}
          </button>
        ))}
      </div>

      {/* ─── POSITIONS TAB ─── */}
      {tab === 'positions' && (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-500 text-left border-b border-zinc-800 bg-zinc-900/80">
                {[t('col_ticker'), t('col_name'), t('col_units'), t('col_avg_cost'), t('col_current'), t('col_value'), t('col_pnl'), t('col_daily'), t('col_dividends'), 'Zone', ''].map(h => (
                  <th key={h} className={`px-4 py-3 font-medium ${h !== t('col_ticker') && h !== t('col_name') ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions?.map(pos => (
                <tr
                  key={pos.id}
                  onClick={() => navigate(`/analysis/${pos.ticker}`)}
                  onMouseEnter={() => handleMouseEnter(pos.ticker)}
                  onMouseLeave={() => handleMouseLeave(pos.ticker)}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 font-semibold text-blue-400">{pos.ticker}</td>
                  <td className="px-4 py-3 text-zinc-300 max-w-[160px] truncate">{pos.instrument_name}</td>
                  <td className="px-4 py-3 text-right text-zinc-300">{Number(pos.units).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-zinc-400">{fmt(Number(pos.open_rate))}</td>
                  <td className="px-4 py-3 text-right">{pos.current_price ? fmt(Number(pos.current_price)) : <span className="text-zinc-600">—</span>}</td>
                  <td className="px-4 py-3 text-right font-medium">{pos.current_value ? fmt(Number(pos.current_value)) : <span className="text-zinc-600">—</span>}</td>
                  <td className="px-4 py-3">
                    <PnlCell value={pos.unrealized_pnl ? Number(pos.unrealized_pnl) : null} pct={pos.unrealized_pnl_pct ? Number(pos.unrealized_pnl_pct) : null} fmt={fmt} />
                  </td>
                  <td className={`px-4 py-3 text-right text-xs ${pos.change_pct_day == null ? 'text-zinc-600' : Number(pos.change_pct_day) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {pos.change_pct_day ? fmtPct(Number(pos.change_pct_day)) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-green-400">{pos.total_dividends ? fmt(Number(pos.total_dividends)) : '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <ZoneBadge zone={zoneMap[pos.ticker]} />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => navigate(`/analysis/${pos.ticker}`)}
                      className="px-3 py-1 text-xs rounded-md border border-zinc-700 text-zinc-400 hover:border-blue-500 hover:text-blue-400 transition-colors"
                    >
                      {t('analyse')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* ─── TRANSACTIONS TAB ─── */}
      {tab === 'transactions' && (
      <div className="space-y-4">
        {/* Filter + Add row */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={filterTicker}
            onChange={e => setFilterTicker(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
          >
            <option value="">{t('txn_filter_all')}</option>
            {uniqueTickers.map(tk => (
              <option key={tk} value={tk}>{tk}</option>
            ))}
          </select>
          <span className="text-zinc-500 text-sm">{filteredTxns.length} {t('txn_total')}</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => { setShowForm(v => !v); setFormErr('') }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-blue-700 text-blue-400 hover:bg-blue-900/30 transition-colors"
            >
              {showForm ? <X size={13} /> : <Plus size={13} />}
              {showForm ? t('txn_cancel') : t('txn_add')}
            </button>
            <a
              href="/api/portfolio/export/transactions"
              download
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-400 hover:border-green-500 hover:text-green-400 transition-colors"
            >
              ↓ CSV
            </a>
          </div>
        </div>

        {/* Inline Add Form */}
        {showForm && (
          <form onSubmit={handleFormSubmit} className="bg-zinc-900 border border-blue-800/60 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-blue-300">{t('txn_add_title')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <input
                placeholder="TICKER"
                value={form.ticker}
                onChange={e => setForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))}
                className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 uppercase"
                maxLength={12}
              />
              <select
                value={form.action}
                onChange={e => setForm(f => ({ ...f, action: e.target.value as 'BUY' | 'SELL' }))}
                className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              >
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
              <input
                placeholder={t('txn_units')}
                type="number"
                min="0"
                step="any"
                value={form.units}
                onChange={e => setForm(f => ({ ...f, units: e.target.value }))}
                className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              />
              <input
                placeholder={t('txn_price')}
                type="number"
                min="0"
                step="any"
                value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              />
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              />
            </div>
            {formErr && <p className="text-red-400 text-xs">{formErr}</p>}
            <button
              type="submit"
              disabled={addTx.isPending}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {addTx.isPending ? '…' : t('txn_add_submit')}
            </button>
          </form>
        )}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            {txLoading ? (
              <div className="p-8 text-center text-zinc-500">{t('loading')}</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-500 text-left border-b border-zinc-800 bg-zinc-900/80">
                    <th className="px-4 py-3 font-medium">{t('txn_date')}</th>
                    <th className="px-4 py-3 font-medium">{t('col_ticker')}</th>
                    <th className="px-4 py-3 font-medium">{t('txn_action')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('txn_units')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('txn_price')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('txn_amount')}</th>
                    <th className="px-4 py-3 font-medium w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTxns.map(tx => (
                    <tr key={tx.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors group">
                      <td className="px-4 py-3 text-zinc-400 font-mono text-xs">{tx.transaction_date}</td>
                      <td className="px-4 py-3 font-semibold text-blue-400">{tx.ticker}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${tx.action === 'BUY' ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
                          {tx.action === 'BUY' ? t('txn_buy') : t('txn_sell')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-300">{tx.units.toFixed(4)}</td>
                      <td className="px-4 py-3 text-right text-zinc-400">{fmt(tx.price)}</td>
                      <td className="px-4 py-3 text-right font-medium text-zinc-200">{fmt(tx.amount_usd)}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => { if (confirm(t('txn_delete_confirm'))) deleteTx.mutate(tx.id) }}
                          disabled={deleteTx.isPending}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-600 hover:text-red-400 transition-all"
                          title={t('txn_delete')}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
