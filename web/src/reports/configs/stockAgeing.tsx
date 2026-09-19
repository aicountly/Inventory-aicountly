import type { ReactNode } from 'react'
import {
  AlertTriangle,
  Boxes,
  Coins,
  Hourglass,
  Layers,
  PackageCheck,
  TrendingDown,
  Warehouse,
} from 'lucide-react'
import type {
  AgeBucketKey,
  StockAgeingRow,
  StockAgeingSummary,
  StockHealthStatus,
} from '../../services/reportsApi'
import { buildTotalsRow, totalsLabel } from '../../registers/registerTotals'
import { defineRegister } from '../../registers/RegisterConfig'
import type { RegisterConfig, StatCardSpec } from '../../registers/RegisterConfig'
import type { RegisterInsight } from '../../registers/RegisterInsightStrip'
import { StockAgeingAnalytics } from '../../registers/ageing/StockAgeingAnalytics'
import { StockAgeingRowActions } from '../../registers/ageing/StockAgeingRowActions'
import {
  AGE_BUCKET_META,
  AGE_BUCKET_ORDER,
  HEALTH_STATUS_META,
  HEALTH_STATUS_ORDER,
  itemGroupName,
  share,
  stockHealth,
  warehouseName,
  worstForAgeing,
} from '../../registers/ageing/stockAgeingModel'
import { EmptyState } from '../../ui/EmptyState'
import { cx } from '../../ui/cx'
import { formatInt, formatMoney, formatQty } from '../../utils/format'
import type { ReportColumn } from '../types'
import {
  DASH,
  byWarehouseFilter,
  itemColumn,
  itemFilter,
  itemGroupFilter,
  moneyColumn,
  qtyColumn,
  stockCategoryFilter,
  textColumn,
  warehouseFilter,
} from './common'

/**
 * Stock ageing — how long the stock on hand has been sitting, and what it is costing.
 *
 * The ageing itself is NOT decided here. `InventoryReportService::stockAgeing` ages each
 * open cost layer from its own receipt under FIFO / LIFO, and the whole on-hand from the
 * last receipt under weighted average; that is the company's costing methodology and this
 * screen is a reading of it, never a second opinion about it. Everything this file adds —
 * the bands' colours, the health score, the KPI cards, the charts — is derived from the
 * summary that endpoint returns.
 *
 * Laid out as a panel rather than the one-row toolbar because the filters here ARE the
 * question: a date and a warehouse decide every figure on the screen, and a controller
 * works in them all afternoon.
 */

/* ------------------------------------------------------------------ columns */

function bucketValue(row: StockAgeingRow, key: AgeBucketKey): number {
  return row.buckets?.[key]?.value ?? 0
}

function bucketQty(row: StockAgeingRow, key: AgeBucketKey): number {
  return row.buckets?.[key]?.qty ?? 0
}

/**
 * One band, as one cell: the quantity over the value it represents.
 *
 * Paired rather than split across two columns because five bands in two columns each is
 * fifteen columns of numbers before the totals even start, and the reader's question —
 * "how much of this item is old" — is answered by the two figures side by side. The
 * separate quantity and value columns still exist (below, shipped hidden) for anyone
 * who wants them apart in a spreadsheet.
 */
function bucketColumn(key: AgeBucketKey): ReportColumn<StockAgeingRow> {
  const meta = AGE_BUCKET_META[key]
  return {
    key: `bucket_${key}`,
    header: (
      <span className="block leading-tight">
        {meta.srLabel}
        <small className="mt-0.5 block text-[9px] font-medium normal-case text-gray-400">
          Qty · Value
        </small>
      </span>
    ),
    align: 'right',
    minWidth: 104,
    configureLabel: `${meta.srLabel} — quantity and value`,
    configureHint: 'One cell carrying both figures',
    csvHeader: `${meta.srLabel} value`,
    // The money is what a CSV of this column is for; the quantity has its own column.
    csv: (r) => bucketValue(r, key),
    amount: true,
    format: 'amount',
    render: (r) => {
      const qty = bucketQty(r, key)
      if (qty === 0 && bucketValue(r, key) === 0) return DASH
      return (
        <span className="block leading-tight">
          <strong className="block text-xs font-semibold tabular-nums text-gray-900">
            {formatQty(qty, '0')}
          </strong>
          <small className={cx('mt-0.5 block text-[10px] tabular-nums', meta.textClass)}>
            {formatMoney(bucketValue(r, key))}
          </small>
        </span>
      )
    },
  }
}

