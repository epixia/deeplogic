// DeepLogic triangle mark — self-contained SVG with per-instance gradient/filter
// ids so multiple logos can coexist on a page.

let uid = 0

export interface LogoProps {
  /** Width & height in px. */
  size?: number
  className?: string
  /** Accessible title (defaults to "DeepLogic"). */
  title?: string
}

/** The DeepLogic brand mark. */
export function Logo({ size = 30, className, title }: LogoProps) {
  uid += 1
  const id = `dl${uid}`
  const gradId = `${id}-g`
  const glowId = `${id}-glow`
  return (
    <svg className={className} width={size} height={size} viewBox="0 -10 120 120" role="img" aria-label={title ?? 'DeepLogic'}>
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7ff0fb" />
          <stop offset="0.5" stopColor="#49a0e6" />
          <stop offset="1" stopColor="#5560e8" />
        </linearGradient>
        <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g fill="none" stroke={`url(#${gradId})`} strokeLinejoin="round" strokeLinecap="round" filter={`url(#${glowId})`}>
        <path d="M60 22 L92 78 L28 78 Z" strokeWidth="9" />
        <path d="M60 42 L77 71 L43 71 Z" strokeWidth="5" opacity="0.5" />
      </g>
      <circle cx="60" cy="22" r="6.4" fill={`url(#${gradId})`} />
      <circle cx="92" cy="78" r="6.4" fill={`url(#${gradId})`} />
      <circle cx="28" cy="78" r="6.4" fill={`url(#${gradId})`} />
      <circle cx="57.4" cy="19.4" r="2" fill="#eafdff" opacity="0.85" />
    </svg>
  )
}
