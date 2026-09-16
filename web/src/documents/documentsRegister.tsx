import { useState } from 'react'
import { Coins, FileText, Layers, Printer } from 'lucide-react'
import { Button } from '../ui/Button'
import { StatusBadge } from '../ui/StatusBadge'
import { notify } from '../ui/notify'
import { useExportIdentity } from '../export/useExportIdentity'
import { P } from '../services/access'
import { documentsApi } from '../services/documentsApi'
import { defineRegister } from '../registers/RegisterConfig'
import type { RegisterConfig, RegisterSelection } from '../registers/RegisterConfig'
import { buildTotalsRow, totalsLabel } from '../registers/registerTotals'
import { pageHint, summaryOverRows, withPageSummary } from '../registers/configs/pageSummary'
import type { PageSummary } from '../registers/configs/pageSummary'
import { DASH, dateColumn, dateTimeColumn, itemFilter, warehouseFilter } from '../reports/configs/common'
import type { ReportColumn, ReportFilter } from '../reports/types'
import { formatInt, formatMoney } from '../utils/format'
import { STATUS_LABELS } from './actions'
import { NewDocumentMenu } from './NewDocumentMenu'
import { bulkPrintDocuments } from './printDocument'
import { labelForCode, specForCode } from './registry'
import type { DocumentTypeSpec } from './registry'
import { DOCUMENT_STATUSES } from './types'
import type { DocumentListRow, DocumentStatus } from './types'
import { useReferenceData } from './useReferenceData'

/**
 * `/documents` as a register.
 *
 * The screen this replaces was a plain list: a row of bare `<select>` boxes, no
 * export, no print, no totals, no KPI strip and no column configuration. Books'
 * Delivery Challan Register — the screen a user is on immediately before
 * following the hand-off link here — offers Excel, PDF, print and bulk print.
 * Landing on strictly less than you left is the complaint, so this is declared
 * as a `RegisterConfig` and rendered by the one register engine, which brings
 * all of that with it.
 *
 * Deep links from Books arrive as `/documents?document_type=<CODE>`
 * (books-react-app .../registers/inventoryHistoricalRegisters.js). `document_type`
 * is a declared filter, so the engine applies it from the URL, and
 * `documentsRegister(code)` names the type in the heading and the breadcrumb so
 * the reader can see which register they landed on.
 */

/** Columns whose page sums the footer and the KPI strip report. */
const SUM_KEYS = ['line_count', 'valuation_total'] as const
/** The same, for a register of a type whose lines are never valued. */
const UNVALUED_SUM_KEYS = ['line_count'] as const

/**
 * Sortable only where the server actually sorts.
 *
 * DocumentsController::index whitelists document_date, document_no,
 * document_type, status, created_at and document_id and silently falls back to
 * document_date for anything else — so a sort control on Party or Lines would
 * move the arrow, re-fetch, and hand back the same order. That reads as
 * "sorted by party", wrongly.
 */
const SERVER_SORTABLE = new Set(['document_date', 'document_no', 'document_type', 'status', 'created_at'])

/**
 * Enforce the whitelist above rather than trusting every column to remember it.
 *
 * `textColumn` and friends default to `sortable = true`, so a column added to
 * the list below carries a sort control unless somebody remembers this comment.
 * Running the list through here means the whitelist is the guard it claims to
 * be: a `sortKey` the server does not honour is dropped, and the header renders
 * without an arrow instead of promising an order the rows are not in.
 */
export function serverSortableOnly<T>(columns: readonly ReportColumn<T>[]): ReportColumn<T>[] {
  return columns.map((col) =>
    col.sortKey && !SERVER_SORTABLE.has(col.sortKey) ? { ...col, sortKey: undefined } : col,
  )
}

/**
 * Types declared `valuation => false` that still value the stock they move.
 *
 * Mirrors `Config\DocumentTypeRegistry::VALUES_MOVED_STOCK`: an inward challan
 * carries no valuation as a *type*, but a settle_deferred or physical one is a
 * receipt like any other and its lines do carry `valuation_amount`.
 */
