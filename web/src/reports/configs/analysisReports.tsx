import { StatusBadge } from '../../components/StatusBadge'
import type { MovementAnalysisRow, MovementAnalysisSummary, NearExpiryRow, NearExpirySummary, ReplenishmentRow, ReplenishmentSummary, StockAgeingRow, StockAgeingSummary } from '../../services/reportsApi'
import { formatInt, formatMoney, formatQty } from '../../utils/format'
import { AGE_BUCKET_LABELS, AGE_BUCKET_ORDER, MOVEMENT_CLASS_LABELS, MOVEMENT_CLASS_ORDER, MOVEMENT_CLASS_TONES, expiryTone } from '../helpers'
import type { ReportColumn, ReportConfig } from '../types'
import { byWarehouseFilter, dateColumn, itemColumn, itemFilter, itemGroupFilter, moneyColumn, qtyColumn, stockCategoryFilter, textColumn, warehouseFilter } from './common'

const ageBucketColumns: ReportColumn<StockAgeingRow>[] = AGE_BUCKET_ORDER.flatMap((key) => [
  { key: `bucket_${key}_qty`, header: `${AGE_BUCKET_LABELS[key]} qty`, align: 'right' as const, render: (r: StockAgeingRow) => formatQty(r.buckets?.[key]?.qty), csv: (r: StockAgeingRow) => r.buckets?.[key]?.qty ?? 0 },
  { key: `bucket_${key}_value`, header: `${AGE_BUCKET_LABELS[key]} value`, align: 'right' as const, render: (r: StockAgeingRow) => formatMoney(r.buckets?.[key]?.value), csv: (r: StockAgeingRow) => r.buckets?.[key]?.value ?? 0 },
])

export const stockAgeingConfig: ReportConfig<StockAgeingRow, StockAgeingSummary> = {
  slug: 'stock_ageing',
  path: 'stock-ageing',
  title: 'Stock ageing',
  description: 'Open cost layers bucketed by age as at a date — how long the stock on hand has been sitting',
  defaultSort: 'total_value',
  defaultOrder: 'desc',
  filters: [{ key: 'as_of', kind: 'date', label: 'As at', defaultValue: (c) => c.today }, itemFilter, warehouseFilter, byWarehouseFilter],
  columns: [
    itemColumn<StockAgeingRow>(),
    textColumn<StockAgeingRow>('warehouse_name', 'Warehouse', false),
    ...ageBucketColumns,
    qtyColumn<StockAgeingRow>('total_qty', 'Total qty', { strong: true }),
    moneyColumn<StockAgeingRow>('total_value', 'Total value', { strong: true }),
    { key: 'weighted_age_days', header: 'Avg age (days)', align: 'right', sortKey: 'weighted_age_days', render: (r) => (r.weighted_age_days === null ? '—' : formatInt(Math.round(r.weighted_age_days))) },
    { key: 'oldest_days', header: 'Oldest', align: 'right', sortKey: 'oldest_days', render: (r) => (r.oldest_days === null ? '—' : `${formatInt(r.oldest_days)} d`) },
  ],
  rowKey: (r) => `${r.item_id}:${r.warehouse_id ?? 0}`,
  summary: (s) => [
    { label: 'Items', value: formatInt(s.items) },
    { label: 'Total qty', value: formatQty(s.total_qty) },
    { label: 'Total value', value: formatMoney(s.total_value), tone: 'good' },
    ...AGE_BUCKET_ORDER.map((key) => ({ label: s.bucket_labels?.[key] ?? AGE_BUCKET_LABELS[key], value: formatMoney(s.buckets?.[key]?.value), hint: `${formatQty(s.buckets?.[key]?.qty)} qty`, tone: (key === '180_plus' ? 'critical' : key === '91_180' ? 'warning' : 'neutral') as 'critical' | 'warning' | 'neutral' })),
  ],
}

export const movementAnalysisConfig: ReportConfig<MovementAnalysisRow, MovementAnalysisSummary> = {
  slug: 'movement_analysis',
  path: 'movement-analysis',
  title: 'Movement analysis',
  description: 'Fast, slow, non-moving and dead stock from the issues of the period and the days since the last movement',
  defaultSort: 'period_out_qty',
  defaultOrder: 'desc',
  filters: [
    { key: 'from', kind: 'date', label: 'From', defaultValue: (c) => c.fyFrom },
    { key: 'to', kind: 'date', label: 'To', defaultValue: (c) => (c.today < c.fyTo ? c.today : c.fyTo) },
    itemFilter,
    warehouseFilter,
    itemGroupFilter,
    stockCategoryFilter,
    { key: 'class', kind: 'select', label: 'Class', options: MOVEMENT_CLASS_ORDER.map((c) => ({ value: c, label: MOVEMENT_CLASS_LABELS[c] })) },
    { key: 'fast_days', kind: 'number', label: 'Fast ≤ days', placeholder: '30' },
    { key: 'slow_days', kind: 'number', label: 'Slow ≤ days', placeholder: '90' },
    { key: 'dead_days', kind: 'number', label: 'Dead > days', placeholder: '180' },
    { key: 'include_inactive', kind: 'toggle', label: 'Include inactive items', defaultOn: false },
  ],
  columns: [
    itemColumn<MovementAnalysisRow>(),
    { key: 'classification', header: 'Class', sortKey: 'classification', render: (r) => <StatusBadge value={MOVEMENT_CLASS_LABELS[r.classification] ?? r.classification} tone={MOVEMENT_CLASS_TONES[r.classification] ?? 'neutral'} />, csv: (r) => r.classification },
    qtyColumn<MovementAnalysisRow>('on_hand', 'On hand'),
    qtyColumn<MovementAnalysisRow>('period_in_qty', 'In (period)'),
    qtyColumn<MovementAnalysisRow>('period_out_qty', 'Out (period)', { strong: true }),
    moneyColumn<MovementAnalysisRow>('period_out_value', 'Out value'),
    { key: 'period_out_docs', header: 'Issues', align: 'right', sortKey: 'period_out_docs', render: (r) => formatInt(r.period_out_docs) },
    dateColumn<MovementAnalysisRow>('last_out_date', 'Last issue'),
    { key: 'days_since_last_out', header: 'Days idle', align: 'right', sortKey: 'days_since_last_out', render: (r) => (r.days_since_last_out === null ? '—' : formatInt(r.days_since_last_out)) },
    { key: 'days_of_cover', header: 'Cover (days)', align: 'right', sortKey: 'days_of_cover', render: (r) => (r.days_of_cover === null ? '—' : formatInt(Math.round(r.days_of_cover))) },
  ],
  rowKey: (r) => r.item_id,
  summary: (s) =>
    MOVEMENT_CLASS_ORDER.map((c) => ({
      label: MOVEMENT_CLASS_LABELS[c],
      value: formatInt(s.by_class?.[c]?.items ?? 0),
      hint: `${formatQty(s.by_class?.[c]?.on_hand ?? 0)} on hand · ${formatQty(s.by_class?.[c]?.period_out_qty ?? 0)} issued`,
      tone: MOVEMENT_CLASS_TONES[c] === 'info' ? 'neutral' : (MOVEMENT_CLASS_TONES[c] as 'good' | 'warning' | 'critical' | 'neutral'),
    })),
}

