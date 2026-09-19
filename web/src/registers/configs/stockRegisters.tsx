import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Boxes,
  BookOpen,
  CircleCheck,
  ListChecks,
  Lock,
  Package,
  RefreshCw,
  Scale,
  TriangleAlert,
  Warehouse,
} from 'lucide-react'
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
import { EmptyState } from '../../ui/EmptyState'
import { StatusBadge } from '../../ui/StatusBadge'
import { formatDate, formatInt, formatMoney, formatQty } from '../../utils/format'
import {
  DASH,
  batchFilter,
  dateColumn,
  dateTimeColumn,
  itemFilter,
  itemGroupFilter,
  moneyColumn,
  periodFilter,
  qtyColumn,
  stockCategoryFilter,
  textColumn,
  warehouseFilter,
} from '../../reports/configs/common'
import { StockBalanceRowActions } from '../StockBalanceRowActions'
import { MovementHeaderActions } from '../movement/MovementHeaderActions'
import { MovementRowActions } from '../movement/MovementRowActions'
import { MovementSelectionActions } from '../movement/MovementSelectionActions'
import { MovementTrendChart, MovementTrendChartSkeleton } from '../movement/MovementTrendChart'
import {
  MovementQtyCell,
  MovementSourceBadge,
  MovementTypeBadge,
  MovementWarehouseCell,
  movementQtyCsv,
  warehouseCsv,
} from '../movement/movementCells'
import {
  comparisonFor,
  comparisonHint,
  movementScopeHint,
  movementSummaryOf,
  movementSummaryOverRows,
} from '../movement/movementSummary'
import type { MovementRegisterSummary } from '../movement/movementSummary'
import { buildTotalsRow, totalsLabel } from '../registerTotals'
import { defineRegister } from '../RegisterConfig'
import type { RegisterGrouping } from '../RegisterConfig'
import type { ReportColumn } from '../../reports/types'
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

/**
 * The movement register's column-preference key.
 *
 * Shared with `SavedViewsMenu`, which scopes a reader's saved filter sets by the same
 * key: both are per-register, per-member preferences and neither may collide with the
 * stock ledger, whose permission slug this register borrows.
 */
const MOVEMENT_PREFS_KEY = 'movement_register'

/**
 * The register's grid.
 *
 * Declared as a named constant rather than inline because the selection toolbar exports
 * exactly these columns: a file of ticked rows that carried different columns from the
 * table they were ticked in is a file nobody can reconcile against the screen.
 *
 * The first eleven are what the mock shows and what an inventory or accounts reader
 * works down; everything after them ships hidden and is on offer in Customize columns.
 * Nothing the endpoint sends has been dropped — the old one-row register's Direction,
 * Kind, signed Qty and Party are all still here, and Category, Reference, Posted at and
 * Posted by are new columns for fields the API was already sending with nowhere to put.
 */
/*
 * Widths, not just minimums.
 *
 * SmartTable only applies `minWidth` alongside an explicit `width`, so a column that
 * declares one alone is laid out by the browser — and with `table-layout: auto` the
 * browser hands the slack to whichever column has the most of it. On this grid that was
 * Date, which took 340px to print "18 Sept 2026" while the item name wrapped onto three
 * lines. Pinning the columns whose content is a fixed shape (a date, a batch code, a
 * quantity, an amount) leaves the rest for the ones that are actually text.
 */
