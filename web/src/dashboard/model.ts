/**
 * Everything the dashboard *computes* lives here, as pure functions over the
 * API payloads. No React, no lucide, no DOM — so it is all unit-testable in the
 * existing node vitest environment, and so the widgets stay thin.
 *
 * Two rules are enforced by construction:
 *
 *  1. **No fabricated figures.** A KPI whose source has not loaded yet gets
 *     `value: null` (the strip renders a skeleton in its place) rather than a
 *     zero. Nothing derives a "previous period" — the server does not send one,
 *     so no card gets a delta chip.
 *  2. **No dead numbers.** Every series item and every KPI carries a `to`, built
 *     by src/dashboard/kpiNavigation.ts from the same filters the figure was
 *     counted with — except where the product has no screen to land on, which
 *     is left as an absent `to` rather than a link that lies.
 */

import type { AgeBucketKey, MovementAnalysisSummary, MovementClass, StockAgeingSummary, WarehouseStockSummary } from '../services/reportsApi'
import type { DashboardData } from '../services/dashboard'
import { labelForCode } from '../documents/registry'
import { humanize } from '../utils/format'
import { formatCount, formatCurrencyCompact, formatQtyCompact, percentOf } from './formatters'
import { drill } from './kpiNavigation'
import type { ExpirySnapshot, ReplenishmentSnapshot, StockValueSnapshot } from './dashboardApi'

// ---------------------------------------------------------------------------
// Shared display types
// ---------------------------------------------------------------------------

export type Tone =
  | 'primary'
  | 'success'
  | 'info'
  | 'warning'
  | 'danger'
  | 'critical'
  | 'neutral'
  | 'teal'
  | 'violet'

export type KpiIconKey =
  | 'value'
  | 'qty'
  | 'items'
  | 'negative'
  | 'reorder'
  | 'expiring'
  | 'expired'
  | 'approval'

export interface KpiCardSpec {
  key: string
  label: string
  /** Formatted for display; `null` while the source request is in flight. */
  value: string | null
  /** Numeric form — drives negative emphasis only, never a fabricated delta. */
  numeric: number | null
  icon: KpiIconKey
  tone: Tone
  hint?: string
  to?: string
  emphasizeNegative?: boolean
  /** Set when the figure is actionable right now (non-zero problem count). */
  attention?: boolean
}

