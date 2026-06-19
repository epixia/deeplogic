import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../cx'

export type ButtonVariant = 'primary' | 'ghost' | 'icon'
export type ButtonSize = 'md' | 'sm' | 'xs'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. `primary` = gradient CTA, `ghost` = outline, `icon` = square icon button. */
  variant?: ButtonVariant
  /** Control height. */
  size?: ButtonSize
  /** Show a spinner and disable while an action is in flight. */
  loading?: boolean
  children?: ReactNode
}

/** The DeepLogic button. Renders a real `<button>` with the design-system classes. */
export function Button({ variant = 'ghost', size = 'md', loading, disabled, className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={cx('dl-btn', `dl-btn--${variant}`, size !== 'md' && `dl-btn--${size}`, className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <span className="dl-spinner dl-spinner--sm" aria-hidden />}
      {children}
    </button>
  )
}
