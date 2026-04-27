// All TypeScript types matching backend Pydantic schemas

export interface PortfolioSummary {
  total_invested_usd: number
  current_value_usd: number
  total_dividends_usd: number
  unrealized_pnl_usd: number
  unrealized_pnl_pct: number
  total_return_usd: number
  total_return_pct: number
  monthly_income_usd: number
  annual_income_usd: number
  yield_on_cost_pct: number
  positions_count: number
  last_updated: string | null
}

export interface Position {
  id: number
  ticker: string
  instrument_name: string
  instrument_type: 'stock' | 'etf' | 'cfd'
  units: number
  open_rate: number
  open_date: string | null
  current_price: number | null
  current_value: number | null
  unrealized_pnl: number | null
  unrealized_pnl_pct: number | null
  change_pct_day: number | null
  total_dividends: number | null
}

export interface DividendsSummary {
  total_usd: number
  ttm_usd: number
  monthly_avg_usd: number
  by_ticker: TickerDividendRow[]
}

export interface TickerDividendRow {
  ticker: string
  total_usd: number
  payments_count: number
  last_payment: string | null
  yield_on_cost_pct: number
}

export interface MonthlyDividends {
  tickers: string[]
  data: Record<string, number | string>[]  // { month: "2025-11", QYLD: 101.09, ... }
}

