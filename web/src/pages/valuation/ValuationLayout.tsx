import { Outlet } from 'react-router-dom'
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
 * The valuation section's tabs, rendered by the page rather than by the layout.
 *
 * They used to sit above the outlet, which put them above every page's own
 * heading — so a reader met "Cost layers" as a tab before they met it as a
 * title, and the breadcrumb that says where they are came third. Owning the
 * tabs lets a page put its header first and the section switch underneath it,
 * which is the order the rest of Inventory reads in.
 *
 * Every page in the section renders exactly this, so the navigation is
 * unchanged: same routes, same permission filter, same active styling.
 */
export function ValuationTabs() {
  // Five tabs are 481px, which is wider than a phone. The strip scrolls
  // sideways inside its own box rather than pushing the page out.
  return (
    <div className="scrollbar-thin -mx-0.5 max-w-full overflow-x-auto px-0.5">
      <SubNav items={ITEMS} label="Valuation" />
    </div>
  )
}

export function ValuationLayout() {
  return (
    <div className="page">
      <Outlet />
    </div>
  )
}
