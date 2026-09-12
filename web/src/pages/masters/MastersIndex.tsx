import { Link } from 'react-router-dom'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { Notice } from '../../components/Notice'
import { PageHeader } from '../../components/PageHeader'
import { MASTER_NAV } from '../../layout/navigation'
import { P } from '../../services/access'

export function MastersIndex() {
  const { companyName } = useCompany()
  const { can, loading } = useAccess()
  const canItems = loading || can(P.masters('items', 'read'))
  const visible = MASTER_NAV.filter((m) => loading || can(P.masters(m.permissionSlug, 'read')))

  return (
    <>
      <PageHeader title="Masters" subtitle={`Reference data for ${companyName || 'this company'}. Every master is scoped to the selected company.`} />
      {!loading && visible.length === 0 && !canItems ? <Notice kind="warning">You do not have permission to view any master in this company.</Notice> : null}
      <div className="kpi-grid-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))' }}>
        {canItems ? (
          <Link to="/items" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="card-body">
              <h3 className="card-title">Items</h3>
              <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
                Stock, service and non-stock items with units, tracking and opening stock.
              </p>
            </div>
          </Link>
        ) : null}
        {visible.map((m) => (
          <Link key={m.slug} to={`/masters/${m.slug}`} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="card-body">
              <h3 className="card-title">{m.label}</h3>
              <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
                {m.description}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </>
  )
}