/**
 * The same bands split apart, shipped hidden.
 *
 * A register's CSV follows the columns on screen, so a reader who wants quantity and
 * value in separate spreadsheet columns turns these on and the export follows. Keys are
 * unchanged from the previous layout, so anything that already named one still resolves.
 */
function bucketSplitColumns(key: AgeBucketKey): ReportColumn<StockAgeingRow>[] {
  const meta = AGE_BUCKET_META[key]
  return [
    {
      key: `bucket_${key}_qty`,
      header: `${meta.srLabel} qty`,
      align: 'right',
      format: 'qty',
      defaultVisible: false,
      configureLabel: `${meta.srLabel} — quantity only`,
      render: (r) => formatQty(bucketQty(r, key)),
      csv: (r) => bucketQty(r, key),
    },
    {
      key: `bucket_${key}_value`,
      header: `${meta.srLabel} value`,
      align: 'right',
      format: 'amount',
      amount: true,
      defaultVisible: false,
      configureLabel: `${meta.srLabel} — value only`,
      render: (r) => formatMoney(bucketValue(r, key)),
      csv: (r) => bucketValue(r, key),
    },
  ]
}

/** The health word, with the dot that makes the column scannable down the page. */
function HealthBadge({ status }: { status: StockHealthStatus }) {
  const meta = HEALTH_STATUS_META[status] ?? HEALTH_STATUS_META.healthy
  return (
    <span
      title={meta.hint}
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold',
        meta.badgeClass,
      )}
    >
      {/* Decoration: the word beside it is the status, so colour is never alone. */}
      <span aria-hidden className={cx('h-1.5 w-1.5 rounded-full', meta.dotClass)} />
      {meta.label}
    </span>
  )
}

const COLUMNS: ReportColumn<StockAgeingRow>[] = [
  itemColumn<StockAgeingRow>(),
  { ...textColumn<StockAgeingRow>('hsn_sac', 'HSN', false), cellClassName: 'whitespace-nowrap tabular-nums' },
  textColumn<StockAgeingRow>('warehouse_name', 'Warehouse', false),
  { ...textColumn<StockAgeingRow>('unit_symbol', 'UOM', false), configureLabel: 'UOM' },
  ...AGE_BUCKET_ORDER.map(bucketColumn),
  qtyColumn<StockAgeingRow>('total_qty', 'Total qty', { strong: true }),
  moneyColumn<StockAgeingRow>('total_value', 'Total value', { strong: true }),
  {
    key: 'weighted_age_days',
    header: 'Avg age',
    align: 'right',
    sortKey: 'weighted_age_days',
    configureHint: 'Quantity-weighted mean age of this line',
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
    configureHint: 'Age of the oldest open layer on this line',
    render: (r) => (r.oldest_days === null ? DASH : <span className="tabular-nums">{formatInt(r.oldest_days)} d</span>),
    csv: (r) => r.oldest_days,
  },
  {
    key: 'health_status',
    header: 'Health',
    sortKey: 'health_status',
    configureLabel: 'Health',
    configureHint: 'Decided by the server from this line’s own value split',
    cellClassName: 'whitespace-nowrap',
    render: (r) => <HealthBadge status={r.health_status} />,
    csv: (r) => HEALTH_STATUS_META[r.health_status]?.label ?? r.health_status,
  },
  // Context a reader asks for once they have found the line, not while scanning.
  {
    ...textColumn<StockAgeingRow>('valuation_method', 'Method', false),
    defaultVisible: false,
    configureHint: 'The costing method this line was aged under',
  },
  {
    key: 'layers',
    header: 'Layers',
    align: 'right',
    format: 'int',
    defaultVisible: false,
    configureHint: 'Open cost layers behind this line',
    render: (r) => <span className="tabular-nums">{formatInt(r.layers)}</span>,
  },
  {
    ...textColumn<StockAgeingRow>('aged_from', 'Aged from', false),
    defaultVisible: false,
    configureHint: 'Weighted-average lines only: the receipt their age is taken from',
  },
  ...AGE_BUCKET_ORDER.flatMap(bucketSplitColumns),
]

/* ------------------------------------------------------------------- cards */

