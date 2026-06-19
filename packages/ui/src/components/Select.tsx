import type { SelectHTMLAttributes, ReactNode } from 'react'
import { cx } from '../cx'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  hint?: string
  invalid?: boolean
  children?: ReactNode
}

/** A styled native `<select>` with custom caret. Pass `label`/`hint` for the full field. */
export function Select({ label, hint, invalid, className, id, children, ...rest }: SelectProps) {
  const sel = <select id={id} className={cx('dl-select', className)} {...rest}>{children}</select>
  if (!label && !hint) return invalid ? <span className="dl-field dl-field--invalid">{sel}</span> : sel
  return (
    <label className={cx('dl-field', invalid && 'dl-field--invalid')} htmlFor={id}>
      {label && <span className="dl-field-label">{label}</span>}
      {sel}
      {hint && <span className="dl-field-hint">{hint}</span>}
    </label>
  )
}