const VALUES_MOVED_STOCK = new Set(['INWARD_CHALLAN'])

/**
 * Can a register of this type ever show a valuation figure?
 *
 * `valuation_total` is `COALESCE(SUM(l.valuation_amount), 0)`, and
 * `DocumentPostingService::valuesLines` never writes `valuation_amount` for a
 * type declared `valuation => false` — DELIVERY_CHALLAN, JOB_WORK_OUT, PACKING,
 * the two adjustment types and the two reservation types. On those, the column
 * is a row of dashes and the card reads "Valuation 0.00 — what the stock cost",
 * which a reader takes as an answer: the dispatched stock is worth nothing, or
 * Inventory has lost the challan values. It is neither. The figure they want is
 * the commercial one, which Books owns and which is deliberately not here — so
 * the register says that in its description and shows no valuation at all,
 * rather than showing a zero.
 *
 * The all-types register keeps the column: most of its rows ARE valued.
 * An unrecognised code keeps it too — saying nothing beats hiding a real figure.
 */
function typeIsValued(code: string | null, spec: DocumentTypeSpec | null): boolean {
  if (!code || !spec) return true
  return spec.valuation || VALUES_MOVED_STOCK.has(code)
}

const SOURCE_LABELS: Record<string, string> = {
  inventory: 'Inventory',
  books: 'Books',
}

function sourceText(row: DocumentListRow): string {
  const app = SOURCE_LABELS[row.source_app] ?? row.source_app
  if (row.source_app === 'inventory') return app
  return row.source_document_no ? `${app} · ${row.source_document_no}` : app
}

const COLUMNS: ReportColumn<DocumentListRow>[] = serverSortableOnly<DocumentListRow>([
  dateColumn<DocumentListRow>('document_date', 'Date'),
  {
    key: 'document_type',
    header: 'Type',
    sortKey: 'document_type',
    minWidth: 160,
    render: (r) => r.document_type_label ?? labelForCode(r.document_type),
    csv: (r) => r.document_type_label ?? labelForCode(r.document_type),
  },
  {
    key: 'document_no',
    header: 'Number',
    sortKey: 'document_no',
    // Identifies the row: a register of dates and amounts with no document
    // number against them cannot be reconciled against anything.
    alwaysVisible: true,
    render: (r) => <span className="font-mono text-xs">{r.document_no ?? `#${r.document_id}`}</span>,
    csv: (r) => r.document_no ?? `#${r.document_id}`,
  },
  {
    key: 'party_name',
    header: 'Party',
    minWidth: 160,
    render: (r) => r.party_name ?? (r.party_ref ? `#${r.party_ref}` : DASH),
    csv: (r) => r.party_name ?? (r.party_ref ? `#${r.party_ref}` : ''),
  },
  {
    key: 'status',
    header: 'Status',
    sortKey: 'status',
    render: (r) => (
      <StatusBadge value={r.status} label={STATUS_LABELS[r.status as DocumentStatus] ?? r.status} />
    ),
    csv: (r) => STATUS_LABELS[r.status as DocumentStatus] ?? r.status,
  },
  {
    key: 'line_count',
    header: 'Lines',
    align: 'right',
    format: 'int',
    render: (r) => formatInt(r.line_count),
    csv: (r) => Number(r.line_count) || 0,
  },
  {
    /*
     * VALUATION, not the commercial value.
     *
     * `valuation_total` is SUM(inv_document_lines.valuation_amount) — what the
     * stock on this document cost, which is what drives COGS and closing stock.
     * It is NOT source_transaction_amount, the price agreed with the party,
     * which Books owns and which drives GST, receivables and turnover. The old
     * column header said "Value", which reads as either. On a printed register
     * that ambiguity is a wrong number.
     */
    key: 'valuation_total',
    header: 'Valuation',
    align: 'right',
    amount: true,
    format: 'amount',
    configureLabel: 'Valuation',
    configureHint: 'What the stock on the document cost. Not the price agreed with the party.',
    render: (r) => (Number(r.valuation_total) ? formatMoney(r.valuation_total) : DASH),
    csv: (r) => Number(r.valuation_total) || 0,
  },
  {
    key: 'source_app',
    header: 'Source',
    configureHint: 'Which product entered the document.',
    render: (r) =>
      r.source_app === 'inventory' ? (
        <span className="text-gray-400">Inventory</span>
      ) : (
        sourceText(r)
      ),
    csv: sourceText,
  },
  {
    key: 'narration',
    header: 'Narration',
    defaultVisible: false,
    minWidth: 220,
    render: (r) => r.narration ?? DASH,
    csv: (r) => r.narration ?? '',
  },
  { ...dateTimeColumn<DocumentListRow>('posted_at', 'Posted at', false), defaultVisible: false },
  { ...dateTimeColumn<DocumentListRow>('created_at', 'Entered at'), defaultVisible: false },
])

