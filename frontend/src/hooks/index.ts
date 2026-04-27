import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  getPortfolioSummary, getPositions,
  getDividendsSummary, getMonthlyDividends,
  getChartData, getAiAnalysis, getTickerInfo,
  getTransactions, getXirr, getDividendCalendar, getCashFlow,
  getTickerNews, getPortfolioTargets, getBenchmark,
  getAlerts, createAlert, deleteAlert, getTaxReport,
  getRebalanceSuggestions, getWhatIf,
  getPortfolioHistory, getWatchlist, addWatchlistItem, deleteWatchlistItem,
  addTransaction, deleteTransaction,
} from '@/api/client'
import type { ChartPeriod, AlertCreate, TransactionCreate } from '@/types'

// ─── Query Keys ─────────────────────────────────────────────────────────────
export const KEYS = {
  portfolioSummary: ['portfolio', 'summary'] as const,
  positions: ['portfolio', 'positions'] as const,
  transactions: (ticker?: string) => ['portfolio', 'transactions', ticker ?? 'all'] as const,
  xirr: ['portfolio', 'xirr'] as const,
  dividendCalendar: ['portfolio', 'calendar'] as const,
  cashFlow: ['portfolio', 'cashflow'] as const,
  portfolioTargets: ['portfolio', 'targets'] as const,
  benchmark: (period: string) => ['portfolio', 'benchmark', period] as const,
  dividendsSummary: ['dividends', 'summary'] as const,
  monthlyDividends: (months: number) => ['dividends', 'monthly', months] as const,
  chart: (ticker: string, period: ChartPeriod) => ['chart', ticker, period] as const,
  aiAnalysis: (ticker: string, lang: string) => ['ai', 'analysis', ticker, lang] as const,
  tickerInfo: (ticker: string) => ['ticker', 'info', ticker] as const,
  tickerNews: (ticker: string) => ['ticker', 'news', ticker] as const,
  alerts: ['alerts'] as const,
}

// ─── Hooks ───────────────────────────────────────────────────────────────────
export function usePortfolioSummary() {
  return useQuery({
    queryKey: KEYS.portfolioSummary,
    queryFn: getPortfolioSummary,
    staleTime: 1000 * 60,        // 1 minute
    refetchInterval: 1000 * 60,  // auto-refresh every 1 min
  })
}

export function usePositions() {
  return useQuery({
    queryKey: KEYS.positions,
    queryFn: getPositions,
    staleTime: 1000 * 60,
    refetchInterval: 1000 * 60,
  })
}

export function useDividendsSummary() {
  return useQuery({
    queryKey: KEYS.dividendsSummary,
    queryFn: getDividendsSummary,
    staleTime: 1000 * 60 * 10,
  })
}

export function useMonthlyDividends(months = 36) {
  return useQuery({
    queryKey: KEYS.monthlyDividends(months),
    queryFn: () => getMonthlyDividends(months),
    staleTime: 1000 * 60 * 10,
  })
}

export function useChartData(ticker: string, period: ChartPeriod) {
  return useQuery({
    queryKey: KEYS.chart(ticker, period),
    queryFn: () => getChartData(ticker, period),
    enabled: !!ticker,
    staleTime: 1000 * 60 * 60,  // 1 hour (OHLCV doesn't change during day)
  })
}

// ─── Prefetch on hover ───────────────────────────────────────────────────────
export function usePrefetchChart() {
  const queryClient = useQueryClient()
  return (ticker: string) => {
    queryClient.prefetchQuery({
      queryKey: KEYS.chart(ticker, '1Y'),
      queryFn: () => getChartData(ticker, '1Y'),
      staleTime: 1000 * 60 * 60,
    })
  }
}

export function useAiAnalysis(ticker: string, enabled: boolean, lang = 'en') {
  return useQuery({
    queryKey: KEYS.aiAnalysis(ticker, lang),
    queryFn: () => getAiAnalysis(ticker, lang),
    enabled: !!ticker && enabled,
    staleTime: 1000 * 60 * 60 * 6,
    retry: false,
  })
}

