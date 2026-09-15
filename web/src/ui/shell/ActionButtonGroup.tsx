import type { ReactNode } from 'react'
import { AIC, cx } from '../cx'

const JUSTIFY = {
  left: 'justify-start',
  right: 'justify-end',
  center: 'justify-center',
  between: 'justify-between',
} as const

export interface ActionButtonGroupProps {
  children?: ReactNode
  align?: keyof typeof JUSTIFY
  className?: string
}

export function ActionButtonGroup({
  children,
  align = 'right',
  className,
}: ActionButtonGroupProps) {
  return (
    <div className={cx(AIC, 'flex flex-wrap items-center gap-2', JUSTIFY[align], className)}>
      {children}
    </div>
  )
}

export default ActionButtonGroup
