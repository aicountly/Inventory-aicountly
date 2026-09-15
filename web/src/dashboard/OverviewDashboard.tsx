import { useCallback, useMemo, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { useCompany } from '../company/CompanyContext'
import { EmptyState } from '../ui/EmptyState'
import { Card } from '../ui/Card'
import { formatDate, formatQty, todayIso } from '../utils/format'
import { DashboardPageHeader } from './components/DashboardPageHeader'
import { PulseBriefing } from './components/PulseBriefing'
import { KpiStrip } from './components/KpiStrip'
import { QuickActions } from './components/QuickActions'
import { NearExpiryWindow } from './components/NearExpiryWindow'
import { exportDashboardPdf } from './dashboardExport'
import { formatCount, formatCurrencyCompact } from './formatters'
import { buildPulseFindings } from './pulse'
import { ageingSeries, buildKpiCards, warehouseSeries } from './model'
import { NEAR_EXPIRY_CHOICES, useDashboardData } from './useDashboardData'
import type { DashboardSectionProps } from './pages/types'
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
export function OverviewDashboard({ scope, view }: DashboardSectionProps) {
  const { companyName, fy, branch, status: companyStatus } = useCompany()
  const { loading: accessLoading } = useAccess()
  const [exporting, setExporting] = useState(false)
  // The as-at date and the warehouse now come from the URL, shared with the
  // other four dashboards, so a link to one of them reopens on the same day
  // and the same warehouse rather than silently on today and everywhere.
  const d = useDashboardData({ asOf: scope.asOf, warehouseId: scope.effectiveWarehouseId })

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

  // The briefing is arithmetic over the figures already on this page — see
  // pulse.ts. It is labelled as a rule-based summary, not as a forecast.
  const findings = useMemo(
    () =>
      buildPulseFindings({
        negativeStockRows: d.core.data?.stock.negative_stock_rows ?? null,
        failedPostings: d.core.data?.documents.failed ?? null,
        expiredBatches: d.expiry.data?.expired ?? null,
        expiringBatches: d.expiry.data?.expiringSoon ?? null,
        expiringDays: d.nearExpiryDays,
        belowReorder: d.replenishment.data?.summary.triggered_total ?? null,
        pendingApproval: d.core.data?.documents.pending_approval ?? null,
        outboxFailed: d.core.data?.integration.outbox_failed ?? null,
        reconciliationDifference:
          d.core.data?.last_reconciliation?.difference === null ||
          d.core.data?.last_reconciliation?.difference === undefined
            ? null
            : Number(d.core.data.last_reconciliation.difference),
        reconciliationStatus: d.core.data?.last_reconciliation?.status ?? null,
      }),
    [d.core.data, d.expiry.data, d.replenishment.data, d.nearExpiryDays],
  )

  const onExport = useCallback(() => {
    setExporting(true)
    try {
      const ages = ageingSeries(d.ageing.data, d.asOf)
      const houses = warehouseSeries(d.warehouses.data, d.asOf)
      exportDashboardPdf({
        title: 'Inventory overview',
        description: view.description,
        companyName,
        fyLabel: fy?.label ?? 'Financial year',
        branchLabel: branch ? branch.name : 'All branches',
        warehouseLabel:
          scope.effectiveWarehouseId === null
            ? 'All warehouses'
            : (scope.warehouses.find((w) => w.warehouse_id === scope.effectiveWarehouseId)?.warehouse_name ??
              `Warehouse ${scope.effectiveWarehouseId}`),
        asOf: d.asOf,
        generatedAt: null,
        metrics: visibleCards.map((c) => [c.label, c.value, c.hint ?? ''] as const),
        tables: [
          {
            title: 'Value by warehouse',
            numericColumns: [1, 2],
            columns: ['Warehouse', 'Value at cost', 'Share', 'Quantity'],
            rows: houses.map((h) => [h.label, h.display, `${h.share.toFixed(0)}%`, h.sub ?? '']),
          },
          {
            title: 'Stock ageing',
            numericColumns: [1, 2],
            columns: ['Age bucket', 'Value at cost', 'Share', 'Quantity'],
            rows: ages.map((a) => [a.label, a.display, `${a.share.toFixed(0)}%`, a.sub ?? '']),
          },
          {
            title: `Items at or below reorder point`,
            note:
              d.replenishment.data && d.replenishment.data.rows.length < d.replenishment.data.summary.triggered_total
                ? `Showing ${d.replenishment.data.rows.length} of ${d.replenishment.data.summary.triggered_total} triggered rows. Open the replenishment report for the full list.`
                : undefined,
            numericColumns: [2, 3],
            columns: ['Item', 'Warehouse', 'Available', 'Suggested'],
            rows: (d.replenishment.data?.rows ?? []).map((r) => [
              r.item_name ?? `Item ${r.item_id}`,
              r.default_warehouse_name ?? '—',
              formatQty(r.available),
              formatQty(r.suggested_qty),
            ]),
          },
          {
            title: `Batches expiring within ${d.nearExpiryDays} days`,
            numericColumns: [3, 4],
            columns: ['Item', 'Batch', 'Expiry', 'Quantity', 'Value at cost'],
            rows: (d.expiry.data?.rows ?? [])
              .filter((r) => !r.is_expired)
              .map((r) => [
                r.item_name ?? `Item ${r.item_id}`,
                r.batch_no ?? '—',
                formatDate(r.expiry_date),
                formatQty(r.on_hand),
                formatCurrencyCompact(r.stock_value),
              ]),
          },
        ],
        notes: [
          'Every value on this sheet is at COST under each item\'s own configured costing method. Commercial value, tax and margin belong to Books and do not appear here.',
          `Quantities are summed in base units only. Where a figure spans several units of measure it is labelled as such rather than added into one number.`,
          d.core.data
            ? `${formatCount(d.core.data.stock.negative_stock_rows)} balance rows are below zero; they are reported as exceptions and are not netted into the ageing composition.`
            : '',
          'Stock ageing measures how long the cost layers still on hand have been held — not how long ago the item was created.',
        ].filter(Boolean),
      })
    } finally {
      setExporting(false)
    }
  }, [d, view, companyName, fy, branch, scope, visibleCards])

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
      <DashboardPageHeader
        title="Inventory overview"
        description={view.description}
        companyName={companyName}
        fyLabel={fy?.label ?? 'Financial year'}
        branchLabel={branch ? branch.name : 'All branches'}
        asOf={scope.asOf}
        onAsOf={scope.setAsOf}
        maxDate={todayIso()}
        warehouses={scope.warehouses}
        warehouseId={scope.effectiveWarehouseId}
        onWarehouseId={scope.setWarehouseId}
        warehouseDropped={scope.warehouseDropped}
        refreshing={d.refreshing}
        onRefresh={d.refreshAll}
        lastSyncedAt={d.lastSyncedAt}
        onExport={onExport}
        exporting={exporting}
        actions={
          <NearExpiryWindow
            value={d.nearExpiryDays}
            choices={NEAR_EXPIRY_CHOICES}
            onChange={d.setNearExpiryDays}
          />
        }
      />

      <PulseBriefing
        findings={findings}
        anyDataKnown={d.core.data !== null || d.stock.data !== null}
        lastSyncedAt={d.lastSyncedAt}
        reviewTo="/dashboard?view=controls"
        reviewLabel="Review controls"
      />

      {visibleCards.length > 0 ? <KpiStrip cards={visibleCards} /> : null}

      <div className="grid gap-3 grid-cols-1 lg:grid-cols-3">
        {d.can.warehouseStock ? <WarehouseValueWidget query={d.warehouses} asOf={d.asOf} /> : null}
        {d.can.ageing ? <AgeingWidget query={d.ageing} asOf={d.asOf} /> : null}
        {d.can.movement ? <MovementMixWidget query={d.movement} /> : null}
      </div>

      <QuickActions asOf={d.asOf} period={d.period} />

      {/* Two across, not four. Each of these four cards holds a MiniTable whose
          columns need ~420px; at four across on a 1440 screen the card is about
          290px and every numeric column is cut off at the card edge. The table
          scrolls, so nothing is unreachable — but a dashboard whose figures are
          half-visible is a dashboard nobody reads. */}
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
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
