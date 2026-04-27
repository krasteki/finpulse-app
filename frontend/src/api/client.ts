// API client — all calls go through Vite proxy /api → http://localhost:8000/api
import type {
  PortfolioSummary, Position,
  DividendsSummary, MonthlyDividends,
  ChartData, ChartPeriod, AiAnalysis, TickerInfo, TickerSearchResult,
  ImportResult, ImportRun, Transaction, TransactionCreate, XirrResult, DividendCalendarEntry, CashFlowData,
  NewsItem, PositionTarget, BenchmarkData, Alert, AlertCreate, TaxReport,
  RebalanceSuggestion, WhatIfResult, HistoryPoint, WatchlistItem,
} from '@/types'

const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`)
  return res.json()
}

// Portfolio
export const getPortfolioSummary = () =>
  get<PortfolioSummary>('/portfolio/summary')

export const getPositions = () =>
  get<Position[]>('/portfolio/positions')

// Dividends
export const getDividendsSummary = () =>
  get<DividendsSummary>('/dividends/summary')

export const getMonthlyDividends = (months = 36) =>
  get<MonthlyDividends>(`/dividends/monthly?months=${months}`)

// Charts
export const getChartData = (ticker: string, period: ChartPeriod = '1Y') =>
  get<ChartData>(`/charts/${ticker}?period=${period}`)

// AI Analysis
export const getAiAnalysis = (ticker: string, lang = 'en') =>
  get<AiAnalysis>(`/ai/analysis/${ticker}?lang=${lang}`)

// Ticker live info (works for any ticker via yfinance)
export const getTickerInfo = (ticker: string) =>
  get<TickerInfo>(`/ticker/info/${ticker}`)

// Ticker search autocomplete
export const searchTickers = (q: string) =>
  get<TickerSearchResult[]>(`/ticker/search?q=${encodeURIComponent(q)}`)

// Import
export async function uploadImportXlsx(file: File) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/import/xlsx`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Upload failed')
  }
  return res.json() as Promise<ImportResult>
}

export async function uploadImportCsv(file: File, broker: string) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/import/csv?broker=${encodeURIComponent(broker)}`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Upload failed')
  }
  return res.json() as Promise<ImportResult>
}

export const getImportHistory = () =>
  get<ImportRun[]>('/import/history')

export const getDividendCalendar = () =>
  get<DividendCalendarEntry[]>('/portfolio/calendar')

// Transactions (purchase history for tax)
export const getTransactions = (ticker?: string) =>
  get<Transaction[]>(`/portfolio/transactions${ticker ? `?ticker=${encodeURIComponent(ticker)}` : ''}`)

// XIRR
export const getXirr = () =>
  get<XirrResult>('/portfolio/xirr')

// Cash Flow (monthly deposits vs dividends)
export const getCashFlow = () =>
  get<CashFlowData>('/portfolio/cashflow')

// Recent news for any ticker
export const getTickerNews = (ticker: string) =>
  get<NewsItem[]>(`/ticker/news/${encodeURIComponent(ticker)}`)

// AI-derived price targets for portfolio positions (from cache)
export const getPortfolioTargets = () =>
  get<PositionTarget[]>('/portfolio/targets')

// Benchmark comparison
export const getBenchmark = (period = '1Y') =>
  get<BenchmarkData>(`/portfolio/benchmark?period=${period}`)

// Alerts CRUD
export const getAlerts = () =>
  get<Alert[]>('/alerts')

export const createAlert = (data: AlertCreate): Promise<Alert> => {
  return fetch(`${BASE}/alerts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(res => {
    if (!res.ok) throw new Error(`API /alerts → ${res.status}`)
    return res.json()
  })
}

export const deleteAlert = (id: number): Promise<void> => {
  return fetch(`${BASE}/alerts/${id}`, { method: 'DELETE' }).then(res => {
    if (!res.ok) throw new Error(`API /alerts/${id} → ${res.status}`)
  })
}

// Tax report (Приложение 8)
export const getTaxReport = (year: number) =>
  get<TaxReport>(`/tax/report?year=${year}`)

// Rebalancing suggestions (based on AI zone cache)
export const getRebalanceSuggestions = () =>
  get<RebalanceSuggestion[]>('/portfolio/rebalance')

// What-If simulator: add N units of ticker → new portfolio metrics
export const getWhatIf = (ticker: string, units: number) =>
  get<WhatIfResult>(`/portfolio/whatif?ticker=${encodeURIComponent(ticker)}&units=${units}`)

// Portfolio daily history
export const getPortfolioHistory = (days = 365) =>
  get<HistoryPoint[]>(`/portfolio/history?days=${days}`)

// Watchlist
export const getWatchlist = () =>
  get<WatchlistItem[]>('/watchlist')

export const addWatchlistItem = (ticker: string, targetPrice?: number, note?: string): Promise<{ id: number; ticker: string; added: boolean }> =>
  fetch(`${BASE}/watchlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker, target_price: targetPrice ?? null, note: note ?? null }),
  }).then(res => {
    if (!res.ok) return res.json().then(e => { throw new Error(e.detail ?? 'Failed') })
    return res.json()
  })

export const deleteWatchlistItem = (id: number): Promise<void> =>
  fetch(`${BASE}/watchlist/${id}`, { method: 'DELETE' }).then(res => {
    if (!res.ok) throw new Error(`DELETE /watchlist/${id} → ${res.status}`)
  })

// Manual transaction CRUD
export const addTransaction = (data: TransactionCreate): Promise<Transaction> =>
  fetch(`${BASE}/portfolio/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(res => {
    if (!res.ok) return res.json().then(e => { throw new Error(e.detail ?? 'Failed') })
    return res.json()
  })

export const deleteTransaction = (id: number): Promise<void> =>
  fetch(`${BASE}/portfolio/transactions/${id}`, { method: 'DELETE' }).then(res => {
    if (!res.ok) throw new Error(`DELETE /portfolio/transactions/${id} → ${res.status}`)
  })
