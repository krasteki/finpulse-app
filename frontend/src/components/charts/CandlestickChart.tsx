import { useEffect, useRef } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type Time,
} from 'lightweight-charts'
import type { ChartData } from '@/types'

interface Props {
  data: ChartData
}

export function CandlestickChart({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const sma50Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const sma200Ref = useRef<ISeriesApi<'Line'> | null>(null)

  // Create chart once on mount
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#09090b' },
        textColor: '#a1a1aa',
      },
      grid: {
        vertLines: { color: '#27272a' },
        horzLines: { color: '#27272a' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#3f3f46' },
      timeScale: { borderColor: '#3f3f46', timeVisible: true },
      width: containerRef.current.clientWidth,
      height: 420,
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })

    const sma50Series = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    })

    const sma200Series = chart.addSeries(LineSeries, {
      color: '#3b82f6',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    sma50Ref.current = sma50Series
    sma200Ref.current = sma200Series

    // Handle resize
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width })
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [])

  // Update data when it changes
  useEffect(() => {
    if (!candleSeriesRef.current || !sma50Ref.current || !sma200Ref.current) return
    if (!data.candles.length) return

    const candles: CandlestickData[] = data.candles.map(c => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))

    const sma50: LineData[] = data.sma.sma50.map(p => ({
      time: p.time as Time,
      value: p.value,
    }))

    const sma200: LineData[] = data.sma.sma200.map(p => ({
      time: p.time as Time,
      value: p.value,
    }))

    candleSeriesRef.current.setData(candles)
    sma50Ref.current.setData(sma50)
    sma200Ref.current.setData(sma200)

    chartRef.current?.timeScale().fitContent()
  }, [data])

  return (
    <div className="relative">
      <div ref={containerRef} className="w-full" />
      {/* Legend */}
      <div className="absolute top-3 left-3 flex items-center gap-4 text-xs pointer-events-none">
        <span className="flex items-center gap-1">
          <span className="w-6 h-0.5 bg-amber-400 inline-block" />
          <span className="text-zinc-400">SMA 50</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-6 h-0.5 bg-blue-500 inline-block" />
          <span className="text-zinc-400">SMA 200</span>
        </span>
      </div>
    </div>
  )
}
