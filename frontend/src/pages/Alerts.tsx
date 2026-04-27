import { useState } from 'react'
import { Bell, Trash2, Plus } from 'lucide-react'
import { useAlerts, useCreateAlert, useDeleteAlert } from '@/hooks'
import { useLanguage } from '@/contexts/LanguageContext'
import type { AlertType } from '@/types'

const ALERT_TYPES: { value: AlertType; labelKey: string }[] = [
  { value: 'PRICE_ABOVE', labelKey: 'alert_type_price_above' },
  { value: 'PRICE_BELOW', labelKey: 'alert_type_price_below' },
  { value: 'YIELD_ABOVE', labelKey: 'alert_type_yield_above' },
  { value: 'RSI_BELOW', labelKey: 'alert_type_rsi_below' },
  { value: 'RSI_ABOVE', labelKey: 'alert_type_rsi_above' },
]

export function Alerts() {
  const { t } = useLanguage()
  const { data: alerts = [], isLoading } = useAlerts()
  const createAlert = useCreateAlert()
  const deleteAlert = useDeleteAlert()

  const [showForm, setShowForm] = useState(false)
  const [ticker, setTicker] = useState('')
  const [alertType, setAlertType] = useState<AlertType>('PRICE_ABOVE')
  const [threshold, setThreshold] = useState('')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const th = parseFloat(threshold)
    if (!ticker.trim() || isNaN(th) || th <= 0) {
      setFormError('Ticker и Threshold са задължителни.')
      return
    }
    createAlert.mutate(
      { ticker: ticker.toUpperCase(), alert_type: alertType, threshold: th, note: note || undefined },
      {
        onSuccess: () => {
          setTicker(''); setThreshold(''); setNote(''); setShowForm(false)
        },
        onError: () => setFormError('Грешка при запис. Провери данните.'),
      }
    )
  }

  return (
    <div className="p-8 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell size={22} className="text-yellow-400" />
          <h1 className="text-2xl font-bold text-zinc-100">{t('alerts_title')}</h1>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Plus size={15} />
          {t('alerts_add')}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('alerts_ticker')}</label>
              <input
                value={ticker}
                onChange={e => setTicker(e.target.value.toUpperCase())}
                maxLength={20}
                placeholder="AAPL"
                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('alerts_type')}</label>
              <select
                value={alertType}
                onChange={e => setAlertType(e.target.value as AlertType)}
                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              >
                {ALERT_TYPES.map(a => (
                  <option key={a.value} value={a.value}>{t(a.labelKey)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('alerts_threshold')}</label>
              <input
                type="number"
                value={threshold}
                onChange={e => setThreshold(e.target.value)}
                step="any"
                min="0.0001"
                placeholder="150.00"
                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('alerts_note')}</label>
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                maxLength={200}
                placeholder="..."
                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          {formError && <p className="text-red-400 text-xs">{formError}</p>}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Отказ
            </button>
            <button
              type="submit"
              disabled={createAlert.isPending}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {createAlert.isPending ? '…' : t('alerts_save')}
            </button>
          </div>
        </form>
      )}

      {/* Alerts list */}
      {isLoading ? (
        <div className="text-center text-zinc-500 py-8">{t('loading')}…</div>
      ) : alerts.length === 0 ? (
        <div className="text-center text-zinc-600 py-12">
          <Bell size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('alerts_no_alerts')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map(alert => (
            <div
              key={alert.id}
              className={`flex items-center justify-between px-5 py-3.5 rounded-xl border transition-colors ${
                alert.triggered_at
                  ? 'bg-zinc-900/50 border-zinc-800 opacity-60'
                  : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-2 h-2 rounded-full ${alert.is_active ? 'bg-green-400' : 'bg-zinc-600'}`} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-zinc-100 text-sm">{alert.ticker}</span>
                    <span className="text-xs text-zinc-500">{ALERT_TYPES.find(a => a.value === alert.alert_type) ? t(ALERT_TYPES.find(a => a.value === alert.alert_type)!.labelKey) : alert.alert_type}</span>
                    <span className="text-xs font-mono text-zinc-300">{alert.threshold}</span>
                  </div>
                  {alert.note && <p className="text-xs text-zinc-500 mt-0.5">{alert.note}</p>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {alert.triggered_at ? (
                  <span className="text-xs text-yellow-500 bg-yellow-900/20 px-2 py-0.5 rounded border border-yellow-800">
                    {t('alerts_triggered')}: {new Date(alert.triggered_at).toLocaleDateString()}
                  </span>
                ) : (
                  <span className="text-xs text-green-500">{t('alerts_active')}</span>
                )}
                <button
                  onClick={() => deleteAlert.mutate(alert.id)}
                  disabled={deleteAlert.isPending}
                  className="text-zinc-600 hover:text-red-400 transition-colors"
                  aria-label="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
