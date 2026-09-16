import {
  BookmarkCheck,
  Boxes,
  Clock,
  Coins,
  Layers,
  Package,
  Scale,
  ScrollText,
  Warehouse,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAccess } from '../../access/AccessContext'
import { P } from '../../services/access'
import { reconciliationApi } from '../../services/reconciliationApi'
import type { ReconciliationRun } from '../../services/reconciliationApi'
import { pendingApi, reservationsApi } from '../../services/stockApi'
import type { PendingRow, Reservation } from '../../services/stockApi'
import { METHOD_LABELS, REPORT_METHODS, valuationApi } from '../../services/valuationApi'
import type {
  ReportMethod,
  ValuationSnapshotRow,
  ValuationSnapshotSummary,
} from '../../services/valuationApi'
import { labelForCode } from '../../documents/registry'
import { StatusBadge } from '../../ui/StatusBadge'
import { formatInt, formatMoney, formatQty, humanize } from '../../utils/format'
import {
  DASH,
  dateColumn,
  dateTimeColumn,
  itemFilter,
  moneyColumn,
  qtyColumn,
  textColumn,
  warehouseFilter,
} from '../../reports/configs/common'
import { RowActionsMenu } from '../../ui/RowActionsMenu'
import type { RowAction } from '../../ui/RowActionsMenu'
import { buildTotalsRow, totalsLabel } from '../registerTotals'
import { defineRegister } from '../RegisterConfig'
import type { ReportColumn } from '../RegisterConfig'
import { ValuationAnalytics } from '../valuation/ValuationAnalytics'
import { ValuationHeaderActions } from '../valuation/ValuationHeaderActions'
import { ValuationSelectionActions } from '../valuation/ValuationSelectionActions'
import { ValuationTableToolbar } from '../valuation/ValuationTableToolbar'
import { WarehouseScopeHint, WarehouseScopeValue } from '../valuation/WarehouseScopeValue'
import { pageHint, summaryOverRows, withPageSummary } from './pageSummary'
import type { PageSummary } from './pageSummary'

function documentCell(id: number | null | undefined, no: string | null | undefined) {
  if (!id) return DASH
  return (
    <Link
      to={`/documents/${id}`}
      className="font-medium text-primary hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {no ?? `#${id}`}
    </Link>
  )
}

/* ---------------------------------------------------- valuation register */

/**
 * Closing quantity, unit cost and value per item at a date.
 *
 * The method filter is the point: the same stock costed FIFO, LIFO, weighted
 * average or exactly as each item master prescribes, so a reader can see what
 * the choice is worth before it is made.
 */
/**
 * The register's columns, named so the selection export can write exactly what
 * the table shows rather than a second, drifting list of its own.
 */
const VALUATION_COLUMNS: ReportColumn<ValuationSnapshotRow>[] = [
  {
    key: 'item_sku',
    header: 'Item code',
    configureHint: 'The code on the item master.',
    minWidth: 110,
    render: (r) =>
      r.item_sku ? (
        <span className="font-medium tabular-nums text-gray-600">{r.item_sku}</span>
      ) : (
        DASH
      ),
    csv: (r) => r.item_sku ?? '',
  },
  {
    key: 'item_name',
    header: 'Item name',
    sortKey: 'item_name',
    alwaysVisible: true,
    minWidth: 200,
    render: (r) => (
      <Link
        to={`/valuation/cost-layers?item_id=${r.item_id}`}
        className="text-gray-900 hover:text-primary"
        onClick={(e) => e.stopPropagation()}
      >
        <strong className="font-semibold">{r.item_name ?? `Item #${r.item_id}`}</strong>
        {r.item_alias ? <span className="text-gray-400"> · {r.item_alias}</span> : null}
      </Link>
    ),
    csv: (r) => r.item_name ?? `Item #${r.item_id}`,
  },
  textColumn<ValuationSnapshotRow>('unit_symbol', 'Unit', false),
  {
    key: 'valuation_method',
    header: 'Item method',
    configureHint: 'What the item master asks for.',
    render: (r) => r.valuation_method ?? <span className="text-gray-400">company default</span>,
    csv: (r) => r.valuation_method ?? '',
  },
  qtyColumn<ValuationSnapshotRow>('closing_qty', 'Closing qty', { strong: true }),
  moneyColumn<ValuationSnapshotRow>('unit_cost', 'Unit cost'),
  moneyColumn<ValuationSnapshotRow>('stock_value', 'Stock value', { strong: true }),
  {
    key: 'valuation_method_applied',
    header: 'Applied',
    configureHint: 'What was actually used — differs when an item has no layers.',
    render: (r) => r.valuation_method_applied ?? DASH,
  },
]

