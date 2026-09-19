import { AlertTriangle, CalendarClock, ShoppingCart, TrendingDown } from 'lucide-react'
import type {
  MovementAnalysisRow,
  MovementAnalysisSummary,
  NearExpiryRow,
  NearExpirySummary,
  ReplenishmentRow,
  ReplenishmentSummary,
} from '../../services/reportsApi'
import { buildTotalsRow, totalsLabel } from '../../registers/registerTotals'
import type { RegisterConfig, StatCardSpec } from '../../registers/RegisterConfig'
import { StatusBadge } from '../../ui/StatusBadge'
import { formatInt, formatMoney, formatQty } from '../../utils/format'
import {
  MOVEMENT_CLASS_LABELS,
  MOVEMENT_CLASS_ORDER,
  MOVEMENT_CLASS_TONES,
  expiryTone,
} from '../helpers'
import {
  DASH,
  byWarehouseFilter,
  dateColumn,
  itemColumn,
  itemFilter,
  itemGroupFilter,
  moneyColumn,
  periodFilter,
  qtyColumn,
  stockCategoryFilter,
  textColumn,
  warehouseFilter,
} from './common'

function ledgerLink(itemId: number, warehouseId?: number | null): string {
  const qs = new URLSearchParams({ item_id: String(itemId) })
  if (warehouseId) qs.set('warehouse_id', String(warehouseId))
  return `/registers/stock-ledger?${qs.toString()}`
}

export const movementAnalysisConfig: RegisterConfig<MovementAnalysisRow, MovementAnalysisSummary> = {
  slug: 'movement_analysis',
  path: 'movement-analysis',
  title: 'Movement analysis',
  description:
    'Fast, slow, non-moving and dead stock from the issues of the period and the days since the last movement',
  group: 'analysis',
  icon: TrendingDown,
  defaultSort: 'period_out_qty',
  defaultOrder: 'desc',
  minWidth: 1300,
  filters: [
    ...periodFilter,
    itemFilter,
    warehouseFilter,
    itemGroupFilter,
    stockCategoryFilter,
    {
      key: 'class',
      kind: 'select',
      label: 'Class',
      options: MOVEMENT_CLASS_ORDER.map((c) => ({ value: c, label: MOVEMENT_CLASS_LABELS[c] })),
    },
    { key: 'fast_days', kind: 'number', label: 'Fast ≤ days', placeholder: '30' },
    { key: 'slow_days', kind: 'number', label: 'Slow ≤ days', placeholder: '90' },
    { key: 'dead_days', kind: 'number', label: 'Dead > days', placeholder: '180' },
    { key: 'include_inactive', kind: 'toggle', label: 'Include inactive items', defaultOn: false },
  ],
  columns: [
    itemColumn<MovementAnalysisRow>(),
    {
      key: 'classification',
      header: 'Class',
      sortKey: 'classification',
      render: (r) => (
        <StatusBadge
          value={MOVEMENT_CLASS_LABELS[r.classification] ?? r.classification}
          tone={MOVEMENT_CLASS_TONES[r.classification] ?? 'neutral'}
        />
      ),
      csv: (r) => r.classification,
    },
    qtyColumn<MovementAnalysisRow>('on_hand', 'On hand'),
    qtyColumn<MovementAnalysisRow>('period_in_qty', 'In (period)'),
    qtyColumn<MovementAnalysisRow>('period_out_qty', 'Out (period)', { strong: true }),
    moneyColumn<MovementAnalysisRow>('period_out_value', 'Out value'),
    {
      key: 'period_out_docs',
      header: 'Issues',
      align: 'right',
      sortKey: 'period_out_docs',
      format: 'int',
      render: (r) => formatInt(r.period_out_docs),
    },
    dateColumn<MovementAnalysisRow>('last_out_date', 'Last issue'),
    {
      key: 'days_since_last_out',
      header: 'Days idle',
      align: 'right',
      sortKey: 'days_since_last_out',
      render: (r) => (r.days_since_last_out === null ? DASH : formatInt(r.days_since_last_out)),
    },
    {
      key: 'days_of_cover',
      header: 'Cover (days)',
      align: 'right',
      sortKey: 'days_of_cover',
      configureHint: 'Days the stock on hand lasts at the period’s issue rate.',
      render: (r) => (r.days_of_cover === null ? DASH : formatInt(Math.round(r.days_of_cover))),
    },
  ],
  rowKey: (r) => r.item_id,
  drillTo: (r) => ledgerLink(r.item_id),
  // Each card filters the register down to its own class — the drill-down the
  // brief asks for, and the thing this screen was missing.
  kpis: (s) =>
    MOVEMENT_CLASS_ORDER.map<StatCardSpec>((c) => ({
      key: c,
      label: MOVEMENT_CLASS_LABELS[c],
      value: formatInt(s.by_class?.[c]?.items ?? 0),
      hint: `${formatQty(s.by_class?.[c]?.on_hand ?? 0)} on hand · ${formatQty(s.by_class?.[c]?.period_out_qty ?? 0)} issued`,
      tone: c === 'fast' ? 'success' : c === 'slow' ? 'info' : c === 'non_moving' ? 'warning' : 'danger',
      icon: TrendingDown,
      to: `/registers/movement-analysis?class=${c}`,
    })),
  summary: (s) =>
    MOVEMENT_CLASS_ORDER.map((c) => ({
      label: MOVEMENT_CLASS_LABELS[c],
      value: formatInt(s.by_class?.[c]?.items ?? 0),
      hint: `${formatQty(s.by_class?.[c]?.on_hand ?? 0)} on hand · ${formatQty(s.by_class?.[c]?.period_out_qty ?? 0)} issued`,
      tone:
        MOVEMENT_CLASS_TONES[c] === 'info'
          ? 'neutral'
          : (MOVEMENT_CLASS_TONES[c] as 'good' | 'warning' | 'critical' | 'neutral'),
    })),
}

