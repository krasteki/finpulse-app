import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Briefcase, TrendingUp, DollarSign, Settings, BarChart2, Upload, CalendarDays, ArrowLeftRight, Bell, FileText, Menu, X, Lightbulb, Bookmark, Sun, Moon } from 'lucide-react'
import { useLanguage, type Lang } from '@/contexts/LanguageContext'
import { useCurrency, type Currency } from '@/contexts/CurrencyContext'
import { useTheme } from '@/contexts/ThemeContext'

const NAV_KEYS = [
  { to: '/', key: 'nav_dashboard', icon: LayoutDashboard },
  { to: '/portfolio', key: 'nav_portfolio', icon: Briefcase },
  { to: '/dividends', key: 'nav_dividends', icon: DollarSign },
  { to: '/calendar', key: 'nav_calendar', icon: CalendarDays },
  { to: '/cashflow', key: 'nav_cashflow', icon: ArrowLeftRight },
  { to: '/alerts', key: 'nav_alerts', icon: Bell },
  { to: '/tax', key: 'nav_tax', icon: FileText },
  { to: '/analytics', key: 'nav_analytics', icon: TrendingUp },
  { to: '/planning', key: 'nav_planning', icon: Lightbulb },
  { to: '/watchlist', key: 'nav_watchlist', icon: Bookmark },
  { to: '/analysis/QYLD', key: 'nav_stock_analysis', icon: BarChart2 },
  { to: '/import', key: 'nav_import', icon: Upload },
  { to: '/settings', key: 'nav_settings', icon: Settings },
]

function SidebarContent({ onNavClick, lang, setLang, currency, setCurrency, t }: {
  onNavClick?: () => void
  lang: Lang
  setLang: (l: Lang) => void
  currency: Currency
  setCurrency: (c: Currency) => void
  t: (k: string) => string
}) {
  const { theme, toggleTheme } = useTheme()
  return (
    <>
      <div className="px-3 mb-8">
        <span className="text-blue-400 font-bold text-xl tracking-tight">Fin</span>
        <span className="font-bold text-xl tracking-tight">Pulse</span>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_KEYS.map(({ to, key, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={onNavClick}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
              }`
            }
          >
            <Icon size={16} />
            {t(key)}
          </NavLink>
        ))}
      </nav>

      {/* Language + Currency toggles */}
      <div className="mt-auto px-1 space-y-3">
        <div className="flex items-center gap-1">
          <span className="text-xs text-zinc-600 mr-1">🌐</span>
          {(['en', 'bg'] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${
                lang === l ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {l === 'en' ? 'EN' : 'БГ'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-zinc-600 mr-1">💱</span>
          {(['USD', 'EUR'] as Currency[]).map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${
                currency === c ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {c === 'USD' ? '$ USD' : '€ EUR'}
            </button>
          ))}
        </div>
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-2 py-1.5 px-2 rounded text-xs font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
      </div>
    </>
  )
}

export function Layout() {
  const { lang, setLang, t } = useLanguage()
  const { currency, setCurrency } = useCurrency()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 border-r border-zinc-800 flex-col py-6 px-3">
        <SidebarContent lang={lang} setLang={setLang} currency={currency} setCurrency={setCurrency} t={t} />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside className={`fixed top-0 left-0 z-50 h-full w-56 bg-zinc-950 border-r border-zinc-800 flex flex-col py-6 px-3 transition-transform duration-200 md:hidden
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-3 text-zinc-400 hover:text-zinc-100 p-1"
        >
          <X size={20} />
        </button>
        <SidebarContent
          onNavClick={() => setMobileOpen(false)}
          lang={lang} setLang={setLang}
          currency={currency} setCurrency={setCurrency}
          t={t}
        />
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 md:hidden shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-zinc-400 hover:text-zinc-100 p-1"
          >
            <Menu size={22} />
          </button>
          <span className="text-blue-400 font-bold tracking-tight">Fin</span>
          <span className="font-bold tracking-tight -ml-2">Pulse</span>
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
