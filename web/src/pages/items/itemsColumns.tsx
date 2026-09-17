import { ActiveBadge } from '../../components/StatusBadge'
import type { CellFormat, ExportableColumn } from '../../registers/registerCells'
import type { SmartColumn } from '../../ui/shell/SmartTable'
import type { ItemListRow } from '../../services/items'
import { formatDateTime, formatMoney, formatQty } from '../../utils/format'

/** Batch / Serial / Expiry, in the order the screen shows them. */
export function trackingFlags(r: ItemListRow): string[] {
  return [
    Number(r.track_batch) === 1 ? 'Batch' : null,
    Number(r.track_serial) === 1 ? 'Serial' : null,
    Number(r.track_expiry) === 1 ? 'Expiry' : null,
  ].filter((f): f is string => f !== null)
}

function Dash() {
  return <span className="text-gray-300">—</span>
}

/**
 * The item list's columns — for the table, the "Columns" chooser and the
 * export alike. `useColumnConfig` filters this one list for all three, so a
 * column switched off here is gone from the CSV and the print sheet too.
 *
 * `tracking` and `on_hand` are computed rather than read straight off the row
 * (there is no `tracking` field, and the figure lives at `stock.on_hand`), so
 * both declare an explicit `csv` resolver: without one, a column whose header
 * promises a figure exports silently blank — see realMasterExports.test.tsx,
 * which caught exactly that on this screen's previous incarnation.
 */
export const ITEM_COLUMNS: SmartColumn<ItemListRow>[] = [
  {
    key: 'item_name',
    header: 'Item',
    sortKey: 'item_name',
    alwaysVisible: true,
    minWidth: 200,
    render: (r) => (
      <>
        <strong className="text-gray-900">{r.item_name}</strong>
        {r.item_alias ? <span className="ml-1 text-gray-400">· {r.item_alias}</span> : null}
        {!r.item_sku ? <span className="mt-0.5 block text-[11px] text-amber-600">SKU not set</span> : null}
      </>
    ),
    csv: (r) => r.item_name,
  },
  {
    key: 'item_sku',
    header: 'SKU',
    sortKey: 'item_sku',
    defaultVisible: false,
    render: (r) => <span className="font-mono text-xs">{r.item_sku ?? <Dash />}</span>,
    csv: (r) => r.item_sku ?? '',
  },
  {
    key: 'item_upc',
    header: 'Barcode',
    defaultVisible: false,
    render: (r) => <span className="font-mono text-xs">{r.item_upc ?? <Dash />}</span>,
    csv: (r) => r.item_upc ?? '',
  },
  {
    key: 'grp_name',
    header: 'Group',
    sortKey: 'grp_name',
    defaultVisible: false,
    csv: (r) => r.grp_name ?? '',
  },
  {
    key: 'cat_name',
    header: 'Category',
    defaultVisible: true,
    csv: (r) => r.cat_name ?? '',
  },
  {
    key: 'brand_name',
    header: 'Brand',
    defaultVisible: false,
    csv: (r) => r.brand_name ?? '',
  },
  {
    key: 'unit_symbol',
    header: 'Unit',
    defaultVisible: false,
    render: (r) => r.unit_symbol ?? r.unit_name ?? <Dash />,
    csv: (r) => r.unit_symbol ?? r.unit_name ?? '',
  },
  {
    key: 'hsn_sac',
    header: 'HSN',
    defaultVisible: false,
    render: (r) => <span className="font-mono text-xs">{r.hsn_sac ?? <Dash />}</span>,
    csv: (r) => r.hsn_sac ?? '',
  },
  {
    key: 'mrp',
    header: 'MRP',
    align: 'right',
    defaultVisible: false,
    amount: true,
    render: (r) => formatMoney(r.mrp),
    csv: (r) => (r.mrp === null || r.mrp === undefined || r.mrp === '' ? '' : Number(r.mrp)),
  },
  {
    key: 'valuation_method',
    header: 'Valuation',
    defaultVisible: true,
    csv: (r) => r.valuation_method,
  },
  {
    key: 'tracking',
    header: 'Tracking',
    defaultVisible: false,
    configureHint: 'Batch, serial and expiry tracking',
    render: (r) => {
      const flags = trackingFlags(r)
      return flags.length ? flags.join(', ') : <Dash />
    },
    csv: (r) => trackingFlags(r).join(', '),
  },
  {
    key: 'on_hand',
    header: 'On hand',
    align: 'right',
    defaultVisible: true,
    render: (r) => (r.stock ? formatQty(r.stock.on_hand) : <Dash />),
    csv: (r) => r.stock?.on_hand ?? '',
  },
  {
    key: 'is_active',
    header: 'Status',
    alwaysVisible: true,
    render: (r) => <ActiveBadge active={r.is_active} />,
    csv: (r) => (Number(r.is_active) === 1 ? 'Active' : 'Inactive'),
  },
  {
    key: 'updated_at',
    header: 'Updated',
    sortKey: 'updated_at',
    defaultVisible: false,
    render: (r) => <span className="whitespace-nowrap text-gray-500">{formatDateTime(r.updated_at)}</span>,
    csv: (r) => r.updated_at ?? '',
  },
]

/** Print/CSV format for the columns whose export value is a raw, unformatted number or date. */
const EXPORT_FORMAT: Partial<Record<string, CellFormat>> = {
  mrp: 'amount',
  on_hand: 'qty',
  updated_at: 'datetime',
}

/** The currently visible columns, as the sheet the export/print pipeline needs. */
export function toExportColumns(columns: readonly SmartColumn<ItemListRow>[]): ExportableColumn<ItemListRow>[] {
  return columns.map((col) => ({
    key: col.key,
    header: col.header,
    align: col.align,
    csv: col.csv,
    csvHeader: col.csvHeader ?? String(col.header),
    amount: col.amount,
    format: EXPORT_FORMAT[col.key],
  }))
}
