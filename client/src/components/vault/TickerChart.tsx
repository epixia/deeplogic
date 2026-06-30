// TickerChart — a compact stock price chart for a public company, rendered with
// TradingView's free "mini symbol overview" embed. Symbol is EXCHANGE:TICKER
// (e.g. "TSXV:LOVE", "NASDAQ:AAPL") or a bare ticker TradingView can resolve.

import { useEffect, useRef } from 'react'
import { useAppTheme } from '../studio/reportTheme'
import './ticker-chart.css'

export default function TickerChart({ symbol }: { symbol: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const theme = useAppTheme()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = ''
    const widget = document.createElement('div')
    widget.className = 'tradingview-widget-container__widget'
    el.appendChild(widget)

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js'
    script.async = true
    script.innerHTML = JSON.stringify({
      symbol,
      width: '100%',
      height: '100%',
      locale: 'en',
      dateRange: '12M',
      colorTheme: theme === 'light' ? 'light' : 'dark',
      isTransparent: true,
      autosize: true,
    })
    el.appendChild(script)
    return () => { el.innerHTML = '' }
  }, [symbol, theme])

  return (
    <div className="tv-chart">
      <div className="tradingview-widget-container" ref={ref} />
      <div className="tv-chart-label">{symbol}</div>
    </div>
  )
}