export const valuationRegister = defineRegister<ValuationSnapshotRow, ValuationSnapshotSummary>({
  slug: 'valuation',
  path: 'valuation',
  title: 'Valuation register',
  description:
    'Item-wise stock valuation as at the selected date, under the valuation method you choose',
  shortDescription: 'Closing value per item, any method, any date',
  group: 'valuation',
  icon: Coins,
  defaultSort: 'item_name',
  minWidth: 1080,
  rowNoun: 'item',
  filenameBase: 'valuation',
  // Read as a workspace, not as a list: the header names it, the filters are
  // the question rather than a refinement of it, and the analytics band answers
  // what no single row can. See RegisterConfig.layout.
  layout: 'workspace',
  defaultLimit: 50,
  headerActions: <ValuationHeaderActions />,
  // The snapshot endpoint already answers a real summary; it just does not
  // label itself, so the envelope is completed here.
  fetch: async ({ query, signal }) => ({
    ...(await valuationApi.snapshot(query, signal)),
    report: 'valuation',
  }),
  filters: [
    { key: 'as_of', kind: 'date', label: 'As at', defaultValue: (c) => c.today },
    {
      key: 'method',
      kind: 'select',
      label: 'Method',
      // Exactly the four ValuationController::REPORT_METHODS. A fifth option
      // here would be a 422 from the API dressed up as a feature.
      options: REPORT_METHODS.map((m: ReportMethod) => ({ value: m, label: METHOD_LABELS[m] })),
      defaultValue: () => 'AS_PER_MASTER',
    },
    { ...itemFilter, placeholder: 'Search item code or name…' },
    { ...warehouseFilter, placeholder: 'Whole company' },
  ],
  columns: VALUATION_COLUMNS,
  rowKey: (r) => r.item_id,
  // Ticking rows answers "what are these worth together", which is the one
  // question a register cannot answer by being read down. Nothing here writes:
  // the actions are a subtotal and a file.
  selectable: {
    idOf: (r) => r.item_id,
    label: 'Select item',
    actions: (selected, _clear, summary) => (
      <ValuationSelectionActions rows={selected} summary={summary} columns={VALUATION_COLUMNS} />
    ),
  },
  // A control, not a column — so it never reaches a CSV or a printed sheet.
  rowActions: (r) => <ValuationRowActions row={r} />,
  // The cost layers are the working behind the number, so that is where a
  // disputed valuation gets settled.
  drillTo: (r) => `/valuation/cost-layers?item_id=${r.item_id}`,
  totals: (s) =>
    buildTotalsRow(
      [
        { key: 'item_sku' },
        { key: 'item_name' },
        { key: 'unit_symbol' },
        { key: 'valuation_method' },
        { key: 'closing_qty', align: 'right' },
        { key: 'unit_cost', align: 'right' },
        { key: 'stock_value', align: 'right' },
        { key: 'valuation_method_applied' },
      ],
      { closing_qty: formatQty(s.total_qty), stock_value: formatMoney(s.total_value) },
      { label: totalsLabel(s.item_count, 'item'), labelKey: 'item_name' },
    ),
  // The "Group by" control. Both groupings are over the rows on screen — the
  // engine says so in each subtotal's own label, and the pinned footer stays the
  // authority on the whole filtered set.
  groupBy: [
    {
      key: 'valuation_method_applied',
      label: 'Applied method',
      of: (r) => ({
        key: r.valuation_method_applied ?? 'unknown',
        label: r.valuation_method_applied ?? 'No method applied',
      }),
      subtotal: (rows, group) =>
        buildTotalsRow(
          [
            { key: 'item_sku' },
            { key: 'item_name' },
            { key: 'closing_qty', align: 'right' },
            { key: 'stock_value', align: 'right' },
          ],
          {
            closing_qty: formatQty(rows.reduce((a, r) => a + r.closing_qty, 0)),
            stock_value: formatMoney(rows.reduce((a, r) => a + r.stock_value, 0)),
          },
          {
            label: `${group.label} · ${totalsLabel(rows.length, 'item')} on this page`,
            labelKey: 'item_name',
          },
        ),
    },
    {
      key: 'valuation_method',
      label: 'Item method',
      of: (r) => ({
        key: r.valuation_method ?? 'default',
        label: r.valuation_method ?? 'Company default',
      }),
      subtotal: (rows, group) =>
        buildTotalsRow(
          [
            { key: 'item_sku' },
            { key: 'item_name' },
            { key: 'closing_qty', align: 'right' },
            { key: 'stock_value', align: 'right' },
          ],
          {
            closing_qty: formatQty(rows.reduce((a, r) => a + r.closing_qty, 0)),
            stock_value: formatMoney(rows.reduce((a, r) => a + r.stock_value, 0)),
          },
          {
            label: `${group.label} · ${totalsLabel(rows.length, 'item')} on this page`,
            labelKey: 'item_name',
          },
        ),
    },
  ],
  // No delta chips: `/v1/valuation` answers one date at a time and sends no
  // comparative, so a card here has nothing honest to compare against. The
  // movement between dates is in the trend chart below, where every point is a
  // date the server was actually asked about.
  kpis: (s) => [
    {
      key: 'items',
      label: 'Total items',
      value: formatInt(s.item_count),
      hint: 'Items with stock on hand',
      icon: Package,
      tone: 'primary',
    },
    {
      key: 'qty',
      label: 'Total quantity',
      value: formatQty(s.total_qty),
      hint: 'Units in stock',
      icon: Boxes,
      tone: 'info',
    },
    {
      key: 'value',
      label: 'Total stock value',
      value: formatMoney(s.total_value),
      hint: `As at ${s.as_of} · ${METHOD_LABELS[s.method as ReportMethod] ?? s.method}`,
      icon: Coins,
      tone: 'violet',
      current: s.total_value,
      emphasizeNegative: true,
    },
    {
      key: 'warehouses',
      label: 'Warehouses',
      value: <WarehouseScopeValue />,
      hint: <WarehouseScopeHint />,
      icon: Warehouse,
      tone: 'warning',
    },
  ],
  // The table's own heading, in the slot the engine already renders above it.
  extra: (s) => <ValuationTableToolbar summary={s} />,
  analytics: ({ summary, values, loading }) => (
    <ValuationAnalytics
      summary={summary}
      loading={loading}
      filters={{
        asOf: values.as_of ?? '',
        method: values.method ?? 'AS_PER_MASTER',
        itemId: values.item_id ?? '',
        warehouseId: values.warehouse_id ?? '',
      }}
    />
  ),
  summary: (s) => [
    { label: 'As at', value: s.as_of, hint: METHOD_LABELS[s.method as ReportMethod] ?? s.method },
    { label: 'Items', value: formatInt(s.item_count) },
    { label: 'Total qty', value: formatQty(s.total_qty) },
    { label: 'Total value', value: formatMoney(s.total_value), tone: 'good' },
  ],
  emptyMessage:
    'No stock valuation is available for the selected date and filters. Widen the date or clear a filter and try again.',
})

