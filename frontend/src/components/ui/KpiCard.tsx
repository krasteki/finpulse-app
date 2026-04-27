import { useNavigate } from 'react-router-dom'

interface KpiCardProps {
  label: string
  value: string
  sub?: string
  trend?: 'up' | 'down' | 'neutral'
  href?: string
}

export function KpiCard({ label, value, sub, trend, href }: KpiCardProps) {
  const navigate = useNavigate()
  const trendColor =
    trend === 'up' ? 'text-green-400' :
    trend === 'down' ? 'text-red-400' :
    'text-zinc-400'

  const base = 'bg-zinc-900 border border-zinc-800 rounded-xl p-5'
  const clickable = href
    ? `${base} cursor-pointer hover:border-zinc-600 hover:bg-zinc-800/70 transition-colors group`
    : base

  return (
    <div className={clickable} onClick={href ? () => navigate(href) : undefined}>
      <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1 flex items-center justify-between">
        {label}
        {href && <span className="text-zinc-700 group-hover:text-zinc-400 transition-colors text-base leading-none">→</span>}
      </p>
      <p className="text-2xl font-semibold text-zinc-100">{value}</p>
      {sub && <p className={`text-sm mt-1 ${trendColor}`}>{sub}</p>}
    </div>
  )
}
