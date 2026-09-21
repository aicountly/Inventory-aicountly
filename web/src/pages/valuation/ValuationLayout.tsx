import { Outlet, useLocation } from 'react-router-dom'
import { SubNav } from '../../components/SubNav'
import { P } from '../../services/access'

const ITEMS = [
  { to: '/valuation', label: 'Stock valuation', end: true, permission: P.report('valuation') },
  { to: '/valuation/cost-layers', label: 'Cost layers', permission: P.report('valuation') },
  { to: '/valuation/method-comparison', label: 'Method comparison', permission: P.report('valuation') },
  { to: '/valuation/recalculations', label: 'Recalculations', permission: P.report('valuation') },
  { to: '/valuation/revisions', label: 'Revisions', permission: P.report('valuation') },
] as const

/**
 * Screens that draw the module's navigation themselves (ValuationTabs), under
 * their own heading rather than above it.
 *
 * A bar rendered here always lands above the page title, which on the rebuilt
 * screens puts five sibling links between the reader and the item they came to
 * look at. Each screen moves into this set as it is rebuilt; when the last one
 * has, the SubNav below goes with it.
 */
const SELF_NAVIGATED = ['/valuation/cost-layers']

export function ValuationLayout() {
  const { pathname } = useLocation()
  const ownsItsNav = SELF_NAVIGATED.some((path) => pathname === path || pathname.startsWith(`${path}/`))

  return (
    <div className="page">
      {ownsItsNav ? null : <SubNav items={ITEMS} label="Valuation" />}
      <Outlet />
    </div>
  )
}
