import { useState } from 'react'
import { Trash2, Plus, ExternalLink } from 'lucide-react'
import { useWatchlist, useAddWatchlistItem, useDeleteWatchlistItem } from '@/hooks'
import { useCurrency } from '@/contexts/CurrencyContext'
import type { WatchlistItem } from '@/types'

function ChangeChip({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-zinc-600">—</span>
  const color = pct >= 0 ? 'text-green-400' : 'text-red-400'
  return <span className={color}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</span>
}

function DistChip({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-zinc-600">—</span>
  const color = pct <= 0 ? 'text-green-400' : 'text-zinc-400'
  const label = pct <= 0 ? `${pct.toFixed(1)}% above target` : `${pct.toFixed(1)}% to target`
  return <span className={`text-xs ${color}`}>{label}</span>
}

export function Watchlist() {
  const { data: items = [], isLoading } = useWatchlist()
  const addMutation = useAddWatchlistItem()
  const deleteMutation = useDeleteWatchlistItem()
  const { fmt } = useCurrency()

  const [inputTicker, setInputTicker] = useState('')
  const [inputTarget, setInputTarget] = useState('')
  const [inputNote, setInputNote] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  const handleAdd = async () => {
    const ticker = inputTicker.trim().toUpperCase()
    if (!ticker) return
    setAddError(null)
    try {
      await addMutation.mutateAsync({
        ticker,
        targetPrice: inputTarget ? parseFloat(inputTarget) : undefined,
        note: inputNote.trim() || undefined,
      })
      setInputTicker('')
      setInputTarget('')
      setInputNote('')
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : 'Failed to add')
    }
  }

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <h1 className="text-2xl font-bold text-zinc-100">Watchlist</h1>

      {/* Add form */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-zinc-400 mb-3 uppercase tracking-wide">Add Ticker</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Ticker *</label>
            <input
              className="bg-zinc-800 border border-zinc-700 text-zinc-100 rounded-md px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-1 focus:ring-blue-500 uppercase"
              placeholder="AAPL"
              value={inputTicker}
              onChange={e => setInputTicker(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Target price (USD)</label>
            <input
              className="bg-zinc-800 border border-zinc-700 text-zinc-100 rounded-md px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="150.00"
              type="number"
              step="0.01"
              min="0"
              value={inputTarget}
              onChange={e => setInputTarget(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <label className="text-xs text-zinc-500">Note</label>
            <input
              className="bg-zinc-800 border border-zinc-700 text-zinc-100 rounded-md px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Why watching..."
              value={inputNote}
              onChange={e => setInputNote(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={addMutation.isPending || !inputTicker.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-md transition-colors"
          >
            <Plus size={14} />
            {addMutation.isPending ? 'Adding…' : 'Add'}
          </button>
        </div>
        {addError && <p className="text-red-400 text-xs mt-2">{addError}</p>}
      </div>

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {isLoading ? (
          <p className="text-zinc-500 text-sm p-6">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-zinc-500 text-sm p-6">Watchlist is empty. Add a ticker above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 text-left border-b border-zinc-800 bg-zinc-900/80">
                  <th className="px-4 py-3 font-medium">Ticker</th>
                  <th className="px-4 py-3 font-medium text-right">Price</th>
                  <th className="px-4 py-3 font-medium text-right">Day %</th>
                  <th className="px-4 py-3 font-medium text-right">Target</th>
                  <th className="px-4 py-3 font-medium">Distance</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                  <th className="px-4 py-3 font-medium text-right">Added</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {(items as WatchlistItem[]).map(item => (
                  <tr
                    key={item.id}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/40 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-blue-400">{item.ticker}</span>
                        <a
                          href={`/analysis/${item.ticker}`}
                          className="text-zinc-600 hover:text-zinc-400 transition-colors"
                          title="Open analysis"
                        >
                          <ExternalLink size={12} />
                        </a>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {item.current_price != null ? fmt(item.current_price) : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ChangeChip pct={item.change_pct_day} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {item.target_price != null ? fmt(item.target_price) : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <DistChip pct={item.dist_to_target_pct} />
                    </td>
                    <td className="px-4 py-3 text-zinc-400 max-w-xs truncate">
                      {item.note ?? <span className="text-zinc-700">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-600 text-xs">
                      {item.added_at.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => deleteMutation.mutate(item.id)}
                        disabled={deleteMutation.isPending}
                        className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                        title="Remove"
                      >
                        <Trash2 size={14} />
                      </button>
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
