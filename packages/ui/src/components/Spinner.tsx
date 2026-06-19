import { cx } from '../cx'

export interface SpinnerProps {
  /** Diameter preset. */
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** Accessible label (defaults to "Loading"). */
  label?: string
}

/** A token-coloured loading spinner. */
export function Spinner({ size = 'md', className, label = 'Loading' }: SpinnerProps) {
  return <span className={cx('dl-spinner', size !== 'md' && `dl-spinner--${size}`, className)} role="status" aria-label={label} />
}
