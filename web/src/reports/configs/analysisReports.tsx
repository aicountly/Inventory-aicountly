import type { ReactNode } from 'react'
import { AlertTriangle, CalendarClock, Hourglass, ShoppingCart, TrendingDown } from 'lucide-react'
import type {
  AgeBucketKey,
  MovementAnalysisRow,
  MovementAnalysisSummary,
  NearExpiryRow,
  NearExpirySummary,
  ReplenishmentRow,
  ReplenishmentSummary,
  StockAgeingRow,
  StockAgeingSummary,
} from '../../services/reportsApi'
import { buildTotalsRow, totalsLabel } from '../../registers/registerTotals'
import type { RegisterConfig, StatCardSpec } from '../../registers/RegisterConfig'
import { AgeingBucketCell, AgeingBucketHeader } from '../../registers/ageing/AgeingBucketCell'
import { HealthBadge } from '../../registers/ageing/HealthBadge'
import { StockAgeingAnalytics } from '../../registers/ageing/StockAgeingAnalytics'
import { StockAgeingRowActions } from '../../registers/ageing/StockAgeingRowActions'
import {
  AGEING_KPI_ICONS,
  HEALTH_STATUS_META,
  HEALTH_STATUS_ORDER,
  ageingInsights,
  ageingNote,
  capitalAtRisk,
  formatShare,
} from '../../registers/ageing/ageingModel'
import { EmptyState } from '../../ui/EmptyState'
import { StatusBadge } from '../../ui/StatusBadge'
import { formatInt, formatMoney, formatQty } from '../../utils/format'
import {
  AGE_BUCKET_LABELS,
  AGE_BUCKET_ORDER,
  MOVEMENT_CLASS_LABELS,
  MOVEMENT_CLASS_ORDER,
  MOVEMENT_CLASS_TONES,
  expiryTone,
  sumBy,
} from '../helpers'
import type { ReportColumn } from '../types'
import {
  DASH,
  brandFilter,
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

const ageBucketColumns: ReportColumn<StockAgeingRow>[] = AGE_BUCKET_ORDER.flatMap((key) => {
  const label = AGE_BUCKET_LABELS[key]
  return [
    // The pair, in one column. Keyed `_value` so a reader's saved column choice and
    // every existing CSV keep working: the export still writes the band's value under
    // the band's name, and the screen now shows the quantity above it.
    {
      key: `bucket_${key}_value`,
      header: <AgeingBucketHeader label={label} />,
      align: 'right' as const,
      format: 'amount' as const,
      amount: true,
      csvHeader: `${label} value`,
      configureLabel: `${label} — quantity and value`,
      configureHint: 'Exports as the value of the band; add the quantity column for the units.',
      render: (r: StockAgeingRow) => <AgeingBucketCell bucket={key} value={r.buckets?.[key]} />,
      csv: (r: StockAgeingRow) => r.buckets?.[key]?.value ?? 0,
    },
    // The quantity on its own, for the reader who pivots the export by units. Off by
    // default because the cell beside it already shows the figure.
    {
      key: `bucket_${key}_qty`,
      header: `${label} qty`,
      align: 'right' as const,
      format: 'qty' as const,
      defaultVisible: false,
      configureLabel: `${label} — quantity as a separate column`,
      render: (r: StockAgeingRow) => formatQty(r.buckets?.[key]?.qty),
      csv: (r: StockAgeingRow) => r.buckets?.[key]?.qty ?? 0,
    },
  ]
})

/** Every column the totals row has to line up against, in table order. */
const ageingTotalsColumns = [
  { key: 'item_name' },
  { key: 'hsn_sac' },
  { key: 'warehouse_name' },
  { key: 'unit_symbol' },
  ...AGE_BUCKET_ORDER.flatMap((key) => [
    { key: `bucket_${key}_value`, align: 'right' as const },
    { key: `bucket_${key}_qty`, align: 'right' as const },
  ]),
  { key: 'total_qty', align: 'right' as const },
  { key: 'total_value', align: 'right' as const },
  { key: 'weighted_age_days', align: 'right' as const },
  { key: 'oldest_days', align: 'right' as const },
  { key: 'health_status' },
]

/** Subtotal cells for one group of rows on screen. */
function ageingSubtotal(rows: readonly StockAgeingRow[], label: string): Record<string, ReactNode> {
  const values: Record<string, ReactNode> = {
    total_qty: formatQty(sumBy(rows, (r) => r.total_qty)),
    total_value: formatMoney(sumBy(rows, (r) => r.total_value)),
  }
  for (const key of AGE_BUCKET_ORDER) {
    values[`bucket_${key}_value`] = formatMoney(sumBy(rows, (r) => r.buckets?.[key]?.value))
    values[`bucket_${key}_qty`] = formatQty(sumBy(rows, (r) => r.buckets?.[key]?.qty))
  }
  return buildTotalsRow(ageingTotalsColumns, values, {
    label: `${label} · ${totalsLabel(rows.length, 'item')} on this page`,
    labelKey: 'item_name',
  })
}

export const stockAgeingConfig: RegisterConfig<StockAgeingRow, StockAgeingSummary> = {
  slug: 'stock_ageing',
  path: 'stock-ageing',
  title: 'Stock ageing',
  description:
    'Open cost layers bucketed by age as at a date — how long the stock on hand has been sitting, and how much capital is tied up in the oldest of it',
  shortDescription:
    'Analyse how long your inventory has been in stock and identify capital at risk',
  group: 'analysis',
  icon: Hourglass,
  defaultSort: 'total_value',
  defaultOrder: 'desc',
  defaultLimit: 50,
  minWidth: 1500,
  printOrientation: 'landscape',
  rowNoun: 'item',
  // The panel layout: page header, carded filter grid, wide KPI row. This register is
  // read all day rather than glanced at, and its filters ARE the question — a date and
  // an ageing band decide every figure on the screen.
  layout: 'panel',
  filterPanel: {
    title: 'Ageing filters',
    description: 'Age the stock on hand at a date, then narrow to the bands that matter',
    // Five in the grid; the rest live behind "More filters", which carries the count
    // of those that are set so nothing can be narrowing the figures unseen.
    primaryKeys: ['as_of', 'item_id', 'warehouse_id', 'item_grp_id', 'brand_id'],
  },
  tableTitle: 'Stock ageing details',
  tableHint: 'Quantity and value of every item, split across the ageing bands it is sitting in',
  filters: [
    { key: 'as_of', kind: 'date', label: 'As at', defaultValue: (c) => c.today },
    itemFilter,
    warehouseFilter,
    itemGroupFilter,
    brandFilter,
    stockCategoryFilter,
    // The chart and the donut write this one; it is declared so the drill-down is a
    // real filter — in the URL, counted in the panel, cleared by Reset.
    {
      key: 'age_bucket',
      kind: 'select',
      label: 'Ageing band',
      options: AGE_BUCKET_ORDER.map((key) => ({ value: key, label: AGE_BUCKET_LABELS[key] })),
    },
    {
      key: 'health_status',
      kind: 'select',
      label: 'Health',
      options: HEALTH_STATUS_ORDER.map((key) => ({
        value: key,
        label: HEALTH_STATUS_META[key].label,
      })),
    },
    byWarehouseFilter,
  ],
  columns: [
    itemColumn<StockAgeingRow>(),
    textColumn<StockAgeingRow>('hsn_sac', 'HSN / SAC', false),
    textColumn<StockAgeingRow>('warehouse_name', 'Warehouse', false),
    textColumn<StockAgeingRow>('unit_symbol', 'UOM', false),
    ...ageBucketColumns,
    qtyColumn<StockAgeingRow>('total_qty', 'Total qty', { strong: true }),
    moneyColumn<StockAgeingRow>('total_value', 'Total value', { strong: true }),
    {
      key: 'weighted_age_days',
      header: 'Avg age',
      align: 'right',
      sortKey: 'weighted_age_days',
      configureHint: 'Quantity-weighted age of the layers still on hand.',
      render: (r) =>
        r.weighted_age_days === null ? DASH : (
          <span className="tabular-nums">{formatInt(Math.round(r.weighted_age_days))} d</span>
        ),
      csv: (r) => r.weighted_age_days,
    },
    {
      key: 'oldest_days',
      header: 'Oldest',
      align: 'right',
      sortKey: 'oldest_days',
      configureHint: 'Age of the oldest layer still on hand.',
      render: (r) => (r.oldest_days === null ? DASH : `${formatInt(r.oldest_days)} d`),
      csv: (r) => r.oldest_days,
    },
    {
      key: 'health_status',
      header: 'Health',
      sortKey: 'health_status',
      configureHint:
        'Decided by the server from the row\u2019s own ageing profile, so the badge, the CSV and the printed sheet always agree.',
      render: (r) => <HealthBadge status={r.health_status} />,
      csv: (r) => (r.health_status ? HEALTH_STATUS_META[r.health_status].label : ''),
    },
  ],
  rowKey: (r) => `${r.item_id}:${r.warehouse_id ?? 0}`,
  drillTo: (r) => ledgerLink(r.item_id, r.warehouse_id),
  rowActions: (r) => <StockAgeingRowActions row={r} />,
  groupBy: [
    {
      key: 'health_status',
      label: 'Health',
      of: (r) => ({
        key: r.health_status ?? 'none',
        label: r.health_status ? HEALTH_STATUS_META[r.health_status].label : 'Not classified',
      }),
      subtotal: (rows, group) => ageingSubtotal(rows, group.label),
    },
    {
      key: 'warehouse_name',
      label: 'Warehouse',
      of: (r) => ({
        key: String(r.warehouse_id ?? 0),
        label: r.warehouse_name ?? 'All warehouses',
      }),
      subtotal: (rows, group) => ageingSubtotal(rows, group.label),
    },
    {
      key: 'grp_name',
      label: 'Item group',
      of: (r) => ({ key: String(r.item_grp_id ?? 0), label: r.grp_name ?? 'Ungrouped' }),
      subtotal: (rows, group) => ageingSubtotal(rows, group.label),
    },
    {
      key: 'brand_name',
      label: 'Brand',
      of: (r) => ({ key: String(r.brand_id ?? 0), label: r.brand_name ?? 'No brand' }),
      subtotal: (rows, group) => ageingSubtotal(rows, group.label),
    },
  ],
  // Every bucket has a server-side total, so the footer lines up column for column
  // with the header — including the buckets a reader has hidden. Strings, not JSX:
  // a total built from nodes has no text form and prints blank.
  totals: (s) => {
    const values: Record<string, string> = {
      total_qty: formatQty(s.total_qty),
      total_value: formatMoney(s.total_value),
      weighted_age_days: s.weighted_age_days === null ? '' : `${formatInt(s.weighted_age_days)} d`,
      oldest_days: s.oldest_days === null ? '' : `${formatInt(s.oldest_days)} d`,
    }
    for (const key of AGE_BUCKET_ORDER) {
      values[`bucket_${key}_value`] = formatMoney(s.buckets?.[key]?.value)
      values[`bucket_${key}_qty`] = formatQty(s.buckets?.[key]?.qty)
    }
    return buildTotalsRow(ageingTotalsColumns, values, {
      label: totalsLabel(s.items, 'item'),
      labelKey: 'item_name',
    })
  },
  kpis: (s, _res, values = {}) => {
    const risk = capitalAtRisk(s)
    const slow = s.buckets?.['91_180']
    const obsolete = s.buckets?.['180_plus']
    // The card drills in ON TOP of what the reader has already asked for. Building
    // the link from the band alone would drop their warehouse or their as-at date and
    // land them on a wider set than the figure they just clicked.
    const drill = (bucket: AgeBucketKey) => {
      const qs = new URLSearchParams()
      for (const [key, value] of Object.entries(values)) {
        if (value && value !== '0') qs.set(key, value)
      }
      qs.set('age_bucket', bucket)
      return `/registers/stock-ageing?${qs.toString()}`
    }
    return [
      {
        key: 'items',
        label: 'Total items',
        value: formatInt(s.items),
        hint: 'Unique items in stock',
        icon: AGEING_KPI_ICONS.items,
        tone: 'primary',
      },
      {
        key: 'qty',
        label: 'Total quantity',
        value: formatQty(s.total_qty),
        hint: 'Units across all warehouses',
        icon: AGEING_KPI_ICONS.qty,
        tone: 'info',
      },
      {
        key: 'value',
        label: 'Total stock value',
        value: formatMoney(s.total_value),
        hint: `Current stock value at cost · as at ${s.as_of}`,
        icon: AGEING_KPI_ICONS.value,
        tone: 'violet',
        current: s.total_value,
        emphasizeNegative: true,
      },
      {
        key: 'slow',
        label: `Slow moving · ${AGE_BUCKET_LABELS['91_180']}`,
        value: `${formatInt(slow?.items ?? 0)} ${(slow?.items ?? 0) === 1 ? 'item' : 'items'}`,
        hint: `${formatMoney(slow?.value)} · ${formatShare(risk.slowShare)} of stock value`,
        icon: AGEING_KPI_ICONS.slow,
        tone: 'warning',
        to: drill('91_180'),
      },
      {
        key: 'obsolete',
        label: `Obsolete · ${AGE_BUCKET_LABELS['180_plus']}`,
        value: `${formatInt(obsolete?.items ?? 0)} ${(obsolete?.items ?? 0) === 1 ? 'item' : 'items'}`,
        hint: `${formatMoney(obsolete?.value)} · ${formatShare(risk.obsoleteShare)} of stock value`,
        icon: AGEING_KPI_ICONS.obsolete,
        tone: 'danger',
        to: drill('180_plus'),
      },
    ]
  },
  // Deterministic observations over the summary the register already holds — never a
  // second request, and never a sentence the data does not carry.
  insights: (s) => ({ items: ageingInsights(s), note: ageingNote(s) }),
  analytics: ({ summary, loading }) => (
    <StockAgeingAnalytics summary={summary} loading={loading} />
  ),
  summary: (s) => [
    { label: 'Items', value: formatInt(s.items) },
    { label: 'Total qty', value: formatQty(s.total_qty) },
    { label: 'Total value', value: formatMoney(s.total_value), tone: 'good' },
    ...AGE_BUCKET_ORDER.map((key) => ({
      label: s.bucket_labels?.[key] ?? AGE_BUCKET_LABELS[key],
      value: formatMoney(s.buckets?.[key]?.value),
      hint: `${formatQty(s.buckets?.[key]?.qty)} qty · ${formatInt(s.buckets?.[key]?.items)} items`,
      tone: (key === '180_plus' ? 'critical' : key === '91_180' ? 'warning' : 'neutral') as
        | 'critical'
        | 'warning'
        | 'neutral',
    })),
  ],
  emptyMessage:
    'Try widening the ageing band, changing the warehouse, or clearing one or more filters.',
  emptyUnfiltered: (
    <EmptyState
      icon={Hourglass}
      title="No stock on hand at this date"
      description="Nothing has been received, or everything received has been issued. Post a receipt, or move the as-at date forward, and the ageing bands will fill."
    />
  ),
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
