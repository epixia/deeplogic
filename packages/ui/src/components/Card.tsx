import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../cx'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Larger internal padding. */
  padded?: boolean
  /** Lift + accent border on hover (for clickable cards). */
  hover?: boolean
  children?: ReactNode
}

/** A surface container — hairline border, card background, rounded corners. */
export function Card({ padded, hover, className, children, ...rest }: CardProps) {
  return (
    <div className={cx('dl-card', padded && 'dl-card--pad-lg', hover && 'dl-card--hover', className)} {...rest}>
      {children}
    </div>
  )
}
