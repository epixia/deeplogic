import type { InputHTMLAttributes } from 'react'
import { cx } from '../cx'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Optional field label rendered above the input. */
  label?: string
  /** Helper text below the input. */
  hint?: string
  /** Mark the field invalid (red border). */
  invalid?: boolean
}

/** A single-line text field. Pass `label`/`hint` to render the full field, or use bare. */
export function Input({ label, hint, invalid, className, id, ...rest }: InputProps) {
  const input = <input id={id} className={cx('dl-input', className)} {...rest} />
  if (!label && !hint) return invalid ? <span className="dl-field dl-field--invalid">{input}</span> : input
  return (
    <label className={cx('dl-field', invalid && 'dl-field--invalid')} htmlFor={id}>
      {label && <span className="dl-field-label">{label}</span>}
      {input}
      {hint && <span className="dl-field-hint">{hint}</span>}
    </label>
  )
}
