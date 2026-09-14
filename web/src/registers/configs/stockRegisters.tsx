import { ArrowLeftRight, BookOpen, Scale, Warehouse } from 'lucide-react'
import { Link } from 'react-router-dom'
import { P } from '../../services/access'
import { stockBalancesApi, stockLedgerApi, stockMovementsApi } from '../../services/stockViewsApi'
import type {
  LedgerResponse,
  LedgerRow,
  LedgerSummary,
  StockBalanceGridRow,
  StockMovementRow,
} from '../../services/stockViewsApi'
import type { LedgerQuery } from '../../services/stockViewsApi'
import { StatusBadge } from '../../ui/StatusBadge'
import { formatInt, formatMoney, formatQty } from '../../utils/format'
import {
  DASH,
  batchFilter,
  dateColumn,
  dateTimeColumn,
  itemFilter,
  moneyColumn,
  periodFilter,
  qtyColumn,
  textColumn,
  warehouseFilter,
} from '../../reports/configs/common'
import { buildTotalsRow, totalsLabel } from '../registerTotals'
import { defineRegister } from '../RegisterConfig'
import { pageHint, summaryOverRows, withPageSummary } from './pageSummary'
import type { PageSummary } from './pageSummary'

/* ------------------------------------------------------------------ helpers */

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

function itemCell(
  itemId: number,
  name: string | null | undefined,
  sku?: string | null,
  warehouseId?: number | null,
) {
  const qs = new URLSearchParams({ item_id: String(itemId) })
  if (warehouseId) qs.set('warehouse_id', String(warehouseId))
  return (
    <Link
      to={`/registers/stock-ledger?${qs.toString()}`}
      className="text-gray-900 hover:text-primary"
      onClick={(e) => e.stopPropagation()}
    >
      <strong className="font-semibold">{name ?? `Item #${itemId}`}</strong>
      {sku ? <span className="text-gray-400"> · {sku}</span> : null}
    </Link>
  )
}

function movementKindCell(kind: string) {
  if (kind === 'physical') return <span className="text-gray-400">physical</span>
  return <StatusBadge value={kind} tone={kind === 'reversal' ? 'warning' : 'info'} />
}

/* ------------------------------------------------------------- stock ledger */

/**
 * The stock ledger — one item, every movement, a running balance.
 *
 * This is the register a stock question actually gets settled with, and the one
 * Books readers will look for first. Opening comes from the FY opening plus
 * everything dated before the period, so the running balance on the first line
 * is the real one, not a partial sum of the page.
 *
 * Only the date column sorts, and only by flipping direction: the balance is a
 * running total accumulated in movement sequence (ReportsController::
 * STOCK_LEDGER_SORTABLE), so re-ordering by rate or value would leave a balance
 * column that is the sum of no particular thing.
 */