/**
 * The row menu: the four places a valuation figure can be taken apart.
 *
 * Every entry is a screen that exists and a filter the destination actually
 * reads — the warehouse breakup is the warehouse-stock register narrowed to
 * this item at this date, not a view invented for the menu. Each is gated on
 * the permission its destination is gated on, so the menu never offers a door
 * that answers 403.
 */
function ValuationRowActions({ row }: { row: ValuationSnapshotRow }) {
  const { can } = useAccess()
  const asOf = useSearchParams()[0].get('as_of') ?? ''
  const name = row.item_name ?? `Item #${row.item_id}`
  const dated = (key: string) => (asOf ? `&${key}=${asOf}` : '')

  const actions: RowAction[] = []
  if (can(P.report('valuation'))) {
    actions.push({
      key: 'layers',
      label: 'View cost layers',
      icon: Layers,
      to: `/valuation/cost-layers?item_id=${row.item_id}`,
    })
  }
  if (can(P.report('stock_ledger'))) {
    actions.push({
      key: 'ledger',
      label: 'Movement history',
      icon: ScrollText,
      to: `/registers/stock-ledger?item_id=${row.item_id}${dated('to')}`,
    })
  }
  if (can(P.report('warehouse_stock'))) {
    actions.push({
      key: 'warehouses',
      label: 'Warehouse breakup',
      icon: Warehouse,
      to: `/registers/warehouse-stock?item_id=${row.item_id}${dated('to')}`,
    })
  }
  if (can(P.masters('items', 'read'))) {
    actions.push({
      key: 'item',
      label: 'Open item',
      icon: Package,
      to: `/items/${row.item_id}`,
    })
  }

  if (actions.length === 0) return null
  return <RowActionsMenu actions={actions} label={`Actions for ${name}`} />
}

