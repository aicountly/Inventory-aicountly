import { Link } from 'react-router-dom'
import {
  AlarmClock,
  CircleCheck,
  Clock,
  Coins,
  Hourglass,
  LayoutGrid,
  ListChecks,
  Package,
  Table2,
} from 'lucide-react'
import { P } from '../../services/access'
import { PENDING_AGEING_BUCKETS, pendingApi } from '../../services/stockApi'
import type {
  PendingBreakdowns,
  PendingComparison,
  PendingRow,
  PendingSummaryResponse,
  PendingTrendPoint,
} from '../../services/stockApi'
import { labelForCode } from '../../documents/registry'
import { formatDate, formatInt, formatMoney, formatQty } from '../../utils/format'
import { Sparkline } from '../../ui/Sparkline'
import { EmptyState } from '../../ui/EmptyState'
import {
  DASH,
  dateColumn,
  dateTimeColumn,
  itemFilter,
  moneyColumn,
  qtyColumn,
  warehouseFilter,
} from '../../reports/configs/common'
import { describeDateRange } from '../dateRangePresets'
import { buildTotalsRow, totalsLabel } from '../registerTotals'
import { defineRegister } from '../RegisterConfig'
import type { ReportColumn } from '../RegisterConfig'
import {
  AgeingCell,
  DirectionBadge,
  PENDING_STATUS_OPTIONS,
  PendingStatusBadge,
  PriorityBadge,
  pendingKindLabel,
} from './pendingCells'
import { PendingMiniMetrics } from './PendingMiniMetrics'
import { PendingRowActions } from './PendingRowActions'
import { PendingSelectionActions } from './PendingSelectionActions'
import { PendingSummaryView } from './PendingSummaryView'
import { buildPendingInsights } from './pendingInsights'

/**
 * Everything the register states, over the whole filtered set.
 *
 * Unlike the plain list endpoints behind the movement and reservation registers,
 * `/v1/pending-quantities` sends a real aggregate — so there is no `PageSummary`
 * here, no "(this page)" caveat on any figure, and no `summaryForRows`: the
 * footer under a 50-row page is the total of every matching line, and the export
 * carries the same numbers without re-totalling what it walked.
 */
export interface PendingSummary extends PendingSummaryResponse {
  /** The same figures a month back. Null when they could not be reconstructed. */
  previous: PendingComparison | null
  trend: PendingTrendPoint[]
  breakdowns?: PendingBreakdowns
  /** True when the register is empty because NOTHING is pending, filters aside. */
  unfilteredEmpty: boolean
}

const EMPTY_SUMMARY: PendingSummary = {
  open_lines: 0,
  open_quantity: 0,
  overdue_lines: 0,
  overdue_quantity: 0,
  overdue_value: 0,
  pending_value: 0,
  average_ageing_days: 0,
  inbound_pending: 0,
  outbound_pending: 0,
  net_exposure: 0,
  original_qty_total: 0,
  settled_qty_total: 0,
  open_qty_total: 0,
  settled_today: 0,
  settled_today_qty: 0,
  item_count: 0,
  party_count: 0,
  warehouse_count: 0,
  document_count: 0,
  qty_open: 0,
  rows: 0,
  previous: null,
  trend: [],
  unfilteredEmpty: false,
}

/** Aggregates the screen asks for. The export pager asks for none — see below. */
const TABLE_INCLUDE = 'summary,previous,trend,breakdowns'

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