export const stockLedgerRegister = defineRegister<LedgerRow, LedgerSummary>({
  slug: 'stock_ledger',
  path: 'stock-ledger',
  title: 'Stock ledger',
  description:
    'Every movement of one item with its running quantity and value, opening to closing',
  shortDescription: 'One item, every movement, running balance',
  group: 'movement',
  icon: BookOpen,
  defaultSort: 'movement_date',
  defaultOrder: 'asc',
  minWidth: 1500,
  rowNoun: 'movement',
  filenameBase: 'stock-ledger',
  requireFilters: ['item_id'],
  requireFiltersMessage: 'Pick an item to run its ledger',
  fetch: ({ query, signal }) => stockLedgerApi.get(query as unknown as LedgerQuery, signal),
  filters: [itemFilter, warehouseFilter, ...periodFilter],
  columns: [
    { ...dateColumn<LedgerRow>('movement_date', 'Date'), alwaysVisible: true, minWidth: 96 },
    {
      key: 'document_no',
      header: 'Document',
      alwaysVisible: true,
      render: (r) => documentCell(r.document_id, r.document_no),
      csv: (r) => r.document_no ?? `#${r.document_id}`,
    },
    {
      key: 'document_type_label',
      header: 'Type',
      render: (r) => r.document_type_label ?? r.document_type,
      csv: (r) => r.document_type_label ?? r.document_type,
    },
    {
      key: 'source_app',
      header: 'Source',
      configureHint: 'The product the document came from (Books, Sales, POS…).',
      render: (r) =>
        r.source_app ? (
          <span className="text-gray-600">
            {r.source_app}
            {r.source_document_no ? ` · ${r.source_document_no}` : ''}
          </span>
        ) : (
          DASH
        ),
      csv: (r) => (r.source_app ? `${r.source_app} ${r.source_document_no ?? ''}`.trim() : ''),
    },
    {
      key: 'party_name',
      header: 'Party / narration',
      minWidth: 160,
      render: (r) => r.party_name ?? r.narration ?? DASH,
      csv: (r) => r.party_name ?? r.narration ?? '',
    },
    textColumn<LedgerRow>('warehouse_name', 'Warehouse', false),
    textColumn<LedgerRow>('batch_no', 'Batch', false),
    {
      ...qtyColumn<LedgerRow>('in_qty', 'In', { sortable: false }),
      render: (r) => (r.in_qty ? <span className="text-emerald-700">{formatQty(r.in_qty)}</span> : ''),
    },
    {
      ...qtyColumn<LedgerRow>('out_qty', 'Out', { sortable: false }),
      render: (r) => (r.out_qty ? <span className="text-red-600">{formatQty(r.out_qty)}</span> : ''),
    },
    { ...moneyColumn<LedgerRow>('unit_cost', 'Rate', { sortable: false }), configureHint: 'Discloses unit cost.' },
    moneyColumn<LedgerRow>('value', 'Value', { sortable: false }),
    { ...qtyColumn<LedgerRow>('balance_qty', 'Balance', { strong: true, sortable: false }), alwaysVisible: true },
    moneyColumn<LedgerRow>('balance_value', 'Balance value', { sortable: false }),
    {
      key: 'movement_kind',
      header: 'Kind',
      render: (r) => movementKindCell(r.movement_kind),
      csv: (r) => r.movement_kind,
    },
  ],
  rowKey: (r) => r.movement_id,
  // The document that caused the line is the only place a "why is this here?"
  // question can be answered, so the whole row opens it.
  drillTo: (r) => (r.document_id ? `/documents/${r.document_id}` : null),
  totals: (s) =>
    buildTotalsRow(
      [
        { key: 'movement_date' },
        { key: 'document_no' },
        { key: 'document_type_label' },
        { key: 'source_app' },
        { key: 'party_name' },
        { key: 'warehouse_name' },
        { key: 'batch_no' },
        { key: 'in_qty', align: 'right' },
        { key: 'out_qty', align: 'right' },
        { key: 'unit_cost', align: 'right' },
        { key: 'value', align: 'right' },
        { key: 'balance_qty', align: 'right' },
        { key: 'balance_value', align: 'right' },
        { key: 'movement_kind' },
      ],
      {
        movement_date: `Closing · opening ${formatQty(s.opening_qty)}`,
        in_qty: formatQty(s.in_qty),
        out_qty: formatQty(s.out_qty),
        value: formatMoney(s.in_value - s.out_value),
        balance_qty: formatQty(s.closing_qty),
        balance_value: formatMoney(s.closing_value),
      },
      { labelKey: 'movement_date' },
    ),
  kpis: (s, response) => {
    // In and Out open the very movements they add up — same item, same
    // warehouse, same period, one direction. Opening and Closing are balances
    // rather than a set of rows, so they stay figures: a card that navigates
    // somewhere showing a different number is worse than one that does not
    // navigate at all.
    const itemId = (response as LedgerResponse).item?.item_id
    const movements = (direction: 'in' | 'out'): string | undefined => {
      if (!itemId) return undefined
      const qs = new URLSearchParams({ item_id: String(itemId), direction })
      if (s.warehouse_id) qs.set('warehouse_id', String(s.warehouse_id))
      if (s.from) qs.set('from', s.from)
      if (s.to) qs.set('to', s.to)
      return `/registers/movement-register?${qs.toString()}`
    }

    return [
    {
      key: 'opening',
      label: 'Opening',
      value: formatQty(s.opening_qty),
      hint: formatMoney(s.opening_value),
      icon: BookOpen,
      tone: 'slate',
    },
    { key: 'in', label: 'In', value: formatQty(s.in_qty), hint: formatMoney(s.in_value), icon: BookOpen, tone: 'success', to: movements('in') },
    { key: 'out', label: 'Out', value: formatQty(s.out_qty), hint: formatMoney(s.out_value), icon: BookOpen, tone: 'warning', to: movements('out') },
    {
      key: 'closing',
      label: 'Closing',
      value: formatQty(s.closing_qty),
      hint: formatMoney(s.closing_value),
      icon: BookOpen,
      tone: 'primary',
      current: s.closing_qty,
      emphasizeNegative: true,
    },
    ]
  },
  summary: (s) => [
    { label: 'Opening', value: formatQty(s.opening_qty), hint: formatMoney(s.opening_value) },
    { label: 'In', value: formatQty(s.in_qty), hint: formatMoney(s.in_value), tone: 'good' },
    { label: 'Out', value: formatQty(s.out_qty), hint: formatMoney(s.out_value), tone: 'warning' },
    { label: 'Closing', value: formatQty(s.closing_qty), hint: formatMoney(s.closing_value) },
  ],
  rowClassName: (r) => (r.movement_kind === 'reversal' ? 'bg-amber-50/60' : undefined),
  emptyMessage: 'No movements for this item in the period.',
})

