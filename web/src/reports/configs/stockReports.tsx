import { Boxes, Layers, ScanBarcode } from 'lucide-react'
import type { ReportMethod } from '../../services/valuationApi'
import { METHOD_LABELS, REPORT_METHODS } from '../../services/valuationApi'
import type {
  BatchStockRow,
  BatchStockSummary,
  SerialStockRow,
  SerialStockSummary,
  StockSummaryRow,
  StockSummarySummary,
} from '../../services/reportsApi'
import { buildTotalsRow, totalsLabel } from '../../registers/registerTotals'
import type { RegisterConfig } from '../../registers/RegisterConfig'
import { StatusBadge } from '../../ui/StatusBadge'
import { formatInt, formatMoney, formatQty } from '../../utils/format'
import { expiryTone } from '../helpers'
import type { ReportFilter } from '../types'
import {
  DASH,
  batchFilter,
  dateColumn,
  itemColumn,
  itemFilter,
  itemGroupFilter,
  moneyColumn,
  nonzeroFilter,
  periodFilter,
  qtyColumn,
  statusColumn,
  stockCategoryFilter,
  textColumn,
  warehouseFilter,
} from './common'

const methodFilter: ReportFilter = {
  key: 'method',
  kind: 'select',
  label: 'Valuation',
  options: REPORT_METHODS.map((m: ReportMethod) => ({ value: m, label: METHOD_LABELS[m] })),
  defaultValue: () => 'AS_PER_MASTER',
}

/** One item's ledger, filtered the way the row it was opened from was. */
function ledgerLink(itemId: number, warehouseId?: number | null): string {
  const qs = new URLSearchParams({ item_id: String(itemId) })
  if (warehouseId) qs.set('warehouse_id', String(warehouseId))
  return `/registers/stock-ledger?${qs.toString()}`
}

export const stockSummaryConfig: RegisterConfig<StockSummaryRow, StockSummarySummary> = {
  slug: 'stock_summary',
  path: 'stock-summary',
  title: 'Stock summary',
  description:
    'Opening, receipts, issues and closing per item for the period, valued at the chosen method',
  group: 'stock',
  icon: Boxes,
  defaultSort: 'item_name',
  minWidth: 1100,
  rowNoun: 'item',
  filters: [...periodFilter, itemFilter, warehouseFilter, itemGroupFilter, methodFilter, nonzeroFilter],
  columns: [
    itemColumn<StockSummaryRow>(),
    textColumn<StockSummaryRow>('unit_symbol', 'Unit', false),
    qtyColumn<StockSummaryRow>('opening_qty', 'Opening'),
    qtyColumn<StockSummaryRow>('in_qty', 'In'),
    qtyColumn<StockSummaryRow>('out_qty', 'Out'),
    qtyColumn<StockSummaryRow>('closing_qty', 'Closing', { strong: true }),
    moneyColumn<StockSummaryRow>('unit_cost', 'Unit cost'),
    moneyColumn<StockSummaryRow>('closing_value', 'Closing value', { strong: true }),
    {
      key: 'valuation_method_applied',
      header: 'Method',
      configureHint: 'The method actually used for this item.',
      render: (r) => r.valuation_method_applied ?? DASH,
    },
  ],
  rowKey: (r) => r.item_id,
  drillTo: (r) => ledgerLink(r.item_id),
  // Every figure here is the server's total over the whole filtered set, so it
  // stays true on page 1 of 40.
  totals: (s, rows) =>
    buildTotalsRow(
      [
        { key: 'item_name' },
        { key: 'unit_symbol' },
        { key: 'opening_qty', align: 'right' },
        { key: 'in_qty', align: 'right' },
        { key: 'out_qty', align: 'right' },
        { key: 'closing_qty', align: 'right' },
        { key: 'unit_cost', align: 'right' },
        { key: 'closing_value', align: 'right' },
        { key: 'valuation_method_applied' },
      ],
      {
        opening_qty: formatQty(s.opening_qty),
        in_qty: formatQty(s.in_qty),
        out_qty: formatQty(s.out_qty),
        closing_qty: formatQty(s.closing_qty),
        closing_value: formatMoney(s.closing_value),
      },
      { label: totalsLabel(s.items || rows.length, 'item'), labelKey: 'item_name' },
    ),
  summary: (s) => [
    { label: 'Items', value: formatInt(s.items) },
    { label: 'Opening qty', value: formatQty(s.opening_qty) },
    { label: 'In', value: formatQty(s.in_qty), tone: 'good' },
    { label: 'Out', value: formatQty(s.out_qty), tone: 'warning' },
    { label: 'Closing qty', value: formatQty(s.closing_qty) },
    { label: 'Closing value', value: formatMoney(s.closing_value), tone: 'good' },
  ],
}

/**
 * Warehouse stock.
 *
 * Declared in `registers/warehouse/`, which is where its cells, its rail and its
 * deterministic insight rules live, and re-exported here so `reports/configs/index.ts`
 * and every existing import of it are unchanged. It stays a `RegisterConfig` served by
 * the same engine at both `/reports/warehouse-stock` and `/registers/warehouse-stock`.
 */
export { warehouseStockConfig } from '../../registers/warehouse/warehouseStockRegister'

