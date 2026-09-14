import type { ReactNode } from 'react'
import { BreadcrumbHeader } from '../ui/shell/BreadcrumbHeader'

export interface Crumb {
  label: string
  to?: string
}

interface PageHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  breadcrumbs?: Crumb[]
}

/**
 * The original page header, re-expressed on the shared one. Same props, so
 * every screen that renders it gains the breadcrumb bar, the Esc-to-back
 * shortcut and the Books type scale without an edit.
 */
export function PageHeader({ title, subtitle, actions, breadcrumbs }: PageHeaderProps) {
  return (
    <BreadcrumbHeader
      breadcrumbs={breadcrumbs}
      title={title}
      description={subtitle}
      actions={actions}
    />
  )
}
