import { useCallback, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  Clock,
  Coins,
  Layers,
  PackageCheck,
  PieChart,
  Play,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Warehouse,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { errorMessage } from '../../services/api'
import { valuationApi } from '../../services/valuationApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { EmptyState } from '../../ui/EmptyState'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Skeleton, SkeletonRows } from '../../ui/Skeleton'
import { useToast } from '../../ui/ToastContext'
import { Notice } from '../../components/Notice'
import { formatDate, formatInt, formatMoney, formatQty, todayIso } from '../../utils/format'
import { assertScope, fetchValuationBridge } from '../aggregatesApi'
import { AgeingDonut } from '../charts/AgeingDonut'
import { BarList } from '../charts/BarList'
import { BridgeChart } from '../charts/BridgeChart'
import { DashboardPageHeader } from '../components/DashboardPageHeader'
import { DeltaChip } from '../components/DeltaChip'
import { InventoryInsightBar } from '../components/InventoryInsightBar'
import type { SyncState } from '../components/InventoryInsightBar'
import { MethodComparisonTable } from '../components/MethodComparisonTable'
import { MetricCard } from '../components/MetricCard'
import { MiniTable } from '../components/MiniTable'
import { MovementClassTable } from '../components/MovementClassTable'
import { RiskList } from '../components/RiskList'
import { RunValuationDialog } from '../components/RunValuationDialog'
import { StockHealthHero } from '../components/StockHealthHero'
import { WidgetCard } from '../components/WidgetCard'
import {
  fetchAgeing,
  fetchExpiry,
  fetchMethodComparison,
  fetchMovementMix,
  fetchStockValue,
  fetchWarehouseSplit,
} from '../dashboardApi'
import { exportDashboardPdf } from '../dashboardExport'
import { formatCount, formatCurrencyCompact, formatQtyCompact, percentOf } from '../formatters'
import { drill } from '../kpiNavigation'
import { warehouseSeries } from '../model'
import { useSyncStamp } from '../useSyncStamp'
import {
  ageingValue,
  atRiskRows,
  deltaPercent,
  insightChips,
  previousPeriodEnd,
  riskAttentionCount,
  stockHealth,
  suggestedActions,
  topItemConcentration,
} from '../valuationHealth'
import type { ValuationHealthInput } from '../valuationHealth'
import { answeredMethods, methodRows, methodSpread } from '../valuationMethods'
import {
  ageingView,
  bridgeCloses,
  bridgeSteps,
  movementSeriesForValuation,
  movementThresholds,
  unknownAgeNote,
} from '../valuationModel'
import type { AgeingBasis } from '../valuationModel'
import type { NearExpiryRow } from '../../services/reportsApi'
import type { DashboardSectionProps } from './types'

const EXPIRY_WINDOW_DAYS = 30
const AGEING_BASIS_KEY = 'inventory.dashboard.valuation.ageingBasis'

/** Remembered for the session only — a view preference, not a filter. */
function readAgeingBasis(): AgeingBasis {
  try {
    return window.sessionStorage.getItem(AGEING_BASIS_KEY) === 'quantity' ? 'quantity' : 'value'
  } catch {
    return 'value'
  }
}

/**
 * Dashboard 4 — inventory cost and stock health.
 *
 * Cost, never revenue. Every figure is `closing_value` and `stock_value` out of
 * the valuation walk: what the goods cost this company. Books owns the
 * commercial side — what they were sold for, the tax on it and who owes it —
 * and nothing on this screen reaches for any of it.
 *
 * ## Independent requests
 *
 * Eight, not one, because they have wildly different costs: the valuation walk
 * behind stock value and ageing is far heavier than a batch scan, and batching
 * them would make the whole page as slow as its slowest part and blank it on a
 * single 403. Two of the eight are DEFERRED until the primary figures have
 * landed — the four-method comparison (four more valuation walks) and the
 * prior-month reading — so the numbers a reader came for are never held up by
 * the ones that merely decorate them.
 *
 * ## What this screen will not show
 *
 * **Realizable value.** Inventory records what stock COST. Net realizable value
 * needs an expected selling price net of the cost to sell, and this product
 * holds neither: the item master's MRP is a printed price ceiling, not an
 * expectation, and selling prices belong to Books, which Inventory does not
 * read. There is no card for it rather than a card computed out of the nearest
 * available number and labelled as though it meant that.
 *
 * **Prior-period deltas on most cards.** Only the stock summary answers "as at
 * an earlier date" under the same scope, so only the two figures it produces
 * carry a comparison. The ageing, movement and expiry reports describe a
 * position now, not a movement between two positions, and their cards carry no
 * chip rather than one derived from somewhere else.
 */
export function ValuationDashboard({ scope, view }: DashboardSectionProps) {
  const { companyName, fy, branch, fyRange } = useCompany()
  const { can } = useAccess()
  const toast = useToast()
  const [exporting, setExporting] = useState(false)
  const [ageingBasis, setAgeingBasis] = useState<AgeingBasis>(readAgeingBasis)
  const [runOpen, setRunOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const expected = scope.scope
  const warehouseId = scope.effectiveWarehouseId
  const enabled = scope.ready

  const canExport = can(P.dashboard)
  const canRunValuation = can(P.valuationRecalculate)
  const canCompareMethods = can(P.report('valuation'))
  const canReadStock = can(P.report('stock_summary'))

  // --- primary sources ------------------------------------------------------

  const stock = useQuery((signal) => fetchStockValue(scope.asOf, signal), [scope.scopeKey, scope.asOf], {
    enabled: enabled && canReadStock,
    resetKey: scope.scopeKey,
  })
  const ageing = useQuery((signal) => fetchAgeing(scope.asOf, signal), [scope.scopeKey, scope.asOf], {
    enabled: enabled && can(P.report('stock_ageing')),
    resetKey: scope.scopeKey,
  })
  const warehouses = useQuery((signal) => fetchWarehouseSplit(scope.asOf, signal), [scope.scopeKey, scope.asOf], {
    enabled: enabled && can(P.report('warehouse_stock')),
    resetKey: scope.scopeKey,
  })
  const movement = useQuery(
    (signal) => fetchMovementMix(scope.period.from || scope.asOf, scope.period.to || scope.asOf, signal),
    [scope.scopeKey, scope.period.from, scope.period.to],
    { enabled: enabled && can(P.report('movement_analysis')), resetKey: scope.scopeKey },
  )
  const expiry = useQuery(
    (signal) => fetchExpiry(EXPIRY_WINDOW_DAYS, scope.asOf, signal),
    [scope.scopeKey, scope.asOf],
    { enabled: enabled && can(P.report('near_expiry')), resetKey: scope.scopeKey },
  )
  const bridge = useQuery(
    async (signal) => {
      const envelope = await fetchValuationBridge(
        scope.period.from || scope.asOf,
        scope.asOf,
        warehouseId,
        signal,
      )
      return expected ? assertScope(envelope, expected) : envelope
    },
    [scope.scopeKey, scope.period.from, scope.asOf, warehouseId],
    { enabled: enabled && can(P.dashboard), resetKey: scope.scopeKey },
  )

  /**
   * When the deferred panels may go.
   *
   * A query that is switched off never lands, so a reader who may compare
   * valuation methods but may not read the stock summary would otherwise wait
   * on a request that is never made and watch a skeleton for ever. A disabled
   * source counts as settled.
   */
  const primarySettled = !canReadStock || stock.data !== null || stock.error !== null

  // --- deferred sources -----------------------------------------------------

  const comparedTo = useMemo(() => previousPeriodEnd(scope.asOf, fyRange.from), [scope.asOf, fyRange.from])

  const previousStock = useQuery(
    (signal) => fetchStockValue(comparedTo as string, signal),
    [scope.scopeKey, comparedTo],
    {
      enabled: enabled && canReadStock && comparedTo !== null && primarySettled,
      resetKey: scope.scopeKey,
    },
  )

  const methods = useQuery(
    (signal) => fetchMethodComparison(scope.asOf, warehouseId, signal),
    [scope.scopeKey, scope.asOf, warehouseId],
    { enabled: enabled && canCompareMethods && primarySettled, resetKey: scope.scopeKey },
  )

  const queries = [stock, ageing, warehouses, movement, expiry, bridge, previousStock, methods]
  const refreshing = queries.some((q) => q.loading)
  const lastSyncedAt = useSyncStamp(refreshing)

  // Through a ref rather than a dependency array: `queries.map(q => q.reload)`
  // is a variable-length deps list, which React rejects outright, and listing
  // eight reloads by hand drifts the moment a ninth query is added.
  const reloadsRef = useRef<(() => void)[]>([])
  reloadsRef.current = queries.map((q) => q.reload)
  const refreshAll = useCallback(() => {
    for (const reload of reloadsRef.current) reload()
  }, [])

  // --- derived --------------------------------------------------------------

  const bridgeData = bridge.data?.data ?? null
  const steps = useMemo(() => (bridgeData ? bridgeSteps(bridgeData) : []), [bridgeData])
  const closure = useMemo(() => (bridgeData ? bridgeCloses(bridgeData) : null), [bridgeData])

  const ages = useMemo(() => ageingView(ageing.data, scope.asOf, ageingBasis), [ageing.data, scope.asOf, ageingBasis])
  /**
   * Buckets that are an exception under EITHER measure.
   *
   * A bucket can be positive in value and negative in quantity, and either way
   * it is a cost layer consumed past its own quantity — something to look at,
   * and not a slice of any whole. Counting only the measure the toggle happens
   * to be showing would make an exception appear and disappear as the reader
   * switches a view control.
   */
  const negativeBuckets = useMemo(() => {
    const byValue = ageingView(ageing.data, scope.asOf, 'value').negatives
    const byQty = ageingView(ageing.data, scope.asOf, 'quantity').negatives
    return new Set([...byValue, ...byQty].map((b) => b.key)).size
  }, [ageing.data, scope.asOf])
  const unknownAge = useMemo(() => unknownAgeNote(ageing.data), [ageing.data])
  const movementBars = useMemo(() => movementSeriesForValuation(movement.data), [movement.data])
  const thresholds = useMemo(() => movementThresholds(movement.data), [movement.data])
  const warehouseBars = useMemo(() => warehouseSeries(warehouses.data, scope.asOf), [warehouses.data, scope.asOf])

  const healthInput = useMemo<ValuationHealthInput>(
    () => ({
      stock: stock.data
        ? {
            closingValue: stock.data.summary.closing_value,
            closingQty: stock.data.summary.closing_qty,
            items: stock.data.summary.items,
            topItems: stock.data.topItems,
          }
        : null,
      ageing: ageing.data,
      movement: movement.data,
      expiry: expiry.data ? { summary: expiry.data.summary, expiringSoon: expiry.data.expiringSoon, expired: expiry.data.expired } : null,
      warehouses: warehouses.data,
      bridge: bridgeData,
      negativeAgeingBuckets: negativeBuckets,
      asOf: scope.asOf,
      period: scope.period,
    }),
    [stock.data, ageing.data, movement.data, expiry.data, warehouses.data, bridgeData, negativeBuckets, scope.asOf, scope.period],
  )

  const health = useMemo(() => stockHealth(healthInput), [healthInput])
  const risks = useMemo(() => atRiskRows(healthInput), [healthInput])
  const actions = useMemo(() => suggestedActions(healthInput), [healthInput])
  const chips = useMemo(() => insightChips(healthInput), [healthInput])
  const concentration = useMemo(
    () => topItemConcentration(stock.data?.topItems, stock.data?.summary.closing_value),
    [stock.data],
  )

  const methodTable = useMemo(() => (methods.data ? methodRows(methods.data) : []), [methods.data])
  const methodsAnswered = answeredMethods(methodTable)
  const spread = useMemo(() => methodSpread(methodTable), [methodTable])

  const slow = movement.data?.by_class.slow ?? null
  const nonMoving = movement.data?.by_class.non_moving ?? null
  const dead = movement.data?.by_class.dead ?? null

  const old180 = ageingValue(ageing.data, '180_plus')
  const ageTotal = ageing.data?.total_value ?? null

  const valueDelta = useMemo(
    () => deltaPercent(stock.data?.summary.closing_value, previousStock.data?.summary.closing_value),
    [stock.data, previousStock.data],
  )
  const qtyDelta = useMemo(
    () => deltaPercent(stock.data?.summary.closing_qty, previousStock.data?.summary.closing_qty),
    [stock.data, previousStock.data],
  )

  // Expiry rows and the expiry KPI come from ONE response, so the rows on the
  // card always belong to the figure above them.
  const expiringRows = useMemo(() => (expiry.data?.rows ?? []).filter((r) => !r.is_expired), [expiry.data])
  const expiringValue = useMemo(() => expiringRows.reduce((acc, r) => acc + r.stock_value, 0), [expiringRows])

  const anyDataKnown = queries.some((q) => q.data !== null)
  const erroredCount = queries.filter((q) => q.error !== null).length
  const syncState: SyncState = running
    ? 'recalculating'
    : refreshing
      ? 'refreshing'
      : erroredCount === 0
        ? 'synced'
        : erroredCount === queries.length
          ? 'failed'
          : 'partial'

  /**
   * Nothing to value in this scope.
   *
   * Only when the stock summary says there is not one item carrying stock AND
   * the movement report has nothing to classify. The movement clause matters:
   * a company whose closing value is zero while a balance sits below zero has a
   * problem, not an empty warehouse, and replacing the dashboard with "no stock
   * here" would hide the very thing someone needs to see.
   */
  const movementItems = movement.data
    ? (['fast', 'slow', 'non_moving', 'dead'] as const).reduce((acc, k) => acc + (movement.data?.by_class[k]?.items ?? 0), 0)
    : 0
  const emptyScope =
    stock.data !== null &&
    stock.data.summary.items === 0 &&
    stock.data.summary.closing_value === 0 &&
    movementItems === 0

  // --- actions --------------------------------------------------------------

  const warehouseLabel =
    warehouseId === null
      ? 'All warehouses'
      : (scope.warehouses.find((w) => w.warehouse_id === warehouseId)?.warehouse_name ?? 'Selected warehouse')

  const runValuation = useCallback(
    async ({ fromDate, dryRun }: { fromDate: string; dryRun: boolean }) => {
      // Guard rather than trust the disabled button: a double submit is a
      // second live re-costing, and this one publishes revisions to Books.
      if (running) return
      if (!scope.scope) {
        setRunError('Select a company and financial year before running a valuation.')
        return
      }
      setRunning(true)
      setRunError(null)
      try {
        const job = await valuationApi.enqueueRecalc({ from_date: fromDate, dry_run: dryRun, run_now: true })
        setRunOpen(false)
        toast.success(
          `Valuation ${dryRun ? 'dry run' : 'recalculation'} #${job.job_id} ${job.status.toLowerCase()}` +
            (job.revised_line_count !== null
              ? ` — ${formatInt(job.revised_line_count)} lines revised, COGS delta ${formatMoney(job.cogs_delta)}.`
              : '.'),
        )
        // Only a live run changes the figures on screen; a dry run writes
        // nothing, so re-reading every report after one is pure cost.
        if (!dryRun) refreshAll()
      } catch (e) {
        setRunError(errorMessage(e, 'The valuation could not be run. Try again in a moment.'))
      } finally {
        setRunning(false)
      }
    },
    [running, scope.scope, toast, refreshAll],
  )

  const onAgeingBasis = useCallback((next: AgeingBasis) => {
    setAgeingBasis(next)
    try {
      window.sessionStorage.setItem(AGEING_BASIS_KEY, next)
    } catch {
      /* A browser that cannot remember it simply opens on Value next time. */
    }
  }, [])

  const onExport = useCallback(() => {
    setExporting(true)
    try {
      exportDashboardPdf({
        title: 'Valuation and stock health',
        description: view.description,
        companyName,
        fyLabel: fy?.label ?? 'Financial year',
        branchLabel: branch ? branch.name : 'All branches',
        warehouseLabel,
        asOf: scope.asOf,
        generatedAt: bridge.data?.meta.generated_at ?? null,
        metrics: [
          ['Stock health score', health.score === null ? null : `${health.score} / 100 — ${health.label}`, `Rule-based score over ageing, movement, expiry, concentration and inventory exceptions. ${health.assessed} of ${health.total} factors could be read.`],
          ['Closing stock value', stock.data ? formatCurrencyCompact(stock.data.summary.closing_value) : null, `Value at cost of every item carrying stock as at ${scope.asOf}, under each item's own costing method.`],
          ['Stock on hand', stock.data ? `${formatQtyCompact(stock.data.summary.closing_qty)} units` : null, `Closing quantity across ${stock.data ? formatCount(stock.data.summary.items) : '—'} items carrying stock.`],
          ['Slow moving', slow ? `${formatCount(slow.items)} items` : null, thresholds[1] ? `Items ${thresholds[1].detail}. Counted in items, not value — the movement report measures items and quantity per class, not cost.` : ''],
          ['Non-moving', nonMoving ? `${formatCount(nonMoving.items)} items` : null, thresholds[2]?.detail ?? ''],
          ['Dead stock', dead ? `${formatCount(dead.items)} items` : null, thresholds[3]?.detail ?? ''],
          [`Expiring within ${EXPIRY_WINDOW_DAYS} days`, expiry.data ? formatCount(expiry.data.expiringSoon) : null, 'Batches with an expiry date inside the window that have not expired. Expired batches are counted separately and never folded in.'],
          ['Expired on hand', expiry.data ? formatCount(expiry.data.expired) : null, 'Batches already past their expiry date with stock still on hand.'],
          ['Capital in ageing stock', old180 === null ? null : formatCurrencyCompact(old180), 'Value at cost of stock whose remaining cost layers were received 180 days or more before the as-at date.'],
        ],
        tables: [
          {
            title: 'Inventory value bridge',
            note: closure && !closure.closes
              ? `The steps below do not reach the closing value; the difference of ${formatCurrencyCompact(closure.residual)} is shown as Unexplained rather than absorbed into a step.`
              : undefined,
            numericColumns: [1],
            columns: ['Step', 'Amount at cost', 'Basis'],
            rows: bridgeData
              ? [
                  ['Opening', formatCurrencyCompact(bridgeData.opening.value as number), bridgeData.opening.definition],
                  ...steps.map((s) => [s.label, s.display, s.sub ?? '']),
                  ['Closing', formatCurrencyCompact(bridgeData.closing.value as number), bridgeData.closing.definition],
                ]
              : [],
          },
          {
            // The columns follow the toggle. `ages` is built on the basis the
            // reader chose, so a fixed "Value at cost" heading would print unit
            // counts under it the moment they switched to Quantity.
            title: `Ageing of remaining stock (by ${ageingBasis === 'value' ? 'value' : 'quantity'})`,
            note: ages.compositionInvalid
              ? 'Shares are taken over the non-negative buckets only; any negative bucket is listed separately as an exception rather than forced into a percentage split.'
              : undefined,
            numericColumns: [1, 2, 3],
            columns: [
              'Age bucket',
              ageingBasis === 'value' ? 'Value at cost' : 'Quantity',
              'Share',
              ageingBasis === 'value' ? 'Quantity' : 'Value at cost',
            ],
            rows: [
              ...ages.buckets.map((b) => [b.label, b.display, `${b.share.toFixed(0)}%`, b.sub ?? '']),
              ...ages.negatives.map((b) => [`${b.label} (negative)`, b.display, 'Excluded', b.sub ?? '']),
            ],
          },
          {
            title: 'At-risk inventory',
            numericColumns: [],
            columns: ['Risk', 'Level', 'Detail'],
            rows: risks.map((r) => [r.title, r.level.toUpperCase(), r.detail]),
          },
          {
            title: 'Value by warehouse',
            numericColumns: [1, 2],
            columns: ['Warehouse', 'Value at cost', 'Share', 'Quantity'],
            rows: warehouseBars.map((w) => [w.label, w.display, `${w.share.toFixed(0)}%`, w.sub ?? '']),
          },
          {
            title: 'Movement classification',
            note: 'Counted in items and quantity on hand. The movement report carries no value per class, so no currency column is shown.',
            numericColumns: [1, 3],
            columns: ['Category', 'Items', 'On hand', '% of items'],
            rows: movementBars.map((m) => [m.label, m.display, m.sub ?? '', `${m.share.toFixed(0)}%`]),
          },
          ...(methodTable.length > 0
            ? [
                {
                  title: 'Valuation method comparison',
                  note: 'Comparison only. The books are kept on "As per item master"; the other methods are counterfactual and nothing here revalues anything.',
                  numericColumns: [1, 2],
                  columns: ['Method', 'Stock value', 'Variance vs basis', 'Status'],
                  rows: methodTable.map((r) => [
                    r.label,
                    r.value === null ? 'Unavailable' : formatCurrencyCompact(r.value),
                    r.isBasis ? '—' : r.variancePercent === null ? '—' : `${r.variancePercent > 0 ? '+' : ''}${r.variancePercent.toFixed(1)}%`,
                    r.statusLabel,
                  ]),
                },
              ]
            : []),
          {
            title: `Batches expiring within ${EXPIRY_WINDOW_DAYS} days`,
            note: `Rows and the expiring figure above come from the same response, so they describe the same set. Total on these rows: ${formatCurrencyCompact(expiringValue)}.`,
            numericColumns: [4, 5],
            columns: ['Item', 'Batch', 'Expiry', 'Days left', 'Quantity', 'Value at cost'],
            rows: expiringRows.map((r) => [
              r.item_name ?? `Item ${r.item_id}`,
              r.batch_no ?? '—',
              formatDate(r.expiry_date),
              String(r.days_to_expiry),
              `${formatQty(r.on_hand)} ${r.unit_symbol ?? ''}`,
              formatCurrencyCompact(r.stock_value),
            ]),
          },
        ],
        notes: [
          'Every figure on this sheet is at COST, under each item\'s own configured costing method (FIFO, LIFO or weighted average). No commercial value, tax or margin appears here; those belong to Books.',
          'Net realizable value is not reported: Inventory records what stock cost, and holds no expected selling price net of the cost to sell.',
          bridgeData?.definition ?? '',
          bridgeData && bridgeData.unvalued_movements > 0
            ? `${bridgeData.unvalued_movements} movements in this period carry no value, so the bridge is short by whatever they were worth.`
            : '',
          unknownAge ?? '',
          comparedTo && previousStock.data
            ? `Period comparison is against ${formatDate(comparedTo)}, read from the same stock summary under the same scope.`
            : 'No prior-period comparison is included: only the stock summary answers an earlier date under this scope.',
          'Ageing measures how long stock still on hand has been held. Movement class measures how recently the item last moved. They are different questions and are never added together.',
        ].filter(Boolean),
      })
    } finally {
      setExporting(false)
    }
  }, [
    view, companyName, fy, branch, warehouseLabel, scope.asOf, bridge.data, bridgeData, steps, closure,
    stock.data, slow, nonMoving, dead, thresholds, expiry.data, ages, ageingBasis, warehouseBars, expiringRows,
    expiringValue, unknownAge, health, risks, movementBars, methodTable, old180, comparedTo, previousStock.data,
  ])

  // --- render ---------------------------------------------------------------

  const header = (
    <DashboardPageHeader
      title="Valuation and stock health"
      description={view.description}
      companyName={companyName}
      fyLabel={fy?.label ?? 'Financial year'}
      branchLabel={branch ? branch.name : 'All branches'}
      asOf={scope.asOf}
      onAsOf={scope.setAsOf}
      maxDate={todayIso()}
      warehouses={scope.warehouses}
      warehouseId={warehouseId}
      onWarehouseId={scope.setWarehouseId}
      warehouseDropped={scope.warehouseDropped}
      refreshing={refreshing}
      onRefresh={refreshAll}
      lastSyncedAt={lastSyncedAt}
      onExport={canExport ? onExport : undefined}
      exporting={exporting}
      actions={
        canRunValuation ? (
          <Button
            variant="primary"
            icon={Play}
            onClick={() => {
              setRunError(null)
              setRunOpen(true)
            }}
            disabled={running || !scope.ready}
            loading={running}
            className="h-8"
          >
            {running ? 'Running…' : 'Run valuation'}
          </Button>
        ) : null
      }
    />
  )

  const runDialog = canRunValuation ? (
    <RunValuationDialog
      open={runOpen}
      fyStart={fyRange.from}
      defaultFrom={scope.period.from || fyRange.from || scope.asOf}
      maxDate={scope.asOf}
      busy={running}
      error={runError}
      onConfirm={runValuation}
      onCancel={() => {
        if (!running) setRunOpen(false)
      }}
    />
  ) : null

  if (emptyScope) {
    return (
      <div className="space-y-3">
        {header}
        <Card padding="lg">
          <EmptyState
            icon={Layers}
            title="No stock value for this date and warehouse"
            description={`Nothing carries stock in ${warehouseLabel.toLowerCase()} as at ${formatDate(scope.asOf)}. Try another date or warehouse, or record opening and inward stock before running a valuation.`}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="secondary" onClick={() => scope.setAsOf(todayIso())}>
                  Reset to today
                </Button>
                <Link
                  to="/registers/stock-balances"
                  className="inline-flex h-8 items-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 no-underline transition-colors hover:border-primary/40 hover:text-primary"
                >
                  View stock balances
                </Link>
                <Link
                  to="/items"
                  className="inline-flex h-8 items-center rounded-lg border border-primary/40 bg-white px-3 text-sm font-medium text-primary no-underline transition-colors hover:bg-primary-light"
                >
                  Add opening stock
                </Link>
              </div>
            }
          />
        </Card>
        <InventoryInsightBar chips={[]} state={syncState} lastSyncedAt={lastSyncedAt} />
        {runDialog}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {header}

      <StockHealthHero
        health={health}
        actions={actions}
        anyDataKnown={anyDataKnown}
        lastSyncedAt={lastSyncedAt}
        loading={refreshing}
      />

      <section aria-label="Valuation summary" className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="Closing stock value"
          value={stock.data ? formatCurrencyCompact(stock.data.summary.closing_value) : null}
          numeric={stock.data?.summary.closing_value ?? null}
          definition={`Value at cost of every item carrying stock as at ${scope.asOf}, under each item's own costing method. Cost, not selling value.`}
          hint={
            valueDelta ? (
              <DeltaChip delta={valueDelta} comparedTo={comparedTo} goodWhen="none" />
            ) : (
              'At cost'
            )
          }
          icon={Coins}
          tone="success"
          loading={stock.loading && !stock.data}
          error={stock.error}
          onRetry={stock.reload}
          to={drill.stockValue({ asOf: scope.asOf })}
          emphasizeNegative
        />
        <MetricCard
          label="Stock on hand"
          value={stock.data ? `${formatQtyCompact(stock.data.summary.closing_qty)} units` : null}
          numeric={stock.data?.summary.closing_qty ?? null}
          definition={`Closing quantity across every item carrying stock as at ${scope.asOf}. Quantity, in each item's own base unit — not added across different units.`}
          hint={
            qtyDelta ? (
              <DeltaChip delta={qtyDelta} comparedTo={comparedTo} goodWhen="none" />
            ) : stock.data ? (
              `${formatCount(stock.data.summary.items)} items`
            ) : undefined
          }
          icon={PackageCheck}
          tone="primary"
          loading={stock.loading && !stock.data}
          error={stock.error}
          onRetry={stock.reload}
          to={drill.stockQty({ asOf: scope.asOf })}
          emphasizeNegative
        />
        <MetricCard
          label="Slow moving"
          value={slow ? `${formatCount(slow.items)} items` : null}
          numeric={slow?.items ?? null}
          definition={
            thresholds[1]
              ? `Items ${thresholds[1].detail}. Counted in items and quantity, because the movement report measures those per class — not cost.`
              : 'Items whose last issue falls in the slow-moving window.'
          }
          hint={slow ? `${formatQtyCompact(slow.on_hand)} units on hand` : undefined}
          icon={Clock}
          tone="warning"
          loading={movement.loading && !movement.data}
          error={movement.error}
          onRetry={movement.reload}
          to={drill.movementAnalysis({ from: scope.period.from, to: scope.period.to, cls: 'slow' })}
        />
        <MetricCard
          label="Non-moving"
          value={nonMoving ? `${formatCount(nonMoving.items)} items` : null}
          numeric={nonMoving?.items ?? null}
          definition={
            thresholds[2]
              ? `Items ${thresholds[2].detail}. Movement class, not age: an item can be non-moving and hold only recent stock.`
              : 'Items with no issue in the non-moving window.'
          }
          hint={nonMoving ? `${formatQtyCompact(nonMoving.on_hand)} units on hand` : undefined}
          icon={AlertTriangle}
          tone="danger"
          loading={movement.loading && !movement.data}
          error={movement.error}
          onRetry={movement.reload}
          to={drill.movementAnalysis({ from: scope.period.from, to: scope.period.to, cls: 'non_moving' })}
          badge={(dead?.items ?? 0) > 0 ? { label: `${formatCount(dead?.items ?? 0)} dead`, tone: 'danger' } : undefined}
        />
        <MetricCard
          label={`Expiring in ${EXPIRY_WINDOW_DAYS}d`}
          value={expiry.data ? `${formatCount(expiry.data.expiringSoon)} ${expiry.data.expiringSoon === 1 ? 'batch' : 'batches'}` : null}
          numeric={expiry.data?.expiringSoon ?? null}
          definition={`Batches with an expiry date inside the next ${EXPIRY_WINDOW_DAYS} days that have NOT yet expired. Batches already expired are a separate figure and are never folded in here.`}
          hint={expiry.data ? `${formatCount(expiry.data.expired)} already expired` : undefined}
          icon={CalendarClock}
          tone="warning"
          loading={expiry.loading && !expiry.data}
          error={expiry.error}
          onRetry={expiry.reload}
          to={drill.nearExpiry({ days: EXPIRY_WINDOW_DAYS, includeExpired: false })}
          badge={(expiry.data?.expired ?? 0) > 0 ? { label: 'Expired on hand', tone: 'danger' } : undefined}
        />
        <MetricCard
          label="Capital in ageing stock"
          value={old180 === null ? null : formatCurrencyCompact(old180)}
          numeric={old180}
          definition="Value at cost of stock whose remaining cost layers were received 180 days or more before the as-at date. This is the capital sitting in the oldest bucket — not a write-down, and not a judgement that the stock is unsaleable."
          hint={
            old180 !== null && ageTotal !== null && ageTotal > 0
              ? `${percentOf(Math.max(0, old180), ageTotal).toFixed(0)}% of stock value`
              : undefined
          }
          icon={PieChart}
          tone="violet"
          loading={ageing.loading && !ageing.data}
          error={ageing.error}
          onRetry={ageing.reload}
          to={drill.stockAgeing({ asOf: scope.asOf })}
          emphasizeNegative
        />
      </section>

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-12">
        <WidgetCard
          className="lg:col-span-6 xl:col-span-5"
          title="Inventory value bridge"
          description={`Movement in value at cost, ${formatDate(scope.period.from)} to ${formatDate(scope.asOf)}`}
          icon={BarChart3}
          tone="primary"
          errorSubject="the inventory value bridge"
          state={{
            loading: bridge.loading && !bridgeData,
            error: bridge.error,
            empty: bridgeData !== null && steps.length === 0 && (bridgeData.opening.value ?? 0) === 0,
            reload: bridge.reload,
          }}
          skeleton={<Skeleton height="h-[260px]" />}
          emptyTitle="Nothing has been valued yet"
          emptyDescription="Posted, valued stock movements build this walk from opening to closing."
          emptyIcon={BarChart3}
          footer={
            bridgeData ? (
              <span>
                {bridgeData.definition}
                {bridgeData.unvalued_movements > 0 ? (
                  <>
                    {' '}
                    <strong className="text-amber-700">
                      {formatCount(bridgeData.unvalued_movements)} movements carry no value.
                    </strong>
                  </>
                ) : null}
              </span>
            ) : undefined
          }
        >
          {bridgeData ? (
            <BridgeChart
              openingLabel="Opening"
              opening={(bridgeData.opening.value as number) ?? 0}
              openingDisplay={formatCurrencyCompact(bridgeData.opening.value)}
              closingLabel="Closing"
              closing={(bridgeData.closing.value as number) ?? 0}
              closingDisplay={formatCurrencyCompact(bridgeData.closing.value)}
              steps={steps}
              formatValue={(n) => formatCurrencyCompact(n)}
              height={260}
              caption={`Inventory value at cost from ${formatDate(scope.period.from)} to ${formatDate(scope.asOf)}: opening, receipts, issues, adjustments and transfers, reaching the closing value.`}
            />
          ) : null}
        </WidgetCard>

        <WidgetCard
          className="lg:col-span-6 xl:col-span-4"
          title="Ageing of remaining stock"
          description={ageingBasis === 'value' ? 'Value-wise ageing distribution, at cost' : 'Quantity-wise ageing distribution'}
          icon={Layers}
          tone="info"
          errorSubject="stock ageing"
          state={{
            loading: ageing.loading && !ageing.data,
            error: ageing.error,
            empty: ages.buckets.length === 0 && ages.negatives.length === 0,
            reload: ageing.reload,
          }}
          skeleton={<Skeleton height="h-[220px]" />}
          emptyTitle="No ageing to show"
          emptyDescription="Ageing appears once remaining cost layers carry receipt dates."
          emptyIcon={Layers}
          viewAll={{ to: drill.stockAgeing({ asOf: scope.asOf }), label: 'Full report' }}
          footer={
            <>
              {ages.compositionInvalid ? (
                <span className="text-amber-700">
                  Shares are over the non-negative buckets only — a negative bucket cannot be a slice of a whole.
                </span>
              ) : (
                <span>Age of the cost layers still on hand, not of the items themselves.</span>
              )}
              {unknownAge ? <span className="mt-1 block">{unknownAge}</span> : null}
            </>
          }
        >
          <div className="-mt-1 mb-2 flex justify-end print:hidden">
            <SegmentedControl<AgeingBasis>
              value={ageingBasis}
              onChange={onAgeingBasis}
              options={[
                { value: 'value', label: 'Value', title: 'Split the buckets by value at cost' },
                { value: 'quantity', label: 'Quantity', title: 'Split the buckets by quantity on hand' },
              ]}
            />
          </div>
          <AgeingDonut
            items={ages.buckets}
            centerValue={ages.totalDisplay}
            centerLabel={ages.totalLabel}
            measureLabel={ageingBasis === 'value' ? 'value at cost' : 'quantity on hand'}
          />
          {ages.negatives.length > 0 ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-2">
              <p className="text-[11px] font-semibold text-amber-800">Negative buckets, shown as exceptions</p>
              <ul className="mt-1 space-y-0.5">
                {ages.negatives.map((b) => (
                  <li key={b.key} className="flex justify-between gap-2 text-[11px] text-amber-900">
                    <span className="truncate">{b.label}</span>
                    <span className="shrink-0 tabular-nums">{b.display}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </WidgetCard>

        <WidgetCard
          className="lg:col-span-12 xl:col-span-3"
          title="At-risk inventory"
          description={
            risks.length === 0
              ? 'Risks appear once their reports have loaded'
              : `${formatCount(riskAttentionCount(risks))} of ${formatCount(risks.length)} need attention`
          }
          icon={ShieldAlert}
          tone="rose"
          errorSubject="the risk summary"
          state={{
            // Derived from the cards around it, so it has no request and no
            // error of its own: it is empty until one of them answers.
            loading: refreshing && risks.length === 0,
            error: null,
            empty: risks.length === 0,
          }}
          skeleton={<SkeletonRows rows={4} />}
          emptyTitle="No risks assessed yet"
          emptyDescription="Expiry, movement, ageing and concentration risks appear as their reports land."
          emptyIcon={ShieldCheck}
          viewAll={{ to: '/registers/valuation', label: 'View all' }}
          footer={
            concentration ? (
              <span>
                The dearest {formatCount(concentration.items)} items hold{' '}
                {formatCurrencyCompact(concentration.value)} — {concentration.share.toFixed(0)}% of stock value.
              </span>
            ) : undefined
          }
        >
          <RiskList rows={risks} />
        </WidgetCard>

        <WidgetCard
          className="lg:col-span-6 2xl:col-span-4"
          title="Value by warehouse"
          description="Where the capital is sitting, at cost"
          icon={Warehouse}
          tone="primary"
          errorSubject="the warehouse split"
          state={{
            loading: warehouses.loading && !warehouses.data,
            error: warehouses.error,
            empty: warehouseBars.length === 0,
            reload: warehouses.reload,
          }}
          skeleton={<SkeletonRows rows={4} />}
          emptyTitle="No stock in any warehouse"
          emptyDescription="Warehouses appear here once they carry valued stock."
          emptyIcon={Warehouse}
          viewAll={{ to: drill.warehouseStock({ asOf: scope.asOf }), label: 'Full report' }}
          footer={
            warehouses.data
              ? `${formatCurrencyCompact(warehouses.data.closing_value)} across ${formatCount(warehouseBars.length)} warehouses`
              : undefined
          }
        >
          <BarList items={warehouseBars} showShare limit={6} />
        </WidgetCard>

        <WidgetCard
          className="lg:col-span-6 2xl:col-span-4"
          title="Movement classification"
          description="How recently each item last moved"
          icon={Clock}
          tone="violet"
          errorSubject="movement classification"
          state={{
            loading: movement.loading && !movement.data,
            error: movement.error,
            empty: movementBars.every((b) => b.value === 0),
            reload: movement.reload,
          }}
          skeleton={<SkeletonRows rows={4} />}
          emptyTitle="No movement in the period"
          emptyDescription="Items are classified once there are issues to measure them against."
          emptyIcon={Clock}
          viewAll={{ to: drill.movementAnalysis({ from: scope.period.from, to: scope.period.to }), label: 'Full report' }}
          footer={
            thresholds.length > 0 ? (
              <span>
                {/* The thresholds are on the card, not in a tooltip: someone may
                    write stock off on the strength of this classification. */}
                {thresholds.map((t) => `${t.label}: ${t.detail}`).join(' · ')}
              </span>
            ) : undefined
          }
        >
          <MovementClassTable
            rows={movementBars}
            caption={`Items per movement class between ${formatDate(scope.period.from)} and ${formatDate(scope.period.to)}, with quantity on hand.`}
          />
        </WidgetCard>

        {canCompareMethods ? (
          <WidgetCard
            className="lg:col-span-6 2xl:col-span-4"
            title="Valuation method comparison"
            description="Compare inventory valuation methods"
            icon={Scale}
            tone="teal"
            errorSubject="the method comparison"
            state={{
              loading: (methods.loading || !primarySettled) && !methods.data,
              error: methods.error,
              empty: methods.data !== null && methodsAnswered === 0,
              reload: methods.reload,
            }}
            skeleton={<SkeletonRows rows={4} />}
            emptyTitle="No method could be valued"
            emptyDescription="The valuation engine did not answer for this date. Try another date, or open the full comparison."
            emptyIcon={Scale}
            viewAll={{ to: `/valuation/method-comparison?as_of=${scope.asOf}`, label: 'See details' }}
            footer={
              <span>
                Comparison only — nothing here revalues or switches a method.
                {spread && spread.amount > 0 ? (
                  <>
                    {' '}
                    Widest spread {formatCurrencyCompact(spread.amount)}
                    {spread.percentOfBasis !== null ? ` (${spread.percentOfBasis.toFixed(1)}% of the basis)` : ''}.
                  </>
                ) : null}
                {methodsAnswered > 0 && methodsAnswered < methodTable.length ? (
                  <span className="mt-1 block text-amber-700">
                    {methodTable.length - methodsAnswered} of {methodTable.length} methods could not be valued at this date.
                  </span>
                ) : null}
              </span>
            }
          >
            <MethodComparisonTable rows={methodTable} />
          </WidgetCard>
        ) : null}
      </div>

      <WidgetCard
        title="Batch and expiry watch"
        description={`Batches expiring within ${EXPIRY_WINDOW_DAYS} days, soonest first`}
        icon={CalendarClock}
        tone="warning"
        errorSubject="expiring batches"
        state={{
          loading: expiry.loading && !expiry.data,
          error: expiry.error,
          empty: expiringRows.length === 0,
          reload: expiry.reload,
        }}
        skeleton={<SkeletonRows rows={4} />}
        emptyTitle="Nothing is expiring soon"
        emptyDescription={`No batch with stock on hand expires within ${EXPIRY_WINDOW_DAYS} days.`}
        emptyIcon={ShieldCheck}
        viewAll={{ to: drill.nearExpiry({ days: EXPIRY_WINDOW_DAYS, includeExpired: false }), label: 'Full report' }}
        footer={
          expiry.data ? (
            <span>
              {/* Rows and the KPI come from one response, so this total always
                  describes the rows above it. */}
              {formatCount(expiringRows.length)} of {formatCount(expiry.data.expiringSoon)} expiring batches shown ·{' '}
              {formatCurrencyCompact(expiringValue)} at cost on these rows
              {expiry.data.expired > 0
                ? ` · ${formatCount(expiry.data.expired)} batches have already expired and are listed separately`
                : ''}
            </span>
          ) : undefined
        }
      >
        <MiniTable<NearExpiryRow>
          caption="Batches with stock on hand expiring inside the window, with quantity and value at cost."
          rows={expiringRows}
          rowKey={(r) => `${r.batch_id}-${r.warehouse_id ?? 0}`}
          to={(r) => drill.nearExpiry({ days: EXPIRY_WINDOW_DAYS, includeExpired: false, itemId: r.item_id })}
          rowLabel={(r) => `${r.item_name ?? r.item_id}, batch ${r.batch_no ?? r.batch_id}`}
          minWidth={620}
          columns={[
            {
              key: 'item',
              header: 'Item',
              render: (r) => (
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-gray-900">{r.item_name ?? `Item ${r.item_id}`}</p>
                  <p className="truncate text-[11px] text-gray-500">{r.warehouse_name ?? 'No warehouse'}</p>
                </div>
              ),
            },
            { key: 'batch', header: 'Batch', render: (r) => <span className="text-xs text-gray-700">{r.batch_no ?? '—'}</span> },
            { key: 'expiry', header: 'Expiry', render: (r) => <span className="text-xs text-gray-700">{formatDate(r.expiry_date)}</span> },
            {
              key: 'days',
              header: 'Days left',
              align: 'right',
              cellClassName: 'tabular-nums',
              render: (r) => (
                <Badge tone={r.days_to_expiry <= 7 ? 'danger' : r.days_to_expiry <= 15 ? 'warning' : 'neutral'} size="xs">
                  {r.days_to_expiry} d
                </Badge>
              ),
            },
            {
              key: 'qty',
              header: 'Quantity',
              align: 'right',
              cellClassName: 'tabular-nums',
              render: (r) => (
                <span className="text-xs text-gray-900">
                  {formatQty(r.on_hand)} {r.unit_symbol ?? ''}
                </span>
              ),
            },
            {
              key: 'value',
              header: 'Value at cost',
              align: 'right',
              cellClassName: 'tabular-nums',
              render: (r) => <span className="text-xs font-semibold text-gray-900">{formatCurrencyCompact(r.stock_value)}</span>,
            },
          ]}
        />
      </WidgetCard>

      {closure && !closure.closes ? (
        <Notice kind="warning" title="The value bridge does not close">
          The steps shown add to {formatCurrencyCompact((bridgeData?.opening.value as number) ?? 0)} plus movements, which
          is {formatCurrencyCompact(closure.residual)} away from the closing value. The gap is drawn as its own
          &ldquo;Unexplained&rdquo; bar rather than folded into a step — it usually means movements posted with no value
          against them.
        </Notice>
      ) : null}

      <InventoryInsightBar chips={chips} state={syncState} lastSyncedAt={lastSyncedAt} />

      {runDialog}
    </div>
  )
}

export default ValuationDashboard