export interface Candle {
  time: number   // Unix timestamp
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface SmaPoint {
  time: number
  value: number
}

export interface ChartData {
  ticker: string
  period: string
  candles: Candle[]
  sma: { sma50: SmaPoint[]; sma200: SmaPoint[] }
  data_from: string | null
  data_to: string | null
  candles_count: number
}

export type ChartPeriod = '1W' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'MAX'

export interface AiAnalysis {
  ticker: string
  summary: string
  price_targets?: {
    buy_below: number | null
    hold_range_low: number | null
    hold_range_high: number | null
    sell_above: number | null
    current_zone: 'BUY' | 'HOLD' | 'SELL' | 'TRIM'
  }
  strengths: string[]
  risks: string[]
  dividend_outlook: string
  recommendation: 'BUY' | 'HOLD' | 'SELL'
  recommendation_reason: string
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  cached: boolean
  model?: string
}

export interface TickerSearchResult {
  symbol: string
  name: string
  exchange: string
  type: string
}

export interface TickerInfo {
  ticker: string
  name: string
  currency: string
  exchange: string
  sector: string
  industry: string
  current_price: number | null
  prev_close: number | null
  change_pct_day: number | null
  high_52w: number | null
  low_52w: number | null
  market_cap: number | null
  description: string
  found: boolean
}

export interface ImportResult {
  ok: boolean
  filename: string
  rows_processed: number
  dividends_added: number
  transactions_added: number
  positions_updated: number
}

export interface ImportRun {
  id: number
  filename: string
  status: 'success' | 'error' | 'pending'
  rows_processed: number
  dividends_added: number
  transactions_added: number
  positions_updated: number
  error_message: string | null
  imported_at: string | null
}

export interface Transaction {
  id: number
  etoro_id: string | null
  ticker: string
  action: 'BUY' | 'SELL'
  units: number
  price: number
  amount_usd: number
  transaction_date: string
  total_dividends_since: number
}

export interface TransactionCreate {
  ticker: string
  action: 'BUY' | 'SELL'
  units: number
  price: number
  transaction_date: string
}

export interface XirrResult {
  xirr_pct: number | null
  cash_flows: number
  current_value_usd: number
}

export interface DividendCalendarEntry {
  ticker: string
  instrument_name: string
  ex_div_date: string
  days_to_ex_div: number
  dividend_rate_usd: number | null
  dividend_frequency: number | null
  dividend_yield_pct: number | null
  payout_ratio_pct: number | null
  units: number
  est_payment_usd: number | null
}

export interface CashFlowMonth {
  month: string           // "2025-03"
  deposits_usd: number
  dividends_usd: number
}

export interface CashFlowSummary {
  total_deposited_usd: number
  total_dividends_usd: number
  avg_monthly_deposit_usd: number
  self_sufficiency_pct: number
}

export interface CashFlowData {
  monthly: CashFlowMonth[]
  summary: CashFlowSummary
}

export interface NewsItem {
  title: string
  date: string
  url: string
  source: string
}

export interface PositionTarget {
  ticker: string
  current_zone: 'BUY' | 'HOLD' | 'SELL' | 'TRIM' | null
  buy_below: number | null
  hold_range_low: number | null
  hold_range_high: number | null
  sell_above: number | null
}

export interface BenchmarkData {
  period: string
  portfolio_return_pct: number | null
  sp500_return_pct: number | null
  vti_return_pct: number | null
  outperformance_pct: number | null
  start_date: string
  end_date: string
}

export type AlertType = 'PRICE_ABOVE' | 'PRICE_BELOW' | 'YIELD_ABOVE' | 'RSI_BELOW' | 'RSI_ABOVE'

export interface RebalanceSuggestion {
  ticker: string
  instrument_name: string
  current_zone: 'BUY' | 'HOLD' | 'SELL' | 'TRIM' | null
  action: 'BUY' | 'HOLD' | 'REDUCE' | 'NO_DATA'
  reason: string
  current_price: number
  units: number
  current_value: number
  weight_pct: number | null
  buy_below: number | null
  sell_above: number | null
}

export interface WhatIfResult {
  ticker: string
  ticker_name: string
  units_added: number
  current_price: number | null
  cost_to_add: number | null
  annual_div_rate: number | null
  current_value: number
  current_monthly_income: number
  current_yield_pct: number
  ticker_weight_before: number
  new_value: number
  new_monthly_income: number
  new_yield_pct: number
  ticker_weight_after: number
  top_concentration_after: number
  delta_value: number
  delta_monthly_income: number
  delta_yield_pct: number
}

export interface Alert {
  id: number
  ticker: string
  alert_type: AlertType
  threshold: number
  note: string | null
  is_active: boolean
  triggered_at: string | null
  created_at: string
}

export interface AlertCreate {
  ticker: string
  alert_type: AlertType
  threshold: number
  note?: string
}

export interface TaxReportRow {
  date: string
  ticker: string
  country: string
  net_usd: number
  gross_usd: number
  withholding_usd: number
  withholding_rate_pct: number
  eur_rate: number
  net_eur: number
  gross_eur: number
  withholding_eur: number
  bg_tax_eur: number
  additional_bg_tax_eur: number
}

export interface TaxCountrySummary {
  country: string
  gross_eur: number
  withholding_eur: number
  net_eur: number
  bg_tax_eur: number
  additional_bg_tax_eur: number
  count: number
  withholding_rate_pct: number
}

export interface TaxReport {
  year: number
  bg_tax_rate_pct: number
  eur_rates_source: string
  dividends: TaxReportRow[]
  summary: {
    total_gross_eur: number
    total_withholding_eur: number
    total_net_eur: number
    total_bg_tax_eur: number
    total_additional_bg_tax_eur: number
    by_country: TaxCountrySummary[]
  }
  capital_gains: CapitalGainRow[]
  capital_gains_summary: {
    total_gain_loss_eur: number
    total_gain_loss_usd: number
    transactions_count: number
    profitable_count: number
    loss_count: number
  }
}

export interface CapitalGainRow {
  ticker: string
  units_sold: number
  acq_date: string
  sell_date: string
  acq_price_usd: number
  sell_price_usd: number
  acq_cost_usd: number
  proceeds_usd: number
  gain_loss_usd: number
  acq_eur_rate: number
  sell_eur_rate: number
  acq_cost_eur: number
  proceeds_eur: number
  gain_loss_eur: number
}

export interface HistoryPoint {
  date: string       // "2025-04-01"
  value_usd: number
}

export interface WatchlistItem {
  id: number
  ticker: string
  name: string
  target_price: number | null
  note: string | null
  added_at: string
  current_price: number | null
  change_pct_day: number | null
  dist_to_target_pct: number | null
}

