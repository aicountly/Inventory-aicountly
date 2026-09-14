import { BookmarkCheck, Clock, Coins, Scale } from 'lucide-react'
import { Link } from 'react-router-dom'
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
import { buildTotalsRow, totalsLabel } from '../registerTotals'
import { defineRegister } from '../RegisterConfig'
import { pageHint, withPageSummary } from './pageSummary'
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
export const valuationRegister = defineRegister<ValuationSnapshotRow, ValuationSnapshotSummary>({
  slug: 'valuation',
  path: 'valuation',
  title: 'Valuation register',
  description:
    'Closing quantity, unit cost and value per item as at a date, under the valuation method you choose',
  shortDescription: 'Closing value per item, any method, any date',
  group: 'valuation',
  icon: Coins,
  defaultSort: 'item_name',
  minWidth: 1000,
  rowNoun: 'item',
  filenameBase: 'valuation',
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
      options: REPORT_METHODS.map((m: ReportMethod) => ({ value: m, label: METHOD_LABELS[m] })),
      defaultValue: () => 'AS_PER_MASTER',
    },
    itemFilter,
    { ...warehouseFilter, placeholder: 'Whole company' },
  ],
  columns: [
    {
      key: 'item_name',
      header: 'Item',
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
          {r.item_sku ? <span className="text-gray-400"> · {r.item_sku}</span> : null}
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
  ],
  rowKey: (r) => r.item_id,
  // The cost layers are the working behind the number, so that is where a
  // disputed valuation gets settled.
  drillTo: (r) => `/valuation/cost-layers?item_id=${r.item_id}`,
  totals: (s) =>
    buildTotalsRow(
      [
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
  kpis: (s) => [
    {
      key: 'as_of',
      label: 'As at',
      value: s.as_of,
      hint: METHOD_LABELS[s.method as ReportMethod] ?? s.method,
      icon: Scale,
      tone: 'slate',
    },
    { key: 'items', label: 'Items', value: formatInt(s.item_count), icon: Coins, tone: 'primary' },
    { key: 'qty', label: 'Total qty', value: formatQty(s.total_qty), icon: Coins, tone: 'info' },
    {
      key: 'value',
      label: 'Total value',
      value: formatMoney(s.total_value),
      icon: Coins,
      tone: 'success',
      current: s.total_value,
      emphasizeNegative: true,
    },
  ],
  summary: (s) => [
    { label: 'As at', value: s.as_of, hint: METHOD_LABELS[s.method as ReportMethod] ?? s.method },
    { label: 'Items', value: formatInt(s.item_count) },
    { label: 'Total qty', value: formatQty(s.total_qty) },
    { label: 'Total value', value: formatMoney(s.total_value), tone: 'good' },
  ],
  emptyMessage: 'No stock on hand at this date.',
})

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
  defaultSort: 'document_date',
  minWidth: 1300,
  rowNoun: 'line',
  filenameBase: 'pending-quantities',
  fetch: async ({ query, signal }) => {
    const res = await pendingApi.list(query, signal)
    const base = withPageSummary(res, 'pending_quantities', PENDING_SUM_KEYS)
    return { ...base, summary: { ...base.summary, qtyOpenAll: res.summary?.qty_open ?? base.summary.sums.qty_open } }
  },
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