/* ------------------------------------------------------- movement register */

const MOVEMENT_SUM_KEYS = ['qty', 'value'] as const

/**
 * Every posted movement in the year and branch, across all items.
 *
 * The companion to the ledger: the ledger answers "what happened to this
 * item", this answers "what happened on these days, from this source".
 */
export const movementRegister = defineRegister<StockMovementRow, PageSummary>({
  slug: 'stock_ledger',
  path: 'movement-register',
  // Shares its permission slug with the stock ledger but is a different grid,
  // so it needs its own column-preference key.
  columnPrefsKey: 'movement_register',
  title: 'Movement register',
  description:
    'Every posted movement in the year and branch — receipts, issues, reversals and revaluations, whichever product raised them',
  shortDescription: 'Every posted movement, any item, any source',
  group: 'movement',
  icon: ArrowLeftRight,
  permission: [P.report('stock_ledger'), P.documentsRead],
  defaultSort: 'movement_date',
  defaultOrder: 'desc',
  minWidth: 1500,
  rowNoun: 'movement',
  filenameBase: 'movement-register',
  fetch: async ({ query, signal }) =>
    withPageSummary(
      await stockMovementsApi.list(query, signal),
      'movement_register',
      MOVEMENT_SUM_KEYS,
    ),
  summaryForRows: (s, rows) => summaryOverRows(s, rows, MOVEMENT_SUM_KEYS),
  filters: [
    ...periodFilter,
    { key: 'q', kind: 'text', label: 'Search', placeholder: 'Item, document or party…' },
    itemFilter,
    warehouseFilter,
    batchFilter,
    { key: 'document_type', kind: 'document_type', label: 'Type' },
    {
      key: 'direction',
      kind: 'select',
      label: 'Direction',
      placeholder: 'In and out',
      options: [
        { value: 'in', label: 'In' },
        { value: 'out', label: 'Out' },
      ],
    },
    {
      key: 'movement_kind',
      kind: 'select',
      label: 'Kind',
      placeholder: 'All kinds',
      options: [
        { value: 'physical', label: 'Physical' },
        { value: 'reversal', label: 'Reversal' },
        { value: 'revaluation', label: 'Revaluation' },
      ],
    },
    { key: 'all_fy', kind: 'toggle', label: 'All years', defaultOn: false },
    // Not shown, but declared: /documents/:id and the dashboard link straight to
    // "the movements this document made", and StockMovementsController reads it.
    { key: 'document_id', kind: 'number', label: 'Document', hidden: true },
  ],
  columns: [
    { ...dateColumn<StockMovementRow>('movement_date', 'Date'), alwaysVisible: true, minWidth: 96 },
    {
      key: 'document_no',
      header: 'Document',
      alwaysVisible: true,
      sortKey: 'document_no',
      render: (r) => documentCell(r.document_id, r.document_no),
      csv: (r) => r.document_no ?? (r.document_id ? `#${r.document_id}` : ''),
    },
    {
      key: 'document_type',
      header: 'Type',
      sortKey: 'document_type',
      render: (r) => r.document_type_label ?? r.document_type,
      csv: (r) => r.document_type_label ?? r.document_type,
    },
    {
      key: 'item_name',
      header: 'Item',
      sortKey: 'item_name',
      alwaysVisible: true,
      minWidth: 180,
      render: (r) => itemCell(r.item_id, r.item_name, r.item_sku, r.warehouse_id),
      csv: (r) => r.item_name ?? `Item #${r.item_id}`,
    },
    textColumn<StockMovementRow>('warehouse_name', 'Warehouse', false),
    textColumn<StockMovementRow>('batch_no', 'Batch', false),
    {
      key: 'direction',
      header: 'Dir.',
      sortKey: 'direction',
      render: (r) => <StatusBadge value={r.direction} tone={r.direction === 'in' ? 'good' : 'warning'} />,
      csv: (r) => r.direction,
    },
    {
      ...qtyColumn<StockMovementRow>('qty', 'Qty', { strong: true }),
      alwaysVisible: true,
      render: (r) => (
        <strong className={r.qty < 0 ? 'font-semibold text-red-600' : 'font-semibold text-gray-900'}>
          {formatQty(r.qty)} {r.unit_symbol ?? ''}
        </strong>
      ),
      csv: (r) => r.qty,
    },
    { ...moneyColumn<StockMovementRow>('unit_cost', 'Rate'), configureHint: 'Discloses unit cost.' },
    moneyColumn<StockMovementRow>('value', 'Value'),
    {
      key: 'movement_kind',
      header: 'Kind',
      render: (r) => movementKindCell(r.movement_kind),
      csv: (r) => r.movement_kind,
    },
    {
      key: 'source_app',
      header: 'Source',
      render: (r) =>
        r.source_app ? `${r.source_app} · ${r.source_document_no ?? r.source_document_id ?? ''}` : DASH,
      csv: (r) => (r.source_app ? `${r.source_app} ${r.source_document_no ?? ''}`.trim() : ''),
    },
    { ...textColumn<StockMovementRow>('party_name', 'Party', false), defaultVisible: false },
  ],
  rowKey: (r) => r.movement_id,
  drillTo: (r) => (r.document_id ? `/documents/${r.document_id}` : null),
  groupBy: [
    {
      key: 'document_type',
      label: 'Document type',
      of: (r) => ({ key: r.document_type, label: r.document_type_label ?? r.document_type }),
      subtotal: (rows, group) =>
        buildTotalsRow(
          [
            { key: 'movement_date' },
            { key: 'qty', align: 'right' },
            { key: 'value', align: 'right' },
          ],
          {
            qty: formatQty(rows.reduce((a, r) => a + r.qty, 0)),
            value: formatMoney(rows.reduce((a, r) => a + (r.value ?? 0), 0)),
          },
          // Named "on this page" because that is what it is: the footer below
          // still carries the figure for the whole filtered set.
          { label: `${group.label} · ${totalsLabel(rows.length, 'movement')} on this page`, labelKey: 'movement_date' },
        ),
    },
    {
      key: 'warehouse',
      label: 'Warehouse',
      of: (r) => ({ key: String(r.warehouse_id ?? 0), label: r.warehouse_name ?? 'No warehouse' }),
      subtotal: (rows, group) =>
        buildTotalsRow(
          [
            { key: 'movement_date' },
            { key: 'qty', align: 'right' },
            { key: 'value', align: 'right' },
          ],
          {
            qty: formatQty(rows.reduce((a, r) => a + r.qty, 0)),
            value: formatMoney(rows.reduce((a, r) => a + (r.value ?? 0), 0)),
          },
          { label: `${group.label} · ${totalsLabel(rows.length, 'movement')} on this page`, labelKey: 'movement_date' },
        ),
    },
  ],
  totals: (s) =>
    buildTotalsRow(
      [
        { key: 'movement_date' },
        { key: 'qty', align: 'right' },
        { key: 'value', align: 'right' },
      ],
      { qty: formatQty(s.sums.qty), value: formatMoney(s.sums.value) },
      {
        label: `${totalsLabel(s.pageRows, 'movement')} — ${pageHint(s)}`,
        labelKey: 'movement_date',
      },
    ),
  kpis: (s) => [
    {
      key: 'rows',
      label: 'Movements',
      value: formatInt(s.total),
      hint: 'matching the filters',
      icon: ArrowLeftRight,
      tone: 'primary',
    },
    {
      key: 'qty',
      label: 'Net quantity',
      value: formatQty(s.sums.qty),
      hint: pageHint(s),
      icon: ArrowLeftRight,
      tone: 'info',
      current: s.sums.qty,
      emphasizeNegative: true,
    },
    {
      key: 'value',
      label: 'Net value',
      value: formatMoney(s.sums.value),
      hint: pageHint(s),
      icon: Scale,
      tone: 'success',
      current: s.sums.value,
      emphasizeNegative: true,
    },
  ],
  summary: (s) => [
    { label: 'Movements', value: formatInt(s.total) },
    { label: 'Net qty', value: formatQty(s.sums.qty), hint: pageHint(s) },
    { label: 'Net value', value: formatMoney(s.sums.value), hint: pageHint(s) },
  ],
  rowClassName: (r) => (r.movement_kind === 'reversal' ? 'bg-amber-50/60' : undefined),
  emptyMessage: 'No movements match these filters.',
})

