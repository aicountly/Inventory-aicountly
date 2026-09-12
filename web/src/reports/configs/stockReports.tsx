import { StatusBadge } from '../../components/StatusBadge'
import type { ReportMethod } from '../../services/valuationApi'
import { METHOD_LABELS, REPORT_METHODS } from '../../services/valuationApi'
import type { BatchStockRow, BatchStockSummary, SerialStockRow, SerialStockSummary, StockSummaryRow, StockSummarySummary, WarehouseStockRow, WarehouseStockSummary } from '../../services/reportsApi'
import { formatInt, formatMoney, formatQty } from '../../utils/format'
import { expiryTone } from '../helpers'
import type { ReportConfig, ReportFilter } from '../types'
import { dateColumn, itemColumn, itemFilter, itemGroupFilter, moneyColumn, nonzeroFilter, qtyColumn, statusColumn, stockCategoryFilter, textColumn, warehouseFilter } from './common'

const methodFilter: ReportFilter = {
  key: 'method',
  kind: 'select',
  label: 'Valuation',
  options: REPORT_METHODS.map((m: ReportMethod) => ({ value: m, label: METHOD_LABELS[m] })),
  defaultValue: () => 'AS_PER_MASTER',
}

export const stockSummaryConfig: ReportConfig<StockSummaryRow, StockSummarySummary> = {
  slug: 'stock_summary',
  path: 'stock-summary',
  title: 'Stock summary',
  description: 'Opening, receipts, issues and closing per item for the period, valued at the chosen method',
  defaultSort: 'item_name',
  filters: [
    { key: 'from', kind: 'date', label: 'From', defaultValue: (c) => c.fyFrom },
    { key: 'to', kind: 'date', label: 'To', defaultValue: (c) => (c.today < c.fyTo ? c.today : c.fyTo) },
    itemFilter,
    warehouseFilter,
    methodFilter,
    nonzeroFilter,
  ],
  columns: [
    itemColumn<StockSummaryRow>(),
    textColumn<StockSummaryRow>('unit_symbol', 'Unit', false),
    qtyColumn<StockSummaryRow>('opening_qty', 'Opening'),
    qtyColumn<StockSummaryRow>('in_qty', 'In'),
    qtyColumn<StockSummaryRow>('out_qty', 'Out'),
    qtyColumn<StockSummaryRow>('closing_qty', 'Closing', { strong: true }),
    moneyColumn<StockSummaryRow>('unit_cost', 'Unit cost'),
    moneyColumn<StockSummaryRow>('closing_value', 'Closing value', { strong: true }),
    { key: 'valuation_method_applied', header: 'Method', render: (r) => r.valuation_method_applied ?? '—' },
  ],
  rowKey: (r) => r.item_id,
  summary: (s) => [
    { label: 'Items', value: formatInt(s.items) },
    { label: 'Opening qty', value: formatQty(s.opening_qty) },
    { label: 'In', value: formatQty(s.in_qty), tone: 'good' },
    { label: 'Out', value: formatQty(s.out_qty), tone: 'warning' },
    { label: 'Closing qty', value: formatQty(s.closing_qty) },
    { label: 'Closing value', value: formatMoney(s.closing_value), tone: 'good' },
  ],
}

