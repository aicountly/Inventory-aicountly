import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Database,
  LineChart,
  MinusCircle,
  PackageSearch,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { fetchReport } from '../../services/reportsApi'
import type { ReplenishmentRow, ReplenishmentSummary } from '../../services/reportsApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Modal } from '../../components/Modal'
import { Select } from '../../ui/Select'
import { formatDate, formatQty, todayIso } from '../../utils/format'
import { assertScope, fetchDemand } from '../aggregatesApi'
import { ForecastChart } from '../charts/ForecastChart'
import { DashboardPageHeader } from '../components/DashboardPageHeader'
import { MetricCard } from '../components/MetricCard'
import { MiniTable } from '../components/MiniTable'
import { PulseBriefing } from '../components/PulseBriefing'
import { WidgetCard } from '../components/WidgetCard'
import { exportDashboardPdf } from '../dashboardExport'
import { formatCount, formatCurrencyCompact, formatQtyCompact } from '../formatters'
import { drill } from '../kpiNavigation'
import { buildPulseFindings } from '../pulse'
import {
  COVER_LABEL,
  COVER_TONE,
  coverUrgency,
  daysOfCover,
  formatCover,
  readiness,
  suggest,
  transferableSurplus,
} from '../replenishmentModel'
import { useSyncStamp } from '../useSyncStamp'
import type { DashboardSectionProps } from './types'

/** How far past the lead time a suggestion covers. */
const HORIZON_CHOICES = [7, 14, 30] as const
const HISTORY_DAYS = 60
const PANEL_ROWS = 10

/**
 * Dashboard 3 — anticipate shortages and review what to order.
 *
 * Two sources, deliberately kept apart on the screen:
 *
 *  - the **replenishment report**, which is the authority on what the company's
 *    own reorder policy says, and
 *  - the **demand aggregate** for one selected item, which says what has
 *    actually been going out.
 *
 * They answer different questions and they are allowed to disagree; the screen
 * shows both with their bases named rather than blending them into one number
 * whose provenance nobody could reconstruct.
 *
 * Nothing here orders anything. The review drawer assembles the inputs, lets a
 * permitted user adjust the quantity, and hands off to the document the company
 * actually raises. A dashboard may not post stock, and a keystroke may not buy
 * anything.
 */