/* -------------------------------------------------- reservation register */

const RESERVATION_SUM_KEYS = ['qty', 'fulfilled_qty', 'open_qty'] as const

/**
 * Soft allocations of available stock to an order or an invoice draft.
 *
 * Read-only on purpose: creating, releasing and fulfilling a reservation is an
 * operational action and stays on `/reservations`, which keeps its dialogs.
 * This is the register — the dated, totalled, printable view of the same rows.
 */
export const reservationRegister = defineRegister<Reservation, PageSummary>({
  slug: 'reservations',
  path: 'reservations',
  title: 'Reservation register',
  description:
    'Every soft allocation of stock — what is reserved, what has been fulfilled and what is still open',
  shortDescription: 'Reserved, fulfilled and open allocations',
  group: 'compliance',
  icon: BookmarkCheck,
  permission: ['documents.reservation.read', P.documentsRead],
  defaultSort: 'created_at',
  defaultOrder: 'desc',
  minWidth: 1300,
  rowNoun: 'reservation',
  filenameBase: 'reservations',
  fetch: async ({ query, signal }) =>
    withPageSummary(
      await reservationsApi.list(query, signal),
      'reservations',
      RESERVATION_SUM_KEYS,
    ),
  summaryForRows: (s, rows) => summaryOverRows(s, rows, RESERVATION_SUM_KEYS),
  toQuery: (values) => {
    const { status, ...rest } = values
    // "Open" is the default view and is a different parameter from a status
    // filter, so the two must not be sent together.
    return status && status !== 'open' ? { ...rest, status } : { ...rest, open: 1 }
  },
  filters: [
    {
      key: 'status',
      kind: 'select',
      label: 'Status',
      placeholder: 'Open (active, partial)',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'partial', label: 'Partially fulfilled' },
        { value: 'fulfilled', label: 'Fulfilled' },
        { value: 'released', label: 'Released' },
        { value: 'expired', label: 'Expired' },
      ],
    },
    itemFilter,
    warehouseFilter,
    { key: 'expired', kind: 'toggle', label: 'Past their expiry', defaultOn: false },
    { key: 'all_fy', kind: 'toggle', label: 'All years', defaultOn: false },
  ],
  columns: [
    {
      key: 'item_name',
      header: 'Item',
      sortKey: 'item_name',
      alwaysVisible: true,
      minWidth: 180,
      render: (r) => (
        <span>
          <strong className="font-semibold text-gray-900">{r.item_name ?? `Item #${r.item_id}`}</strong>
          {r.item_sku ? <span className="text-gray-400"> · {r.item_sku}</span> : null}
        </span>
      ),
      csv: (r) => r.item_name ?? `Item #${r.item_id}`,
    },
    {
      key: 'warehouse_name',
      header: 'Warehouse',
      sortKey: 'warehouse_name',
      render: (r) => r.warehouse_name ?? (r.warehouse_id ? `#${r.warehouse_id}` : <span className="text-gray-400">any</span>),
      csv: (r) => r.warehouse_name ?? '',
    },
    textColumn<Reservation>('batch_no', 'Batch', false),
    {
      ...qtyColumn<Reservation>('qty', 'Reserved'),
      render: (r) => `${formatQty(r.qty)} ${r.unit_symbol ?? ''}`,
      csv: (r) => r.qty,
    },
    qtyColumn<Reservation>('fulfilled_qty', 'Fulfilled'),
    { ...qtyColumn<Reservation>('open_qty', 'Open', { strong: true }), alwaysVisible: true },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      render: (r) => (
        <StatusBadge
          value={r.is_expired ? 'expired' : r.status}
          tone={r.is_expired ? 'critical' : r.status === 'active' ? 'good' : r.status === 'partial' ? 'info' : 'neutral'}
        />
      ),
      csv: (r) => (r.is_expired ? 'expired' : r.status),
    },
    dateTimeColumn<Reservation>('expires_at', 'Expires'),
    {
      key: 'source',
      header: 'Source',
      render: (r) =>
        r.source_document_type
          ? `${r.source_app} · ${r.source_document_type}${r.source_document_id ? ` #${r.source_document_id}` : ''}`
          : r.document_id
            ? documentCell(r.document_id, `document #${r.document_id}`)
            : <span className="text-gray-400">{r.source_app}</span>,
      csv: (r) =>
        r.source_document_type
          ? `${r.source_app} ${r.source_document_type} ${r.source_document_id ?? ''}`.trim()
          : r.source_app,
    },
    dateTimeColumn<Reservation>('created_at', 'Created'),
  ],
  rowKey: (r) => r.reservation_id,
  drillTo: (r) => (r.document_id ? `/documents/${r.document_id}` : null),
  totals: (s) =>
    buildTotalsRow(
      [
        { key: 'item_name' },
        { key: 'qty', align: 'right' },
        { key: 'fulfilled_qty', align: 'right' },
        { key: 'open_qty', align: 'right' },
      ],
      {
        qty: formatQty(s.sums.qty),
        fulfilled_qty: formatQty(s.sums.fulfilled_qty),
        open_qty: formatQty(s.sums.open_qty),
      },
      { label: `${totalsLabel(s.pageRows, 'reservation')} — ${pageHint(s)}`, labelKey: 'item_name' },
    ),
  kpis: (s) => [
    { key: 'rows', label: 'Reservations', value: formatInt(s.total), icon: BookmarkCheck, tone: 'primary' },
    { key: 'qty', label: 'Reserved', value: formatQty(s.sums.qty), hint: pageHint(s), icon: BookmarkCheck, tone: 'info' },
    {
      key: 'fulfilled',
      label: 'Fulfilled',
      value: formatQty(s.sums.fulfilled_qty),
      hint: pageHint(s),
      icon: BookmarkCheck,
      tone: 'success',
    },
    {
      key: 'open',
      label: 'Still open',
      value: formatQty(s.sums.open_qty),
      hint: pageHint(s),
      icon: BookmarkCheck,
      tone: 'warning',
    },
  ],
  summary: (s) => [
    { label: 'Reservations', value: formatInt(s.total) },
    { label: 'Reserved', value: formatQty(s.sums.qty), hint: pageHint(s) },
    { label: 'Open', value: formatQty(s.sums.open_qty), hint: pageHint(s), tone: 'warning' },
  ],
  rowClassName: (r) => (r.is_expired ? 'bg-red-50/60' : undefined),
  emptyMessage: 'No reservations match these filters.',
})

