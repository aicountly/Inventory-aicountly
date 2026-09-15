import { useCallback, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  Clock,
  Coins,
  Layers,
  ShieldCheck,
  Warehouse,
} from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { Badge } from '../../ui/Badge'
import { Notice } from '../../components/Notice'
import { formatDate, formatQty, todayIso } from '../../utils/format'
import { assertScope, fetchValuationBridge } from '../aggregatesApi'
import { BridgeChart } from '../charts/BridgeChart'
import { BarList } from '../charts/BarList'
import { DashboardPageHeader } from '../components/DashboardPageHeader'
import { MetricCard } from '../components/MetricCard'
import { MiniTable } from '../components/MiniTable'
import { PulseBriefing } from '../components/PulseBriefing'
import { WidgetCard } from '../components/WidgetCard'
import { fetchAgeing, fetchExpiry, fetchMovementMix, fetchStockValue, fetchWarehouseSplit } from '../dashboardApi'
import { exportDashboardPdf } from '../dashboardExport'
import { formatCount, formatCurrencyCompact, formatQtyCompact } from '../formatters'
import { drill } from '../kpiNavigation'
import { warehouseSeries } from '../model'
import { buildPulseFindings } from '../pulse'
import { useSyncStamp } from '../useSyncStamp'
import {
  ageingView,
  bridgeCloses,
  bridgeSteps,
  movementSeriesForValuation,
  movementThresholds,
  unknownAgeNote,
} from '../valuationModel'
import type { NearExpiryRow } from '../../services/reportsApi'
import type { DashboardSectionProps } from './types'

const EXPIRY_WINDOW_DAYS = 30

/**
 * Dashboard 4 — inventory cost and stock health.
 *
 * Cost, never revenue. Every figure is `closing_value` and `stock_value` out of
 * the valuation walk: what the goods cost this company. Books owns the
 * commercial side — what they were sold for, the tax on it and who owes it —
 * and nothing on this screen reaches for any of it.
 *
 * Five independent requests rather than one, because they have wildly different
 * costs: the valuation walk behind stock value and ageing is far heavier than a
 * batch scan, and batching them would make the whole page as slow as its
 * slowest part and blank it on a single 403.
 */