export const nearExpiryConfig: RegisterConfig<NearExpiryRow, NearExpirySummary> = {
  slug: 'near_expiry',
  path: 'near-expiry',
  title: 'Near expiry',
  description:
    'Batches expiring within the window, oldest first, with what is on hand and what is already promised',
  group: 'analysis',
  icon: CalendarClock,
  defaultSort: 'expiry_date',
  minWidth: 1300,
  filters: [
    { key: 'as_of', kind: 'date', label: 'As at', defaultValue: (c) => c.today },
    { key: 'days', kind: 'number', label: 'Within days', defaultValue: () => '30' },
    { key: 'include_expired', kind: 'toggle', label: 'Include expired', defaultOn: true },
    // Expired stock is a different job from stock about to expire — it is written
    // off, returned or destroyed, not planned around — and until this existed the
    // dashboard's "Expired batches" card had nowhere to send the reader that
    // could show its figure.
    { key: 'expired_only', kind: 'toggle', label: 'Expired only', defaultOn: false },
    itemFilter,
    warehouseFilter,
    itemGroupFilter,
    stockCategoryFilter,
    byWarehouseFilter,
  ],
  columns: [
    itemColumn<NearExpiryRow>(),
    textColumn<NearExpiryRow>('batch_no', 'Batch'),
    textColumn<NearExpiryRow>('warehouse_name', 'Warehouse', false),
    dateColumn<NearExpiryRow>('expiry_date', 'Expiry'),
    {
      key: 'days_to_expiry',
      header: 'Days left',
      align: 'right',
      sortKey: 'days_to_expiry',
      render: (r) => (
        <StatusBadge
          value={r.is_expired ? 'expired' : `${r.days_to_expiry} d`}
          tone={expiryTone(r.days_to_expiry, r.is_expired)}
        />
      ),
      csv: (r) => r.days_to_expiry,
    },
    qtyColumn<NearExpiryRow>('on_hand', 'On hand', { strong: true }),
    qtyColumn<NearExpiryRow>('reserved', 'Reserved'),
    qtyColumn<NearExpiryRow>('packed', 'Packed'),
    { ...qtyColumn<NearExpiryRow>('quality_hold', 'On hold'), defaultVisible: false },
    moneyColumn<NearExpiryRow>('unit_cost', 'Unit cost'),
    moneyColumn<NearExpiryRow>('stock_value', 'Value'),
  ],
  rowKey: (r) => `${r.batch_id}:${r.warehouse_id ?? 0}`,
  drillTo: (r) => ledgerLink(r.item_id, r.warehouse_id),
  totals: (s) =>
    buildTotalsRow(
      [
        { key: 'item_name' },
        { key: 'on_hand', align: 'right' },
      ],
      { on_hand: formatQty(s.on_hand) },
      { label: totalsLabel(s.batches, 'batch', 'batches'), labelKey: 'item_name' },
    ),
  kpis: (s) => [
    {
      key: 'window',
      label: 'Window',
      value: `${formatInt(s.days)} days`,
      hint: `until ${s.until}`,
      icon: CalendarClock,
      tone: 'info',
    },
    { key: 'batches', label: 'Batches', value: formatInt(s.batches), icon: CalendarClock, tone: 'primary' },
    { key: 'items', label: 'Items', value: formatInt(s.items), icon: CalendarClock, tone: 'primary' },
    { key: 'on_hand', label: 'On hand', value: formatQty(s.on_hand), icon: CalendarClock, tone: 'primary' },
    {
      key: 'expired',
      label: 'Expired batches',
      value: formatInt(s.expired_batches),
      hint: `${formatQty(s.expired_qty)} qty`,
      icon: AlertTriangle,
      tone: s.expired_batches > 0 ? 'danger' : 'success',
      // Straight to the ones that have already gone — nothing else on this
      // screen is as urgent — and the register's own batch count is then this
      // very figure.
      to: '/registers/near-expiry?expired_only=1',
    },
  ],
  summary: (s) => [
    { label: 'Window', value: `${formatInt(s.days)} days`, hint: `until ${s.until}` },
    { label: 'Batches', value: formatInt(s.batches) },
    { label: 'Items', value: formatInt(s.items) },
    { label: 'On hand', value: formatQty(s.on_hand) },
    {
      label: 'Expired batches',
      value: formatInt(s.expired_batches),
      hint: `${formatQty(s.expired_qty)} qty`,
      tone: s.expired_batches > 0 ? 'critical' : 'neutral',
    },
  ],
  rowClassName: (r) => (r.is_expired ? 'bg-red-50/60' : undefined),
}