/* ------------------------------------------------------- pending register */

const PENDING_SUM_KEYS = ['qty_original', 'qty_settled', 'qty_open'] as const

interface PendingSummary extends PageSummary {
  /** The server's own total over the whole filtered set. */
  qtyOpenAll: number
}

/**
 * Goods out on challan, in on inward challan, with a job worker, or invoiced
 * and not yet received.
 *
 * Unlike the other plain list endpoints this one does send a real aggregate
 * (`summary.qty_open` over the whole filtered set), so the open-quantity KPI is
 * the true figure and only the two supporting columns are page sums.
 */
export const pendingRegister = defineRegister<PendingRow, PendingSummary>({
  slug: 'pending_quantities',
  path: 'pending-quantities',
  title: 'Pending quantity register',
  description:
    'Goods out on challan, in on inward challan, with a job worker, or invoiced but not received',
  shortDescription: 'Everything issued or expected and not yet settled',
  group: 'compliance',
  icon: Clock,
  permission: P.documentsRead,
  // listOpen() is deliberately not FY-scoped — see PendingQuantityService.
  scopePeriod: 'All financial years',
  defaultSort: 'document_date',
  minWidth: 1300,
  rowNoun: 'line',
  filenameBase: 'pending-quantities',
  fetch: async ({ query, signal }) => {
    const res = await pendingApi.list(query, signal)
    const base = withPageSummary(res, 'pending_quantities', PENDING_SUM_KEYS)
    return { ...base, summary: { ...base.summary, qtyOpenAll: res.summary?.qty_open ?? base.summary.sums.qty_open } }
  },
  // The server's open-quantity total is already the whole set; only the two
  // supporting page sums are re-totalled for an export.
  summaryForRows: (s, rows) => summaryOverRows(s, rows, PENDING_SUM_KEYS),
  filters: [
    {
      key: 'kind',
      kind: 'select',
      label: 'Kind',
      placeholder: 'All kinds',
      options: [
        { value: 'challan', label: 'Challan' },
        { value: 'deferred_purchase', label: 'Deferred purchase' },
        { value: 'job_work', label: 'Job work' },
      ],
    },
    {
      key: 'direction',
      kind: 'select',
      label: 'Direction',
      placeholder: 'In and out',
      options: [
        { value: 'out', label: 'Out' },
        { value: 'in', label: 'In' },
      ],
    },
    itemFilter,
    warehouseFilter,
    { key: 'party_ref', kind: 'number', label: 'Party ledger', placeholder: 'id' },
  ],
  columns: [
    {
      key: 'document_no',
      header: 'Document',
      alwaysVisible: true,
      render: (r) => documentCell(r.document_id, r.document_no),
      csv: (r) => r.document_no ?? `#${r.document_id}`,
    },
    {
      key: 'document_type',
      header: 'Type',
      render: (r) => r.document_type_label ?? labelForCode(r.document_type),
      csv: (r) => r.document_type_label ?? r.document_type,
    },
    dateColumn<PendingRow>('document_date', 'Date'),
    {
      key: 'pending_kind',
      header: 'Kind',
      render: (r) => humanize(r.pending_kind),
      csv: (r) => r.pending_kind,
    },
    {
      key: 'direction',
      header: 'Dir.',
      render: (r) => <StatusBadge value={r.direction} tone={r.direction === 'in' ? 'good' : 'warning'} />,
      csv: (r) => r.direction,
    },
    {
      key: 'item_name',
      header: 'Item',
      alwaysVisible: true,
      minWidth: 180,
      render: (r) => (
        <Link
          to={`/registers/stock-ledger?item_id=${r.item_id}`}
          className="font-semibold text-gray-900 hover:text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          {r.item_name ?? `Item #${r.item_id}`}
        </Link>
      ),
      csv: (r) => r.item_name ?? `Item #${r.item_id}`,
    },
    textColumn<PendingRow>('warehouse_name', 'Warehouse', false),
    {
      key: 'party_ref',
      header: 'Party',
      render: (r) => (r.party_ref ? `#${r.party_ref}` : DASH),
      csv: (r) => r.party_ref,
    },
    qtyColumn<PendingRow>('qty_original', 'Original'),
    qtyColumn<PendingRow>('qty_settled', 'Settled'),
    {
      ...qtyColumn<PendingRow>('qty_open', 'Open', { strong: true }),
      alwaysVisible: true,
      render: (r) => (
        <strong className="font-semibold text-gray-900">
          {formatQty(r.qty_open)} {r.unit_symbol ?? ''}
        </strong>
      ),
      csv: (r) => r.qty_open,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge value={r.status} tone={r.status === 'partial' ? 'info' : 'warning'} />,
      csv: (r) => r.status,
    },
  ],
  rowKey: (r) => r.pending_id,
  drillTo: (r) => (r.document_id ? `/documents/${r.document_id}` : null),
  totals: (s) =>
    buildTotalsRow(
      [
        { key: 'document_no' },
        { key: 'qty_original', align: 'right' },
        { key: 'qty_settled', align: 'right' },
        { key: 'qty_open', align: 'right' },
      ],
      {
        qty_original: formatQty(s.sums.qty_original),
        qty_settled: formatQty(s.sums.qty_settled),
        // The one figure on this row that covers the whole filtered set.
        qty_open: formatQty(s.qtyOpenAll),
      },
      { label: totalsLabel(s.total, 'line'), labelKey: 'document_no' },
    ),
  kpis: (s) => [
    { key: 'rows', label: 'Open lines', value: formatInt(s.total), icon: Clock, tone: 'primary' },
    {
      key: 'open',
      label: 'Open quantity',
      value: formatQty(s.qtyOpenAll),
      hint: 'all matching rows',
      icon: Clock,
      tone: 'warning',
    },
    {
      key: 'settled',
      label: 'Settled so far',
      value: formatQty(s.sums.qty_settled),
      hint: pageHint(s),
      icon: Clock,
      tone: 'success',
    },
  ],
  summary: (s) => [
    { label: 'Open lines', value: formatInt(s.total) },
    { label: 'Open quantity', value: formatQty(s.qtyOpenAll), tone: 'warning' },
  ],
  emptyMessage: 'Nothing is pending.',
})

