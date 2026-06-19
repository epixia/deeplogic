import { cx } from '../cx'

export interface TabItem {
  id: string
  label: string
}

export interface TabsProps {
  /** The tabs to show. */
  items: TabItem[]
  /** The active tab id (controlled). */
  value: string
  /** Called with the id of the clicked tab. */
  onChange: (id: string) => void
  className?: string
}

/** A controlled horizontal tab bar with an underline indicator. */
export function Tabs({ items, value, onChange, className }: TabsProps) {
  return (
    <div className={cx('dl-tabs', className)} role="tablist">
      {items.map((t) => (
        <button
          key={t.id} type="button" role="tab" aria-selected={t.id === value}
          className={cx('dl-tab', t.id === value && 'is-active')}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
