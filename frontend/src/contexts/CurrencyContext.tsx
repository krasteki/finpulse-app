import React, { createContext, useContext, useState, useEffect } from 'react'

export type Currency = 'USD' | 'EUR'

interface CurrencyContextType {
  currency: Currency
  setCurrency: (c: Currency) => void
  eurUsdRate: number
  fmt: (usdValue: number | null | undefined, decimals?: number) => string
  fmtCompact: (usdValue: number | null | undefined) => string
}

const FALLBACK_RATE = 1.09

const CurrencyContext = createContext<CurrencyContextType>({
  currency: 'USD',
  setCurrency: () => {},
  eurUsdRate: FALLBACK_RATE,
  fmt: (n, d = 2) => (n == null ? '—' : `$${n.toFixed(d)}`),
  fmtCompact: (n) => (n == null ? '—' : `$${n}`),
})

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>(() => {
    return (localStorage.getItem('fp_currency') as Currency) ?? 'USD'
  })
  const [eurUsdRate, setEurUsdRate] = useState<number>(FALLBACK_RATE)

  useEffect(() => {
    // EURUSD=X gives "1 EUR = ? USD", e.g. 1.09
    fetch(`/api/ticker/info/${encodeURIComponent('EURUSD=X')}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.current_price && data.current_price > 0.5 && data.current_price < 3) {
          setEurUsdRate(data.current_price)
        }
      })
      .catch(() => {})
  }, [])

  const setCurrency = (c: Currency) => {
    setCurrencyState(c)
    localStorage.setItem('fp_currency', c)
  }

  const convert = (usdValue: number): number =>
    currency === 'EUR' ? usdValue / eurUsdRate : usdValue

  const symbol = currency === 'EUR' ? '€' : '$'

  const fmt = (n: number | null | undefined, d = 2): string => {
    if (n == null) return '—'
    const v = convert(n)
    return `${symbol}${v.toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })}`
  }

  const fmtCompact = (n: number | null | undefined): string => {
    if (n == null) return '—'
    const v = convert(n)
    if (v >= 1e12) return `${symbol}${(v / 1e12).toFixed(2)}T`
    if (v >= 1e9) return `${symbol}${(v / 1e9).toFixed(2)}B`
    if (v >= 1e6) return `${symbol}${(v / 1e6).toFixed(1)}M`
    return `${symbol}${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  }

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, eurUsdRate, fmt, fmtCompact }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export const useCurrency = () => useContext(CurrencyContext)