const COLUMNS: ReportColumn<PendingRow>[] = [
  {
    key: 'document_no',
    header: 'Document',
    sortKey: 'document_no',
    alwaysVisible: true,
    minWidth: 110,
    render: (r) => documentCell(r.document_id, r.document_no),
    csv: (r) => r.document_no ?? `#${r.document_id}`,
  },
  {
    key: 'document_type',
    header: 'Type',
    sortKey: 'document_type',
    render: (r) => r.document_type_label ?? labelForCode(r.document_type),
    csv: (r) => r.document_type_label ?? r.document_type,
  },
  dateColumn<PendingRow>('document_date', 'Date'),
  {
    key: 'pending_kind',
    header: 'Kind',
    sortKey: 'pending_kind',
    render: (r) => pendingKindLabel(r.pending_kind),
    csv: (r) => r.pending_kind,
  },
  {
    key: 'direction',
    header: 'Dir.',
    sortKey: 'direction',
    configureHint: 'In is stock owed to us; Out is stock that has left.',
    render: (r) => <DirectionBadge direction={r.direction} />,
    csv: (r) => r.direction,
  },
  {
    key: 'item_name',
    header: 'Item',
    sortKey: 'item_name',
    alwaysVisible: true,
    minWidth: 200,
    render: (r) => (
      <Link
        to={`/registers/stock-ledger?item_id=${r.item_id}`}
        className="text-gray-900 hover:text-primary"
        onClick={(e) => e.stopPropagation()}
      >
        <strong className="font-semibold">{r.item_name ?? `Item #${r.item_id}`}</strong>
        {r.item_sku ? <span className="text-gray-400"> · {r.item_sku}</span> : null}
      </Link>
    ),
    csv: (r) => r.item_name ?? `Item #${r.item_id}`,
  },
  {
    key: 'warehouse_name',
    header: 'Warehouse',
    sortKey: 'warehouse_name',
    minWidth: 130,
    render: (r) => r.warehouse_name ?? DASH,
    csv: (r) => r.warehouse_name ?? '',
  },
  {
    key: 'party_name',
    header: 'Party',
    sortKey: 'party_name',
    minWidth: 140,
    // The name is captured on Inventory's own document; the ledger id behind it
    // belongs to Books and is shown only when no name was recorded.
    render: (r) => r.party_name ?? (r.party_ref ? `Ledger #${r.party_ref}` : DASH),
    csv: (r) => r.party_name ?? (r.party_ref ? `#${r.party_ref}` : ''),
  },
  qtyColumn<PendingRow>('qty_original', 'Original qty'),
  qtyColumn<PendingRow>('qty_settled', 'Settled qty'),
  {
    ...qtyColumn<PendingRow>('qty_open', 'Open qty', { strong: true }),
    alwaysVisible: true,
    render: (r) => (
      <strong className="font-semibold text-gray-900">
        {formatQty(r.qty_open)} {r.unit_symbol ?? ''}
      </strong>
    ),
    csv: (r) => r.qty_open,
  },
  {
    ...moneyColumn<PendingRow>('pending_value', 'Pending value'),
    configureHint:
      "At Inventory's own cost — the line's captured valuation rate, else the item's weighted average. Never a selling price.",
  },
  {
    key: 'ageing_days',
    header: 'Ageing',
    sortKey: 'ageing_days',
    align: 'right',
    configureHint: 'Days since the document date. Lateness is measured separately, against the expected date.',
    render: (r) => <AgeingCell row={r} />,
    csv: (r) => r.ageing_days,
  },
  {
    key: 'due_date',
    header: 'Expected',
    sortKey: 'due_date',
    defaultVisible: false,
    configureHint: "The document's expected date, or the company's grace period where it recorded none.",
    cellClassName: 'whitespace-nowrap',
    render: (r) =>
      r.has_expected_date ? (
        formatDate(r.due_date)
      ) : (
        <span className="text-gray-400" title="Not recorded on the document; the company's grace period stands in.">
          {formatDate(r.due_date)}*
        </span>
      ),
    csv: (r) => r.due_date ?? '',
  },
  {
    key: 'status',
    header: 'Status',
    sortKey: 'status',
    render: (r) => <PendingStatusBadge status={r.status} />,
    csv: (r) => r.status,
  },
  {
    key: 'priority',
    header: 'Priority',
    sortKey: 'priority',
    configureHint: 'Derived from how late, how valuable and how old the line is.',
    render: (r) => <PriorityBadge row={r} />,
    csv: (r) => r.priority,
  },
  {
    ...dateTimeColumn<PendingRow>('last_activity_at', 'Last activity'),
    defaultVisible: false,
    configureHint: 'When this line was last opened, settled against or amended.',
  },
]

/** The columns the follow-up worklist shows, in the order it reads them. */
const FOLLOW_UP_COLUMNS = [
  'priority',
  'party_name',
  'document_no',
  'item_name',
  'qty_open',
  'pending_value',
  'ageing_days',
  'due_date',
  'status',
  'last_activity_at',
] as const