const MOVEMENT_COLUMNS: ReportColumn<StockMovementRow>[] = [
  {
    ...dateColumn<StockMovementRow>('movement_date', 'Date'),
    alwaysVisible: true,
    width: '6.75rem',
    minWidth: 96,
  },
  {
    key: 'document_no',
    header: 'Document',
    alwaysVisible: true,
    sortKey: 'document_no',
    width: '8.5rem',
    minWidth: 112,
    render: (r) => documentCell(r.document_id, r.document_no),
    csv: (r) => r.document_no ?? (r.document_id ? `#${r.document_id}` : ''),
  },
  {
    key: 'document_type',
    header: 'Type',
    sortKey: 'document_type',
    width: '9rem',
    minWidth: 118,
    render: (r) => <MovementTypeBadge row={r} />,
    csv: (r) => r.document_type_label ?? r.document_type,
  },
  {
    key: 'item_name',
    header: 'Item',
    sortKey: 'item_name',
    alwaysVisible: true,
    width: '12.5rem',
    minWidth: 165,
    render: (r) => itemCell(r.item_id, r.item_name, r.item_sku, r.warehouse_id),
    csv: (r) => r.item_name ?? `Item #${r.item_id}`,
  },
  {
    key: 'warehouse_name',
    header: 'Warehouse',
    sortKey: 'warehouse_name',
    width: '11rem',
    minWidth: 140,
    render: (r) => <MovementWarehouseCell row={r} />,
    csv: warehouseCsv,
  },
  { ...textColumn<StockMovementRow>('batch_no', 'Batch'), sortKey: 'batch_no', width: '5.5rem' },
  /*
   * Inward and outward as two columns, split from the one signed quantity the row
   * carries. Neither takes a sort key: the endpoint orders by the signed `qty` and
   * cannot order by half of it, and a header that moved the arrow without reordering
   * the rows would be read as having sorted them.
   */
  {
    key: 'in_qty',
    header: 'In qty',
    align: 'right',
    alwaysVisible: true,
    format: 'qty',
    width: '7rem',
    minWidth: 96,
    render: (r) => <MovementQtyCell row={r} side="in" />,
    csv: (r) => movementQtyCsv(r, 'in'),
  },
  {
    key: 'out_qty',
    header: 'Out qty',
    align: 'right',
    alwaysVisible: true,
    format: 'qty',
    width: '7rem',
    minWidth: 96,
    render: (r) => <MovementQtyCell row={r} side="out" />,
    csv: (r) => movementQtyCsv(r, 'out'),
  },
  {
    ...moneyColumn<StockMovementRow>('unit_cost', 'Rate'),
    width: '6rem',
    minWidth: 84,
    configureHint: 'Discloses unit cost.',
  },
  {
    ...moneyColumn<StockMovementRow>('value', 'Value'),
    width: '7.5rem',
    minWidth: 100,
    configureHint: 'Signed, like the stored figure: negative where stock left.',
    // Signed on purpose. The footer's Net value is this column's sum, so printing it
    // unsigned would leave a column that does not add up to the total beneath it. The
    // colour is what stops the minus being a surprise next to two unsigned quantity
    // columns — and the In / Out columns already say the direction in words.
    render: (r) => (
      <span className={r.value !== null && r.value < 0 ? 'text-rose-700' : undefined}>
        {formatMoney(r.value)}
      </span>
    ),
  },
  {
    key: 'source_app',
    header: 'Source',
    sortKey: 'source_app',
    width: '9rem',
    minWidth: 120,
    render: (r) => <MovementSourceBadge row={r} />,
    csv: (r) => (r.source_app ? `${r.source_app} ${r.source_document_no ?? ''}`.trim() : 'Inventory'),
  },
  {
    key: 'direction',
    header: 'Dir.',
    sortKey: 'direction',
    defaultVisible: false,
    configureHint: 'What the movement was recorded as, before the sign of the quantity.',
    render: (r) => <StatusBadge value={r.direction} tone={r.direction === 'in' ? 'good' : 'warning'} />,
    csv: (r) => r.direction,
  },
  {
    ...qtyColumn<StockMovementRow>('qty', 'Signed qty'),
    defaultVisible: false,
    configureHint: 'The stored quantity — negative when stock left.',
    render: (r) => (
      <strong className={r.qty < 0 ? 'font-semibold text-red-600' : 'font-semibold text-gray-900'}>
        {formatQty(r.qty)} {r.unit_symbol ?? ''}
      </strong>
    ),
    csv: (r) => r.qty,
  },
  {
    key: 'movement_kind',
    header: 'Kind',
    defaultVisible: false,
    render: (r) => movementKindCell(r.movement_kind),
    csv: (r) => r.movement_kind,
  },
  { ...textColumn<StockMovementRow>('cat_name', 'Category', false), defaultVisible: false },
  {
    key: 'source_document_no',
    header: 'Reference',
    defaultVisible: false,
    configureHint: 'The number the raising product gave the document.',
    render: (r) => r.source_document_no ?? DASH,
    csv: (r) => r.source_document_no ?? '',
  },
  { ...textColumn<StockMovementRow>('party_name', 'Party', false), defaultVisible: false },
  { ...dateTimeColumn<StockMovementRow>('created_at', 'Posted at'), defaultVisible: false },
  { ...textColumn<StockMovementRow>('created_by', 'Posted by', false), defaultVisible: false },
]

