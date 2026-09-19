import {
  AlertTriangle,
  Boxes,
  Coins,
  Layers,
  Warehouse as WarehouseIcon,
} from 'lucide-react'
import { METHOD_LABELS, REPORT_METHODS } from '../../services/valuationApi'
import type { ReportMethod } from '../../services/valuationApi'
import type { WarehouseStockRow, WarehouseStockSummary } from '../../services/reportsApi'
import { Tooltip } from '../../ui/Tooltip'
import { currencySymbol, formatInt, formatMoney, formatQty } from '../../utils/format'
import {
  itemFilter,
  itemGroupFilter,
  moneyColumn,
  nonzeroFilter,
  qtyColumn,
  stockCategoryFilter,
  textColumn,
  warehouseFilter,
} from '../../reports/configs/common'
import type { ReportColumn, ReportFilter } from '../../reports/types'
import { defineRegister } from '../RegisterConfig'
import { buildTotalsRow, totalsLabel } from '../registerTotals'
import { ItemCell, LiveQtyCell, SignedCell, WarehouseCell, ledgerLink } from './cells'
import { StockHealthCell, STOCK_HEALTH_OPTIONS, attentionCount } from './stockHealth'
import { WarehouseStockRowActions } from './WarehouseStockRowActions'
import { WarehouseStockEmptyState } from './WarehouseStockEmptyState'
import { WarehouseStockInsightCard } from './WarehouseStockInsightCard'
import { WarehouseStockSidebar } from './WarehouseStockSidebar'
import { warehouseStockInsight } from './warehouseStockInsights'

/* ------------------------------------------------------------------ filters */

const methodFilter: ReportFilter = {
  key: 'method',
  kind: 'select',
  label: 'Valuation',
  options: REPORT_METHODS.map((m: ReportMethod) => ({ value: m, label: METHOD_LABELS[m] })),
  defaultValue: () => 'AS_PER_MASTER',
}

const healthFilter: ReportFilter = {
  key: 'health',
  kind: 'select',
  label: 'Stock health',
  placeholder: 'All items',
  options: STOCK_HEALTH_OPTIONS,
}

/* ------------------------------------------------------------------ columns */

/**
 * A quantity column with a note on what the figure actually is.
 *
 * Five of this register's columns look like plain numbers and are not: closing is dated,
 * reserved and available are live, unit cost depends on the valuation method chosen at
 * the top of the screen. The tooltip is where that gets said once, rather than in a
 * footnote nobody reads or not at all.
 */
function headerWithHelp(label: string, help: string) {
  return (
    <Tooltip label={help}>
      <span className="cursor-help border-b border-dotted border-gray-400">{label}</span>
    </Tooltip>
  )
}

