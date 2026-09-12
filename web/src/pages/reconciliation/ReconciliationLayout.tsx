import { Outlet } from 'react-router-dom'
import { SubNav } from '../../components/SubNav'
import { P } from '../../services/access'

const ITEMS = [
  { to: '/reconciliation', label: 'Runs', end: true, permission: P.reconciliationRead },
  { to: '/reconciliation/posting-status', label: 'Posting status', permission: P.reconciliationRead },
  { to: '/integration/outbox', label: 'Outbox events', permission: P.integrationRead },
] as const

export function ReconciliationLayout() {
  return (
    <div className="page">
      <SubNav items={ITEMS} label="Reconciliation" />
      <Outlet />
    </div>
  )
}
