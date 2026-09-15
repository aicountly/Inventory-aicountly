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
 * every screen that renders it gains the breadcrumb bar and the Books type
 * scale without an edit.
 *
 * Not Esc-to-back, though: this shim is already rendered by thirty screens,
 * three of them data-entry forms, and none of them asked for a key that leaves
 * the page. Esc is not held back while focus is on a checkbox, a button or
 * nothing at all, so on a half-filled form it would discard the work with no
 * warning. A screen opts in by rendering BreadcrumbHeader itself — and a form
 * that does must pass `escDirty` while it holds unsaved edits.
 */
export function PageHeader({ title, subtitle, actions, breadcrumbs }: PageHeaderProps) {
  return (
    <BreadcrumbHeader
      breadcrumbs={breadcrumbs}
      title={title}
      description={subtitle}
      actions={actions}
      escBack={false}
    />
  )
}