const columns: ReportColumn<WarehouseStockRow>[] = [
  {
    key: 'item_name',
    header: 'Item',
    sortKey: 'item_name',
    // Identifies the row: a grid of numbers with no name against them is not a register.
    alwaysVisible: true,
    minWidth: 230,
    render: (r) => <ItemCell row={r} />,
    csv: (r) => r.item_name ?? `Item #${r.item_id}`,
  },
  {
    key: 'item_sku',
    header: 'SKU',
    sortKey: 'item_sku',
    cellClassName: 'whitespace-nowrap text-gray-600',
    render: (r) => r.item_sku ?? <span className="text-gray-300">—</span>,
    csv: (r) => r.item_sku ?? '',
  },
  {
    key: 'warehouse_name',
    header: 'Warehouse',
    sortKey: 'warehouse_name',
    minWidth: 130,
    render: (r) => <WarehouseCell row={r} />,
    csv: (r) => r.warehouse_name ?? '',
  },
  { ...textColumn<WarehouseStockRow>('warehouse_code', 'Code', false), defaultVisible: false },
  textColumn<WarehouseStockRow>('unit_symbol', 'Unit', false),
  // Unsortable on purpose: the endpoint orders by item, warehouse, the closing figures,
  // cost, value and health, and a sort header it cannot honour would move the arrow and
  // return the same rows — which reads as "sorted", wrongly.
  { ...qtyColumn<WarehouseStockRow>('opening_qty', 'Opening', { sortable: false }), defaultVisible: false,
    configureHint: 'Financial-year opening, before any movement in the year.' },
  { ...qtyColumn<WarehouseStockRow>('in_qty', 'In', { sortable: false }), defaultVisible: false,
    configureHint: 'Received in this financial year up to the As-at date.' },
  { ...qtyColumn<WarehouseStockRow>('out_qty', 'Out', { sortable: false }), defaultVisible: false,
    configureHint: 'Issued in this financial year up to the As-at date.' },
  {
    ...qtyColumn<WarehouseStockRow>('closing_qty', 'Closing qty', { strong: true }),
    alwaysVisible: true,
    header: headerWithHelp(
      'Closing qty',
      'Opening plus every movement up to the As-at date, in base units. Below zero means the postings need correcting.',
    ),
    configureLabel: 'Closing qty',
    csvHeader: 'Closing qty',
    render: (r) => <SignedCell value={r.closing_qty} format={formatQty} strong />,
  },
  {
    key: 'reserved_qty',
    header: headerWithHelp(
      'Reserved',
      'Committed to open documents and not free to promise. This is the live position, so it is blank on a back-dated read.',
    ),
    configureLabel: 'Reserved',
    csvHeader: 'Reserved',
    configureHint: 'Live figure from stock balances; blank when the register is back-dated.',
    align: 'right',
    sortKey: 'reserved_qty',
    format: 'qty',
    render: (r) => <LiveQtyCell value={r.reserved_qty} />,
    csv: (r) => r.reserved_qty,
  },
  {
    key: 'available_qty',
    header: headerWithHelp(
      'Available',
      'Free to promise: on hand less reserved, packed, on hold, damaged and blocked. Live, so it is blank on a back-dated read — it is never closing minus reserved.',
    ),
    configureLabel: 'Available',
    csvHeader: 'Available',
    configureHint: 'Live free-to-promise figure; blank when the register is back-dated.',
    align: 'right',
    sortKey: 'available_qty',
    format: 'qty',
    render: (r) => <LiveQtyCell value={r.available_qty} strong emphasiseNegative />,
    csv: (r) => r.available_qty,
  },
  {
    ...moneyColumn<WarehouseStockRow>('unit_cost', 'Unit cost'),
    header: headerWithHelp(
      'Unit cost',
      'Cost per base unit at the As-at date, under the valuation method selected above.',
    ),
    configureLabel: 'Unit cost',
    csvHeader: 'Unit cost',
  },
  {
    ...moneyColumn<WarehouseStockRow>('closing_value', 'Value', { strong: true }),
    header: headerWithHelp('Value', 'Closing quantity valued at the unit cost beside it.'),
    configureLabel: 'Value',
    csvHeader: 'Value',
    render: (r) => <SignedCell value={r.closing_value} format={formatMoney} strong />,
  },
  {
    key: 'stock_health',
    header: 'Status',
    sortKey: 'stock_health',
    align: 'center',
    minWidth: 104,
    configureLabel: 'Status',
    configureHint: 'Against the reorder point, safety stock, minimum and maximum on the item.',
    render: (r) => <StockHealthCell row={r} />,
    csv: (r) => r.stock_health,
  },
  {
    ...qtyColumn<WarehouseStockRow>('reorder_point_qty', 'Reorder point', { sortable: false }),
    defaultVisible: false,
    configureHint: 'From the item master. Blank when none is set.',
  },
  {
    ...qtyColumn<WarehouseStockRow>('min_stock_qty', 'Minimum', { sortable: false }),
    defaultVisible: false,
    configureHint: 'From the item master. Blank when none is set.',
  },
  {
    ...textColumn<WarehouseStockRow>('valuation_method_applied', 'Method applied', false),
    defaultVisible: false,
    configureHint: 'The method each item was actually valued at — relevant on "As per item master".',
  },
]

/* --------------------------------------------------------------- the config */

/**
 * A link back into this register with one filter changed and every other kept.
 *
 * Every drill-down on the screen goes through here — the KPI card, the alerts, the
 * distribution rows — because a link that quietly dropped the warehouse or the date
 * would answer a wider question than the one the reader was looking at when they
 * clicked it.
 */
function registerLink(values: Record<string, string>, patch: Record<string, string>): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...values, ...patch })) {
    if (value !== '' && value !== undefined) qs.set(key, value)
  }
  return `/registers/warehouse-stock?${qs.toString()}`
}

/**
 * Warehouse stock — what is on each shelf, what it is worth, and what needs doing.
 *
 * The register is the company's physical stock position: quantity, cost and value per
 * item per warehouse as at a date, plus the live reserved / available buckets and the
 * health verdict each row earns from the item's own levels. Every figure above the table
 * and in the rail beside it comes from the SAME response the rows came from, over the
 * whole filtered set — nothing here is summed from the page on screen, and nothing is
 * fetched twice under different filters.
 *
 * What it deliberately does not carry: anything commercial. Margin, receivables and
 * invoice profitability are Books' and stay there (docs/DOMAIN_OWNERSHIP.md).
 */
