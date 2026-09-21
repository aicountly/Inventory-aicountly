import { StatusBadge } from '../../ui/StatusBadge'
import { formatDate, formatDateTime, formatMoney, formatQty } from '../../utils/format'
import type { FilterContext, ReportColumn, ReportFilter } from '../types'

/**
 * Shared column and filter builders.
 *
 * Every builder also sets the metadata the register engine needs beyond the
 * screen: `format` tells the print sheet how to render the cell, and `amount`
 * marks the currency columns. Setting them here rather than at each call site
 * is what keeps the table, the CSV and the printed register saying the same
 * thing about the same column.
 */

/** "—" for an absent value, in the shared muted tone. */
export const DASH = <span className="text-gray-300">—</span>

/* ---------------------------------------------------------------- filters */

export const itemFilter: ReportFilter = { key: 'item_id', kind: 'item', label: 'Item' }
export const warehouseFilter: ReportFilter = { key: 'warehouse_id', kind: 'warehouse', label: 'Warehouse' }
export const batchFilter: ReportFilter = { key: 'batch_id', kind: 'batch', label: 'Batch' }
export const itemGroupFilter: ReportFilter = { key: 'item_grp_id', kind: 'item_group', label: 'Item group' }
export const stockCategoryFilter: ReportFilter = { key: 'stock_cat_id', kind: 'stock_category', label: 'Category' }
export const brandFilter: ReportFilter = { key: 'brand_id', kind: 'brand', label: 'Brand' }
export const nonzeroFilter: ReportFilter = { key: 'nonzero', kind: 'toggle', label: 'Hide zero rows', defaultOn: true }
export const byWarehouseFilter: ReportFilter = { key: 'by_warehouse', kind: 'toggle', label: 'Split by warehouse', defaultOn: false }

/**
 * The period filter every dated register uses: one preset dropdown writing the
 * plain `from` / `to` the APIs already read, defaulting to the financial year
 * capped at today.
 *
 * It is a *pair* of entries, not one. The visible `date_range` control owns
 * both dates, and a hidden `to` entry keeps `to` a first-class declared filter
 * — dashboard drill-downs and tests introspect `config.filters` to check that a
 * link only carries parameters the register actually reads, and a URL key that
 * exists only inside another filter's `toKey` would read as unsupported.
 */
const periodTo = (c: FilterContext) => (c.today < c.fyTo ? c.today : c.fyTo)

export const periodFilter: readonly ReportFilter[] = [
  {
    key: 'from',
    toKey: 'to',
    kind: 'date_range',
    label: 'Period',
    defaultValue: (c) => c.fyFrom,
    defaultToValue: periodTo,
  },
  { key: 'to', kind: 'date', label: 'To', hidden: true, defaultValue: periodTo },
]

/** Same control, but spanning the whole financial year rather than to date. */
export const fullFyPeriodFilter: readonly ReportFilter[] = [
  { ...periodFilter[0], defaultToValue: (c) => c.fyTo },
  { key: 'to', kind: 'date', label: 'To', hidden: true, defaultValue: (c) => c.fyTo },
]

/* ---------------------------------------------------------------- columns */

/**
 * `sortable: false` is not decoration: SmartTable draws a sort control for any
 * column carrying a sortKey, and a control the endpoint cannot honour moves the
 * arrow and returns the same rows — which reads as "sorted", wrongly.
 */
export function qtyColumn<T>(
  key: keyof T & string,
  header: string,
  opts: { strong?: boolean; sortable?: boolean } = {},
): ReportColumn<T> {
  return {
    key,
    header,
    align: 'right',
    sortKey: opts.sortable === false ? undefined : key,
    format: 'qty',
    render: (r) =>
      opts.strong ? <strong className="font-semibold text-gray-900">{formatQty(r[key])}</strong> : formatQty(r[key]),
  }
}

export function moneyColumn<T>(
  key: keyof T & string,
  header: string,
  opts: { strong?: boolean; sortable?: boolean } = {},
): ReportColumn<T> {
  return {
    key,
    header,
    align: 'right',
    sortKey: opts.sortable === false ? undefined : key,
    format: 'amount',
    amount: true,
    render: (r) =>
      opts.strong ? <strong className="font-semibold text-gray-900">{formatMoney(r[key])}</strong> : formatMoney(r[key]),
  }
}

export function intColumn<T>(key: keyof T & string, header: string, sortable = true): ReportColumn<T> {
  return { key, header, align: 'right', sortKey: sortable ? key : undefined, format: 'int' }
}

/**
 * `cellClassName` is not decoration: a date is one token, and a narrow column
 * in a squeezed table breaks "28 Sept 2026" across three lines and takes the
 * whole row's height with it. The table already scrolls sideways when the
 * columns want more room than the viewport has.
 */
export function dateColumn<T>(key: keyof T & string, header: string, sortable = true): ReportColumn<T> {
  return { key, header, sortKey: sortable ? key : undefined, format: 'date', cellClassName: 'whitespace-nowrap', render: (r) => formatDate(r[key]) }
}

export function dateTimeColumn<T>(key: keyof T & string, header: string, sortable = true): ReportColumn<T> {
  return {
    key,
    header,
    sortKey: sortable ? key : undefined,
    format: 'datetime',
    cellClassName: 'whitespace-nowrap',
    render: (r) => formatDateTime(r[key]),
  }
}

export function textColumn<T>(key: keyof T & string, header: string, sortable = true): ReportColumn<T> {
  return {
    key,
    header,
    sortKey: sortable ? key : undefined,
    render: (r) => (r[key] === null || r[key] === undefined || r[key] === '' ? DASH : String(r[key])),
  }
}

export function statusColumn<T>(key: keyof T & string, header = 'Status', sortable = true): ReportColumn<T> {
  return {
    key,
    header,
    sortKey: sortable ? key : undefined,
    render: (r) => <StatusBadge value={String(r[key] ?? '')} />,
  }
}

/** Item name + SKU + group — the first column of every item register. */
export function itemColumn<
  T extends {
    item_id: number
    item_name: string | null
    item_sku?: string | null
    item_alias?: string | null
    grp_name?: string | null
  },
>(): ReportColumn<T> {
  return {
    key: 'item_name',
    header: 'Item',
    sortKey: 'item_name',
    // Identifies the row: a grid of numbers with no name against them is not a
    // register, so it is never on offer in the column configurator.
    alwaysVisible: true,
    minWidth: 200,
    render: (r) => (
      <span>
        <strong className="font-semibold text-gray-900">{r.item_name ?? `Item #${r.item_id}`}</strong>
        {r.item_sku ? <span className="text-gray-400"> · {r.item_sku}</span> : null}
        {r.grp_name ? <span className="block text-[11px] text-gray-500">{r.grp_name}</span> : null}
      </span>
    ),
    csv: (r) => r.item_name ?? `Item #${r.item_id}`,
  }
}
