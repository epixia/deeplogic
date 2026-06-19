import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../cx'

export interface WrapProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
}

/** Centered page container with the app's max width and gutters. */
export function Wrap({ className, children, ...rest }: WrapProps) {
  return <div className={cx('dl-wrap', className)} {...rest}>{children}</div>
}