export const warehouseStockConfig = defineRegister<WarehouseStockRow, WarehouseStockSummary>({
  slug: 'warehouse_stock',
  path: 'warehouse-stock',
  title: 'Warehouse stock',
  description:
    'Closing stock per item and warehouse as at a date, with reserved and available quantity, valuation and stock health',
  shortDescription: 'Real-time stock visibility across warehouses',
  group: 'stock',
  icon: WarehouseIcon,
  layout: 'panel',
  defaultSort: 'item_name',
  minWidth: 1180,
  rowNoun: 'row',
  filenameBase: 'warehouse-stock',

  filters: [
    {
      key: 'to',
      kind: 'date',
      label: 'As at date',
      defaultValue: (c) => c.today,
    },
    itemFilter,
    warehouseFilter,
    methodFilter,
    healthFilter,
    nonzeroFilter,
    itemGroupFilter,
    stockCategoryFilter,
  ],
  filterPanel: {
    description: 'Every figure below answers exactly these filters',
    primaryKeys: ['to', 'item_id', 'warehouse_id', 'method', 'health', 'nonzero'],
    // Seven controls plus the actions: four columns strands one of them on a row of its
    // own, so the widest screens get a track per control instead.
    gridClassName:
      'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-8',
  },

  columns,
  rowKey: (r) => `${r.item_id}:${r.warehouse_id ?? 0}`,
  drillTo: (r) => ledgerLink(r.item_id, r.warehouse_id),
  rowActions: (r) => <WarehouseStockRowActions row={r} />,

  viewPresets: [
    // No column list: "Default" IS the register's shipped set, and repeating it here
    // would be a second copy to keep in step every time a column is added.
    { id: 'default', label: 'Default', description: 'Quantity, availability and value' },
    {
      id: 'health',
      label: 'Stock health',
      description: 'What is short, and what it was measured against',
      columns: [
        'item_name',
        'item_sku',
        'warehouse_name',
        'closing_qty',
        'available_qty',
        'reorder_point_qty',
        'min_stock_qty',
        'stock_health',
      ],
    },
    {
      id: 'warehouse',
      label: 'Warehouse analysis',
      description: 'How the year moved this stock, warehouse by warehouse',
      columns: [
        'item_name',
        'warehouse_name',
        'warehouse_code',
        'unit_symbol',
        'opening_qty',
        'in_qty',
        'out_qty',
        'closing_qty',
        'closing_value',
      ],
    },
    {
      id: 'valuation',
      label: 'Valuation',
      description: 'Cost, value and the method each item was valued at',
      columns: [
        'item_name',
        'item_sku',
        'warehouse_name',
        'unit_symbol',
        'closing_qty',
        'unit_cost',
        'closing_value',
        'valuation_method_applied',
      ],
    },
    {
      id: 'availability',
      label: 'Availability',
      description: 'On hand, committed and free to promise',
      columns: [
        'item_name',
        'item_sku',
        'warehouse_name',
        'unit_symbol',
        'closing_qty',
        'reserved_qty',
        'available_qty',
        'stock_health',
      ],
    },
  ],

  groupBy: [
    {
      key: 'warehouse',
      label: 'Warehouse',
      of: (r) => ({ key: String(r.warehouse_id ?? 0), label: r.warehouse_name ?? 'No warehouse' }),
      subtotal: (rows, group) =>
        buildTotalsRow(
          [
            { key: 'item_name' },
            { key: 'closing_qty', align: 'right' },
            { key: 'closing_value', align: 'right' },
          ],
          {
            closing_qty: formatQty(rows.reduce((a, r) => a + Number(r.closing_qty ?? 0), 0)),
            closing_value: formatMoney(rows.reduce((a, r) => a + Number(r.closing_value ?? 0), 0)),
          },
          {
            label: `${group.label} · ${totalsLabel(rows.length, 'row')} on this page`,
            labelKey: 'item_name',
          },
        ),
    },
  ],

  // Server aggregates over the whole filtered set — never the page on screen.
  totals: (s) =>
    buildTotalsRow(
      [
        { key: 'item_name' },
        { key: 'item_sku' },
        { key: 'warehouse_name' },
        { key: 'unit_symbol' },
        { key: 'closing_qty', align: 'right' },
        { key: 'reserved_qty', align: 'right' },
        { key: 'available_qty', align: 'right' },
        { key: 'unit_cost', align: 'right' },
        { key: 'closing_value', align: 'right' },
        { key: 'stock_health' },
      ],
      {
        closing_qty: formatQty(s.closing_qty),
        // A dash, not a zero: on a back-dated read these are not zero, they are not
        // figures about that date at all.
        reserved_qty: s.reserved_qty === null ? '—' : formatQty(s.reserved_qty),
        available_qty: s.available_qty === null ? '—' : formatQty(s.available_qty),
        closing_value: formatMoney(s.closing_value),
      },
      { label: totalsLabel(s.rows, 'row'), labelKey: 'item_name' },
    ),

  kpis: (s, _res, values) => {
    const attention = attentionCount(s.health)
    const symbol = currencySymbol(s.currency)
    const insight = warehouseStockInsight(s)
    // Keeps every other filter: a drill-down that quietly dropped the warehouse would
    // answer a wider question than the one the reader was looking at.
    const withHealth = (health: string) => registerLink(values ?? { to: s.to }, { health })
    return [
      {
        key: 'skus',
        label: 'Total SKUs',
        value: formatInt(s.items),
        hint: `${formatInt(s.rows)} item · warehouse lines`,
        icon: Boxes,
        tone: 'primary',
      },
      {
        key: 'warehouses',
        label: 'Active warehouses',
        value: formatInt(s.active_warehouses),
        hint:
          s.warehouses === s.active_warehouses
            ? 'All holding stock'
            : `${formatInt(s.warehouses)} holding stock on this date`,
        icon: WarehouseIcon,
        tone: 'info',
      },
      {
        key: 'closing_qty',
        label: 'Closing qty',
        value: formatQty(s.closing_qty),
        hint: s.live_buckets
          ? `${s.available_qty === null ? '—' : formatQty(s.available_qty)} free to promise`
          : `Units in stock as at ${s.to}`,
        icon: Layers,
        tone: 'teal',
        current: s.closing_qty,
        emphasizeNegative: true,
      },
      {
        key: 'closing_value',
        label: 'Closing value',
        value: `${symbol} ${formatMoney(s.closing_value)}`,
        hint: `Valued at ${METHOD_LABELS[s.method as ReportMethod] ?? s.method}`,
        icon: Coins,
        tone: 'violet',
        current: s.closing_value,
        emphasizeNegative: true,
      },
      {
        key: 'attention',
        label: 'Needs attention',
        value: formatInt(attention),
        hint:
          attention === 0
            ? 'Nothing short or below zero'
            : [
                s.health.negative ? `${s.health.negative} negative` : '',
                s.health.reorder ? `${s.health.reorder} to reorder` : '',
                s.health.low ? `${s.health.low} low` : '',
                s.health.out ? `${s.health.out} out` : '',
              ]
                .filter(Boolean)
                .join(' · '),
        icon: AlertTriangle,
        tone: attention > 0 ? 'danger' : 'success',
        // One click to everything worth acting on, rather than four visits to a
        // dropdown and four chances to conclude the register is clean.
        to: attention > 0 ? withHealth('attention') : undefined,
      },
      {
        key: 'insight',
        label: 'Insight',
        value: '',
        node: (
          <WarehouseStockInsightCard
            insight={insight}
            to={insight?.health ? withHealth(insight.health) : undefined}
          />
        ),
      },
    ]
  },

  aside: ({ summary, values }) => (
    <WarehouseStockSidebar
      summary={summary}
      values={values}
      healthLink={(health) => registerLink(values, { health })}
      warehouseLink={(warehouseId) =>
        warehouseId ? registerLink(values, { warehouse_id: String(warehouseId) }) : null
      }
    />
  ),

  /**
   * The flat summary strip, for anything that reads a register's figures without
   * rendering its cards — the print sheet's fallback, and the registers hub.
   *
   * Same figures as `kpis`, same source: the server's aggregate over the whole set.
   */
  summary: (s) => [
    { label: 'SKUs', value: formatInt(s.items) },
    { label: 'Warehouses', value: formatInt(s.warehouses) },
    { label: 'Closing qty', value: formatQty(s.closing_qty) },
    { label: 'Closing value', value: formatMoney(s.closing_value), tone: 'good' },
    {
      label: 'Needs attention',
      value: formatInt(attentionCount(s.health)),
      tone: attentionCount(s.health) > 0 ? 'warning' : 'good',
    },
  ],

  tableTitle: 'Warehouse stock',
  tableHint: 'Closing position per item and warehouse, as at the date above',
  emptyTitle: 'No warehouse stock found',
  emptyMessage:
    'Nothing matches the item, warehouse, stock health or date you have chosen. Widen one of them and try again.',
  // A company that has simply never recorded stock gets the other screen: telling it to
  // widen a filter sends it hunting for one that is not there.
  emptyUnfiltered: <WarehouseStockEmptyState />,
})

export default warehouseStockConfig
