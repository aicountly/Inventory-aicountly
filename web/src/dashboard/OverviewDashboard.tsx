import { useMemo } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { useCompany } from '../company/CompanyContext'
import { EmptyState } from '../ui/EmptyState'
import { Card } from '../ui/Card'
import { DashboardHeader } from './components/DashboardHeader'
import { KpiStrip } from './components/KpiStrip'
import { QuickActions } from './components/QuickActions'
import { buildKpiCards } from './model'
import { NEAR_EXPIRY_CHOICES, useDashboardData } from './useDashboardData'
import { AgeingWidget, MovementMixWidget, TopItemsWidget, WarehouseValueWidget } from './widgets/StockWidgets'
import { ExpiryWidget, RecentMovementsWidget, ReorderWidget } from './widgets/ActionWidgets'
import { DocumentsWidget, IntegrationWidget, ReconciliationWidget } from './widgets/OpsWidgets'

/**
 * The Inventory overview — the screen a stock manager keeps open.
 *
 * Structure, top to bottom: what the stock is worth, what needs doing today,
 * where to go next, then the detail behind each of those. Nothing on it is
 * decoration — every figure is a real server aggregate over the whole filtered
 * set, and every figure is a link into the register that produced it.
 *
 * Composition notes worth keeping when this grows:
 *
 *  - Widgets are permission-gated at the *mount* point, so a report the user
 *    cannot read is never requested and never flashes an error. Gating happens
 *    after `accessLoading` clears, so nothing appears and then disappears.
 *  - Each widget owns its loading, error and empty states (WidgetCard); the page
 *    itself has no global spinner and never blanks because one report was slow.
 *  - Chrome is marked `print:hidden`; the cards themselves print.
 *  - The `aic` class opts this subtree into the Books reset (see theme/tokens.css).
 */
export function OverviewDashboard() {
  const { companyName, fy, branch, status: companyStatus } = useCompany()
  const { member, loading: accessLoading } = useAccess()
  const d = useDashboardData()

  const userName = useMemo(() => {
    const name = member?.display_name?.trim()
    if (!name) return null
    return name.split(/\s+/)[0]
  }, [member])

  const cards = useMemo(
    () =>
      buildKpiCards({
        asOf: d.asOf,
        nearExpiryDays: d.nearExpiryDays,
        core: d.core.data,
        stock: d.stock.data,
        expiry: d.expiry.data,
        replenishment: d.replenishment.data,
      }),
    [d.asOf, d.nearExpiryDays, d.core.data, d.stock.data, d.expiry.data, d.replenishment.data],
  )

  // A KPI whose source the user may not read would sit at "loading" for ever.
  // Drop those cards instead of leaving a skeleton on the page.
  const visibleCards = useMemo(() => {
    const blocked = new Set<string>()
    if (!d.can.stockSummary) ['stock_value', 'stock_qty', 'items_in_stock'].forEach((k) => blocked.add(k))
    if (!d.can.replenishment) blocked.add('reorder')
    if (!d.can.nearExpiry) ['expiring', 'expired'].forEach((k) => blocked.add(k))
    if (!d.can.dashboard) ['negative_stock', 'pending_approval'].forEach((k) => blocked.add(k))
    return cards.filter((c) => !blocked.has(c.key))
  }, [cards, d.can])

  // While the company scope is still resolving, render the page anyway: every
  // query is disabled until `scope` exists, so each widget shows its own
  // skeleton and the layout is already in place when the data arrives. Only
  // "no company" and "Manage unreachable" bail out — AppShell owns those,
  // and drawing a dashboard behind its panel would be noise.
  if (companyStatus === 'empty' || companyStatus === 'error') return null

  if (!accessLoading && !d.can.dashboard && !d.can.stockSummary) {
    return (
      <div className="aic p-3">
        <Card padding="lg">
          <EmptyState
            icon={ShieldAlert}
            title="You do not have access to the Inventory dashboard"
            description="Ask an administrator for the Dashboard permission in this company, or open a report you do have access to from the sidebar."
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="aic space-y-3 pb-6 max-w-screen-2xl mx-auto text-gray-900">
      <DashboardHeader
        userName={userName}
        companyName={companyName}
        fyLabel={fy?.label ?? 'Financial year'}
        branchLabel={branch ? branch.name : 'All branches'}
        asOf={d.asOf}
        lastSyncedAt={d.lastSyncedAt}
        refreshing={d.refreshing}
        onRefresh={d.refreshAll}
        nearExpiryDays={d.nearExpiryDays}
        nearExpiryChoices={NEAR_EXPIRY_CHOICES}
        onNearExpiryDays={d.setNearExpiryDays}
      />

      {visibleCards.length > 0 ? <KpiStrip cards={visibleCards} /> : null}

      <div className="grid gap-3 grid-cols-1 lg:grid-cols-3">
        {d.can.warehouseStock ? <WarehouseValueWidget query={d.warehouses} asOf={d.asOf} /> : null}
        {d.can.ageing ? <AgeingWidget query={d.ageing} asOf={d.asOf} /> : null}
        {d.can.movement ? <MovementMixWidget query={d.movement} /> : null}
      </div>

      <QuickActions asOf={d.asOf} period={d.period} />

      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        {d.can.replenishment ? <ReorderWidget query={d.replenishment} /> : null}
        {d.can.nearExpiry ? <ExpiryWidget query={d.expiry} days={d.nearExpiryDays} /> : null}
        {d.can.stockSummary ? <TopItemsWidget query={d.stock} asOf={d.asOf} period={d.period} /> : null}
        {d.can.movements ? <RecentMovementsWidget query={d.movements} /> : null}
      </div>

      <div className="grid gap-3 grid-cols-1 lg:grid-cols-3">
        {/* All three read the /v1/dashboard payload, which the server authorises
            on dashboard.read alone. Gating them on integration.read /
            reconciliation.read as well hid data the user had already been sent
            and left a dashboard.read user with one card. Report-backed widgets
            above stay gated on their own report slug, where the gate really does
            prevent a 403. */}
        {d.can.dashboard ? <DocumentsWidget query={d.core} /> : null}
        {d.can.dashboard ? <IntegrationWidget query={d.core} /> : null}
        {d.can.dashboard ? <ReconciliationWidget query={d.core} /> : null}
      </div>
    </div>
  )
}

export default OverviewDashboard