/* ------------------------------------------------ reconciliation register */

export function differenceTone(difference: number | null): 'good' | 'warning' | 'critical' | 'neutral' {
  if (difference === null) return 'neutral'
  const abs = Math.abs(difference)
  return abs < 0.005 ? 'good' : abs < 1 ? 'warning' : 'critical'
}

const RECONCILIATION_SUM_KEYS = ['difference'] as const

const RUN_STATUS_TONE: Record<string, 'good' | 'critical' | 'warning'> = {
  COMPLETED: 'good',
  FAILED: 'critical',
  BOOKS_UNAVAILABLE: 'warning',
}

/**
 * Every Inventory ↔ Books reconciliation run, kept for the audit trail.
 *
 * Read-only: "Run now" is an action and stays on `/reconciliation`. A row opens
 * the run, where the difference is explained bucket by bucket.
 */
export const reconciliationRegister = defineRegister<ReconciliationRun, PageSummary>({
  slug: 'reconciliation',
  path: 'reconciliation-runs',
  title: 'Reconciliation register',
  description:
    'Every comparison of Inventory’s closing stock value with the Stock-in-Hand ledger in Books, and the gap each one found',
  shortDescription: 'Inventory vs Books, run by run',
  group: 'compliance',
  icon: Scale,
  permission: P.reconciliationRead,
  defaultSort: 'created_at',
  defaultOrder: 'desc',
  minWidth: 1100,
  rowNoun: 'run',
  filenameBase: 'reconciliation-runs',
  fetch: async ({ query, signal }) =>
    withPageSummary(
      await reconciliationApi.runs(query, signal),
      'reconciliation_runs',
      RECONCILIATION_SUM_KEYS,
    ),
  summaryForRows: (s, rows) => summaryOverRows(s, rows, RECONCILIATION_SUM_KEYS),
  filters: [
    {
      key: 'status',
      kind: 'select',
      label: 'Status',
      placeholder: 'All statuses',
      options: [
        { value: 'COMPLETED', label: 'Completed' },
        { value: 'FAILED', label: 'Failed' },
        { value: 'BOOKS_UNAVAILABLE', label: 'Books unavailable' },
      ],
    },
    {
      key: 'from',
      toKey: 'to',
      kind: 'date_range',
      label: 'Run between',
    },
    // The visible control owns both dates; `to` is still declared so it is a
    // first-class URL key rather than one hidden inside another filter.
    { key: 'to', kind: 'date', label: 'To', hidden: true },
    { key: 'all_fy', kind: 'toggle', label: 'All years', defaultOn: false },
  ],
  columns: [
    {
      key: 'run_id',
      header: '#',
      sortKey: 'run_id',
      alwaysVisible: true,
      align: 'right',
      render: (r) => (
        <Link
          to={`/reconciliation/${r.run_id}`}
          className="font-medium text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {r.run_id}
        </Link>
      ),
      csv: (r) => r.run_id,
    },
    dateColumn<ReconciliationRun>('as_of_date', 'As at'),
    dateTimeColumn<ReconciliationRun>('created_at', 'Run'),
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge value={r.status} tone={RUN_STATUS_TONE[r.status] ?? 'neutral'} />,
      csv: (r) => r.status,
    },
    qtyColumn<ReconciliationRun>('inventory_closing_qty', 'Inventory qty'),
    moneyColumn<ReconciliationRun>('inventory_closing_value', 'Inventory value'),
    moneyColumn<ReconciliationRun>('books_stock_ledger_balance', 'Books stock ledger'),
    {
      key: 'difference',
      header: 'Difference',
      align: 'right',
      sortKey: 'difference',
      alwaysVisible: true,
      format: 'amount',
      amount: true,
      render: (r) => <StatusBadge value={formatMoney(r.difference)} tone={differenceTone(r.difference)} />,
      csv: (r) => r.difference,
    },
    {
      key: 'requested_by',
      header: 'By',
      render: (r) => r.requested_by ?? <span className="text-gray-400">scheduled</span>,
      csv: (r) => r.requested_by ?? 'scheduled',
    },
  ],
  rowKey: (r) => r.run_id,
  drillTo: (r) => `/reconciliation/${r.run_id}`,
  kpis: (s) => [
    { key: 'runs', label: 'Runs', value: formatInt(s.total), icon: Scale, tone: 'primary' },
    {
      key: 'net_difference',
      label: 'Net difference',
      value: formatMoney(s.sums.difference),
      hint: pageHint(s),
      icon: Scale,
      tone: Math.abs(s.sums.difference) < 0.005 ? 'success' : 'warning',
      current: s.sums.difference,
      emphasizeNegative: true,
    },
  ],
  summary: (s) => [
    { label: 'Runs', value: formatInt(s.total) },
    {
      label: 'Net difference',
      value: formatMoney(s.sums.difference),
      hint: pageHint(s),
      tone: Math.abs(s.sums.difference) < 0.005 ? 'good' : 'warning',
    },
  ],
  emptyMessage: 'No reconciliation has been run yet.',
})