/**
 * One grouping of the movement register, with the subtotal every grouping shares.
 *
 * Grouping is a view of the rows ON SCREEN — the engine re-orders what the page served
 * and totals what it grouped — so each subtotal says so in its own label while the pinned
 * footer beneath stays the authority on the whole filtered set. Six groupings differing
 * only in how they key a row do not need six copies of that paragraph or of the sum.
 */
function movementGrouping(
  key: string,
  label: string,
  of: (row: StockMovementRow) => { key: string; label: string },
): RegisterGrouping<StockMovementRow> {
  return {
    key,
    label,
    of,
    subtotal: (rows, group) =>
      buildTotalsRow(
        [
          { key: 'movement_date' },
          { key: 'in_qty', align: 'right' },
          { key: 'out_qty', align: 'right' },
          { key: 'value', align: 'right' },
        ],
        {
          in_qty: formatQty(rows.reduce((a, r) => a + (r.qty > 0 ? r.qty : 0), 0)),
          out_qty: formatQty(rows.reduce((a, r) => a + (r.qty < 0 ? -r.qty : 0), 0)),
          value: formatMoney(rows.reduce((a, r) => a + (r.value ?? 0), 0)),
        },
        {
          // Named "on this page" because that is what it is: the footer below still
          // carries the figure for the whole filtered set.
          label: `${group.label} · ${totalsLabel(rows.length, 'movement')} on this page`,
          labelKey: 'movement_date',
        },
      ),
  }
}


/**
 * Every posted movement in the year and branch, across all items.
 *
 * The companion to the ledger: the ledger answers "what happened to this item", this
 * answers "what happened on these days, from this source".
 *
 * It is laid out as a `panel` — page heading, a carded filter grid with period chips,
 * metric cards and a trend band — because this is a register people work in all day
 * rather than glance at, and because its filters ARE the question: a period, a warehouse
 * and a document type decide every figure on the screen.
 *
 * Its figures come from the endpoint's own aggregate (`summary=1`) over the whole filtered
 * set, not from the served page, and its comparison is the same aggregate over the
 * preceding window. That is what lets a card over a 25-row page speak for all 4,000
 * matching movements and carry an honest percentage beside it — see
 * `registers/movement/movementSummary.ts` for what happens when the server sends neither.
 */