export const warehouseStockConfig: ReportConfig<WarehouseStockRow, WarehouseStockSummary> = {
  slug: 'warehouse_stock',
  path: 'warehouse-stock',
  title: 'Warehouse stock',
  description: 'Closing stock per item and warehouse as at a date',
  defaultSort: 'item_name',
  filters: [{ key: 'to', kind: 'date', label: 'As at', defaultValue: (c) => c.today }, itemFilter, warehouseFilter, methodFilter, nonzeroFilter],
  columns: [
    itemColumn<WarehouseStockRow>(),
    textColumn<WarehouseStockRow>('warehouse_name', 'Warehouse'),
    textColumn<WarehouseStockRow>('unit_symbol', 'Unit', false),
    qtyColumn<WarehouseStockRow>('closing_qty', 'Closing', { strong: true }),
    moneyColumn<WarehouseStockRow>('unit_cost', 'Unit cost'),
    moneyColumn<WarehouseStockRow>('closing_value', 'Value', { strong: true }),
  ],
  rowKey: (r) => `${r.item_id}:${r.warehouse_id ?? 0}`,
  summary: (s) => [
    { label: 'Rows', value: formatInt(s.rows) },
    { label: 'Closing qty', value: formatQty(s.closing_qty) },
    { label: 'Closing value', value: formatMoney(s.closing_value), tone: 'good' },
  ],
  extra: (s) =>
    s.by_warehouse?.length ? (
      <div className="report-extra">
        <h3>By warehouse</h3>
        <table className="table compact">
          <thead>
            <tr>
              <th>Warehouse</th>
              <th className="num">Qty</th>
              <th className="num">Value</th>
            </tr>
          </thead>
          <tbody>
            {s.by_warehouse.map((w) => (
              <tr key={w.warehouse_id ?? 0}>
                <td>{w.warehouse_name ?? '(no warehouse)'}</td>
                <td className="num">{formatQty(w.closing_qty)}</td>
                <td className="num">{formatMoney(w.closing_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : null,
}

export const batchStockConfig: ReportConfig<BatchStockRow, BatchStockSummary> = {
  slug: 'batch_stock',
  path: 'batch-stock',
  title: 'Batch stock',
  description: 'On-hand and available quantity per batch, with expiry',
  defaultSort: 'expiry_date',
  filters: [
    itemFilter,
    warehouseFilter,
    itemGroupFilter,
    stockCategoryFilter,
    { key: 'status', kind: 'select', label: 'Batch status', options: [{ value: 'active', label: 'Active' }, { value: 'quarantine', label: 'Quarantine' }, { value: 'expired', label: 'Expired' }, { value: 'blocked', label: 'Blocked' }] },
    { key: 'expiring_before', kind: 'date', label: 'Expiring before' },
    nonzeroFilter,
  ],
  columns: [
    itemColumn<BatchStockRow>(),
    textColumn<BatchStockRow>('batch_no', 'Batch'),
    textColumn<BatchStockRow>('lot_no', 'Lot', false),
    textColumn<BatchStockRow>('warehouse_name', 'Warehouse'),
    dateColumn<BatchStockRow>('expiry_date', 'Expiry'),
    { key: 'days_to_expiry', header: 'Days', align: 'right', sortKey: 'days_to_expiry', render: (r) => (r.days_to_expiry === null ? '—' : <StatusBadge value={r.is_expired ? 'expired' : `${r.days_to_expiry} d`} tone={expiryTone(r.days_to_expiry, r.is_expired)} />), csv: (r) => r.days_to_expiry },
    statusColumn<BatchStockRow>('batch_status'),
    qtyColumn<BatchStockRow>('on_hand', 'On hand', { strong: true }),
    qtyColumn<BatchStockRow>('reserved', 'Reserved'),
    qtyColumn<BatchStockRow>('packed', 'Packed'),
    qtyColumn<BatchStockRow>('quality_hold', 'On hold'),
    qtyColumn<BatchStockRow>('available', 'Available', { strong: true }),
    moneyColumn<BatchStockRow>('stock_value', 'Value'),
  ],
  rowKey: (r) => `${r.batch_id}:${r.warehouse_id ?? 0}`,
  summary: (s) => [
    { label: 'Batches', value: formatInt(s.batches) },
    { label: 'Items', value: formatInt(s.items) },
    { label: 'On hand', value: formatQty(s.on_hand) },
    { label: 'Reserved', value: formatQty(s.reserved) },
  ],
  rowClassName: (r) => (r.is_expired ? 'row-critical' : undefined),
}

export const serialStockConfig: ReportConfig<SerialStockRow, SerialStockSummary> = {
  slug: 'serial_stock',
  path: 'serial-stock',
  title: 'Serial numbers',
  description: 'Every tracked serial with its status, location and the documents that received and issued it',
  defaultSort: 'serial_no',
  filters: [
    { key: 'q', kind: 'text', label: 'Serial', placeholder: 'Serial number…' },
    itemFilter,
    warehouseFilter,
    { key: 'status', kind: 'select', label: 'Status', options: [{ value: 'in_stock', label: 'In stock' }, { value: 'reserved', label: 'Reserved' }, { value: 'issued', label: 'Issued' }, { value: 'returned', label: 'Returned' }, { value: 'scrapped', label: 'Scrapped' }] },
  ],
  columns: [
    { key: 'serial_no', header: 'Serial', sortKey: 'serial_no', render: (r) => <strong>{r.serial_no}</strong> },
    statusColumn<SerialStockRow>('status'),
    itemColumn<SerialStockRow>(),
    textColumn<SerialStockRow>('batch_no', 'Batch', false),
    textColumn<SerialStockRow>('warehouse_name', 'Warehouse'),
    textColumn<SerialStockRow>('location_code', 'Location', false),
    { key: 'received', header: 'Received', render: (r) => (r.received_document_no ? `${r.received_document_no} · ${r.received_date ?? ''}` : '—'), csv: (r) => r.received_document_no },
    { key: 'issued', header: 'Issued', render: (r) => (r.issued_document_no ? `${r.issued_document_no} · ${r.issued_date ?? ''}${r.issued_to ? ` → ${r.issued_to}` : ''}` : '—'), csv: (r) => r.issued_document_no },
    moneyColumn<SerialStockRow>('unit_cost', 'Unit cost'),
    dateColumn<SerialStockRow>('warranty_until', 'Warranty'),
  ],
  rowKey: (r) => r.serial_id,
  summary: (s) => [
    { label: 'Serials (all statuses)', value: formatInt(s.total_all_statuses) },
    ...Object.entries(s.by_status ?? {}).map(([status, n]) => ({ label: status.replace(/_/g, ' '), value: formatInt(n) })),
  ],
}