/* -------------------------------------------------------- balance register */

const BALANCE_SUM_KEYS = [
  'on_hand_qty',
  'reserved_qty',
  'committed_qty',
  'packed_qty',
  'in_transit_qty',
  'job_worker_qty',
  'quality_hold_qty',
  'damaged_qty',
  'blocked_qty',
  'expected_qty',
  'available_qty',
] as const

/**
 * Item × warehouse × batch, with every bucket that makes up "on hand" and what
 * is actually available to promise.
 */
export const stockBalanceRegister = defineRegister<StockBalanceGridRow, PageSummary>({
  slug: 'warehouse_stock',
  path: 'stock-balances',
  columnPrefsKey: 'stock_balances',
  title: 'Stock balance register',
  description:
    'Item, warehouse and batch with every bucket behind the on-hand figure and what is free to promise',
  shortDescription: 'On hand, reserved, packed, available — by bin',
  group: 'stock',
  icon: Warehouse,
  permission: [P.report('warehouse_stock'), P.report('stock_summary')],
  defaultSort: 'item_name',
  minWidth: 1600,
  rowNoun: 'balance',
  filenameBase: 'stock-balances',
  fetch: async ({ query, signal }) =>
    withPageSummary(
      await stockBalancesApi.list(
        { ...query, nonzero: query.nonzero === '0' ? 0 : 1 },
        signal,
      ),
      'stock_balances',
      BALANCE_SUM_KEYS,
    ),
  summaryForRows: (s, rows) => summaryOverRows(s, rows, BALANCE_SUM_KEYS),
  filters: [
    itemFilter,
    warehouseFilter,
    batchFilter,
    { key: 'nonzero', kind: 'toggle', label: 'Hide zero balances', defaultOn: true },
    // Where the dashboard's negative-stock card lands: same table, same
    // tolerance (StockBalanceService::NEGATIVE_ON_HAND_EPSILON).
    { key: 'negative', kind: 'toggle', label: 'Below zero only', defaultOn: false },
  ],
  columns: [
    {
      key: 'item_name',
      header: 'Item',
      sortKey: 'item_name',
      alwaysVisible: true,
      minWidth: 200,
      render: (r) => itemCell(r.item_id, r.item_name, r.item_sku, r.warehouse_id),
      csv: (r) => r.item_name ?? `Item #${r.item_id}`,
    },
    {
      key: 'warehouse_name',
      header: 'Warehouse',
      sortKey: 'warehouse_id',
      render: (r) => r.warehouse_name ?? <span className="text-gray-400">(none)</span>,
      csv: (r) => r.warehouse_name ?? '',
    },
    textColumn<StockBalanceGridRow>('batch_no', 'Batch', false),
    qtyColumn<StockBalanceGridRow>('on_hand_qty', 'On hand', { strong: true }),
    qtyColumn<StockBalanceGridRow>('reserved_qty', 'Reserved'),
    { ...qtyColumn<StockBalanceGridRow>('committed_qty', 'Committed'), defaultVisible: false },
    qtyColumn<StockBalanceGridRow>('packed_qty', 'Packed'),
    { ...qtyColumn<StockBalanceGridRow>('in_transit_qty', 'In transit'), defaultVisible: false },
    qtyColumn<StockBalanceGridRow>('job_worker_qty', 'Job worker'),
    { ...qtyColumn<StockBalanceGridRow>('quality_hold_qty', 'On hold'), defaultVisible: false },
    { ...qtyColumn<StockBalanceGridRow>('damaged_qty', 'Damaged'), defaultVisible: false },
    { ...qtyColumn<StockBalanceGridRow>('blocked_qty', 'Blocked'), defaultVisible: false },
    { ...qtyColumn<StockBalanceGridRow>('expected_qty', 'Expected'), defaultVisible: false },
    { ...qtyColumn<StockBalanceGridRow>('available_qty', 'Available', { strong: true }), alwaysVisible: true },
    dateTimeColumn<StockBalanceGridRow>('last_movement_at', 'Last movement'),
  ],
  rowKey: (r) => r.balance_id,
  drillTo: (r) =>
    `/registers/stock-ledger?item_id=${r.item_id}${r.warehouse_id ? `&warehouse_id=${r.warehouse_id}` : ''}`,
  groupBy: [
    {
      key: 'warehouse',
      label: 'Warehouse',
      of: (r) => ({ key: String(r.warehouse_id ?? 0), label: r.warehouse_name ?? 'No warehouse' }),
      subtotal: (rows, group) =>
        buildTotalsRow(
          [
            { key: 'item_name' },
            ...BALANCE_SUM_KEYS.map((key) => ({ key, align: 'right' as const })),
          ],
          Object.fromEntries(
            BALANCE_SUM_KEYS.map((key) => [key, formatQty(rows.reduce((a, r) => a + Number(r[key] ?? 0), 0))]),
          ),
          { label: `${group.label} · ${totalsLabel(rows.length, 'row')} on this page`, labelKey: 'item_name' },
        ),
    },
  ],
  totals: (s) =>
    buildTotalsRow(
      [
        { key: 'item_name' },
        ...BALANCE_SUM_KEYS.map((key) => ({ key, align: 'right' as const })),
      ],
      Object.fromEntries(BALANCE_SUM_KEYS.map((key) => [key, formatQty(s.sums[key])])),
      { label: `${totalsLabel(s.pageRows, 'row')} — ${pageHint(s)}`, labelKey: 'item_name' },
    ),
  kpis: (s) => [
    { key: 'rows', label: 'Rows', value: formatInt(s.total), icon: Warehouse, tone: 'primary' },
    {
      key: 'on_hand',
      label: 'On hand',
      value: formatQty(s.sums.on_hand_qty),
      hint: pageHint(s),
      icon: Warehouse,
      tone: 'info',
    },
    {
      key: 'reserved',
      label: 'Reserved',
      value: formatQty(s.sums.reserved_qty),
      hint: pageHint(s),
      icon: Warehouse,
      tone: 'warning',
    },
    {
      key: 'packed',
      label: 'Packed',
      value: formatQty(s.sums.packed_qty),
      hint: pageHint(s),
      icon: Warehouse,
      tone: 'violet',
    },
    {
      key: 'available',
      label: 'Available',
      value: formatQty(s.sums.available_qty),
      hint: pageHint(s),
      icon: Warehouse,
      tone: 'success',
      current: s.sums.available_qty,
      emphasizeNegative: true,
    },
  ],
  summary: (s) => [
    { label: 'Rows', value: formatInt(s.total) },
    { label: 'On hand', value: formatQty(s.sums.on_hand_qty), hint: pageHint(s) },
    { label: 'Reserved', value: formatQty(s.sums.reserved_qty), hint: pageHint(s) },
    { label: 'Available', value: formatQty(s.sums.available_qty), hint: pageHint(s), tone: 'good' },
  ],
  emptyMessage: 'No stock balances match these filters.',
})