export const movementRegister = defineRegister<StockMovementRow, MovementRegisterSummary>({
  slug: 'stock_ledger',
  path: 'movement-register',
  // Shares its permission slug with the stock ledger but is a different grid,
  // so it needs its own column-preference key.
  columnPrefsKey: MOVEMENT_PREFS_KEY,
  title: 'Movement register',
  description:
    'Every posted movement in the year and branch — receipts, issues, reversals and revaluations, whichever product raised them',
  shortDescription: 'Track all inventory movements across your business in real time',
  group: 'movement',
  icon: ArrowLeftRight,
  permission: [P.report('stock_ledger'), P.documentsRead],
  defaultSort: 'movement_date',
  defaultOrder: 'desc',
  // Eleven columns ship visible, plus the tick box and the row menu. Below this the item
  // name starts breaking across three lines and takes each row's height with it, so the
  // body scrolls sideways instead — which is what an enterprise register grid does.
  minWidth: 1520,
  rowNoun: 'movement',
  filenameBase: 'movement-register',
  layout: 'panel',
  filterPanel: {
    description: 'Narrow the register to the movements you are asking about',
    // The periods a movement register is actually read over. Each one writes real dates
    // into the URL, and "This FY" takes them from the financial year the header selects —
    // never from the calendar year, which in India is not the same thing.
    quickRanges: ['today', 'last_7', 'last_30', 'this_month', 'fy_to_date'],
    // Eight controls plus the button cell: two clean rows of five rather than three
    // ragged rows of four.
    gridColumns: 5,
    primaryKeys: [
      'from',
      'q',
      'warehouse_id',
      'batch_id',
      'document_type',
      'direction',
      'movement_kind',
      'stock_cat_id',
    ],
  },
  headerActions: <MovementHeaderActions registerKey={MOVEMENT_PREFS_KEY} />,
  tableTitle: 'Movements',
  tableHint: 'Every line the filters match, newest first',
  defaultLimit: 25,
  /**
   * One request for the page, its aggregate and its chart.
   *
   * They travel together so the three can never answer differently filtered questions —
   * a KPI card that disagrees with the table under it is worse than no card. The export
   * pager asks for neither: it walks every page of the same query, and re-running the
   * aggregate on each of seventeen pages would recompute a figure the caller already has
   * (`summaryForRows` re-totals over what the export actually wrote).
   */
  fetch: async ({ query, signal, purpose }) => {
    const wantsAggregate = purpose !== 'export'
    const response = await stockMovementsApi.list(
      { ...query, ...(wantsAggregate ? { summary: 1, trend: 1 } : {}) },
      signal,
    )
    return { ...response, report: 'movement_register', summary: movementSummaryOf(response) }
  },
  summaryForRows: (s, rows) => movementSummaryOverRows(s, rows),
  filters: [
    ...periodFilter,
    {
      key: 'q',
      kind: 'text',
      label: 'Search',
      // Exactly the columns StockMovementsController::filteredMovements searches. A
      // placeholder that named a field the query does not read would send a reader
      // hunting for a batch number the box cannot find.
      placeholder: 'Item, document no., batch, reference…',
    },
    warehouseFilter,
    batchFilter,
    { key: 'document_type', kind: 'document_type', label: 'Document type' },
    {
      key: 'direction',
      kind: 'select',
      label: 'Direction',
      placeholder: 'In and out',
      options: [
        { value: 'in', label: 'Inward only' },
        { value: 'out', label: 'Outward only' },
      ],
    },
    {
      key: 'movement_kind',
      kind: 'select',
      label: 'Movement type',
      placeholder: 'All kinds',
      options: [
        { value: 'physical', label: 'Physical' },
        { value: 'reversal', label: 'Reversal' },
        { value: 'revaluation', label: 'Revaluation' },
      ],
    },
    { ...stockCategoryFilter, label: 'Item category' },
    // Behind "More filters": each one narrows to a question asked less often than the
    // eight above, and none is dropped — the panel's overflow carries the count of those
    // that are set, so a filter cannot be on without the reader being told.
    itemFilter,
    itemGroupFilter,
    { key: 'all_fy', kind: 'toggle', label: 'All financial years', defaultOn: false },
    // Not shown, but declared: /documents/:id and the dashboard link straight to
    // "the movements this document made", and StockMovementsController reads it.
    { key: 'document_id', kind: 'number', label: 'Document', hidden: true },
  ],
  // "All financial years" widens the query past the year the header selects, and the
  // scope line is the only record of that on a printed sheet.
  scopePeriodFor: (v) => (v.all_fy === '1' ? 'All financial years' : undefined),
  columns: MOVEMENT_COLUMNS,
  rowKey: (r) => r.movement_id,
  drillTo: (r) => (r.document_id ? `/documents/${r.document_id}` : null),
  // A control, not a column — so it never reaches a CSV or a printed sheet.
  rowActions: (r) => <MovementRowActions row={r} />,
  /**
   * Ticking rows answers "what do these come to together", which a register cannot be
   * read down to answer. Nothing here writes: the actions are a subtotal and a file.
   */
  selectable: {
    idOf: (r) => r.movement_id,
    label: 'Select movement',
    actions: (selected, _clear, summary) => (
      <MovementSelectionActions rows={selected} summary={summary} columns={MOVEMENT_COLUMNS} />
    ),
  },
  groupBy: [
    movementGrouping('document_type', 'Document type', (r) => ({
      key: r.document_type,
      label: r.document_type_label ?? r.document_type,
    })),
    movementGrouping('warehouse', 'Warehouse', (r) => ({
      key: String(r.warehouse_id ?? 0),
      label: r.warehouse_name ?? 'No warehouse',
    })),
    movementGrouping('item', 'Item', (r) => ({
      key: String(r.item_id),
      label: r.item_name ?? `Item #${r.item_id}`,
    })),
    movementGrouping('date', 'Date', (r) => ({
      key: r.movement_date,
      label: formatDate(r.movement_date),
    })),
    movementGrouping('batch', 'Batch', (r) => ({
      key: String(r.batch_id ?? 0),
      label: r.batch_no ?? 'No batch',
    })),
    movementGrouping('category', 'Item category', (r) => ({
      key: String(r.stock_cat_id ?? 0),
      label: r.cat_name ?? 'No category',
    })),
  ],
  /**
   * The pinned footer, over the WHOLE filtered set.
   *
   * `s.in_qty` and friends are the endpoint's aggregate, so the figure under a 25-row page
   * is the total of every matching movement — which is the difference between a register
   * and a list. When the aggregate is missing (an export re-total, an older API) `whole`
   * is false and the label says which rows the figures cover.
   */
  totals: (s) =>
    buildTotalsRow(
      [
        { key: 'movement_date' },
        { key: 'in_qty', align: 'right' },
        { key: 'out_qty', align: 'right' },
        { key: 'value', align: 'right' },
      ],
      {
        in_qty: formatQty(s.in_qty),
        out_qty: formatQty(s.out_qty),
        value: formatMoney(s.net_value),
      },
      {
        // Kept short on purpose. SmartTable pins the totals row `whitespace-nowrap` so it
        // cannot break over three lines, which means whatever is written here sets the
        // width of the column it sits in — a sentence here stretched Date to 330px and
        // pushed Source off the screen. The caveat is only spelled out when there IS one:
        // a server aggregate covers every matching movement, and the cards above already
        // say so.
        label: s.whole
          ? totalsLabel(s.total, 'movement')
          : `${totalsLabel(s.pageRows, 'movement')} — this page only`,
        labelKey: 'movement_date',
      },
    ),
  kpis: (s) => [
    {
      key: 'movements',
      label: 'Total movements',
      value: formatInt(s.total),
      hint: comparisonHint(s),
      icon: ArrowLeftRight,
      tone: 'primary',
      current: s.movements,
      previous: comparisonFor(s, 'movements'),
    },
    {
      key: 'in_qty',
      label: 'Total inward qty',
      value: formatQty(s.in_qty),
      hint: comparisonHint(s),
      icon: ArrowDownLeft,
      tone: 'info',
      current: s.in_qty,
      previous: comparisonFor(s, 'in_qty'),
    },
    {
      key: 'out_qty',
      label: 'Total outward qty',
      value: formatQty(s.out_qty),
      hint: comparisonHint(s),
      icon: ArrowUpRight,
      tone: 'rose',
      current: s.out_qty,
      previous: comparisonFor(s, 'out_qty'),
      // More stock leaving is not in itself good news, so the chip is not coloured as
      // though it were: up is drawn red here and green on the inward card beside it.
      invertDelta: true,
    },
    {
      key: 'net_qty',
      label: 'Net quantity',
      value: formatQty(s.net_qty),
      hint: comparisonHint(s),
      icon: Scale,
      tone: 'violet',
      current: s.net_qty,
      previous: comparisonFor(s, 'net_qty'),
      emphasizeNegative: true,
    },
  ],
  analytics: ({ summary, loading }) => <MovementTrendChart summary={summary} loading={loading} />,
  analyticsSkeleton: <MovementTrendChartSkeleton />,
  summary: (s) => [
    { label: 'Movements', value: formatInt(s.total) },
    { label: 'Inward qty', value: formatQty(s.in_qty), hint: movementScopeHint(s) },
    { label: 'Outward qty', value: formatQty(s.out_qty), hint: movementScopeHint(s) },
    { label: 'Net qty', value: formatQty(s.net_qty), hint: movementScopeHint(s) },
    { label: 'Net value', value: formatMoney(s.net_value), hint: movementScopeHint(s) },
  ],
  rowClassName: (r) => (r.movement_kind === 'reversal' ? 'bg-amber-50/60' : undefined),
  emptyMessage: 'No inventory movements match the selected filters.',
  emptyUnfiltered: (
    <EmptyState
      icon={ArrowLeftRight}
      title="No movements yet"
      description="Nothing has moved stock in this financial year. Post a receipt, an issue or an opening stock document and every line it moves appears here."
    />
  ),
})


