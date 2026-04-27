import { useCallback, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, CheckCircle, XCircle, Clock, Info } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import { uploadImportXlsx, uploadImportCsv, getImportHistory } from '@/api/client'
import type { ImportResult, ImportRun } from '@/types'

type UploadState = 'idle' | 'uploading' | 'success' | 'error'
type BrokerKey = 'etoro' | 'trading212' | 'ibkr' | 'revolut'

const BROKERS: { key: BrokerKey; labelKey: string; ext: string; accept: string }[] = [
  { key: 'etoro',      labelKey: 'import_broker_etoro',   ext: 'XLSX', accept: '.xlsx' },
  { key: 'trading212', labelKey: 'import_broker_t212',    ext: 'CSV',  accept: '.csv'  },
  { key: 'ibkr',       labelKey: 'import_broker_ibkr',    ext: 'CSV',  accept: '.csv'  },
  { key: 'revolut',    labelKey: 'import_broker_revolut', ext: 'CSV',  accept: '.csv'  },
]

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('bg-BG', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function Import() {
  const { t } = useLanguage()
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [broker, setBroker] = useState<BrokerKey>('etoro')
  const [dragging, setDragging] = useState(false)
  const [state, setState] = useState<UploadState>('idle')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')

  const currentBroker = BROKERS.find(b => b.key === broker)!

  const { data: history = [], refetch: refetchHistory } = useQuery<ImportRun[]>({
    queryKey: ['import', 'history'],
    queryFn: getImportHistory,
    refetchOnWindowFocus: false,
  })

  const handleFile = useCallback(async (file: File) => {
    const isXlsx = file.name.toLowerCase().endsWith('.xlsx')
    const isCsv = file.name.toLowerCase().endsWith('.csv')
    const expectXlsx = broker === 'etoro'

    if (expectXlsx && !isXlsx) {
      setErrorMsg(t('import_only_xlsx'))
      setState('error')
      return
    }
    if (!expectXlsx && !isCsv) {
      setErrorMsg(t('import_only_csv'))
      setState('error')
      return
    }

    setState('uploading')
    setErrorMsg('')
    setResult(null)
    try {
      const res = broker === 'etoro'
        ? await uploadImportXlsx(file)
        : await uploadImportCsv(file, broker)
      setResult(res)
      setState('success')
      qc.invalidateQueries({ queryKey: ['portfolio'] })
      qc.invalidateQueries({ queryKey: ['dividends'] })
      refetchHistory()
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed')
      setState('error')
      refetchHistory()
    }
  }, [broker, t, qc, refetchHistory])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold">{t('import_title')}</h1>

      {/* Info tip */}
      <div className="flex gap-2 bg-blue-950/50 border border-blue-800 rounded-lg p-3 text-sm text-blue-300">
        <Info size={16} className="shrink-0 mt-0.5" />
        <span>{t('import_full_history_tip')}</span>
      </div>

      {/* Broker selector */}
      <div>
        <p className="text-sm text-zinc-400 mb-2">{t('import_select_broker')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {BROKERS.map(b => (
            <button
              key={b.key}
              onClick={() => { setBroker(b.key); setState('idle'); setResult(null); setErrorMsg('') }}
              className={`py-2.5 px-3 rounded-lg text-sm font-medium border transition-colors text-left
                ${broker === b.key
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-zinc-800/50 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800'
                }`}
            >
              <div className="font-semibold">{b.key === 'etoro' ? 'eToro' : b.key === 'trading212' ? 'Trading 212' : b.key === 'ibkr' ? 'IBKR' : 'Revolut'}</div>
              <div className={`text-xs mt-0.5 ${broker === b.key ? 'text-blue-200' : 'text-zinc-500'}`}>{b.ext}</div>
            </button>
          ))}
        </div>
      </div>

      {/* T212 How-to guide */}
      {broker === 'trading212' && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 space-y-2">
          <p className="text-sm font-medium text-zinc-300">{t('import_t212_guide_title')}</p>
          <ol className="space-y-1.5 text-sm text-zinc-400 list-none">
            {(['import_t212_guide_1', 'import_t212_guide_2', 'import_t212_guide_3'] as const).map((key, i) => (
              <li key={key} className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-900/50 text-blue-400 text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                <span>{t(key)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-4 cursor-pointer transition-colors
          ${dragging ? 'border-blue-500 bg-blue-950/30' : 'border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900/50'}`}
      >
        <Upload size={36} className="text-zinc-500" />
        <p className="text-zinc-400 text-sm text-center">
          {broker === 'etoro' ? t('import_drop_hint_xlsx') : t('import_drop_hint_csv')}
        </p>
        <p className="text-zinc-600 text-xs">{t('import_or')}</p>
        <button
          type="button"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
          onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}
        >
          {t('import_browse')}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={currentBroker.accept}
          className="hidden"
          onChange={onInputChange}
        />
      </div>

      {/* Upload states */}
      {state === 'uploading' && (
        <div className="flex items-center gap-3 bg-zinc-800 rounded-lg p-4 text-zinc-300">
          <Clock size={20} className="animate-spin text-blue-400" />
          <span>{t('import_uploading')}</span>
        </div>
      )}

      {state === 'success' && result && (
        <div className="bg-green-950/50 border border-green-800 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 text-green-400 font-semibold">
            <CheckCircle size={20} />
            <span>{t('import_success')} — {result.filename}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { val: result.rows_processed, label: t('import_rows') },
              { val: result.dividends_added, label: t('import_divs') },
              { val: result.transactions_added, label: t('import_txs') },
              { val: result.positions_updated, label: t('import_pos') },
            ].map(({ val, label }) => (
              <div key={label} className="bg-zinc-800 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-white">{val}</div>
                <div className="text-xs text-zinc-400 mt-1">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {state === 'error' && (
        <div className="flex items-start gap-3 bg-red-950/50 border border-red-800 rounded-lg p-4 text-red-300">
          <XCircle size={20} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">{t('import_error')}</div>
            {errorMsg && <div className="text-sm mt-1 text-red-400">{errorMsg}</div>}
          </div>
        </div>
      )}

      {/* History */}
      <div>
        <h2 className="text-lg font-semibold mb-3">{t('import_history_title')}</h2>
        {history.length === 0 ? (
          <p className="text-zinc-500 text-sm">{t('import_no_history')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400 text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">{t('import_col_date')}</th>
                  <th className="px-4 py-3 text-left">{t('import_col_file')}</th>
                  <th className="px-4 py-3 text-right">{t('import_col_divs')}</th>
                  <th className="px-4 py-3 text-right">{t('import_col_txs')}</th>
                  <th className="px-4 py-3 text-right">{t('import_col_pos')}</th>
                  <th className="px-4 py-3 text-center">{t('import_col_status')}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((run) => (
                  <tr key={run.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">{formatDate(run.imported_at)}</td>
                    <td className="px-4 py-3 text-zinc-300 max-w-[180px] truncate" title={run.filename}>{run.filename}</td>
                    <td className="px-4 py-3 text-right text-zinc-300">{run.dividends_added}</td>
                    <td className="px-4 py-3 text-right text-zinc-300">{run.transactions_added}</td>
                    <td className="px-4 py-3 text-right text-zinc-300">{run.positions_updated}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={run.status} t={t} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status, t }: { status: ImportRun['status']; t: (k: string) => string }) {
  if (status === 'success') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-900/50 text-green-400 border border-green-800">
      <CheckCircle size={10} /> {t('import_status_success')}
    </span>
  )
  if (status === 'error') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-900/50 text-red-400 border border-red-800">
      <XCircle size={10} /> {t('import_status_error')}
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-zinc-700 text-zinc-400 border border-zinc-600">
      <Clock size={10} /> {t('import_status_pending')}
    </span>
  )
}