/** The five cards over the table: what is held, and what is at risk. */
function kpiCards(s: StockAgeingSummary): StatCardSpec[] {
  const health = stockHealth(s)
  const slowValue = s.buckets?.['91_180']?.value ?? 0
  const slowItems = s.by_health?.slow?.items ?? 0
  const obsoleteItems = s.by_health?.obsolete?.items ?? 0

  return [
    {
      key: 'items',
      label: 'Total items',
      value: formatInt(s.items),
      hint: s.items === 1 ? 'Line in stock' : 'Lines in stock at this date',
      icon: Boxes,
      tone: 'info',
    },
    {
      key: 'qty',
      label: 'Total quantity',
      value: formatQty(s.total_qty, '0'),
      hint: 'Units across every warehouse in scope',
      icon: PackageCheck,
      tone: 'success',
    },
    {
      key: 'value',
      label: 'Total stock value',
      value: formatMoney(s.total_value),
      hint: 'At cost, on the method each item is valued under',
      icon: Coins,
      tone: 'violet',
    },
    {
      key: 'slow',
      label: 'Slow moving · 91–180 days',
      value: `${formatInt(slowItems)} ${slowItems === 1 ? 'item' : 'items'}`,
      hint: `${formatMoney(slowValue)} · ${share(slowValue, s.total_value).toFixed(1)}% of stock value`,
      icon: TrendingDown,
      tone: 'warning',
      to: '/registers/stock-ageing?health=slow',
    },
    {
      key: 'obsolete',
      label: 'Obsolete · 180+ days',
      value: `${formatInt(obsoleteItems)} ${obsoleteItems === 1 ? 'item' : 'items'}`,
      hint: `${formatMoney(health.valueOver180)} · ${health.percentOver180.toFixed(1)}% of stock value`,
      icon: AlertTriangle,
      tone: 'rose',
      to: '/registers/stock-ageing?health=obsolete',
    },
  ]
}

/**
 * The at-a-glance strip: facts about the set, in words, from the same summary.
 *
 * An entry that would not be true is left out rather than printed hedged — a register
 * with nothing older than 90 days names no worst warehouse, because there is no ageing
 * problem for one to be worst at.
 */
function insights(s: StockAgeingSummary): { items: RegisterInsight[]; note?: string } {
  const health = stockHealth(s)
  const items: RegisterInsight[] = []

  if (s.total_value > 0) {
    items.push({
      key: 'at-risk',
      label: `${formatMoney(health.valueOver90)} older than 90 days`,
      hint: `${health.percentOver90.toFixed(1)}% of the stock value in scope`,
      icon: AlertTriangle,
      tone: health.percentOver90 >= 25 ? 'danger' : 'warning',
    })
  }

  if (s.weighted_age_days !== null) {
    items.push({
      key: 'age',
      label: `${formatInt(s.weighted_age_days)} days average age`,
      hint:
        s.oldest_days === null
          ? 'Weighted by quantity'
          : `Weighted by quantity · oldest layer ${formatInt(s.oldest_days)} days`,
      icon: Hourglass,
      tone: 'primary',
    })
  }

  // Shares are taken against the summary's own totals, because the server bounds these
  // lists and a sum of the rows would divide by a truncated whole.
  const worstWarehouse = worstForAgeing(s.by_warehouse, warehouseName, 'value_over_90', health.valueOver90)
  if (worstWarehouse) {
    items.push({
      key: 'warehouse',
      label: `${worstWarehouse.label} holds the oldest stock`,
      hint: `${worstWarehouse.percentOfAtRisk.toFixed(0)}% of the value older than 90 days`,
      icon: Warehouse,
      tone: 'info',
    })
  }

  const worstGroup = worstForAgeing(s.by_item_group, itemGroupName, 'value_over_180', health.valueOver180)
  if (worstGroup) {
    items.push({
      key: 'group',
      label: `${worstGroup.label} carries the most 180+ stock`,
      hint: `${formatMoney(worstGroup.value_over_180)} · ${worstGroup.percentOfAtRisk.toFixed(0)}% of the 180+ value`,
      icon: Layers,
      tone: 'rose',
    })
  }

  return {
    items,
    note: s.total_value > 0 ? `Health ${health.score ?? '—'}/100 · ${health.band.label}` : undefined,
  }
}

/* ----------------------------------------------------------------- register */

export const stockAgeingConfig: RegisterConfig<StockAgeingRow, StockAgeingSummary> = defineRegister<
  StockAgeingRow,
  StockAgeingSummary