export interface SeriesItem {
  key: string
  label: string
  /** Raw figure the bar/arc is drawn from. */
  value: number
  /** Formatted figure shown beside the label. */
  display: string
  /** Share of the series total, 0-100 — the number shown as "%". */
  share: number
  /** Share of the series *maximum*, 0-100 — the bar's width. */
  scale: number
  tone: Tone
  to?: string
  /** Secondary line (quantity beside a value, item count beside a class…). */
  sub?: string
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

export interface KpiInput {
  asOf: string
  nearExpiryDays: number
  core: DashboardData | null
  stock: StockValueSnapshot | null
  expiry: ExpirySnapshot | null
  replenishment: ReplenishmentSnapshot | null
}

/**
 * The eight headline figures, in the order a stock manager scans them:
 * what the stock is worth, how much of it there is, then the four things that
 * need doing today, then the paperwork.
 */
export function buildKpiCards(input: KpiInput): KpiCardSpec[] {
  const { asOf, nearExpiryDays, core, stock, expiry, replenishment } = input
  const s = stock?.summary ?? null
  const negativeItems = core?.stock.negative_stock_items ?? null
  const negativeRows = core?.stock.negative_stock_warehouse_rows ?? null
  const pendingApproval = core?.documents.pending_approval ?? null
  const failed = core?.documents.failed ?? null
  const reorder = replenishment?.summary.triggered_total ?? null

  return [
    {
      key: 'stock_value',
      label: 'Stock value',
      value: s ? formatCurrencyCompact(s.closing_value) : null,
      numeric: s ? s.closing_value : null,
      icon: 'value',
      tone: 'success',
      hint: `Closing value as at ${asOf}`,
      to: drill.stockValue({ asOf }),
      emphasizeNegative: true,
    },
    {
      key: 'stock_qty',
      label: 'Stock on hand',
      value: s ? formatQtyCompact(s.closing_qty) : null,
      numeric: s ? s.closing_qty : null,
      icon: 'qty',
      tone: 'teal',
      hint: core
        ? `Base units across ${formatCount(core.masters.warehouses.active)} active warehouses`
        : 'Base units across all warehouses',
      to: drill.stockQty({ asOf }),
      emphasizeNegative: true,
    },
    {
      key: 'items_in_stock',
      label: 'Items in stock',
      value: s ? formatCount(s.items) : null,
      numeric: s ? s.items : null,
      icon: 'items',
      tone: 'primary',
      hint: core ? `${formatCount(core.masters.items.active)} active items in the master` : undefined,
      to: drill.itemsInStock({ asOf }),
    },
    {
      key: 'reorder',
      label: 'To reorder',
      value: reorder === null ? null : formatCount(reorder),
      numeric: reorder,
      icon: 'reorder',
      tone: 'warning',
      hint: reorder ? 'At or below reorder point' : 'Nothing below its reorder point',
      to: drill.replenishment({ onlyTriggered: true }),
      attention: (reorder ?? 0) > 0,
    },
    {
      key: 'negative_stock',
      label: 'Negative stock',
      value: negativeItems === null ? null : formatCount(negativeItems),
      numeric: negativeItems,
      icon: 'negative',
      tone: (negativeItems ?? 0) > 0 ? 'danger' : 'neutral',
      hint: negativeRows ? `${formatCount(negativeRows)} stock rows below zero` : 'No item is below zero',
      to: drill.negativeStock(),
      attention: (negativeItems ?? 0) > 0,
    },
    {
      key: 'expiring',
      label: `Expiring in ${nearExpiryDays}d`,
      value: expiry ? formatCount(expiry.expiringSoon) : null,
      numeric: expiry ? expiry.expiringSoon : null,
      icon: 'expiring',
      tone: (expiry?.expiringSoon ?? 0) > 0 ? 'warning' : 'neutral',
      hint: expiry ? `${formatQtyCompact(expiry.summary.on_hand)} units in the window` : undefined,
      to: drill.nearExpiry({ days: nearExpiryDays, includeExpired: false }),
      attention: (expiry?.expiringSoon ?? 0) > 0,
    },
    {
      key: 'expired',
      label: 'Expired batches',
      value: expiry ? formatCount(expiry.expired) : null,
      numeric: expiry ? expiry.expired : null,
      icon: 'expired',
      tone: (expiry?.expired ?? 0) > 0 ? 'danger' : 'neutral',
      hint: expiry && expiry.expired > 0 ? `${formatQtyCompact(expiry.summary.expired_qty)} units still on hand` : 'Nothing expired on hand',
      to: drill.expiredBatches(),
      attention: (expiry?.expired ?? 0) > 0,
    },
    {
      key: 'pending_approval',
      label: 'Awaiting approval',
      value: pendingApproval === null ? null : formatCount(pendingApproval),
      numeric: pendingApproval,
      icon: 'approval',
      tone: (pendingApproval ?? 0) > 0 ? 'info' : 'neutral',
      hint: failed ? `${formatCount(failed)} failed postings` : 'No document is waiting',
      to: drill.documents({ status: 'PENDING_APPROVAL' }),
      attention: (pendingApproval ?? 0) > 0,
    },
  ]
}

// ---------------------------------------------------------------------------
// Series builders
// ---------------------------------------------------------------------------

/** Stock value per warehouse, biggest first. Every slice links to its register. */
export function warehouseSeries(summary: WarehouseStockSummary | null, asOf: string): SeriesItem[] {
  if (!summary) return []
  const rows = [...summary.by_warehouse].sort((a, b) => b.closing_value - a.closing_value)
  const total = summary.closing_value
  return rows.map((r) => ({
    key: String(r.warehouse_id ?? 'none'),
    label: r.warehouse_name ?? (r.warehouse_id ? `Warehouse ${r.warehouse_id}` : 'No warehouse'),
    value: r.closing_value,
    display: formatCurrencyCompact(r.closing_value),
    share: percentOf(Math.max(0, r.closing_value), total),
    scale: percentOf(Math.max(0, r.closing_value), Math.max(...rows.map((x) => Math.abs(x.closing_value)), 0)),
    tone: 'primary' as Tone,
    sub: `${formatQtyCompact(r.closing_qty)} units`,
    to: drill.warehouseStock({ asOf, warehouseId: r.warehouse_id }),
  }))
}

const AGE_BUCKET_ORDER: AgeBucketKey[] = ['0_30', '31_60', '61_90', '91_180', '180_plus']
const AGE_BUCKET_TONE: Record<AgeBucketKey, Tone> = {
  '0_30': 'success',
  '31_60': 'info',
  '61_90': 'warning',
  '91_180': 'danger',
  '180_plus': 'critical',
}

/** Value of stock still on hand, by how long it has been sitting there. */
export function ageingSeries(summary: StockAgeingSummary | null, asOf: string): SeriesItem[] {
  if (!summary) return []
  const total = summary.total_value
  const max = AGE_BUCKET_ORDER.reduce((m, k) => Math.max(m, Math.abs(summary.buckets[k]?.value ?? 0)), 0)
  return AGE_BUCKET_ORDER.map((k) => {
    const bucket = summary.buckets[k] ?? { qty: 0, value: 0 }
    return {
      key: k,
      label: summary.bucket_labels?.[k] ?? k.replace(/_/g, '-'),
      value: bucket.value,
      display: formatCurrencyCompact(bucket.value),
      share: percentOf(Math.max(0, bucket.value), total),
      scale: max > 0 ? Math.min(100, (Math.abs(bucket.value) / max) * 100) : 0,
      tone: AGE_BUCKET_TONE[k],
      sub: `${formatQtyCompact(bucket.qty)} units`,
      to: drill.stockAgeing({ asOf }),
    }
  })
}

const MOVEMENT_ORDER: MovementClass[] = ['fast', 'slow', 'non_moving', 'dead']
const MOVEMENT_LABEL: Record<MovementClass, string> = {
  fast: 'Fast moving',
  slow: 'Slow moving',
  non_moving: 'Non-moving',
  dead: 'Dead stock',
}
const MOVEMENT_TONE: Record<MovementClass, Tone> = {
  fast: 'success',
  slow: 'info',
  non_moving: 'warning',
  dead: 'critical',
}

/** How many items fall in each movement class over the reporting period. */
export function movementSeries(summary: MovementAnalysisSummary | null): SeriesItem[] {
  if (!summary) return []
  const byClass = summary.by_class
  const total = MOVEMENT_ORDER.reduce((acc, k) => acc + (byClass[k]?.items ?? 0), 0)
  const max = MOVEMENT_ORDER.reduce((m, k) => Math.max(m, byClass[k]?.items ?? 0), 0)
  return MOVEMENT_ORDER.map((k) => {
    const c = byClass[k] ?? { items: 0, on_hand: 0, period_out_qty: 0 }
    return {
      key: k,
      label: MOVEMENT_LABEL[k],
      value: c.items,
      display: formatCount(c.items),
      share: percentOf(c.items, total),
      scale: max > 0 ? Math.min(100, (c.items / max) * 100) : 0,
      tone: MOVEMENT_TONE[k],
      sub: `${formatQtyCompact(c.on_hand)} on hand`,
      to: drill.movementAnalysis({ from: summary.from, to: summary.to, cls: k }),
    }
  })
}

const DOCUMENT_STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'info',
  APPROVED: 'info',
  POSTING: 'warning',
  POSTED: 'success',
  PARTIALLY_FULFILLED: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  REVERSED: 'warning',
  FAILED: 'critical',
}

