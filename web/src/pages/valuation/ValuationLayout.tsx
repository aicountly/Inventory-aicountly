import { Outlet } from 'react-router-dom'
import { SubNav } from '../../components/SubNav'
import { P } from '../../services/access'

const ITEMS = [
  { to: '/valuation', label: 'Stock valuation', end: true, permission: P.report('valuation') },
  { to: '/valuation/cost-layers', label: 'Cost layers', permission: P.report('valuation') },
  { to: '/valuation/recalculations', label: 'Recalculations', permission: P.report('valuation') },
  { to: '/valuation/revisions', label: 'Revisions', permission: P.report('valuation') },
] as const

export function ValuationLayout() {
  return (
    <div className="page">
      <SubNav items={ITEMS} label="Valuation" />
      <Outlet />
    </div>
  )
}