export const replenishmentConfig: RegisterConfig<ReplenishmentRow, ReplenishmentSummary> = {
  slug: 'replenishment',
  path: 'replenishment',
  title: 'Replenishment',
  description:
    'Items at or below their reorder point once reservations, pending outs and expected receipts are taken into account, with a suggested order quantity',
  group: 'analysis',
  icon: ShoppingCart,
  defaultSort: 'item_name',
  minWidth: 1700,
  filters: [
    itemFilter,
    warehouseFilter,
    itemGroupFilter,
    stockCategoryFilter,
    { key: 'only_triggered', kind: 'toggle', label: 'Only items to reorder', defaultOn: true },
    { key: 'with_thresholds_only', kind: 'toggle', label: 'Only items with thresholds', defaultOn: false },
  ],
  columns: [
    itemColumn<ReplenishmentRow>(),
    textColumn<ReplenishmentRow>('default_warehouse_name', 'Warehouse', false),
    qtyColumn<ReplenishmentRow>('on_hand', 'On hand'),
    qtyColumn<ReplenishmentRow>('available', 'Available'),
    qtyColumn<ReplenishmentRow>('expected', 'Expected in'),
    qtyColumn<ReplenishmentRow>('pending_out', 'Pending out'),
    qtyColumn<ReplenishmentRow>('projected', 'Projected', { strong: true }),
    qtyColumn<ReplenishmentRow>('reorder_point_qty', 'Reorder at'),
    { ...qtyColumn<ReplenishmentRow>('min_stock_qty', 'Min'), defaultVisible: false },
    { ...qtyColumn<ReplenishmentRow>('max_stock_qty', 'Max'), defaultVisible: false },
    {
      key: 'triggered',
      header: 'Reorder?',
      render: (r) => (r.triggered ? <StatusBadge value="reorder" tone="warning" /> : <span className="text-gray-400">ok</span>),
      csv: (r) => (r.triggered ? 'yes' : 'no'),
    },
    {
      key: 'reasons',
      header: 'Why',
      render: (r) => (r.reasons?.length ? r.reasons.map((x) => x.replace(/_/g, ' ')).join(', ') : DASH),
      csv: (r) => r.reasons?.join('; ') ?? '',
    },
    qtyColumn<ReplenishmentRow>('suggested_qty', 'Suggest', { strong: true }),
    moneyColumn<ReplenishmentRow>('suggested_value', 'Suggested value'),
    dateColumn<ReplenishmentRow>('needed_by', 'Needed by'),
  ],
  rowKey: (r) => r.item_id,
  drillTo: (r) => ledgerLink(r.item_id, r.default_warehouse_id),
  kpis: (s) => [
    {
      key: 'triggered',
      label: 'Items to reorder',
      value: formatInt(s.triggered_total),
      icon: ShoppingCart,
      tone: s.triggered_total > 0 ? 'warning' : 'success',
      // `only_triggered` is already on by default, so linking to it alone left
      // the card doing nothing when clicked. Worst shortfall first is the thing
      // a reader wants from this figure, and it is a filter the endpoint reads.
      to: '/registers/replenishment?only_triggered=1&sort=projected&order=asc',
    },
    // The endpoint only totals the page it served, so the label has to say so
    // rather than let a reader read it as the whole result.
    {
      key: 'page_qty',
      label: 'Suggested qty',
      value: formatQty(s.page_suggested_qty),
      hint: 'this page only',
      icon: ShoppingCart,
      tone: 'primary',
    },
    {
      key: 'page_value',
      label: 'Suggested value',
      value: formatMoney(s.page_suggested_value),
      hint: 'this page only',
      icon: ShoppingCart,
      tone: 'primary',
    },
  ],
  summary: (s) => [
    {
      label: 'Items to reorder',
      value: formatInt(s.triggered_total),
      tone: s.triggered_total > 0 ? 'warning' : 'good',
    },
    { label: 'Suggested qty (page)', value: formatQty(s.page_suggested_qty) },
    { label: 'Suggested value (page)', value: formatMoney(s.page_suggested_value) },
  ],
  rowClassName: (r) => (r.triggered ? 'bg-amber-50/60' : undefined),
}