/** Document count by status for the financial year — zero-count statuses drop out. */
export function documentStatusSeries(byStatus: Record<string, number> | null | undefined): SeriesItem[] {
  if (!byStatus) return []
  const entries = Object.entries(byStatus).filter(([, n]) => n > 0)
  const total = entries.reduce((acc, [, n]) => acc + n, 0)
  const max = entries.reduce((m, [, n]) => Math.max(m, n), 0)
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([status, n]) => ({
      key: status,
      label: humanize(status),
      value: n,
      display: formatCount(n),
      share: percentOf(n, total),
      scale: max > 0 ? Math.min(100, (n / max) * 100) : 0,
      tone: DOCUMENT_STATUS_TONE[status] ?? 'neutral',
      to: drill.documents({ status }),
    }))
}

/**
 * Posted documents by type — the paperwork actually raised this year, which is
 * a different question from how many are stuck in each status. Each bar opens
 * the document register filtered to that type.
 */
export function postedTypeSeries(byType: Record<string, number> | null | undefined, limit = 6): SeriesItem[] {
  if (!byType) return []
  const entries = Object.entries(byType).filter(([, n]) => n > 0)
  const total = entries.reduce((acc, [, n]) => acc + n, 0)
  const max = entries.reduce((m, [, n]) => Math.max(m, n), 0)
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([type, n]) => ({
      key: type,
      label: labelForCode(type),
      value: n,
      display: formatCount(n),
      // Share of everything posted, not of the six shown, or the percentages
      // would add up to 100 while hiding rows.
      share: percentOf(n, total),
      scale: max > 0 ? Math.min(100, (n / max) * 100) : 0,
      tone: 'info' as Tone,
      to: drill.documents({ documentType: type }),
    }))
}

const OUTBOX_TONE: Record<string, Tone> = {
  PENDING: 'info',
  SENT: 'success',
  ACKED: 'success',
  FAILED: 'warning',
  DEAD: 'critical',
}

