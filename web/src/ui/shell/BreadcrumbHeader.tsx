import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { BreadcrumbBar } from './BreadcrumbBar'
import type { Crumb } from './BreadcrumbBar'
import { PageHeader } from './PageHeader'
import { usePageBackKeyboard } from '../../keyboard/usePageBackKeyboard'
import { AIC, cx } from '../cx'

export interface BreadcrumbHeaderProps {
  breadcrumbs?: readonly Crumb[]
  title: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  badge?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  /** Compact mode only: filters / segmented controls beside the breadcrumbs. */
  toolbar?: ReactNode
  backTo?: string
  backLabel?: string
  /** Esc navigates to backTo, else the breadcrumb parent. */
  escBack?: boolean
  escOnBack?: () => void
  /** Unsaved edits on the page: Esc asks before leaving instead of discarding. */
  escDirty?: boolean
  /** One row — breadcrumbs · toolbar · actions. What every register uses. */
  compact?: boolean
  className?: string
}

export function BreadcrumbHeader({
  breadcrumbs,
  title,
  description,
  icon,
  badge,
  meta,
  actions,
  toolbar,
  backTo,
  backLabel,
  escBack = true,
  escOnBack,
  escDirty = false,
  compact = false,
  className,
}: BreadcrumbHeaderProps) {
  usePageBackKeyboard({
    backTo,
    breadcrumbs,
    onBack: escOnBack,
    enabled: escBack !== false,
    dirty: escDirty,
  })

  if (compact) {
    return (
      <div className={cx(AIC, 'flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
        <div className="min-w-0 shrink-0">
          {breadcrumbs?.length ? (
            <BreadcrumbBar items={breadcrumbs} />
          ) : (
            <h1 className="text-lg font-semibold text-gray-900 truncate">{title}</h1>
          )}
        </div>
        {badge ? <span className="shrink-0">{badge}</span> : null}
        {toolbar ? (
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[12rem]">{toolbar}</div>
        ) : null}
        {actions ? (
          <div className="flex items-center flex-wrap gap-2 shrink-0 ml-auto print:hidden">
            {actions}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cx(AIC, 'space-y-2', className)}>
      {breadcrumbs?.length ? <BreadcrumbBar items={breadcrumbs} /> : null}
      <PageHeader
        title={title}
        description={description}
        icon={icon}
        badge={badge}
        meta={meta}
        actions={actions}
        backTo={backTo}
        backLabel={backLabel}
      />
    </div>
  )
}

export default BreadcrumbHeader