>({
  slug: 'stock_ageing',
  path: 'stock-ageing',
  title: 'Stock ageing',
  description:
    'Open cost layers bucketed by age as at a date — how long the stock on hand has been sitting, and how much capital is locked in the oldest of it',
  shortDescription:
    'Analyse how long your inventory has been in stock and identify capital at risk',
  group: 'analysis',
  icon: Hourglass,
  defaultSort: 'total_value',
  defaultOrder: 'desc',
  defaultLimit: 50,
  minWidth: 1420,
  printOrientation: 'landscape',
  rowNoun: 'item',
  filenameBase: 'stock-ageing',

  // The panel layout: page header, carded filter grid, wide metric cards. Same treatment
  // as the valuation and stock balance registers, for the same reason — the filters are
  // the question, not a way of trimming an answer.
  layout: 'panel',
  filterPanel: {
    title: 'Ageing filters',
    description: 'Age the stock on hand at a date, for a warehouse, a group or one item',
    // The five the mock puts on the front row. Everything else sits behind "More
    // filters", which carries the count of those that are set.
    primaryKeys: ['as_of', 'item_id', 'warehouse_id', 'item_grp_id', 'stock_cat_id'],
  },

  // A deliberate one-time reset: the bucket columns were ten and are now five paired
  // cells plus ten hidden ones, so a saved layout from the old grid would restore a table
  // nobody chose. Everyone starts at the new shipped default and re-picks from there.
  columnPrefsKey: 'stock_ageing.v2',

  filters: [
    { key: 'as_of', kind: 'date', label: 'As at', defaultValue: (c) => c.today },
    { ...itemFilter, placeholder: 'Search item, SKU or HSN…' },
    { ...warehouseFilter, placeholder: 'All warehouses' },
    itemGroupFilter,
    stockCategoryFilter,
    {
      key: 'age_bucket',
      kind: 'select',
      label: 'Ageing band',
      placeholder: 'All bands',
      // Exactly the server's own five keys. A sixth option here would be a 422 from the
      // API dressed up as a feature.
      options: AGE_BUCKET_ORDER.map((key) => ({
        value: key,
        label: AGE_BUCKET_META[key].srLabel,
      })),
    },
    {
      key: 'health',
      kind: 'select',
      label: 'Stock health',
      placeholder: 'Any health',
      options: HEALTH_STATUS_ORDER.map((status) => ({
        value: status,
        label: HEALTH_STATUS_META[status].label,
      })),
    },
    byWarehouseFilter,
  ],

  columns: COLUMNS,
  rowKey: (r) => `${r.item_id}:${r.warehouse_id ?? 0}`,
  drillTo: (r) =>
    `/registers/stock-ledger?item_id=${r.item_id}${r.warehouse_id ? `&warehouse_id=${r.warehouse_id}` : ''}`,
  rowActions: (r) => <StockAgeingRowActions row={r} />,

  groupBy: [
    {
      key: 'warehouse',
      label: 'Warehouse',
      of: (r) => ({
        key: String(r.warehouse_id ?? 0),
        label: r.warehouse_name ?? 'All warehouses',
      }),
      subtotal: (rows, group) => subtotalFor(rows, `${group.label} — on this page`),
    },
    {
      key: 'item_group',
      label: 'Item group',
      of: (r) => ({ key: String(r.item_grp_id ?? 0), label: r.grp_name ?? 'Ungrouped items' }),
      subtotal: (rows, group) => subtotalFor(rows, `${group.label} — on this page`),
    },
    {
      key: 'health',
      label: 'Health',
      of: (r) => ({
        key: r.health_status,
        label: HEALTH_STATUS_META[r.health_status]?.label ?? r.health_status,
      }),
      subtotal: (rows, group) => subtotalFor(rows, `${group.label} — on this page`),
    },
  ],

  tableTitle: 'Stock ageing details',
  tableHint:
    'One line per item — per item and warehouse when "Split by warehouse" is on. Select a row to open its ledger.',

  // Every band has a server-side total, so the footer lines up column for column with the
  // header — including the bands a reader has hidden.
  totals: (s) => {
    const values: Record<string, string> = {
      total_qty: formatQty(s.total_qty, '0'),
      total_value: formatMoney(s.total_value),
      weighted_age_days: s.weighted_age_days == null ? '' : `${formatInt(s.weighted_age_days)} d`,
      oldest_days: s.oldest_days == null ? '' : `${formatInt(s.oldest_days)} d`,
    }
    for (const key of AGE_BUCKET_ORDER) {
      values[`bucket_${key}`] = formatMoney(s.buckets?.[key]?.value)
      values[`bucket_${key}_qty`] = formatQty(s.buckets?.[key]?.qty, '0')
      values[`bucket_${key}_value`] = formatMoney(s.buckets?.[key]?.value)
    }
    return buildTotalsRow(
      [
        { key: 'item_name' },
        { key: 'hsn_sac' },
        { key: 'warehouse_name' },
        { key: 'unit_symbol' },
        ...AGE_BUCKET_ORDER.map((key) => ({ key: `bucket_${key}`, align: 'right' as const })),
        { key: 'total_qty', align: 'right' as const },
        { key: 'total_value', align: 'right' as const },
        { key: 'weighted_age_days', align: 'right' as const },
        { key: 'oldest_days', align: 'right' as const },
        { key: 'health_status' },
        { key: 'valuation_method' },
        { key: 'layers', align: 'right' as const },
        { key: 'aged_from' },
        ...AGE_BUCKET_ORDER.flatMap((key) => [
          { key: `bucket_${key}_qty`, align: 'right' as const },
          { key: `bucket_${key}_value`, align: 'right' as const },
        ]),
      ],
      values,
      { label: totalsLabel(s.items, 'item'), labelKey: 'item_name' },
    )
  },

  kpis: (s) => kpiCards(s),
  insights: (s) => insights(s),
  analytics: ({ summary, loading }) => (
    <StockAgeingAnalytics summary={summary} loading={loading} />
  ),

  // The engine falls back to this only where `kpis` is not declared; it is what the
  // export sheet's summary strip is built from on registers that have no cards.
  summary: (s) => [
    { label: 'Items', value: formatInt(s.items) },
    { label: 'Total qty', value: formatQty(s.total_qty, '0') },
    { label: 'Total value', value: formatMoney(s.total_value), tone: 'good' },
    ...AGE_BUCKET_ORDER.map((key) => ({
      label: s.bucket_labels?.[key] ?? AGE_BUCKET_META[key].srLabel,
      value: formatMoney(s.buckets?.[key]?.value),
      hint: `${formatQty(s.buckets?.[key]?.qty, '0')} qty`,
      tone: (key === '180_plus' ? 'critical' : key === '91_180' ? 'warning' : 'neutral') as
        | 'critical'
        | 'warning'
        | 'neutral',
    })),
  ],

  emptyMessage:
    'Try widening the ageing band, changing the warehouse, moving the as-at date, or clearing one or more filters.',

  // A company that holds no stock at this date is not over-filtered, and telling it to
  // "clear a filter" sends the reader hunting for one that is not set.
  emptyUnfiltered: (
    <EmptyState
      icon={PackageCheck}
      title="No stock on hand at this date"
      description="Nothing has an open cost layer as at the selected date, so there is no ageing to report. Move the as-at date to a day after your first receipt, or post an opening stock entry."
    />
  ),
})

/** Subtotals for one group of rows on screen. Page figures, and they say so. */
function subtotalFor(
  rows: readonly StockAgeingRow[],
  label: string,
): Record<string, ReactNode> {
  const sum = (pick: (r: StockAgeingRow) => number): number =>
    rows.reduce((total, r) => total + (Number(pick(r)) || 0), 0)
  const totalQty = sum((r) => r.total_qty)
  const values: Record<string, string> = {
    item_name: label,
    total_qty: formatQty(totalQty, '0'),
    total_value: formatMoney(sum((r) => r.total_value)),
    weighted_age_days:
      totalQty > 0
        ? `${formatInt(Math.round(sum((r) => (r.weighted_age_days ?? 0) * r.total_qty) / totalQty))} d`
        : '',
  }
  for (const key of AGE_BUCKET_ORDER) {
    values[`bucket_${key}`] = formatMoney(sum((r) => bucketValue(r, key)))
    values[`bucket_${key}_qty`] = formatQty(sum((r) => bucketQty(r, key)), '0')
    values[`bucket_${key}_value`] = formatMoney(sum((r) => bucketValue(r, key)))
  }
  return values
}

export default stockAgeingConfig