export const nearExpiryConfig: ReportConfig<NearExpiryRow, NearExpirySummary> = {
  slug: 'near_expiry',
  path: 'near-expiry',
  title: 'Near expiry',
  description: 'Batches expiring within the window, oldest first, with what is on hand and what is already promised',
  defaultSort: 'expiry_date',
  filters: [
    { key: 'as_of', kind: 'date', label: 'As at', defaultValue: (c) => c.today },
    { key: 'days', kind: 'number', label: 'Within days', defaultValue: () => '30' },
    { key: 'include_expired', kind: 'toggle', label: 'Include expired', defaultOn: true },
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
    { key: 'days_to_expiry', header: 'Days left', align: 'right', sortKey: 'days_to_expiry', render: (r) => <StatusBadge value={r.is_expired ? 'expired' : `${r.days_to_expiry} d`} tone={expiryTone(r.days_to_expiry, r.is_expired)} />, csv: (r) => r.days_to_expiry },
    qtyColumn<NearExpiryRow>('on_hand', 'On hand', { strong: true }),
    qtyColumn<NearExpiryRow>('reserved', 'Reserved'),
    qtyColumn<NearExpiryRow>('packed', 'Packed'),
    qtyColumn<NearExpiryRow>('quality_hold', 'On hold'),
    moneyColumn<NearExpiryRow>('unit_cost', 'Unit cost'),
    moneyColumn<NearExpiryRow>('stock_value', 'Value'),
  ],
  rowKey: (r) => `${r.batch_id}:${r.warehouse_id ?? 0}`,
  summary: (s) => [
    { label: 'Window', value: `${formatInt(s.days)} days`, hint: `until ${s.until}` },
    { label: 'Batches', value: formatInt(s.batches) },
    { label: 'Items', value: formatInt(s.items) },
    { label: 'On hand', value: formatQty(s.on_hand) },
    { label: 'Expired batches', value: formatInt(s.expired_batches), hint: `${formatQty(s.expired_qty)} qty`, tone: s.expired_batches > 0 ? 'critical' : 'neutral' },
  ],
  rowClassName: (r) => (r.is_expired ? 'row-critical' : undefined),
}

export const replenishmentConfig: ReportConfig<ReplenishmentRow, ReplenishmentSummary> = {
  slug: 'replenishment',
  path: 'replenishment',
  title: 'Replenishment',
  description: 'Items at or below their reorder point once reservations, pending outs and expected receipts are taken into account, with a suggested order quantity',
  defaultSort: 'item_name',
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
    qtyColumn<ReplenishmentRow>('min_stock_qty', 'Min'),
    qtyColumn<ReplenishmentRow>('max_stock_qty', 'Max'),
    { key: 'triggered', header: 'Reorder?', render: (r) => (r.triggered ? <StatusBadge value="reorder" tone="warning" /> : <span className="muted">ok</span>), csv: (r) => (r.triggered ? 'yes' : 'no') },
    { key: 'reasons', header: 'Why', render: (r) => (r.reasons?.length ? r.reasons.map((x) => x.replace(/_/g, ' ')).join(', ') : '—'), csv: (r) => r.reasons?.join('; ') ?? '' },
    qtyColumn<ReplenishmentRow>('suggested_qty', 'Suggest', { strong: true }),
    moneyColumn<ReplenishmentRow>('suggested_value', 'Suggested value'),
    dateColumn<ReplenishmentRow>('needed_by', 'Needed by'),
  ],
  rowKey: (r) => r.item_id,
  summary: (s) => [
    { label: 'Items to reorder', value: formatInt(s.triggered_total), tone: s.triggered_total > 0 ? 'warning' : 'good' },
    { label: 'Suggested qty (page)', value: formatQty(s.page_suggested_qty) },
    { label: 'Suggested value (page)', value: formatMoney(s.page_suggested_value) },
  ],
  rowClassName: (r) => (r.triggered ? 'row-warning' : undefined),
}
