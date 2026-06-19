import type { TextareaHTMLAttributes } from 'react'
import { cx } from '../cx'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  invalid?: boolean
}

/** A multi-line text field. Pass `label`/`hint` for the full field, or use bare. */
export function Textarea({ label, hint, invalid, className, id, rows = 3, ...rest }: TextareaProps) {
  const ta = <textarea id={id} rows={rows} className={cx('dl-textarea', className)} {...rest} />
  if (!label && !hint) return invalid ? <span className="dl-field dl-field--invalid">{ta}</span> : ta
  return (
    <label className={cx('dl-field', invalid && 'dl-field--invalid')} htmlFor={id}>
      {label && <span className="dl-field-label">{label}</span>}
      {ta}
      {hint && <span className="dl-field-hint">{hint}</span>}
    </label>
  )
}
