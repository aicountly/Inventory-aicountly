import { StatusBadge } from '../../components/StatusBadge'
import { formatDate, formatMoney, formatQty } from '../../utils/format'
import type { ReportColumn, ReportFilter } from '../types'

/** Filters shared by the item-centric reports. */
export const itemFilter: ReportFilter = { key: 'item_id', kind: 'item', label: 'Item' }
export const warehouseFilter: ReportFilter = { key: 'warehouse_id', kind: 'warehouse', label: 'Warehouse' }
export const itemGroupFilter: ReportFilter = { key: 'item_grp_id', kind: 'item_group', label: 'Item group' }
export const stockCategoryFilter: ReportFilter = { key: 'stock_cat_id', kind: 'stock_category', label: 'Category' }
export const nonzeroFilter: ReportFilter = { key: 'nonzero', kind: 'toggle', label: 'Hide zero rows', defaultOn: true }
export const byWarehouseFilter: ReportFilter = { key: 'by_warehouse', kind: 'toggle', label: 'Split by warehouse', defaultOn: false }

export function qtyColumn<T>(key: keyof T & string, header: string, opts: { strong?: boolean } = {}): ReportColumn<T> {
  return {
    key,
    header,
    align: 'right',
    sortKey: key,
    render: (r) => (opts.strong ? <strong>{formatQty(r[key])}</strong> : formatQty(r[key])),
  }
}

export function moneyColumn<T>(key: keyof T & string, header: string, opts: { strong?: boolean } = {}): ReportColumn<T> {
  return {
    key,
    header,
    align: 'right',
    sortKey: key,
    render: (r) => (opts.strong ? <strong>{formatMoney(r[key])}</strong> : formatMoney(r[key])),
  }
}

export function dateColumn<T>(key: keyof T & string, header: string): ReportColumn<T> {
  return { key, header, sortKey: key, render: (r) => formatDate(r[key]) }
}

export function textColumn<T>(key: keyof T & string, header: string, sortable = true): ReportColumn<T> {
  return { key, header, sortKey: sortable ? key : undefined, render: (r) => (r[key] === null || r[key] === undefined || r[key] === '' ? <span className="muted">—</span> : String(r[key])) }
}

export function statusColumn<T>(key: keyof T & string, header = 'Status'): ReportColumn<T> {
  return { key, header, sortKey: key, render: (r) => <StatusBadge value={String(r[key] ?? '')} /> }
}

/** Item name + SKU + group, the first column of every item report. */
export function itemColumn<T extends { item_id: number; item_name: string | null; item_sku?: string | null; item_alias?: string | null; grp_name?: string | null }>(): ReportColumn<T> {
  return {
    key: 'item_name',
    header: 'Item',
    sortKey: 'item_name',
    render: (r) => (
      <span>
        <strong>{r.item_name ?? `Item #${r.item_id}`}</strong>
        {r.item_sku ? <span className="muted"> · {r.item_sku}</span> : null}
        {r.grp_name ? <div className="muted small">{r.grp_name}</div> : null}
      </span>
    ),
    csv: (r) => r.item_name ?? `Item #${r.item_id}`,
  }
}
