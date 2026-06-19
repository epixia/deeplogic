import type { ReactNode } from 'react'
import { cx } from '../cx'

export interface PanelProps {
  title: string
  /** Supporting copy under the title. */
  children?: ReactNode
  /** Optional action buttons, centered below the text. */
  actions?: ReactNode
  className?: string
}

/** A centered empty-state / placeholder panel. */
export function Panel({ title, children, actions, className }: PanelProps) {
  return (
    <div className={cx('dl-panel', className)}>
      <div className="dl-panel-title">{title}</div>
      {children && <div className="dl-panel-text">{children}</div>}
      {actions && <div className="dl-panel-actions">{actions}</div>}
    </div>
  )
}
