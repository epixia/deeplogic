import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../cx'

export interface GradTextProps extends HTMLAttributes<HTMLSpanElement> {
  children?: ReactNode
}

/** Brand emphasis text — white on dark skins, black on light (matches the app). */
export function GradText({ className, children, ...rest }: GradTextProps) {
  return <span className={cx('dl-gradtext', className)} {...rest}>{children}</span>
}