export const batchStockConfig: RegisterConfig<BatchStockRow, BatchStockSummary> = {
  slug: 'batch_stock',
  path: 'batch-stock',
  title: 'Batch stock',
  description: 'On-hand and available quantity per batch, with expiry',
  group: 'stock',
  icon: Layers,
  defaultSort: 'expiry_date',
  minWidth: 1300,
  filters: [
    itemFilter,
    warehouseFilter,
    batchFilter,
    itemGroupFilter,
    stockCategoryFilter,
    {
      key: 'status',
      kind: 'select',
      label: 'Batch status',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'quarantine', label: 'Quarantine' },
        { value: 'expired', label: 'Expired' },
        { value: 'blocked', label: 'Blocked' },
      ],
    },
    { key: 'expiring_before', kind: 'date', label: 'Expiring before' },
    nonzeroFilter,
  ],
  columns: [
    itemColumn<BatchStockRow>(),
    textColumn<BatchStockRow>('batch_no', 'Batch'),
    textColumn<BatchStockRow>('lot_no', 'Lot', false),
    textColumn<BatchStockRow>('warehouse_name', 'Warehouse'),
    dateColumn<BatchStockRow>('expiry_date', 'Expiry'),
    {
      key: 'days_to_expiry',
      header: 'Days',
      align: 'right',
      sortKey: 'days_to_expiry',
      render: (r) =>
        r.days_to_expiry === null ? (
          DASH
        ) : (
          <StatusBadge
            value={r.is_expired ? 'expired' : `${r.days_to_expiry} d`}
            tone={expiryTone(r.days_to_expiry, r.is_expired)}
          />
        ),
      csv: (r) => r.days_to_expiry,
    },
    statusColumn<BatchStockRow>('batch_status'),
    qtyColumn<BatchStockRow>('on_hand', 'On hand', { strong: true }),
    qtyColumn<BatchStockRow>('reserved', 'Reserved'),
    qtyColumn<BatchStockRow>('packed', 'Packed'),
    { ...qtyColumn<BatchStockRow>('quality_hold', 'On hold'), defaultVisible: false },
    { ...qtyColumn<BatchStockRow>('damaged', 'Damaged'), defaultVisible: false },
    qtyColumn<BatchStockRow>('available', 'Available', { strong: true }),
    moneyColumn<BatchStockRow>('stock_value', 'Value'),
  ],
  rowKey: (r) => `${r.batch_id}:${r.warehouse_id ?? 0}`,
  drillTo: (r) => ledgerLink(r.item_id, r.warehouse_id),
  totals: (s) =>
    buildTotalsRow(
      [
        { key: 'item_name' },
        { key: 'on_hand', align: 'right' },
        { key: 'reserved', align: 'right' },
      ],
      { on_hand: formatQty(s.on_hand), reserved: formatQty(s.reserved) },
      { label: totalsLabel(s.batches, 'batch', 'batches'), labelKey: 'item_name' },
    ),
  summary: (s) => [
    { label: 'Batches', value: formatInt(s.batches) },
    { label: 'Items', value: formatInt(s.items) },
    { label: 'On hand', value: formatQty(s.on_hand) },
    { label: 'Reserved', value: formatQty(s.reserved) },
  ],
  rowClassName: (r) => (r.is_expired ? 'bg-red-50/60' : undefined),
}

export const serialStockConfig: RegisterConfig<SerialStockRow, SerialStockSummary> = {
  slug: 'serial_stock',
  path: 'serial-stock',
  title: 'Serial numbers',
  description:
    'Every tracked serial with its status, location and the documents that received and issued it',
  group: 'stock',
  icon: ScanBarcode,
  defaultSort: 'serial_no',
  minWidth: 1200,
  filters: [
    { key: 'q', kind: 'text', label: 'Serial', placeholder: 'Serial number…' },
    itemFilter,
    warehouseFilter,
    batchFilter,
    {
      key: 'status',
      kind: 'select',
      label: 'Status',
      options: [
        { value: 'in_stock', label: 'In stock' },
        { value: 'reserved', label: 'Reserved' },
        { value: 'issued', label: 'Issued' },
        { value: 'returned', label: 'Returned' },
        { value: 'scrapped', label: 'Scrapped' },
      ],
    },
  ],
  columns: [
    {
      key: 'serial_no',
      header: 'Serial',
      sortKey: 'serial_no',
      alwaysVisible: true,
      render: (r) => <strong className="font-semibold text-gray-900">{r.serial_no}</strong>,
    },
    statusColumn<SerialStockRow>('status'),
    itemColumn<SerialStockRow>(),
    textColumn<SerialStockRow>('batch_no', 'Batch', false),
    textColumn<SerialStockRow>('warehouse_name', 'Warehouse'),
    textColumn<SerialStockRow>('location_code', 'Location', false),
    {
      key: 'received',
      header: 'Received',
      configureHint: 'The document that brought the serial in.',
      render: (r) => (r.received_document_no ? `${r.received_document_no} · ${r.received_date ?? ''}` : DASH),
      csv: (r) => r.received_document_no,
    },
    {
      key: 'issued',
      header: 'Issued',
      render: (r) =>
        r.issued_document_no
          ? `${r.issued_document_no} · ${r.issued_date ?? ''}${r.issued_to ? ` → ${r.issued_to}` : ''}`
          : DASH,
      csv: (r) => r.issued_document_no,
    },
    { ...moneyColumn<SerialStockRow>('unit_cost', 'Unit cost'), defaultVisible: false, configureHint: 'Discloses cost — off by default.' },
    dateColumn<SerialStockRow>('warranty_until', 'Warranty'),
  ],
  rowKey: (r) => r.serial_id,
  // The document that received it is the one a reader wants when a serial looks
  // wrong; its ledger is one click further on from there.
  drillTo: (r) =>
    r.received_document_id
      ? `/documents/${r.received_document_id}`
      : r.item_id
        ? ledgerLink(r.item_id, r.warehouse_id)
        : null,
  summary: (s) => [
    { label: 'Serials (all statuses)', value: formatInt(s.total_all_statuses) },
    ...Object.entries(s.by_status ?? {}).map(([status, n]) => ({
      label: status.replace(/_/g, ' '),
      value: formatInt(n),
    })),
  ],
}
