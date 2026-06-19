import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../cx'

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** Highlight as selected. */
  active?: boolean
  /** Fires when the ✕ remove control is clicked (renders the control when set). */
  onRemove?: () => void
  children?: ReactNode
}

/** A compact, rounded token — tags, filters, selected values. */
export function Chip({ active, onRemove, onClick, className, children, ...rest }: ChipProps) {
  const clickable = !!onClick
  return (
    <span
      className={cx('dl-chip', clickable && 'dl-chip--clickable', active && 'dl-chip--active', className)}
      onClick={onClick}
      {...rest}
    >
      {children}
      {onRemove && (
        <button type="button" className="dl-chip-x" aria-label="Remove" onClick={(e) => { e.stopPropagation(); onRemove() }}>✕</button>
      )}
    </span>
  )
}