/* -------------------------------------------------------- balance register */

/**
 * How far below zero an on-hand quantity has to be before it counts as
 * negative. Mirrors StockBalanceService::NEGATIVE_ON_HAND_EPSILON exactly: the
 * strip must agree with what `?negative=1` would actually return, or a reader
 * who follows "3 negative stock alerts" into the filter finds two rows.
 */
const NEGATIVE_ON_HAND_EPSILON = -0.00005

function isNegativeOnHand(row: StockBalanceGridRow): boolean {
  return Number(row.on_hand_qty ?? 0) < NEGATIVE_ON_HAND_EPSILON
}

function countDistinct<T>(rows: readonly T[], of: (row: T) => string | number | null): number {
  const seen = new Set<string | number>()
  for (const row of rows) {
    const key = of(row)
    if (key !== null) seen.add(key)
  }
  return seen.size
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

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
  shortDescription: 'Live balances across all warehouses and financial years',
  group: 'stock',
  icon: Warehouse,
  permission: [P.report('warehouse_stock'), P.report('stock_summary')],
  // inv_stock_balances has no fy_id: the grid is the position as it stands.
  scopePeriod: 'Live balances, all financial years',
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
  rowActions: (r) => <StockBalanceRowActions row={r} />,
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
  // One icon per bucket. All five cards drew the same warehouse glyph, which
  // made the strip a row of identical tiles and left the colour doing all the
  // work of telling them apart.
  kpis: (s) => [
    { key: 'rows', label: 'Rows', value: formatInt(s.total), hint: 'Total items', icon: ListChecks, tone: 'primary' },
    {
      key: 'on_hand',
      label: 'On hand',
      value: formatQty(s.sums.on_hand_qty),
      hint: `Live balance (${pageHint(s)})`,
      icon: Boxes,
      tone: 'info',
    },
    {
      key: 'reserved',
      label: 'Reserved',
      value: formatQty(s.sums.reserved_qty),
      hint: pageHint(s),
      icon: Lock,
      tone: 'warning',
    },
    {
      key: 'packed',
      label: 'Packed',
      value: formatQty(s.sums.packed_qty),
      hint: pageHint(s),
      icon: Package,
      tone: 'violet',
    },
    {
      key: 'available',
      label: 'Available',
      value: formatQty(s.sums.available_qty),
      hint: pageHint(s),
      icon: CircleCheck,
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
  emptyMessage: 'Try changing your item, warehouse, batch or stock filters.',
  filterPanel: {
    description: 'Refine your view of stock balances',
    // Six controls, all of them worth a column on this register — nothing is
    // pushed behind "More filters".
  },
  tableTitle: 'Stock balances',
  tableHint: 'Showing live stock position for your items',

  /**
   * The at-a-glance strip.
   *
   * Every figure is counted from the rows this response actually carried, and
   * the hint under it says which set that is. `/v1/stock-balances` sends no
   * aggregate over the filtered result (see configs/pageSummary.ts), so on page
   * 1 of 40 these are page figures and are labelled as such — "0 negative stock
   * alerts · All good!" over a page that happens to hold none, while page 7
   * holds twelve, is the most dangerous sentence this screen could print.
   */
  insights: (s, res) => {
    const rows = res.data
    const whole = s.isWholeResult
    const scope = whole ? 'Across all rows' : 'On this page'

    const skus = countDistinct(rows, (r) => r.item_id)
    const warehouseNames = [
      ...new Set(rows.map((r) => r.warehouse_name).filter((n): n is string => Boolean(n))),
    ]
    const warehouses = countDistinct(rows, (r) => r.warehouse_id ?? null)
    const negatives = rows.filter(isNegativeOnHand).length

    return {
      items: [
        {
          key: 'skus',
          label: `${plural(skus, 'SKU')} in view`,
          hint: scope,
          icon: ListChecks,
          tone: 'primary',
        },
        {
          key: 'warehouses',
          label: plural(warehouses, 'warehouse'),
          hint:
            warehouseNames.length === 0
              ? scope
              : warehouseNames.length <= 2
                ? warehouseNames.join(' · ')
                : `${warehouseNames.slice(0, 2).join(' · ')} +${warehouseNames.length - 2} more`,
          icon: Warehouse,
          tone: 'info',
        },
        {
          key: 'negative',
          label: plural(negatives, 'negative stock alert'),
          // "All good!" is a claim about the whole register, so it is only made
          // when the page IS the whole register.
          hint: negatives > 0 ? 'Review required' : whole ? 'All good!' : 'None on this page',
          icon: TriangleAlert,
          tone: negatives > 0 ? 'danger' : 'success',
        },
        {
          key: 'sync',
          label: 'Live sync',
          hint: whole ? 'Data up to date' : 'Figures cover this page',
          icon: RefreshCw,
          tone: 'teal',
        },
      ],
      note: whole && negatives === 0 && rows.length > 0 ? 'Your inventory. In perfect balance.' : undefined,
    }
  },
})
