import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

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

export function PageHeader({ title, subtitle, actions, breadcrumbs }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div>
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <ol className="breadcrumbs">
            {breadcrumbs.map((c, i) => (
              <li key={`${c.label}-${i}`}>{c.to ? <Link to={c.to}>{c.label}</Link> : c.label}</li>
            ))}
          </ol>
        ) : null}
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  )
}