export function ReplenishmentDashboard({ scope, view }: DashboardSectionProps) {
  const { companyName, fy, branch } = useCompany()
  const { can } = useAccess()
  const [horizonDays, setHorizonDays] = useState<number>(14)
  const [reviewing, setReviewing] = useState<ReplenishmentRow | null>(null)
  const [exporting, setExporting] = useState(false)

  const expected = scope.scope
  const warehouseId = scope.effectiveWarehouseId

  const report = useQuery(
    (signal) =>
      fetchReport<ReplenishmentRow, ReplenishmentSummary>(
        'replenishment',
        {
          only_triggered: 1,
          warehouse_id: warehouseId ?? undefined,
          limit: PANEL_ROWS,
          page: 1,
          sort: 'suggested_qty',
          order: 'desc',
        },
        signal,
      ),
    [scope.scopeKey, warehouseId],
    { enabled: scope.ready, resetKey: scope.scopeKey },
  )

  const rows = useMemo(() => report.data?.data ?? [], [report.data])

  // The item whose demand the chart shows: the URL's choice if it is one of
  // the rows, otherwise the most urgent row. Never a hard-coded id.
  const selectedRow = useMemo(() => {
    if (scope.itemId !== null) {
      const match = rows.find((r) => r.item_id === scope.itemId)
      if (match) return match
    }
    return rows[0] ?? null
  }, [rows, scope.itemId])

  const demandQuery = useQuery(
    async (signal) => {
      if (!selectedRow) return null
      const envelope = await fetchDemand(selectedRow.item_id, warehouseId, scope.asOf, HISTORY_DAYS, horizonDays, signal)
      return expected ? assertScope(envelope, expected) : envelope
    },
    [scope.scopeKey, selectedRow?.item_id ?? 0, warehouseId, scope.asOf, horizonDays],
    { enabled: scope.ready && selectedRow !== null, resetKey: scope.scopeKey },
  )

  const demand = demandQuery.data?.data ?? null
  const lastSyncedAt = useSyncStamp(report.loading || demandQuery.loading)

  const dailyDemand = demand?.daily_mean ?? 0

  const suggestion = useMemo(() => {
    if (!selectedRow) return null
    return suggest({
      // The report has already deducted reservations, packing, holds and
      // blocks. Subtracting any of them again here would double-count.
      available: selectedRow.available,
      inbound: selectedRow.expected,
      dailyDemand,
      leadTimeDays: selectedRow.lead_time_days,
      safetyStock: selectedRow.safety_stock_qty ?? 0,
      horizonDays,
    })
  }, [selectedRow, dailyDemand, horizonDays])

  const cover = selectedRow ? daysOfCover(selectedRow.available, dailyDemand) : null
  const urgency = coverUrgency(cover, selectedRow?.lead_time_days ?? null)

  /** The projection: a flat trailing mean, drawn only when it means something. */
  const forecastSeries = useMemo(() => {
    if (!demand || !demand.sufficient_history || demand.daily_mean <= 0) return []
    const out: { date: string; value: number }[] = []
    const start = new Date(`${demand.as_of}T00:00:00`)
    for (let i = 1; i <= demand.horizon_days; i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      out.push({ date: d.toISOString().slice(0, 10), value: demand.daily_mean })
    }
    return out
  }, [demand])

  const actualSeries = useMemo(
    () => (demand?.series ?? []).map((p) => ({ date: p.date, value: p.qty })),
    [demand],
  )

  const checks = useMemo(
    () =>
      readiness(
        rows,
        demand
          ? {
              dailyMean: demand.daily_mean,
              sufficientHistory: demand.sufficient_history,
              historyDays: demand.history_days,
              daysWithDemand: demand.days_with_demand,
            }
          : null,
      ),
    [rows, demand],
  )

  const triggered = report.data?.summary.triggered_total ?? null
  const stockoutRisk = useMemo(
    () => rows.filter((r) => r.available <= 0 || (r.reorder_point_qty !== null && r.available < r.reorder_point_qty)).length,
    [rows],
  )

  const findings = useMemo(
    () => buildPulseFindings({ belowReorder: triggered }),
    [triggered],
  )

  /** Surplus somewhere else that could cover this item without creating a new gap. */
  const rebalance = useMemo(() => {
    if (!selectedRow || !suggestion || suggestion.suggestedQty <= 0) return null
    const surplus = transferableSurplus(selectedRow, dailyDemand, selectedRow.lead_time_days)
    if (surplus <= 0) return null
    return { surplus, covers: dailyDemand > 0 ? Math.floor(surplus / dailyDemand) : null }
  }, [selectedRow, suggestion, dailyDemand])

  const onExport = useCallback(() => {
    if (!report.data) return
    setExporting(true)
    try {
      exportDashboardPdf({
        title: 'Replenishment planning',
        description: view.description,
        companyName,
        fyLabel: fy?.label ?? 'Financial year',
        branchLabel: branch ? branch.name : 'All branches',
        warehouseLabel:
          warehouseId === null
            ? 'All warehouses'
            : (scope.warehouses.find((w) => w.warehouse_id === warehouseId)?.warehouse_name ?? `Warehouse ${warehouseId}`),
        asOf: scope.asOf,
        generatedAt: demandQuery.data?.meta.generated_at ?? null,
        metrics: [
          ['Below reorder point', triggered === null ? null : formatCount(triggered), 'Item-location combinations at or below their configured reorder point, over the whole filtered set.'],
          ['Stockout risk', formatCount(stockoutRisk), `Of the ${rows.length} rows shown, those with no available stock or availability under the reorder point.`],
          ['Open replenishment requests', null, 'Not modelled: this product has no purchase-request workflow. Suggestions are reviewed and raised as documents.'],
          ['Demand basis', demand ? `${formatQty(demand.daily_mean)} / day` : null, demand?.demand_basis ?? 'Outward movements on issue-type documents; transfers and adjustments excluded.'],
        ],
        tables: [
          {
            title: 'Replenishment recommendations',
            note:
              triggered !== null && rows.length < triggered
                ? `Showing the ${rows.length} largest suggestions of ${triggered} triggered rows. Open the replenishment report for the full list.`
                : undefined,
            numericColumns: [2, 3, 4, 5, 6],
            columns: ['Item', 'Warehouse', 'Available', 'Inbound', 'Lead time', 'Safety stock', 'Suggested', 'Reason'],
            rows: rows.map((r) => [
              r.item_name ?? `Item ${r.item_id}`,
              r.default_warehouse_name ?? '—',
              formatQty(r.available),
              formatQty(r.expected),
              r.lead_time_days === null ? 'Not set' : `${r.lead_time_days} days`,
              r.safety_stock_qty === null ? 'Not set' : formatQty(r.safety_stock_qty),
              formatQty(r.suggested_qty),
              r.reasons.join('; ') || '—',
            ]),
          },
        ],
        notes: [
          'Suggested quantity on this sheet is the replenishment report\'s own figure, computed against the company\'s configured reorder policy.',
          'The dashboard also shows a demand-based suggestion for the selected item: max(0, daily demand x (lead time + horizon) + safety stock - (available + confirmed inbound)). Availability already has reservations, packing, quality holds, damage and blocks deducted; they are not deducted twice.',
          demand
            ? `Demand for the selected item is a ${demand.method.replace(/_/g, ' ')} over ${demand.history_days} days. ${demand.demand_basis}`
            : '',
          demand && !demand.sufficient_history
            ? `History is insufficient for that item by the stated rule: ${demand.sufficiency_rule}`
            : '',
          'No confidence percentage is given: a trailing mean over daily issues does not support one.',
        ].filter(Boolean),
      })
    } finally {
      setExporting(false)
    }
  }, [report.data, view, companyName, fy, branch, warehouseId, scope, demandQuery.data, triggered, stockoutRisk, rows, demand])

  const canReplenishment = can(P.report('replenishment'))

  return (
    <div className="space-y-3">
      <DashboardPageHeader
        title="Replenishment planning"
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
        refreshing={report.loading || demandQuery.loading}
        onRefresh={() => {
          report.reload()
          demandQuery.reload()
        }}
        lastSyncedAt={lastSyncedAt}
        onExport={report.data ? onExport : undefined}
        exporting={exporting}
        actions={
          <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="whitespace-nowrap">Cover horizon</span>
            <Select
              value={String(horizonDays)}
              onChange={(e) => setHorizonDays(Number(e.target.value))}
              className="h-8 text-xs"
              aria-label="Planning horizon beyond the lead time"
            >
              {HORIZON_CHOICES.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </Select>
          </label>
        }
      />

      <PulseBriefing
        findings={findings}
        anyDataKnown={report.data !== null}
        lastSyncedAt={lastSyncedAt}
        reviewTo={canReplenishment ? drill.replenishment({ onlyTriggered: true, warehouseId }) : undefined}
        reviewLabel="Open the full report"
      />

      <section aria-label="Replenishment summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          label="Below reorder point"
          value={triggered === null ? null : formatCount(triggered)}
          numeric={triggered}
          definition="Item-location combinations at or below their configured reorder point, counted over the whole filtered set rather than the rows shown."
          hint="Item-locations, not items"
          icon={AlertTriangle}
          tone="warning"
          loading={report.loading && !report.data}
          error={report.error}
          onRetry={report.reload}
          to={drill.replenishment({ onlyTriggered: true, warehouseId })}
          badge={(triggered ?? 0) > 0 ? { label: 'Act now', tone: 'warning' } : undefined}
        />
        <MetricCard
          label="Stockout risk"
          value={report.data ? formatCount(stockoutRisk) : null}
          numeric={stockoutRisk}
          definition={`Of the ${rows.length} rows on this page, those with no available stock or availability already under the reorder point. Scoped to the rows shown, not the whole set — the report is the authority on the total.`}
          hint={`Within the ${rows.length} largest suggestions`}
          icon={PackageSearch}
          tone="danger"
          loading={report.loading && !report.data}
          error={report.error}
          onRetry={report.reload}
          to={drill.replenishment({ onlyTriggered: true, warehouseId })}
        />
        <MetricCard
          label="Suggested value"
          value={report.data ? formatCurrencyCompact(report.data.summary.page_suggested_value) : null}
          numeric={report.data?.summary.page_suggested_value ?? null}
          definition="Cost of the suggested quantities on this page, at standard cost. A page figure, not a company total — the report footer carries the full one."
          hint="On this page, at standard cost"
          icon={ShoppingCart}
          tone="primary"
          loading={report.loading && !report.data}
          error={report.error}
          onRetry={report.reload}
          to={drill.replenishment({ onlyTriggered: true, warehouseId })}
        />
        {/* There is no purchase-request workflow in this product, so there is no
            honest figure to put here. Said plainly rather than shown as 0. */}
        <MetricCard
          label="Open requests"
          value={null}
          state="not_configured"
          definition="Replenishment requests raised and not yet fulfilled."
          reason="This product has no purchase-request workflow of its own — Purchases lives outside Inventory. A reviewed suggestion is raised as an inventory document, and those are counted on the Operations dashboard."
          icon={MinusCircle}
          insteadTo="/documents/new"
          insteadLabel="Raise a document"
        />
      </section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <WidgetCard
          className="xl:col-span-2"
          title="Demand and stock cover"
          description={
            selectedRow
              ? `${selectedRow.item_name ?? `Item ${selectedRow.item_id}`} · actual to ${formatDate(scope.asOf)}, projected after`
              : 'Select an item to measure its demand'
          }
          icon={LineChart}
          tone="primary"
          state={{
            loading: (report.loading || demandQuery.loading) && !demand,
            error: demandQuery.error ?? report.error,
            empty: selectedRow === null,
            reload: demandQuery.reload,
          }}
          skeleton={<div className="skeleton h-[220px] rounded-lg" />}
          emptyTitle="Nothing is below its reorder point"
          emptyDescription="When an item falls below its reorder point it appears here with its demand history."
          emptyIcon={LineChart}
          footer={
            demand ? (
              <span>
                {/* The method and its basis, in the user's words, next to the
                    chart rather than in a tooltip — a projection whose basis is
                    hidden is a projection nobody can argue with. */}
                {demand.method === 'trailing_mean' ? 'Trailing mean' : demand.method} over {demand.history_days} days ·{' '}
                {demand.sufficient_history
                  ? `demand on ${demand.days_with_demand} days`
                  : `insufficient history (${demand.sufficiency_rule.toLowerCase()}) — no projection drawn`}
              </span>
            ) : undefined
          }
        >
          {rows.length > 1 ? (
            <div className="mb-2 flex items-center gap-2">
              <label className="text-[11px] text-gray-500" htmlFor="replenishment-item">
                Item
              </label>
              <Select
                id="replenishment-item"
                value={selectedRow ? String(selectedRow.item_id) : ''}
                onChange={(e) => scope.setItemId(e.target.value === '' ? null : Number(e.target.value))}
                className="h-8 max-w-xs text-xs"
              >
                {rows.map((r) => (
                  <option key={`${r.item_id}-${r.default_warehouse_id ?? 0}`} value={r.item_id}>
                    {r.item_name ?? `Item ${r.item_id}`}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          <ForecastChart
            actual={actualSeries}
            forecast={forecastSeries}
            asOf={scope.asOf}
            unit={`Quantity (${selectedRow?.unit_symbol ?? 'base units'})`}
            caption={`Daily outward demand for ${selectedRow?.item_name ?? 'the selected item'} over the last ${HISTORY_DAYS} days, and the projection for the next ${horizonDays} days. ${demand?.demand_basis ?? ''}`}
            formatValue={(n) => formatQtyCompact(n)}
            formatDate={(iso) => formatDate(iso)}
          />
        </WidgetCard>

        <WidgetCard
          title="Suggested action"
          description={selectedRow ? 'Every input behind the number' : 'Nothing to suggest'}
          icon={TrendingUp}
          tone="success"
          state={{
            loading: (report.loading || demandQuery.loading) && !suggestion,
            error: report.error,
            empty: selectedRow === null || suggestion === null,
            reload: report.reload,
          }}
          skeleton={<div className="skeleton h-64 rounded-lg" />}
          emptyTitle="Nothing needs replenishing"
          emptyDescription="Items at or below their reorder point appear here with a suggested quantity."
          emptyIcon={TrendingUp}
        >
          {selectedRow && suggestion ? (
            <div className="space-y-3">
              <div>
                <p className="truncate text-sm font-semibold text-gray-900">
                  {selectedRow.item_name ?? `Item ${selectedRow.item_id}`}
                </p>
                <p className="truncate text-[11px] text-gray-500">
                  {selectedRow.item_sku ? `${selectedRow.item_sku} · ` : ''}
                  {selectedRow.default_warehouse_name ?? 'All warehouses'}
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                {[
                  ['Available', formatQty(selectedRow.available), 'Reservations, packing, holds, damage and blocks already deducted'],
                  ['Confirmed inbound', formatQty(selectedRow.expected), 'Expected quantity on open documents'],
                  ['Daily demand', demand ? formatQty(demand.daily_mean) : '—', demand?.demand_basis ?? 'Not measured'],
                  ['Lead time', selectedRow.lead_time_days === null ? 'Not set' : `${selectedRow.lead_time_days} days`, suggestion.leadTimeMissing ? 'No lead time configured — the window covers the horizon only' : 'From the item master'],
                  ['Safety stock', selectedRow.safety_stock_qty === null ? 'Not set' : formatQty(selectedRow.safety_stock_qty), 'Treated as zero when unset, never guessed'],
                  ['Stock cover', formatCover(cover), COVER_LABEL[urgency]],
                ].map(([label, value, hint]) => (
                  <div key={label} className="min-w-0">
                    <dt className="truncate text-[10px] uppercase tracking-wide text-gray-400" title={hint}>
                      {label}
                    </dt>
                    <dd className="truncate text-xs font-semibold tabular-nums text-gray-900">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="rounded-lg border border-primary/25 bg-primary-light/40 p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">Demand-based suggestion</p>
                <p className="text-lg font-semibold tabular-nums text-gray-900">
                  {formatQty(suggestion.suggestedQty)} {selectedRow.unit_symbol ?? ''}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-gray-600">
                  {formatQty(suggestion.forecastDemand)} over {suggestion.coverDays} days + {formatQty(suggestion.safetyStock)} safety
                  − {formatQty(suggestion.netSupply)} net supply
                </p>
                <p className="mt-1 text-[11px] text-gray-500">
                  The report&rsquo;s own policy figure is {formatQty(selectedRow.suggested_qty)}
                  {selectedRow.target_basis ? ` (${selectedRow.target_basis.replace(/_/g, ' ')})` : ''}.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setReviewing(selectedRow)}>
                  Review calculation
                </Button>
                <Badge tone={COVER_TONE[urgency]} size="xs">
                  {formatCover(cover)} of cover
                </Badge>
              </div>
            </div>
          ) : null}
        </WidgetCard>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <WidgetCard
          className="xl:col-span-2"
          title="Replenishment recommendations"
          description="Items at or below their reorder point, largest suggestion first"
          icon={ShoppingCart}
          tone="warning"
          state={{
            loading: report.loading && !report.data,
            error: report.error,
            empty: rows.length === 0,
            reload: report.reload,
          }}
          skeleton={<div className="skeleton h-48 rounded-lg" />}
          emptyTitle="Nothing is below its reorder point"
          emptyDescription="Items appear here as soon as availability falls to the reorder point configured on them."
          emptyIcon={CheckCircle2}
          viewAll={{ to: drill.replenishment({ onlyTriggered: true, warehouseId }), label: 'Full report' }}
          footer={
            triggered !== null && rows.length < triggered
              ? `Showing the ${rows.length} largest of ${formatCount(triggered)} triggered rows`
              : undefined
          }
        >
          <MiniTable<ReplenishmentRow>
            caption="Items at or below their reorder point, with availability, lead time and suggested quantity."
            rows={rows}
            rowKey={(r) => `${r.item_id}-${r.default_warehouse_id ?? 0}`}
            to={(r) => drill.replenishment({ itemId: r.item_id, warehouseId: r.default_warehouse_id })}
            rowLabel={(r) => `Replenishment for ${r.item_name ?? r.item_id}`}
            minWidth={640}
            columns={[
              {
                key: 'item',
                header: 'Item',
                render: (r) => (
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-gray-900">{r.item_name ?? `Item ${r.item_id}`}</p>
                    <p className="truncate text-[11px] text-gray-500">{r.default_warehouse_name ?? 'All warehouses'}</p>
                  </div>
                ),
              },
              {
                key: 'available',
                header: 'Available',
                align: 'right',
                cellClassName: 'tabular-nums',
                render: (r) => (
                  <span className={r.available < 0 ? 'text-xs font-semibold text-red-600' : 'text-xs text-gray-900'}>
                    {formatQty(r.available)} {r.unit_symbol ?? ''}
                  </span>
                ),
              },
              {
                key: 'cover',
                header: 'Cover',
                render: (r) => {
                  // Cover is measured only for the item whose demand we have
                  // actually fetched. Every other row shows a dash rather than
                  // a number derived from someone else's demand rate.
                  if (!selectedRow || r.item_id !== selectedRow.item_id) {
                    return <span className="text-[11px] text-gray-400">—</span>
                  }
                  return (
                    <Badge tone={COVER_TONE[urgency]} size="xs">
                      {formatCover(cover)}
                    </Badge>
                  )
                },
              },
              {
                key: 'lead',
                header: 'Lead time',
                align: 'right',
                cellClassName: 'tabular-nums',
                render: (r) =>
                  r.lead_time_days === null ? (
                    <span className="text-[11px] text-amber-700">Not set</span>
                  ) : (
                    <span className="text-xs text-gray-700">{r.lead_time_days} d</span>
                  ),
              },
              {
                key: 'inbound',
                header: 'Inbound',
                align: 'right',
                cellClassName: 'tabular-nums',
                render: (r) => <span className="text-xs text-gray-700">{formatQty(r.expected)}</span>,
              },
              {
                key: 'suggested',
                header: 'Suggested',
                align: 'right',
                cellClassName: 'tabular-nums',
                render: (r) => (
                  <span className="text-xs font-semibold text-gray-900">
                    {formatQty(r.suggested_qty)} {r.unit_symbol ?? ''}
                  </span>
                ),
              },
              {
                key: 'reason',
                header: 'Reason',
                render: (r) => (
                  <span className="text-[11px] text-gray-600" title={r.reasons.join('; ')}>
                    {r.reasons[0]?.replace(/_/g, ' ') ?? '—'}
                  </span>
                ),
              },
            ]}
          />
        </WidgetCard>

        <div className="space-y-3">
          <WidgetCard
            title="Rebalance before purchase"
            description="Surplus that could move instead of being bought"
            icon={ArrowRightLeft}
            tone="info"
            state={{
              loading: report.loading && !report.data,
              error: report.error,
              empty: rebalance === null,
              reload: report.reload,
            }}
            skeleton={<div className="skeleton h-28 rounded-lg" />}
            emptyTitle="Nothing to rebalance"
            emptyDescription="A location's surplus is only what it holds above its own safety stock and lead-time demand. Nothing here has any."
            emptyIcon={ArrowRightLeft}
          >
            {rebalance && selectedRow ? (
              <div className="space-y-2">
                <p className="text-xs leading-relaxed text-gray-700">
                  {selectedRow.item_name ?? `Item ${selectedRow.item_id}`} has{' '}
                  <strong className="tabular-nums">{formatQty(rebalance.surplus)}</strong> above what this location needs
                  for its own safety stock and lead time
                  {rebalance.covers !== null ? `, about ${rebalance.covers} days of demand` : ''}.
                </p>
                {/* The rule that keeps this honest: surplus is what is left
                    AFTER the holding location's own needs, so a transfer can
                    never be recommended that simply moves the shortage. */}
                <p className="text-[11px] text-gray-500">
                  Surplus is measured after this location&rsquo;s own safety stock and lead-time demand, so moving it
                  cannot create a shortage where it came from.
                </p>
                <Link
                  to="/documents/new/stock_transfer"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary print:hidden"
                >
                  Raise a transfer
                </Link>
              </div>
            ) : null}
          </WidgetCard>

          <WidgetCard
            title="Data readiness"
            description="What these suggestions are standing on"
            icon={Database}
            tone="slate"
            state={{ loading: report.loading && !report.data, error: report.error, empty: false, reload: report.reload }}
            skeleton={<div className="skeleton h-32 rounded-lg" />}
          >
            <ul className="space-y-2">
              {checks.map((c) => (
                <li key={c.key} className="flex items-start gap-2">
                  <span
                    className={
                      c.status === 'ready'
                        ? 'mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500'
                        : c.status === 'partial'
                          ? 'mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500'
                          : 'mt-1 h-2 w-2 shrink-0 rounded-full bg-gray-300'
                    }
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-gray-800">{c.label}</span>
                    <span className="block text-[11px] leading-snug text-gray-500">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </WidgetCard>
        </div>
      </div>

      <ReviewDrawer
        row={reviewing}
        demandPerDay={dailyDemand}
        horizonDays={horizonDays}
        onClose={() => setReviewing(null)}
      />
    </div>
  )
}

/**
 * The review drawer.
 *
 * It shows the whole calculation, lets a permitted user change the quantity,
 * and then hands off to the document the company actually raises. It does not
 * order anything, does not post stock and does not call an external system:
 * there is no purchase-request workflow inside Inventory to call, and inventing
 * a button that looks like one would be worse than saying so.
 */
function ReviewDrawer({
  row,
  demandPerDay,
  horizonDays,
  onClose,
}: {
  row: ReplenishmentRow | null
  demandPerDay: number
  horizonDays: number
  onClose: () => void
}) {
  const { can } = useAccess()
  const [qty, setQty] = useState<string>('')

  const calc = row
    ? suggest({
        available: row.available,
        inbound: row.expected,
        dailyDemand: demandPerDay,
        leadTimeDays: row.lead_time_days,
        safetyStock: row.safety_stock_qty ?? 0,
        horizonDays,
      })
    : null

  const effectiveQty = qty.trim() === '' ? (calc?.suggestedQty ?? 0) : Number(qty)
  const canRaise = can(['documents.material_receipt.create', 'documents.create'])

  return (
    <Modal
      open={row !== null}
      onClose={() => {
        setQty('')
        onClose()
      }}
      title={row ? `Review ${row.item_name ?? `item ${row.item_id}`}` : 'Review'}
      description="Every input behind the suggested quantity, and what changing it would mean."
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setQty('')
              onClose()
            }}
          >
            Close
          </Button>
          {canRaise && row ? (
            // A link, not a submit: this opens a blank document form with the
            // figures prefilled. It saves nothing, posts nothing and orders
            // nothing — the user reviews the draft and saves it themselves.
            <Link
              to={`/documents/new/material_receipt?item_id=${row.item_id}&qty=${effectiveQty}${
                row.default_warehouse_id ? `&warehouse_id=${row.default_warehouse_id}` : ''
              }`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-white no-underline transition-colors hover:bg-primary-hover"
            >
              Draft a receipt
            </Link>
          ) : null}
        </div>
      }
    >
      {row && calc ? (
        <div className="space-y-4">
          <table className="w-full text-xs">
            <caption className="sr-only">Inputs to the suggested quantity</caption>
            <tbody className="divide-y divide-gray-100">
              {[
                ['Available', `${formatQty(row.available)} ${row.unit_symbol ?? ''}`, 'On hand less reservations, packing, quality holds, damage and blocks — deducted once, by the server'],
                ['Confirmed inbound', `${formatQty(row.expected)} ${row.unit_symbol ?? ''}`, 'Expected quantity on open documents'],
                ['Net supply', `${formatQty(calc.netSupply)} ${row.unit_symbol ?? ''}`, 'Available + confirmed inbound'],
                ['Daily demand', `${formatQty(demandPerDay)} ${row.unit_symbol ?? ''}`, 'Trailing mean of outward movements on issue-type documents; transfers and adjustments excluded'],
                ['Lead time', row.lead_time_days === null ? 'Not set' : `${row.lead_time_days} days`, calc.leadTimeMissing ? 'No lead time on the item master, so the window covers the horizon only — nothing is assumed' : 'From the item master'],
                ['Cover horizon', `${horizonDays} days`, 'How far past the lead time this suggestion covers'],
                ['Forecast demand', `${formatQty(calc.forecastDemand)} ${row.unit_symbol ?? ''}`, `Daily demand over ${calc.coverDays} days`],
                ['Safety stock', `${formatQty(calc.safetyStock)} ${row.unit_symbol ?? ''}`, row.safety_stock_qty === null ? 'Not configured — treated as zero rather than guessed' : 'From the item master'],
              ].map(([label, value, hint]) => (
                <tr key={label}>
                  <th scope="row" className="py-1.5 text-left font-medium text-gray-600">
                    {label}
                    <span className="block text-[10px] font-normal text-gray-400">{hint}</span>
                  </th>
                  <td className="py-1.5 text-right tabular-nums font-semibold text-gray-900">{value}</td>
                </tr>
              ))}
              <tr className="bg-primary-light/40">
                <th scope="row" className="py-2 text-left font-semibold text-gray-800">
                  Suggested quantity
                  <span className="block text-[10px] font-normal text-gray-500">
                    max(0, forecast + safety − net supply)
                  </span>
                </th>
                <td className="py-2 text-right tabular-nums text-sm font-bold text-gray-900">
                  {formatQty(calc.suggestedQty)} {row.unit_symbol ?? ''}
                </td>
              </tr>
            </tbody>
          </table>

          <label className="block">
            <span className="text-[11px] font-medium text-gray-600">Quantity to raise</span>
            <input
              type="number"
              min={0}
              step="any"
              value={qty}
              placeholder={String(calc.suggestedQty)}
              onChange={(e) => setQty(e.target.value)}
              className="mt-1 h-9 w-40 rounded-lg border border-gray-200 px-2 text-sm tabular-nums focus:border-primary focus:outline-none"
            />
            <span className="mt-1 block text-[11px] text-gray-500">
              Leave blank to use the suggestion. Nothing is ordered from this screen — the button below opens a draft
              document for you to check and save.
            </span>
          </label>

          {!canRaise ? (
            <p className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-[11px] text-gray-600">
              You do not have permission to raise a receipt in this company. Ask an administrator, or send the figures
              above to whoever does.
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}

export default ReplenishmentDashboard
