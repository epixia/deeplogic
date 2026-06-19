import { cx } from '../cx'

export interface SwitchProps {
  /** On/off state (controlled). */
  checked: boolean
  /** Called with the next state when toggled. */
  onChange: (next: boolean) => void
  disabled?: boolean
  /** Accessible label. */
  label?: string
  className?: string
}

/** A controlled on/off toggle. */
export function Switch({ checked, onChange, disabled, label, className }: SwitchProps) {
  return (
    <label className={cx('dl-switch', checked && 'is-on', className)} aria-disabled={disabled || undefined}>
      <input
        type="checkbox" role="switch" checked={checked} disabled={disabled}
        aria-label={label} onChange={(e) => onChange(e.target.checked)}
      />
      <span className="dl-switch-track"><span className="dl-switch-thumb" /></span>
    </label>
  )
}
