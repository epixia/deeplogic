import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../cx'

export type BadgeTone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Semantic colour. */
  tone?: BadgeTone
  /** Show a leading status dot. */
  dot?: boolean
  children?: ReactNode
}

/** A pill for statuses, counts and labels. Also exported as `StatusPill`. */
export function Badge({ tone = 'neutral', dot, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx('dl-badge', tone !== 'neutral' && `dl-badge--${tone}`, className)} {...rest}>
      {dot && <span className="dl-badge-dot" aria-hidden />}
      {children}
    </span>
  )
}

/** Alias of {@link Badge} — reads better for live status (Running / Failed / …). */
export const StatusPill = Badge