/**
 * The period has NO default.
 *
 * The server already scopes the list to the selected financial year, and Books
 * links here with no dates at all. Defaulting the range to "FY to date" would
 * hide a document dated later in the year from a reader who followed that link
 * and never touched the filter — rows missing from a register are the one
 * failure a reader cannot see.
 */
const FILTERS: ReportFilter[] = [
  { key: 'q', kind: 'text', label: 'Search', placeholder: 'Number, party or source…', grow: true },
  { key: 'document_type', kind: 'document_type', label: 'Type' },
  {
    key: 'status',
    kind: 'select',
    label: 'Status',
    options: DOCUMENT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
    placeholder: 'All statuses',
  },
  { key: 'from', toKey: 'to', kind: 'date_range', label: 'Period' },
  { key: 'to', kind: 'date', label: 'To', hidden: true },
  { ...warehouseFilter, placeholder: 'All warehouses' },
  itemFilter,
  {
    key: 'source_app',
    kind: 'select',
    label: 'Source',
    options: [
      { value: 'inventory', label: 'Entered in Inventory' },
      { value: 'books', label: 'From Books' },
    ],
    placeholder: 'Any source',
  },
]

const totalsColumnsFor = (columns: readonly ReportColumn<DocumentListRow>[]) =>
  columns.map((c) => ({ key: c.key, align: c.align }))

/* --------------------------------------------------------------- bulk print */

/**
 * Print every ticked document, one letterheaded sheet each, snapshot first.
 *
 * A component rather than a closure so `SELECTION` below stays a constant: the
 * register config must not be rebuilt on every tick, or the engine's filter and
 * column state is torn down under the reader's hands.
 */
