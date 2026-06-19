import type { ReactNode } from 'react'

export interface ModalProps {
  /** Whether the dialog is shown. */
  open: boolean
  /** Called on backdrop click or the ✕ control. */
  onClose: () => void
  title?: string
  /** Sub-text under the title. */
  description?: string
  children?: ReactNode
  /** Footer actions (e.g. Cancel / Confirm buttons), right-aligned. */
  actions?: ReactNode
}

/** A centered modal dialog over a blurred backdrop. */
export function Modal({ open, onClose, title, description, children, actions }: ModalProps) {
  if (!open) return null
  return (
    <div className="dl-modal-backdrop" onClick={onClose} role="presentation">
      <div className="dl-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        {(title || description) && (
          <div className="dl-modal-head">
            <div>
              {title && <div className="dl-modal-title">{title}</div>}
              {description && <div className="dl-modal-sub">{description}</div>}
            </div>
            <button type="button" className="dl-modal-x" aria-label="Close" onClick={onClose}>✕</button>
          </div>
        )}
        {children}
        {actions && <div className="dl-modal-actions">{actions}</div>}
      </div>
    </div>
  )
}