export function ValuationDashboard({ scope, view }: DashboardSectionProps) {
  const { companyName, fy, branch } = useCompany()
  const { can } = useAccess()
  const [exporting, setExporting] = useState(false)

  const expected = scope.scope
  const warehouseId = scope.effectiveWarehouseId
  const enabled = scope.ready

  const stock = useQuery((signal) => fetchStockValue(scope.asOf, signal), [scope.scopeKey, scope.asOf], {
    enabled: enabled && can(P.report('stock_summary')),
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

  const queries = [stock, ageing, warehouses, movement, expiry, bridge]
  const refreshing = queries.some((q) => q.loading)
  const lastSyncedAt = useSyncStamp(refreshing)

  // Through a ref rather than a dependency array: `queries.map(q => q.reload)`
  // is a variable-length deps list, which React rejects outright, and listing
  // six reloads by hand drifts the moment a seventh query is added.
  const reloadsRef = useRef<(() => void)[]>([])
  reloadsRef.current = queries.map((q) => q.reload)
  const refreshAll = useCallback(() => {
    for (const reload of reloadsRef.current) reload()
  }, [])

  const bridgeData = bridge.data?.data ?? null
  const steps = useMemo(() => (bridgeData ? bridgeSteps(bridgeData) : []), [bridgeData])
  const closure = useMemo(() => (bridgeData ? bridgeCloses(bridgeData) : null), [bridgeData])

  const ages = useMemo(() => ageingView(ageing.data, scope.asOf), [ageing.data, scope.asOf])
  const unknownAge = useMemo(() => unknownAgeNote(ageing.data), [ageing.data])
  const movementBars = useMemo(() => movementSeriesForValuation(movement.data), [movement.data])
  const thresholds = useMemo(() => movementThresholds(movement.data), [movement.data])
  const warehouseBars = useMemo(() => warehouseSeries(warehouses.data, scope.asOf), [warehouses.data, scope.asOf])

  /**
   * Slow-moving and non-moving VALUE.
   *
   * The movement report's summary carries item counts and on-hand quantities
   * per class but no value, so there is no honest per-class currency figure to
   * show. The cards report what the report actually measures — items and
   * quantity — rather than a rupee figure derived from somewhere else and
   * captioned as though it came from here.
   */
  const slow = movement.data?.by_class.slow ?? null
  const nonMoving = movement.data?.by_class.non_moving ?? null
  const dead = movement.data?.by_class.dead ?? null

  // Expiry rows and the expiry KPI come from ONE response, so the rows on the
  // card always belong to the figure above them. (The concept mockup's rows did
  // not sum to its KPI; deriving both from one payload makes that impossible.)
  const expiringRows = useMemo(
    () => (expiry.data?.rows ?? []).filter((r) => !r.is_expired),
    [expiry.data],
  )
  const expiringValue = useMemo(
    () => expiringRows.reduce((acc, r) => acc + r.stock_value, 0),
    [expiringRows],
  )

  const findings = useMemo(
    () =>
      buildPulseFindings({
        expiredBatches: expiry.data?.expired ?? null,
        expiringBatches: expiry.data?.expiringSoon ?? null,
        expiringDays: EXPIRY_WINDOW_DAYS,
        unvaluedMovements: bridgeData?.unvalued_movements ?? null,
        nonMovingValue: null,
      }),
    [expiry.data, bridgeData],
  )

  const onExport = useCallback(() => {
    setExporting(true)
    try {
      exportDashboardPdf({
        title: 'Valuation and stock health',
        description: view.description,
        companyName,
        fyLabel: fy?.label ?? 'Financial year',
        branchLabel: branch ? branch.name : 'All branches',
        warehouseLabel:
          warehouseId === null
            ? 'All warehouses'
            : (scope.warehouses.find((w) => w.warehouse_id === warehouseId)?.warehouse_name ?? `Warehouse ${warehouseId}`),
        asOf: scope.asOf,
        generatedAt: bridge.data?.meta.generated_at ?? null,
        metrics: [
          ['Closing stock value', stock.data ? formatCurrencyCompact(stock.data.summary.closing_value) : null, `Value at cost of every item carrying stock as at ${scope.asOf}, under each item's own costing method.`],
          ['Slow moving', slow ? `${formatCount(slow.items)} items` : null, thresholds[1] ? `Items ${thresholds[1].detail}. Counted in items, not value — the movement report measures items and quantity per class, not cost.` : ''],
          ['Non-moving', nonMoving ? `${formatCount(nonMoving.items)} items` : null, thresholds[2]?.detail ?? ''],
          ['Dead stock', dead ? `${formatCount(dead.items)} items` : null, thresholds[3]?.detail ?? ''],
          [`Expiring within ${EXPIRY_WINDOW_DAYS} days`, expiry.data ? formatCount(expiry.data.expiringSoon) : null, 'Batches with an expiry date inside the window that have not expired. Expired batches are counted separately and never folded in.'],
          ['Expired on hand', expiry.data ? formatCount(expiry.data.expired) : null, 'Batches already past their expiry date with stock still on hand.'],
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
            title: 'Ageing of remaining stock',
            note: ages.compositionInvalid
              ? 'Shares are taken over the non-negative buckets only; any negative bucket is listed separately as an exception rather than forced into a percentage split.'
              : undefined,
            numericColumns: [1, 2, 3],
            columns: ['Age bucket', 'Value at cost', 'Share', 'Quantity'],
            rows: [
              ...ages.buckets.map((b) => [b.label, b.display, `${b.share.toFixed(0)}%`, b.sub ?? '']),
              ...ages.negatives.map((b) => [`${b.label} (negative)`, b.display, 'Excluded', b.sub ?? '']),
            ],
          },
          {
            title: 'Value by warehouse',
            numericColumns: [1, 2],
            columns: ['Warehouse', 'Value at cost', 'Share', 'Quantity'],
            rows: warehouseBars.map((w) => [w.label, w.display, `${w.share.toFixed(0)}%`, w.sub ?? '']),
          },
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
          bridgeData?.definition ?? '',
          bridgeData && bridgeData.unvalued_movements > 0
            ? `${bridgeData.unvalued_movements} movements in this period carry no value, so the bridge is short by whatever they were worth.`
            : '',
          unknownAge ?? '',
          'Ageing measures how long stock still on hand has been held. Movement class measures how recently the item last moved. They are different questions and are never added together.',
        ].filter(Boolean),
      })
    } finally {
      setExporting(false)
    }
  }, [
    view, companyName, fy, branch, warehouseId, scope, bridge.data, bridgeData, steps, closure,
    stock.data, slow, nonMoving, dead, thresholds, expiry.data, ages, warehouseBars, expiringRows,
    expiringValue, unknownAge,
  ])

  return (
    <div className="space-y-3">
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
        onExport={onExport}
        exporting={exporting}
      />

      <PulseBriefing
        findings={findings}
        anyDataKnown={stock.data !== null || bridgeData !== null}
        lastSyncedAt={lastSyncedAt}
        reviewTo="/registers/valuation"
        reviewLabel="Open valuation"
      />

      <section aria-label="Valuation summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          label="Closing stock value"
          value={stock.data ? formatCurrencyCompact(stock.data.summary.closing_value) : null}
          numeric={stock.data?.summary.closing_value ?? null}
          definition={`Value at cost of every item carrying stock as at ${scope.asOf}, under each item's own costing method. Cost, not selling value.`}
          hint="At cost"
          icon={Coins}
          tone="success"
          loading={stock.loading && !stock.data}
          error={stock.error}
          onRetry={stock.reload}
          to={drill.stockValue({ asOf: scope.asOf })}
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
        />
        <MetricCard
          label={`Expiring in ${EXPIRY_WINDOW_DAYS}d`}
          value={expiry.data ? formatCount(expiry.data.expiringSoon) : null}
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
      </section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <WidgetCard
          title="Inventory value bridge"
          description={`Movement in value at cost, ${formatDate(scope.period.from)} to ${formatDate(scope.asOf)}`}
          icon={BarChart3}
          tone="primary"
          state={{
            loading: bridge.loading && !bridgeData,
            error: bridge.error,
            empty: bridgeData !== null && steps.length === 0 && (bridgeData.opening.value ?? 0) === 0,
            reload: bridge.reload,
          }}
          skeleton={<div className="skeleton h-[200px] rounded-lg" />}
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
              caption={`Inventory value at cost from ${formatDate(scope.period.from)} to ${formatDate(scope.asOf)}: opening, receipts, issues, adjustments and transfers, reaching the closing value.`}
            />
          ) : null}
        </WidgetCard>

        <WidgetCard
          title="Ageing of remaining stock"
          description="How long the stock on hand has been held, by value at cost"
          icon={Layers}
          tone="info"
          state={{
            loading: ageing.loading && !ageing.data,
            error: ageing.error,
            empty: ages.buckets.length === 0 && ages.negatives.length === 0,
            reload: ageing.reload,
          }}
          skeleton={<div className="skeleton h-48 rounded-lg" />}
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
          <BarList items={ages.buckets} showShare />
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
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <WidgetCard
          title="Value by warehouse"
          description="Where the capital is sitting, at cost"
          icon={Warehouse}
          tone="primary"
          state={{
            loading: warehouses.loading && !warehouses.data,
            error: warehouses.error,
            empty: warehouseBars.length === 0,
            reload: warehouses.reload,
          }}
          skeleton={<div className="skeleton h-40 rounded-lg" />}
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
          <BarList items={warehouseBars} showShare limit={8} />
        </WidgetCard>

        <WidgetCard
          title="Movement classification"
          description="How recently each item last moved"
          icon={Clock}
          tone="violet"
          state={{
            loading: movement.loading && !movement.data,
            error: movement.error,
            empty: movementBars.every((b) => b.value === 0),
            reload: movement.reload,
          }}
          skeleton={<div className="skeleton h-40 rounded-lg" />}
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
          <BarList items={movementBars} showShare />
        </WidgetCard>
      </div>

      <WidgetCard
        title="Batch and expiry watch"
        description={`Batches expiring within ${EXPIRY_WINDOW_DAYS} days, soonest first`}
        icon={CalendarClock}
        tone="warning"
        state={{
          loading: expiry.loading && !expiry.data,
          error: expiry.error,
          empty: expiringRows.length === 0,
          reload: expiry.reload,
        }}
        skeleton={<div className="skeleton h-40 rounded-lg" />}
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
    </div>
  )
}

export default ValuationDashboard