export function useTickerInfo(ticker: string) {
  return useQuery({
    queryKey: KEYS.tickerInfo(ticker),
    queryFn: () => getTickerInfo(ticker),
    enabled: !!ticker,
    staleTime: 1000 * 60 * 5,   // 5 min — live price
    retry: false,
  })
}

export function useTransactions(ticker?: string) {
  return useQuery({
    queryKey: KEYS.transactions(ticker),
    queryFn: () => getTransactions(ticker),
    staleTime: 1000 * 60 * 5,
  })
}

export function useXirr() {
  return useQuery({
    queryKey: KEYS.xirr,
    queryFn: getXirr,
    staleTime: 1000 * 60 * 10,
  })
}

export function useDividendCalendar() {
  return useQuery({
    queryKey: KEYS.dividendCalendar,
    queryFn: getDividendCalendar,
    staleTime: 1000 * 60 * 60 * 4,  // 4 hours — ex-div dates don't change often
  })
}

export function useCashFlow() {
  return useQuery({
    queryKey: KEYS.cashFlow,
    queryFn: getCashFlow,
    staleTime: 1000 * 60 * 60,  // 1 hour
  })
}

export function useTickerNews(ticker: string) {
  return useQuery({
    queryKey: KEYS.tickerNews(ticker),
    queryFn: () => getTickerNews(ticker),
    enabled: !!ticker,
    staleTime: 1000 * 60 * 30,  // 30 min — news doesn't change that fast
    retry: false,
  })
}

export function usePortfolioTargets() {
  return useQuery({
    queryKey: KEYS.portfolioTargets,
    queryFn: getPortfolioTargets,
    staleTime: 1000 * 60 * 60 * 6,  // 6 hours — same as AI cache
  })
}

export function useBenchmark(period = '1Y') {
  return useQuery({
    queryKey: KEYS.benchmark(period),
    queryFn: () => getBenchmark(period),
    staleTime: 1000 * 60 * 60,  // 1 hour
    retry: false,
  })
}

export function useAlerts() {
  return useQuery({
    queryKey: KEYS.alerts,
    queryFn: getAlerts,
    staleTime: 1000 * 60 * 5,
  })
}

export function useCreateAlert() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: AlertCreate) => createAlert(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.alerts }),
  })
}

export function useDeleteAlert() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteAlert(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.alerts }),
  })
}

export function useTaxReport(year: number) {
  return useQuery({
    queryKey: ['tax', 'report', year],
    queryFn: () => getTaxReport(year),
    staleTime: 30 * 60 * 1000,  // 30 min — rates don't change often
    retry: false,
  })
}

export function useRebalanceSuggestions() {
  return useQuery({
    queryKey: ['portfolio', 'rebalance'],
    queryFn: getRebalanceSuggestions,
    staleTime: 1000 * 60 * 60 * 6,  // 6 hours — same as AI cache
    retry: false,
  })
}

export function useWhatIf(ticker: string, units: number, enabled: boolean) {
  return useQuery({
    queryKey: ['portfolio', 'whatif', ticker, units],
    queryFn: () => getWhatIf(ticker, units),
    enabled: enabled && !!ticker && units > 0,
    staleTime: 1000 * 60 * 5,
    retry: false,
  })
}

export function usePortfolioHistory(days = 365) {
  return useQuery({
    queryKey: ['portfolio', 'history', days],
    queryFn: () => getPortfolioHistory(days),
    staleTime: 1000 * 60 * 60,  // 1 hour
    retry: false,
  })
}

export function useWatchlist() {
  return useQuery({
    queryKey: ['watchlist'],
    queryFn: getWatchlist,
    staleTime: 1000 * 60 * 5,
  })
}

export function useAddWatchlistItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ticker, targetPrice, note }: { ticker: string; targetPrice?: number; note?: string }) =>
      addWatchlistItem(ticker, targetPrice, note),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['watchlist'] }),
  })
}

export function useDeleteWatchlistItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteWatchlistItem(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['watchlist'] }),
  })
}

export function useAddTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: TransactionCreate) => addTransaction(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio', 'transactions'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio', 'positions'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio', 'summary'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio', 'xirr'] })
    },
  })
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio', 'transactions'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio', 'positions'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio', 'summary'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio', 'xirr'] })
    },
  })
}