const TOTALS_COLUMNS = [
  { key: 'document_no' },
  { key: 'qty_original', align: 'right' as const },
  { key: 'qty_settled', align: 'right' as const },
  { key: 'qty_open', align: 'right' as const },
  { key: 'pending_value', align: 'right' as const },
]

/**
 * The pending-quantity register.
 *
 * Goods out on a delivery challan, in on an inward challan, with a job worker, or
 * invoiced and not yet received — everything issued or expected that has not been
 * settled by a later document.
 *
 * Deliberately NOT financial-year scoped, and the period filter therefore defaults
 * to no period at all. Goods sent to a job worker in February are still out in
 * April, and a register that quietly dropped them at the year boundary would
 * understate ITC-04 and every open challan. The FY is one chip away for a reader
 * who wants it, and the scope line says which of the two they are looking at.
 */
export const pendingRegister = defineRegister<PendingRow, PendingSummary>({
  slug: 'pending_quantities',
  path: 'pending-quantities',
  title: 'Pending quantity register',
  description:
    'Goods out on challan, in on inward challan, with a job worker, or invoiced but not received — with what is overdue, what it is worth at cost, and who to chase',
  shortDescription:
    'Track and reconcile pending quantities across purchases, sales and stock transfers',
  group: 'compliance',
  icon: Clock,
  tone: 'warning',
  permission: P.documentsRead,
  scopePeriod: 'All financial years',
  // The scope line is stamped on every printed sheet, where it is the only record
  // of what was asked for. A reader who narrows the period must not get a sheet
  // still claiming to cover every year; one who sets none falls back to the
  // constant above, which is the truth for this register.
  scopePeriodFor: (v) =>
    v.from || v.to ? describeDateRange(v.from ?? '', v.to ?? '') : undefined,
  defaultSort: 'document_date',
  defaultLimit: 50,
  minWidth: 1560,
  rowNoun: 'line',
  filenameBase: 'pending-quantities',
  layout: 'panel',
  filterPanel: {
    title: 'Filters',
    description: 'Narrow the register by kind, direction, item, warehouse, party, period or age',
    quickRanges: ['all', 'fy_to_date', 'fy', 'last_30', 'last_90'],
    allRangeLabel: 'All dates',
    // Eight controls in the grid; everything else moves behind "More filters",
    // which carries the count of those that are set.
    primaryKeys: [
      'kind',
      'direction',
      'item_id',
      'warehouse_id',
      'party_ref',
      'from',
      'ageing_bucket',
      'status',
    ],
  },

  fetch: async ({ query, signal, purpose }) => {
    // The pager walking every page for a CSV does not want five aggregates per
    // page for figures the caller computed once and already holds.
    const include = purpose === 'export' ? 'none' : ((query.include as string) ?? TABLE_INCLUDE)
    const res = await pendingApi.list({ ...query, include }, signal)
    const s = res.summary
    return {
      ...res,
      report: 'pending_quantities',
      summary: s
        ? {
            ...s,
            previous: res.previous ?? null,
            trend: res.trend ?? [],
            breakdowns: res.breakdowns,
            unfilteredEmpty: res.unfiltered_empty ?? false,
          }
        : EMPTY_SUMMARY,
    }
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
        { value: 'in', label: 'In — owed to us' },
        { value: 'out', label: 'Out — issued' },
      ],
    },
    { ...itemFilter, placeholder: 'Search item (name / code / HSN)' },
    { ...warehouseFilter, placeholder: 'All warehouses' },
    { key: 'party_ref', kind: 'party', label: 'Party ledger', placeholder: 'All parties' },
    // No default on either end: this register is not read inside one year.
    { key: 'from', toKey: 'to', kind: 'date_range', label: 'Period' },
    { key: 'to', kind: 'date', label: 'To', hidden: true },
    {
      key: 'ageing_bucket',
      kind: 'select',
      label: 'Ageing bucket',
      placeholder: 'All ageing',
      options: PENDING_AGEING_BUCKETS.map((b) => ({ value: b.value, label: b.label })),
    },
    {
      key: 'status',
      kind: 'select',
      label: 'Status',
      placeholder: 'Open / pending',
      options: PENDING_STATUS_OPTIONS,
    },

    /* ---- behind "More filters" ---- */
    { key: 'document_type', kind: 'document_type', label: 'Document type' },
    { key: 'document_no', kind: 'text', label: 'Document number', placeholder: 'e.g. SO-1024' },
    {
      key: 'priority',
      kind: 'select',
      label: 'Priority',
      placeholder: 'Any priority',
      options: [
        { value: 'high', label: 'High' },
        { value: 'medium', label: 'Medium' },
        { value: 'low', label: 'Low' },
      ],
    },
    { key: 'overdue_only', kind: 'toggle', label: 'Overdue only' },
    { key: 'ageing_from', kind: 'number', label: 'Ageing from (days)', placeholder: '0' },
    { key: 'ageing_to', kind: 'number', label: 'Ageing to (days)', placeholder: '365' },
    { key: 'min_open_qty', kind: 'number', label: 'Min open qty', placeholder: '0' },
    { key: 'max_open_qty', kind: 'number', label: 'Max open qty', placeholder: 'any' },
    { key: 'min_pending_value', kind: 'number', label: 'Min pending value', placeholder: '0' },
    { key: 'max_pending_value', kind: 'number', label: 'Max pending value', placeholder: 'any' },
  ],

  columns: COLUMNS,
  rowKey: (r) => r.pending_id,
  drillTo: (r) => (r.document_id ? `/documents/${r.document_id}` : null),
  rowActions: (r) => <PendingRowActions row={r} />,

  // Ticking rows answers "what do these come to together, and what share of the
  // book is that" — a question a register cannot answer by being read down — and
  // gives a file of exactly those lines. Nothing here writes: a pending quantity
  // is settled by raising the document that settles it.
  selectable: {
    idOf: (r) => r.pending_id,
    label: 'Select pending line',
    actions: (selected, _clear, summary) => (
      <PendingSelectionActions rows={selected} summary={summary} columns={COLUMNS} />
    ),
  },

  views: [
    // None of the three narrows the aggregates it asks for: `fetch` requests the
    // same set for every view, so the KPI strip above the card does not lose its
    // deltas and sparklines the moment a reader presses Summary. Only the
    // follow-up view narrows the ROWS, and it does so server-side.
    {
      key: 'table',
      label: 'Table',
      icon: Table2,
      hint: 'Every outstanding line, oldest first',
    },
    {
      key: 'summary',
      label: 'Summary',
      icon: LayoutGrid,
      hint: 'The same filtered set, grouped the six ways it is read',
      render: ({ summary, loading }) => (
        <PendingSummaryView breakdowns={summary.breakdowns} loading={loading} />
      ),
    },
    {
      key: 'follow_up',
      label: 'Follow-up',
      icon: ListChecks,
      hint: 'Lines that need chasing: overdue, materially valuable, or long open',
      // Server-side, so the pager and the totals describe the worklist itself.
      // `low` is everything in date, small and recent — the rest is the work.
      query: { priority: 'high,medium' },
      columns: FOLLOW_UP_COLUMNS,
      defaultSort: 'priority',
      defaultOrder: 'desc',
      emptyMessage: 'Nothing needs chasing — every open line is in date and immaterial.',
    },
  ],

  tableTitle: 'Pending lines',
  tableHint: 'Every outstanding line, oldest first',
  // Handed the register's own aggregate, so the chips beside the table cannot
  // state a figure the table below them disagrees with.
  tableActions: ({ summary }) => <PendingMiniMetrics summary={summary} />,

  totals: (s) =>
    buildTotalsRow(
      TOTALS_COLUMNS,
      {
        qty_original: formatQty(s.original_qty_total),
        qty_settled: formatQty(s.settled_qty_total),
        qty_open: formatQty(s.open_qty_total),
        pending_value: formatMoney(s.pending_value),
      },
      { label: totalsLabel(s.open_lines, 'line'), labelKey: 'document_no' },
    ),

  /**
   * Six cards, each with a REAL comparison.
   *
   * `previous` is the same register reconstructed one month back from the
   * settlement trail (and yesterday, for the daily count) — measured, not
   * modelled. When the endpoint could not compute it the card renders its hint
   * and no percentage at all, which is the designed fallback: a delta nobody
   * measured is worse than no delta.
   *
   * `invertDelta` is set wherever DOWN is the good direction, which on this
   * register is almost everywhere — more open lines, more overdue lines, more
   * money tied up and older stock are all bad news, and a green arrow over them
   * would congratulate a reader on a worsening position.
   */
  kpis: (s) => {
    const prev = s.previous
    const vsMonth = prev ? 'vs. last month' : 'all matching rows'
    // The series is optional at every level: the endpoint omits it on a filtered
    // set too large to reconstruct cheaply, and a caller may hand these cards a
    // summary built without one. Two points is the minimum a line can be drawn
    // from, and below that the cards simply carry no sparkline.
    const trend = s.trend ?? []
    const spark = (pick: (p: PendingTrendPoint) => number) =>
      trend.length >= 2 ? <Sparkline points={trend.map(pick)} /> : undefined

    return [
      {
        key: 'open_lines',
        label: 'Open lines',
        value: formatInt(s.open_lines),
        icon: Package,
        tone: 'info',
        current: s.open_lines,
        previous: prev?.open_lines ?? null,
        invertDelta: true,
        hint: vsMonth,
        sparkline: spark((p) => p.open_lines),
      },
      {
        key: 'open_quantity',
        label: 'Open quantity',
        value: formatQty(s.open_quantity),
        icon: Clock,
        tone: 'warning',
        current: s.open_quantity,
        previous: prev?.open_quantity ?? null,
        invertDelta: true,
        hint: vsMonth,
        sparkline: spark((p) => p.open_quantity),
      },
      {
        key: 'overdue_lines',
        label: 'Overdue lines',
        value: formatInt(s.overdue_lines),
        icon: AlarmClock,
        tone: 'danger',
        current: s.overdue_lines,
        previous: prev?.overdue_lines ?? null,
        invertDelta: true,
        hint: vsMonth,
      },
      {
        key: 'pending_value',
        label: 'Pending value (at cost)',
        value: formatMoney(s.pending_value),
        icon: Coins,
        tone: 'primary',
        current: s.pending_value,
        previous: prev?.pending_value ?? null,
        invertDelta: true,
        hint: vsMonth,
        sparkline: spark((p) => p.pending_value),
      },
      {
        key: 'settled_today',
        label: 'Settled today',
        value: formatInt(s.settled_today),
        icon: CircleCheck,
        tone: 'success',
        current: s.settled_today,
        previous: prev?.settled_today ?? null,
        // The one figure here where up is good.
        hint: prev ? 'vs. yesterday' : `${formatQty(s.settled_today_qty)} qty settled`,
      },
      {
        key: 'average_ageing',
        label: 'Avg. ageing',
        value: `${formatInt(Math.round(s.average_ageing_days))} days`,
        icon: Hourglass,
        tone: 'violet',
        current: s.average_ageing_days,
        previous: prev?.average_ageing_days ?? null,
        invertDelta: true,
        hint: vsMonth,
      },
    ]
  },

  // The fallback for the eight report configs; this register declares `kpis`, so
  // it is only ever read by the export sheet's summary block.
  summary: (s) => [
    { label: 'Open lines', value: formatInt(s.open_lines) },
    { label: 'Open quantity', value: formatQty(s.open_quantity), tone: 'warning' },
    { label: 'Overdue lines', value: formatInt(s.overdue_lines), tone: 'critical' },
    { label: 'Pending value (at cost)', value: formatMoney(s.pending_value) },
  ],

  // The third argument carries the filters the register was actually asked, so
  // every insight can link back into itself narrowed by one more thing rather
  // than resetting what the reader already set.
  insights: (s, _response, { values }) => buildPendingInsights(s, s.breakdowns, values),

  emptyMessage: 'No pending quantity lines match the selected filters.',
  /**
   * The endpoint tells the two apart, so the screen does too.
   *
   * `unfilteredEmpty` is the server's answer to "is anything outstanding at all,
   * filters aside" — asked only when the page came back empty. A reader who has
   * narrowed to one warehouse in a company that is completely square should be
   * told they are square, not sent hunting for a filter that was never the
   * problem. With nothing narrowed the question does not arise.
   */
  emptyUnfiltered: (s, activeFilterCount) =>
    s.unfilteredEmpty || activeFilterCount === 0 ? (
      <EmptyState
        icon={CircleCheck}
        title="Nothing is pending"
        description="Everything issued or expected has been settled for this company and branch."
      />
    ) : null,
})

export default pendingRegister
