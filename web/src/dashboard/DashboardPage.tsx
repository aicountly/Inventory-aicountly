import { lazy, Suspense, useMemo } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { useCompany } from '../company/CompanyContext'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { LoadingState } from '../ui/LoadingState'
import { DashboardTabs } from './components/DashboardTabs'
import { ShortcutFooter } from './components/ShortcutFooter'
import { ShortcutHelpDialog } from './components/ShortcutHelpDialog'
import { OverviewDashboard } from './OverviewDashboard'
import { useDashboardScope } from './useDashboardScope'
import { permittedViews, viewById } from './views'

/**
 * `/dashboard` — the shell the five dashboards share.
 *
 * It owns exactly three things: the tab bar, the scope in the URL, and which
 * section is mounted. Everything else — the requests, the refresh, the export,
 * the heading — belongs to the section, because the five read entirely
 * different sources at entirely different costs.
 *
 * **Only the active dashboard is mounted, and the other four are code-split.**
 * That is the whole reason this is a switch over lazy components rather than
 * five always-rendered panels: mounting all five would fire every query on
 * every visit, which is five dashboards' worth of database work to show one.
 * Switching tabs unmounts the previous section and cancels its in-flight
 * requests through the AbortControllers in `useQuery`.
 *
 * Overview is imported eagerly because it is where `/dashboard` lands by
 * default; making the common case wait for a second round trip would be a
 * strange thing to optimise.
 */
const OperationsDashboard = lazy(() => import('./pages/OperationsDashboard'))
const ReplenishmentDashboard = lazy(() => import('./pages/ReplenishmentDashboard'))
const ValuationDashboard = lazy(() => import('./pages/ValuationDashboard'))
const ControlsDashboard = lazy(() => import('./pages/ControlsDashboard'))

export function DashboardPage() {
  const scope = useDashboardScope()
  const { can, loading: accessLoading } = useAccess()
  const { status: companyStatus } = useCompany()

  const views = useMemo(() => permittedViews(can, accessLoading), [can, accessLoading])

  // AppShell already owns "no company" and "Manage unreachable" as a fullscreen
  // panel; drawing a dashboard behind it would be noise.
  if (companyStatus === 'empty' || companyStatus === 'error') return null

  if (!accessLoading && scope.view === null) {
    return (
      <div className="aic p-3">
        <Card padding="lg">
          <EmptyState
            icon={ShieldAlert}
            title="You do not have access to any Inventory dashboard"
            description="Ask an administrator for the Dashboard permission in this company, or open a report you do have access to from the sidebar."
          />
        </Card>
      </div>
    )
  }

  const activeId = scope.view ?? 'overview'
  const view = viewById(activeId)

  return (
    <div className="aic mx-auto max-w-screen-2xl space-y-3 pb-6 text-gray-900">
      <DashboardTabs active={activeId} views={views} preserve={scope.preserved} />

      <Suspense fallback={<LoadingState label={`Loading ${view.label.toLowerCase()}…`} />}>
        {activeId === 'overview' ? <OverviewDashboard scope={scope} view={view} /> : null}
        {activeId === 'operations' ? <OperationsDashboard scope={scope} view={view} /> : null}
        {activeId === 'replenishment' ? <ReplenishmentDashboard scope={scope} view={view} /> : null}
        {activeId === 'valuation' ? <ValuationDashboard scope={scope} view={view} /> : null}
        {activeId === 'controls' ? <ControlsDashboard scope={scope} view={view} /> : null}
      </Suspense>

      <ShortcutFooter />
      <ShortcutHelpDialog />
    </div>
  )
}

export default DashboardPage