function BulkPrintButton({
  rows,
  onDone,
}: {
  rows: readonly DocumentListRow[]
  onDone: () => void
}) {
  const identity = useExportIdentity()
  const { warehouseName } = useReferenceData()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const result = await bulkPrintDocuments(
        rows.map((r) => r.document_id),
        { identity, warehouseName, typeLabel: (code) => labelForCode(code) },
      )
      if (result.printed === 0) {
        notify.error(
          `Nothing could be printed. ${result.failures[0]?.reason ?? 'The documents could not be loaded.'}`,
        )
        return
      }
      if (!result.opened) {
        notify.error('The print sheet could not be opened. Check the browser’s popup settings.')
        return
      }
      if (result.failures.length) {
        // Named, not swallowed: a reader must know the batch is short and which
        // documents are missing from the paper in their hand.
        notify.error(
          `${result.printed} of ${rows.length} documents printed. Could not print: ${result.failures
            .map((f) => `#${f.documentId} (${f.reason})`)
            .join(', ')}.`,
        )
      } else {
        notify.success(
          `${result.printed} document${result.printed === 1 ? '' : 's'} sent to the printer.`,
        )
        onDone()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button size="xs" variant="secondary" icon={Printer} loading={busy} onClick={() => void run()}>
      Print {rows.length} document{rows.length === 1 ? '' : 's'}
    </Button>
  )
}

const SELECTION: RegisterSelection<DocumentListRow> = {
  idOf: (row) => row.document_id,
  label: 'Select document',
  actions: (selected, clear) => <BulkPrintButton rows={selected} onDone={clear} />,
}

/* ------------------------------------------------------------------ config */

function filenameFor(documentType: string | null): string {
  if (!documentType) return 'inventory-documents'
  return `${documentType.toLowerCase().replace(/_/g, '-')}-documents`
}

/**
 * The documents register, optionally narrowed to one document type.
 *
 * `documentType` changes the chrome — heading, breadcrumb, description, export
 * filename — and one thing more: on a type whose lines are structurally never
 * valued it drops the Valuation column, card and total rather than printing a
 * zero (see `typeIsValued`). The ROWS are narrowed by the `document_type` filter
 * the engine reads out of the URL, which is what makes the Books hand-off link
 * work without a second code path.
 */
export function documentsRegister(
  documentType: string | null,
): RegisterConfig<DocumentListRow, PageSummary> {
  const spec = documentType ? specForCode(documentType) : null
  const typeLabel = documentType ? (spec?.label ?? labelForCode(documentType)) : null
  // A type whose lines are never valued shows no Valuation column, no Valuation
  // card and no Valuation total — see `typeIsValued`.
  const valued = typeIsValued(documentType, spec ?? null)
  const columns = valued ? COLUMNS : COLUMNS.filter((c) => c.key !== 'valuation_total')
  const totalsColumns = totalsColumnsFor(columns)
  const sumKeys: readonly string[] = valued ? SUM_KEYS : UNVALUED_SUM_KEYS

  return defineRegister<DocumentListRow, PageSummary>({
    slug: 'documents',
    path: 'documents',
    permission: P.documentsRead,
    title: typeLabel ? `${typeLabel} register` : 'Inventory documents',
    description: typeLabel
      ? valued
        ? `Every ${typeLabel.toLowerCase()} in the selected company, financial year and branch — status, lines and what the stock cost`
        : `Every ${typeLabel.toLowerCase()} in the selected company, financial year and branch — status and lines. This type carries no valuation: it moves no stock value, and the amount agreed with the party belongs to the Books voucher.`
      : 'Every stock document in the selected company, financial year and branch — what it moved, what it cost and which product entered it',
    // The register header is the breadcrumb trail (BreadcrumbHeader in compact
    // mode prints the trail, not a second <h1>), so the type has to be named
    // there or a reader following the Books hand-off cannot tell which register
    // they landed on.
    breadcrumbs: typeLabel
      ? [{ label: 'Documents', to: '/documents' }, { label: `${typeLabel} register` }]
      : [{ label: 'Inventory documents' }],
    // One line for the hero and the hub tile. `description` is the export
    // sheet's blurb and, on an unvalued type, a three-sentence explanation the
    // `extra` callout below already makes — printing both put the same
    // paragraph on the screen twice.
    shortDescription: typeLabel
      ? `Every ${typeLabel.toLowerCase()} in the selected company, year and branch`
      : 'Every stock document in the selected company, year and branch',
    // No parent screen: the documents register is a top-level destination, not
    // a register reached from /registers.
    backTo: null,
    // The register is where a reader already is when they need to raise one, so
    // the entry point stays on it — alongside, not instead of, the nav's hub.
    headerActions: <NewDocumentMenu />,
    icon: FileText,
    defaultSort: 'document_date',
    defaultOrder: 'desc',
    defaultLimit: 50,
    minWidth: 1200,
    rowNoun: 'document',
    filenameBase: filenameFor(documentType),
    // One preference set for the register and every per-type view of it: a
    // reader who hid Narration once should not have to hide it eight times.
    columnPrefsKey: 'documents',
    filters: FILTERS,
    columns,
    rowKey: (r) => r.document_id,
    drillTo: (r) => `/documents/${r.document_id}`,
    selectable: SELECTION,
    fetch: async ({ query, signal }) =>
      withPageSummary(await documentsApi.list(query, signal), 'documents', sumKeys),
    // `/v1/inventory-documents` sends rows and a count and no aggregate, so the
    // sums are of the served page and every figure says so. An export walks
    // every page, and summaryForRows re-totals over what it wrote — at which
    // point the caveat stops being true and disappears by itself.
    summaryForRows: (summary, rows) => summaryOverRows(summary, rows, sumKeys),
    /*
     * The pinned footer says whose rows it totals, exactly as the movement and
     * reservation registers do (configs/stockRegisters.tsx, configs/opsRegisters.tsx).
     *
     * `/v1/inventory-documents` sends no aggregate, so `s.sums` is over the
     * served page alone. A footer under a table of 50 rows reading "Total" with
     * a currency figure beside it is read as the register's total — and quoted,
     * and printed — while the KPI strip two inches above says 4,182. It is the
     * figure a reader trusts most, so it is the one that must carry the caveat.
     * On an export the caveat removes itself: the sheet is re-totalled over
     * every row it wrote, and `pageHint` then reads "all rows".
     */
    totals: (s) =>
      buildTotalsRow(
        totalsColumns,
        valued
          ? {
              line_count: formatInt(s.sums.line_count),
              valuation_total: formatMoney(s.sums.valuation_total),
            }
          : { line_count: formatInt(s.sums.line_count) },
        {
          label: `${totalsLabel(s.pageRows, 'document')} — ${pageHint(s)}`,
          labelKey: 'document_no',
        },
      ),
    /*
     * No card carries a `to`.
     *
     * dashboard/kpiNavigation.ts is binding: "a card may only navigate
     * somewhere that reproduces the number it shows". The obvious cards to
     * link — Drafts, Pending approval, Failed — cannot honour it, because
     * `/v1/inventory-documents` sends no aggregate: a count derived from the
     * served page would disagree with the total shown by the very register the
     * card navigates to. A card that cannot honour the rule is not added, and
     * the two page-derived figures below say "this page only" instead of
     * pretending to be totals.
     */
    kpis: (s) => [
      {
        key: 'documents',
        label: typeLabel ? `${typeLabel}s` : 'Documents',
        value: formatInt(s.total),
        hint: 'Matching these filters',
        icon: FileText,
        tone: 'primary',
      },
      {
        key: 'lines',
        label: 'Lines',
        value: formatInt(s.sums.line_count),
        hint: pageHint(s),
        icon: Layers,
        tone: 'info',
      },
      ...(valued
        ? [
            {
              key: 'valuation',
              label: 'Valuation',
              value: formatMoney(s.sums.valuation_total),
              hint: `${pageHint(s)} · what the stock cost`,
              icon: Coins,
              tone: 'success' as const,
              current: s.sums.valuation_total,
              emphasizeNegative: true,
            },
          ]
        : []),
    ],
    summary: (s) => [
      { label: 'Documents', value: formatInt(s.total) },
      { label: 'Lines', value: formatInt(s.sums.line_count), hint: pageHint(s) },
      ...(valued
        ? [{ label: 'Valuation', value: formatMoney(s.sums.valuation_total), hint: pageHint(s) }]
        : []),
    ],
    /*
     * On an unvalued register, say so on the screen as well as on the sheet.
     *
     * A reader arrives here from Books' own register for this document type,
     * which shows the challan value on every line. Finding no value column at
     * all and no word about it reads as a missing feature or lost data. The
     * answer is that this type of document moves no stock value and that the
     * amount agreed with the party is the Books voucher's — so the screen says
     * exactly that, once, above the table.
     */
    extra: valued
      ? undefined
      : () => (
          <div className="shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 print:hidden">
            A {typeLabel?.toLowerCase() ?? 'document'} carries no valuation: its lines move no
            stock value, so there is nothing for this register to cost. The amount agreed with the
            party is commercial and belongs to the Books voucher.
          </div>
        ),
    emptyMessage: 'No document matches these filters. Widen the period or clear a filter.',
  })
}

/**
 * The column list, the filter list and the sort whitelist, for the tests in
 * `documentsRegister.test.tsx` that hold them as a contract — see that file for
 * what each one guarantees.
 */
export const DOCUMENT_REGISTER_COLUMNS = COLUMNS
export const DOCUMENT_REGISTER_FILTERS = FILTERS
export { SERVER_SORTABLE as DOCUMENT_REGISTER_SORTABLE }
