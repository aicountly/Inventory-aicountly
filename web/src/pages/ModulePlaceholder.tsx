import { useAccess } from '../access/AccessContext'
import { useCompany } from '../company/CompanyContext'
import { Notice } from '../components/Notice'
import { PageHeader } from '../components/PageHeader'
import type { PermissionKey } from '../access/AccessContext'

interface ModulePlaceholderProps {
  title: string
  description: string
  permission: PermissionKey
}

/**
 * Landing page for a module whose screens have not been built yet. It is
 * honest about that rather than showing placeholder data.
 */
export function ModulePlaceholder({ title, description, permission }: ModulePlaceholderProps) {
  const { companyName, fy, branch } = useCompany()
  const { can, loading } = useAccess()

  return (
    <div className="page">
      <PageHeader title={title} subtitle={`${companyName || 'Company'} · ${fy?.label ?? 'FY'} · ${branch ? branch.name : 'All branches'}`} />
      {!loading && !can(permission) ? (
        <Notice kind="warning">You do not have permission to open {title} in this company.</Notice>
      ) : (
        <div className="card">
          <div className="card-body">
            <p style={{ margin: 0 }}>{description}</p>
            <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.875rem' }}>
              The API for this module is live; its screens arrive in a later release.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
