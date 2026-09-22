import type { ReactNode } from 'react'
import { AlertTriangle, Boxes, CalendarClock, Layers, PackageOpen, ScanBarcode, Warehouse } from 'lucide-react'
import type { ReportMethod } from '../../services/valuationApi'
import { METHOD_LABELS, REPORT_METHODS } from '../../services/valuationApi'
import type {
  BatchStockRow,
  BatchStockSummary,
  OpeningStockRow,
  OpeningStockSummary,
  SerialStockRow,
  SerialStockSummary,
  StockSummaryRow,
  StockSummarySummary,
} from '../../services/reportsApi'
import { buildTotalsRow, totalsLabel } from '../../registers/registerTotals'
import type { RegisterConfig } from '../../registers/RegisterConfig'
import { EmptyState } from '../../ui/EmptyState'
import { StatusBadge } from '../../ui/StatusBadge'
import { formatInt, formatMoney, formatQty } from '../../utils/format'
import { expiryTone } from '../helpers'
import type { ReportFilter } from '../types'
import {
  DASH,
  batchFilter,
  brandFilter,
  dateColumn,
  intColumn,
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

/** A short list of names in one cell; a long one says how many rather than wrapping to six lines. */
function nameList(names: readonly string[], noun: string, fallback: ReactNode = DASH): ReactNode {
  if (!names.length) return fallback
  if (names.length <= 2) return names.join(', ')
  return `${names.length} ${noun}`
}

/**
 * Opening stock — what the financial year opened with, per item.
 *
 * The figure at the top of this register is the same `inventory_opening_value` the
 * reconciliation tab holds against Books' Stock-in-Hand opening: the server builds both from
 * the same collapsed opening layers rather than re-adding qty × rate, so the two screens
 * cannot disagree by a paisa and send someone hunting a variance that is a rounding.
 *
 * One row per item, not per opening line. An item opened across two warehouses, three batches
 * or in a case unit still starts the year on ONE blended layer, and that layer — not the
 * paperwork behind it — is what FIFO, LIFO and WAC consume from. The warehouse and batch
 * columns say where the opening was entered; the quantity and the cost say what it is worth.
 */
export const openingStockConfig: RegisterConfig<OpeningStockRow, OpeningStockSummary> = {
  slug: 'opening_stock',
  path: 'opening-stock',
  title: 'Opening stock',
  description:
    'What the financial year opened with, per item — quantity, cost and value, in the item base unit',
  shortDescription: 'The opening layer each item starts the year on',
  group: 'stock',
  icon: PackageOpen,
  // An opening is a position, not a period: there is no date range to state, and the year it
  // belongs to is the scope the whole app is already in.
  scopePeriod: 'Opening position for the selected financial year',
  defaultSort: 'opening_value',
  defaultOrder: 'desc',
  minWidth: 1200,
  rowNoun: 'item',
  filenameBase: 'opening-stock',
  filters: [
    itemFilter,
    warehouseFilter,
    itemGroupFilter,
    stockCategoryFilter,
    brandFilter,
    nonzeroFilter,
    {
      key: 'unvalued',
      kind: 'toggle',
      label: 'Opened without a rate',
      defaultOn: false,
    },
  ],
  columns: [
    itemColumn<OpeningStockRow>(),
    textColumn<OpeningStockRow>('unit_symbol', 'Unit', false),
    qtyColumn<OpeningStockRow>('opening_qty', 'Opening qty', { strong: true }),
    moneyColumn<OpeningStockRow>('unit_cost', 'Opening cost'),
    moneyColumn<OpeningStockRow>('opening_value', 'Opening value', { strong: true }),
    {
      key: 'unvalued_qty',
      header: 'Unvalued qty',
      align: 'right',
      sortKey: 'unvalued_qty',
      format: 'qty',
      configureHint: 'Opening quantity entered with no valuation rate — held, but valued at nil.',
      render: (r) =>
        Number(r.unvalued_qty) > 0 ? (
          <strong className="font-semibold text-amber-700">{formatQty(r.unvalued_qty)}</strong>
        ) : (
          DASH
        ),
    },
    {
      key: 'warehouse_names',
      header: 'Warehouse',
      configureHint: 'Where the opening was entered. Blank means it was entered company-wide.',
      render: (r) => nameList(r.warehouse_names, 'warehouses', <span className="text-gray-400">Company-wide</span>),
      csv: (r) => (r.warehouse_names.length ? r.warehouse_names.join(' | ') : 'Company-wide'),
    },
    {
      key: 'batch_nos',
      header: 'Batch',
      defaultVisible: false,
      render: (r) => nameList(r.batch_nos, 'batches'),
      csv: (r) => r.batch_nos.join(' | '),
    },
    { ...intColumn<OpeningStockRow>('lines', 'Lines'), defaultVisible: false, configureHint: 'Opening rows behind this item.' },
    {
      key: 'source_kinds',
      header: 'Source',
      defaultVisible: false,
      configureHint: 'Where the opening came from: the company inception opening, or a year-end carry forward.',
      render: (r) => (r.source_kinds.length ? r.source_kinds.map(sourceLabel).join(', ') : DASH),
      csv: (r) => r.source_kinds.join(' | '),
    },
  ],
  rowKey: (r) => r.item_id,
  drillTo: (r) => ledgerLink(r.item_id),
  totals: (s, rows) =>
    buildTotalsRow(
      [
        { key: 'item_name' },
        { key: 'unit_symbol' },
        { key: 'opening_qty', align: 'right' },
        { key: 'unit_cost', align: 'right' },
        { key: 'opening_value', align: 'right' },
        { key: 'unvalued_qty', align: 'right' },
        { key: 'warehouse_names' },
        { key: 'batch_nos' },
        { key: 'lines', align: 'right' },
        { key: 'source_kinds' },
      ],
      {
        opening_qty: formatQty(s.opening_qty),
        opening_value: formatMoney(s.opening_value),
        unvalued_qty: s.unvalued_qty > 0 ? formatQty(s.unvalued_qty) : '',
        lines: formatInt(s.lines),
      },
      { label: totalsLabel(s.items || rows.length, 'item'), labelKey: 'item_name' },
    ),
  summary: (s) => [
    { label: 'Items', value: formatInt(s.items) },
    { label: 'Opening qty', value: formatQty(s.opening_qty) },
    { label: 'Opening value', value: formatMoney(s.opening_value), tone: 'good' },
    {
      label: 'Unvalued qty',
      value: formatQty(s.unvalued_qty),
      hint: s.unvalued_items ? `${formatInt(s.unvalued_items)} items opened with no rate` : undefined,
      tone: (s.unvalued_qty > 0 ? 'warning' : 'neutral') as 'warning' | 'neutral',
    },
  ],
  /*
   * The strip exists for one sentence the figures cannot say on their own: WHICH set of
   * opening rows this is. Before the year-end close has run into the year, a company opens on
   * its inception rows; after it, on that year's carried-forward rows. Both are legitimately
   * "the opening" and they are usually different numbers, so a register that stayed silent
   * would read as a contradiction against last week's screenshot.
   */
  insights: (s) => ({
    items: [
      {
        key: 'basis',
        label:
          s.basis === 'carry_forward'
            ? 'Carried forward into this year'
            : 'Company inception opening',
        hint:
          s.basis === 'carry_forward'
            ? 'The year-end close has run into this financial year, so its own opening rows are the authority.'
            : 'No year-end close has run into this financial year yet, so the company inception opening applies.',
        icon: CalendarClock,
        tone: 'primary' as const,
      },
      {
        key: 'spread',
        label: s.warehouses ? `${formatInt(s.warehouses)} warehouses` : 'Entered company-wide',
        hint: `${formatInt(s.lines)} opening rows behind ${formatInt(s.items)} items.`,
        icon: Warehouse,
        tone: 'info' as const,
      },
      ...(s.unvalued_items
        ? [
            {
              key: 'unvalued',
              label: `${formatInt(s.unvalued_items)} items opened with no rate`,
              hint: `${formatQty(s.unvalued_qty)} held and valued at nil — the usual reason an Inventory opening sits below the Books one.`,
              icon: AlertTriangle,
              tone: 'warning' as const,
              to: '/reports/opening-stock?unvalued=1',
            },
          ]
        : []),
    ],
    note:
      'This total is the figure the reconciliation tab compares with Books’ Stock-in-Hand opening.',
  }),
  emptyTitle: 'No opening stock matches these filters',
  emptyMessage: 'Clear a filter, or choose another warehouse, and the opening rows will appear.',
  emptyUnfiltered: (
    <EmptyState
      icon={PackageOpen}
      title="This financial year opens at nil"
      description="No opening stock has been entered for any item. Enter it on an item’s Opening tab, or run the year-end carry forward to bring last year’s closing stock in."
    />
  ),
}

/** `master_inception` / `carry_forward` as a reader would say it. */
function sourceLabel(kind: string): string {
  return kind === 'carry_forward'
    ? 'Carry forward'
    : kind === 'master_inception'
      ? 'Inception'
      : kind === 'opening_document'
        ? 'Opening document'
        : kind
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