/** Books outbox events by delivery status. */
export function outboxSeries(outbox: Record<string, number> | null | undefined): SeriesItem[] {
  if (!outbox) return []
  const entries = Object.entries(outbox).filter(([, n]) => n > 0)
  const total = entries.reduce((acc, [, n]) => acc + n, 0)
  const max = entries.reduce((m, [, n]) => Math.max(m, n), 0)
  return entries.map(([status, n]) => ({
    key: status,
    label: humanize(status),
    value: n,
    display: formatCount(n),
    share: percentOf(n, total),
    scale: max > 0 ? Math.min(100, (n / max) * 100) : 0,
    tone: OUTBOX_TONE[status] ?? 'neutral',
    to: drill.outbox(status),
  }))
}

const INBOUND_TONE: Record<string, Tone> = {
  RECEIVED: 'info',
  PROCESSED: 'success',
  FAILED: 'critical',
  IGNORED: 'neutral',
}

/**
 * Events Books sent *to* Inventory, by processing status. The sync is two-way,
 * so a widget that shows only the outbox reports half the health of it. There
 * is no inbound-event screen to link to, so these bars are figures only.
 */
export function inboundSeries(inbound: Record<string, number> | null | undefined): SeriesItem[] {
  if (!inbound) return []
  const entries = Object.entries(inbound).filter(([, n]) => n > 0)
  const total = entries.reduce((acc, [, n]) => acc + n, 0)
  const max = entries.reduce((m, [, n]) => Math.max(m, n), 0)
  return entries.map(([status, n]) => ({
    key: status,
    label: humanize(status),
    value: n,
    display: formatCount(n),
    share: percentOf(n, total),
    scale: max > 0 ? Math.min(100, (n / max) * 100) : 0,
    tone: INBOUND_TONE[status] ?? 'neutral',
  }))
}

/** Open challans / deferred purchases / job work, by kind. */
export function pendingSeries(pending: Record<string, number> | null | undefined): SeriesItem[] {
  if (!pending) return []
  const entries = Object.entries(pending).filter(([, n]) => n > 0)
  const total = entries.reduce((acc, [, n]) => acc + n, 0)
  const max = entries.reduce((m, [, n]) => Math.max(m, n), 0)
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([kind, n]) => ({
      key: kind,
      label: humanize(kind),
      value: n,
      display: formatCount(n),
      share: percentOf(n, total),
      scale: max > 0 ? Math.min(100, (n / max) * 100) : 0,
      tone: 'info' as Tone,
      to: drill.pendingQuantities(kind),
    }))
}

// ---------------------------------------------------------------------------
// Donut geometry
// ---------------------------------------------------------------------------

export interface DonutArc {
  key: string
  label: string
  /** Share of the circle, 0-100. */
  percent: number
  /** Where the arc starts, 0-100 clockwise from 12 o'clock. */
  offset: number
  display: string
  to?: string
  /** Index into the chart palette. */
  colorIndex: number
}

/**
 * Turn a series into arc geometry. Negative and zero slices are dropped (a
 * donut cannot draw them) and the remainder is re-based so the arcs always
 * close the circle.
 */
export function donutArcs(items: readonly SeriesItem[], maxSlices = 6): DonutArc[] {
  const positive = items.filter((i) => i.value > 0)
  if (positive.length === 0) return []
  const sorted = [...positive].sort((a, b) => b.value - a.value)
  const head = sorted.slice(0, Math.max(1, maxSlices - 1))
  const tail = sorted.slice(Math.max(1, maxSlices - 1))
  const slices =
    tail.length > 1
      ? [
          ...head,
          {
            key: '__other__',
            label: `Other (${tail.length})`,
            value: tail.reduce((acc, t) => acc + t.value, 0),
            display: '',
            share: 0,
            scale: 0,
            tone: 'neutral' as Tone,
            to: undefined,
            sub: undefined,
          } satisfies SeriesItem,
        ]
      : sorted

  const sum = slices.reduce((acc, s) => acc + s.value, 0)
  let offset = 0
  return slices.map((s, i) => {
    const percent = sum > 0 ? (s.value / sum) * 100 : 0
    const arc: DonutArc = {
      key: s.key,
      label: s.label,
      percent,
      offset,
      display: s.display,
      to: s.to,
      colorIndex: i,
    }
    offset += percent
    return arc
  })
}

/** Largest slice as a share of the whole — the one-line takeaway under a donut. */
export function topShare(items: readonly SeriesItem[]): { label: string; share: number } | null {
  const positive = items.filter((i) => i.value > 0)
  if (positive.length === 0) return null
  const total = positive.reduce((acc, i) => acc + i.value, 0)
  const top = positive.reduce((best, i) => (i.value > best.value ? i : best), positive[0])
  return { label: top.label, share: percentOf(top.value, total) }
}
