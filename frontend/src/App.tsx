import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { LanguageProvider } from '@/contexts/LanguageContext'
import { CurrencyProvider } from '@/contexts/CurrencyContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { Layout } from '@/components/layout/Layout'
import { Dashboard } from '@/pages/Dashboard'
import { Portfolio } from '@/pages/Portfolio'
import { Dividends } from '@/pages/Dividends'
import { StockAnalysis } from '@/pages/StockAnalysis'
import { Analytics } from '@/pages/Analytics'
import { Import } from '@/pages/Import'
import { DividendCalendar } from '@/pages/DividendCalendar'
import { CashFlow } from '@/pages/CashFlow'
import { Alerts } from '@/pages/Alerts'
import { TaxReport } from '@/pages/TaxReport'
import { Planning } from '@/pages/Planning'
import { Watchlist } from '@/pages/Watchlist'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function App() {
  return (
    <ThemeProvider>
    <LanguageProvider>
      <CurrencyProvider>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/dividends" element={<Dividends />} />
            <Route path="/calendar" element={<DividendCalendar />} />
            <Route path="/cashflow" element={<CashFlow />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/analysis/:ticker" element={<StockAnalysis />} />
            <Route path="/import" element={<Import />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/tax" element={<TaxReport />} />
            <Route path="/planning" element={<Planning />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/settings" element={<div className="p-8 text-zinc-400">Settings — coming soon</div>} />
          </Route>
        </Routes>
      </BrowserRouter>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
      </CurrencyProvider>
    </LanguageProvider>
    </ThemeProvider>
  )
}

export default App
