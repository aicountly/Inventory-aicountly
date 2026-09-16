import { useCallback, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeftRight,
  ChartNoAxesCombined,
  FileText,
  History,
  Lightbulb,
  ListTree,
  Play,
} from 'lucide-react'
import { useCan } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { useScopeLabel } from '../../company/useScopeLabel'
import { ListSheetActions } from '../../components/ListSheetActions'
import { Notice } from '../../components/Notice'
import { Pagination } from '../../components/Pagination'
import { RequirePermission } from '../../components/RequirePermission'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import type { ExportableColumn } from '../../registers/registerCells'
import { P } from '../../services/access'
import { ApiError } from '../../services/api'
import { fetchAllRows } from '../../services/listAll'
import { reconciliationApi } from '../../services/reconciliationApi'
import type { ReconciliationRun } from '../../services/reconciliationApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card, CardHeader } from '../../ui/Card'
import { EmptyState } from '../../ui/EmptyState'
import { Input } from '../../ui/Input'
import { StatusBadge } from '../../ui/StatusBadge'
import { Tooltip } from '../../ui/Tooltip'
import { cx } from '../../ui/cx'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { SmartTable } from '../../ui/shell/SmartTable'
import type { SmartColumn } from '../../ui/shell/SmartTable'
import { useToast } from '../../ui/ToastContext'
import { formatDate, formatDateTime, formatMoney, formatQty, humanize, todayIso } from '../../utils/format'
import { ReconciliationExplainer } from './ReconciliationExplainer'
import { ReconciliationFilters } from './ReconciliationFilters'
import type { ReconciliationFilterValues } from './ReconciliationFilters'
import { ReconciliationSummary } from './ReconciliationSummary'
import { ReconciliationTabs } from './ReconciliationTabs'
import { ReconciliationTrend } from './ReconciliationTrend'
import { TopVariances } from './VarianceBreakdown'
import {
  booksAnswered,
  bucketRows,
  differencePercent,
  differenceTone,
  formatPercent,
  headlineRun,
  previousCompletedRun,
  trendPoints,
} from './reconciliationModel'

const FILTER_KEYS = ['status', 'from', 'to', 'all_fy'] as const

/** How many runs the headline strip and the trend look back over. */
const HEADLINE_RUNS = 12
const TREND_RUNS = 7

const STATUS_TONE: Record<string, 'good' | 'critical' | 'warning'> = {
  COMPLETED: 'good',
  FAILED: 'critical',
  BOOKS_UNAVAILABLE: 'warning',
}

/** What the By column says when `requested_by` is null. Screen and sheet alike. */
const NO_ACTOR = 'Not recorded'

/** What the Books column says when Books never answered. Never ₹0. */
const NO_BOOKS = 'Not reported'

/**
 * The sheet's columns. Both totals are named for the side they come from, and
 * the difference states its own direction, because a printed reconciliation
 * whose sign convention is implied is a document two readers will argue over.
 */
const EXPORT_COLUMNS: ExportableColumn<ReconciliationRun>[] = [
  { key: 'run_id', csvHeader: 'Run', align: 'right', format: 'int' },
  { key: 'as_of_date', csvHeader: 'As at', format: 'date' },
  { key: 'created_at', csvHeader: 'Run at', format: 'datetime' },
  { key: 'status', csvHeader: 'Status', csv: (r) => humanize(r.status) },
  { key: 'inventory_closing_qty', csvHeader: 'Inventory closing qty', align: 'right', format: 'qty' },
  { key: 'inventory_closing_value', csvHeader: 'Inventory closing value (valuation)', align: 'right', format: 'amount' },
  {
    key: 'books_stock_ledger_balance',
    csvHeader: 'Books stock ledger balance',
    align: 'right',
    format: 'amount',
    // A run Books never answered has no balance. Exporting the null as a blank
    // amount cell reads as zero in a spreadsheet, so the file says the words.
    csv: (r) => (booksAnswered(r) ? (r.books_stock_ledger_balance ?? '') : NO_BOOKS),
  },
  { key: 'difference', csvHeader: 'Difference (Inventory − Books)', align: 'right', format: 'amount' },
  { key: 'difference_pct', csvHeader: 'Difference %', align: 'right', csv: (r) => formatPercent(differencePercent(r)) },
  // The screen and the file say the same words for the same cell. A run with no
  // actor is one nobody was recorded for — NOT a scheduled run: there is no
  // scheduler in this deployment, which is what the explainer above the table
  // says in as many words.
  { key: 'requested_by', csvHeader: 'Requested by', csv: (r) => r.requested_by ?? NO_ACTOR },
]

/** A two-line column header: what the figure is, and what it is measured on. */
function ColumnHead({ label, note }: { label: string; note: string }) {
  return (
    <span className="inline-flex flex-col leading-tight">
      <span>{label}</span>
      <span className="text-[10px] font-medium normal-case tracking-normal text-gray-400">{note}</span>
    </span>
  )
}

export function ReconciliationRunsPage() {
  const { scope, branches, boId, selectBranch } = useCompany()
  const scopeLabel = useScopeLabel()
  const toast = useToast()
  const canRun = useCan(P.reconciliationResolve)
  const params = useListParams({ sort: 'created_at', order: 'desc', limit: 50, filterKeys: FILTER_KEYS })
  const { state, query } = params
  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null

  const list = useQuery(
    (signal) => reconciliationApi.runs(query, signal),
    [JSON.stringify(query), scopeKey],
    { enabled: scope !== null, resetKey: scopeKey },
  )

  /*
   * The headline figures speak for the LATEST run in this scope, not for
   * whatever happens to be on the page in front of you: sort the table by
   * difference, or page back through March, and the four cards must not start
   * reporting March as the current position.
   *
   * They are still served by one request, not five — and not even that one
   * while the table is showing exactly what they need, which is the common
   * case of an unfiltered first page.
   */
  const tableIsHeadline =
    state.page === 1 &&
    state.sort === 'created_at' &&
    state.order === 'desc' &&
    !state.filters.status &&
    !state.filters.from &&
    !state.filters.to
  const recent = useQuery(
    (signal) => reconciliationApi.runs({ limit: HEADLINE_RUNS, sort: 'as_of_date', order: 'desc' }, signal),
    [scopeKey],
    { enabled: scope !== null && !tableIsHeadline, resetKey: scopeKey },
  )
  const headlineSource = tableIsHeadline ? (list.data?.data ?? []) : (recent.data?.data ?? [])
  const headlineLoading = tableIsHeadline ? list.loading : recent.loading

  const latest = useMemo(() => headlineRun(headlineSource), [headlineSource])
  const previous = useMemo(() => previousCompletedRun(headlineSource, latest), [headlineSource, latest])
  const trend = useMemo(() => trendPoints(headlineSource, TREND_RUNS), [headlineSource])

  /* The bucket breakdown lives on the run itself — one extra read for the run
     the cards are already reporting, reused by the trend panel beside it. */
  const detail = useQuery(
    (signal) => reconciliationApi.get(latest?.run_id ?? 0, signal),
    [latest?.run_id ?? 0, scopeKey],
    { enabled: scope !== null && Boolean(latest?.run_id), resetKey: scopeKey },
  )
  const breakdown = detail.data?.breakdown ?? null
  const varianceRows = useMemo(() => bucketRows(breakdown), [breakdown])

  const [asOf, setAsOf] = useState(todayIso())
  const [running, setRunning] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const inFlight = useRef(false)

  const reloadAll = useCallback(() => {
    list.reload()
    if (!tableIsHeadline) recent.reload()
    if (latest?.run_id) detail.reload()
  }, [list, recent, detail, tableIsHeadline, latest?.run_id])

  const runNow = async () => {
    // A double-click must not post two runs: the ref is checked before the
    // state update that disables the button has had a chance to render.
    if (inFlight.current) return
    inFlight.current = true
    setRunning(true)
    setAnnouncement(`Running reconciliation as at ${formatDate(asOf)}…`)
    try {
      const run = await reconciliationApi.run(asOf)
      const message =
        run.status === 'BOOKS_UNAVAILABLE'
          ? `Reconciliation #${run.run_id} ran, but Books could not be reached — only the Inventory side is known.`
          : `Reconciliation #${run.run_id} ${humanize(run.status).toLowerCase()} — difference ₹ ${formatMoney(run.difference)}.`
      setAnnouncement(message)
      toast.success(message)
      reloadAll()
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Could not run the reconciliation.'
      setAnnouncement(message)
      toast.error(message)
    } finally {
      inFlight.current = false
      setRunning(false)
    }
  }

  const fetchAll = useMemo(
    () => () => fetchAllRows<ReconciliationRun>((page, limit) => reconciliationApi.runs({ ...query, page, limit })),
    [query],
  )

  const columns = useMemo<SmartColumn<ReconciliationRun>[]>(
    () => [
      {
        key: 'run_id',
        header: '#',
        sortKey: 'run_id',
        width: 52,
        render: (r) => (
          <Link to={`/reconciliation/${r.run_id}`} className="font-semibold text-primary">
            {r.run_id}
          </Link>
        ),
      },
      {
        key: 'as_of_date',
        header: 'As at',
        sortKey: 'as_of_date',
        cellClassName: 'whitespace-nowrap',
        render: (r) => formatDate(r.as_of_date),
      },
      {
        // Date over time, not one long line: the column is read against "As at"
        // beside it, and the two dates are usually the same.
        key: 'created_at',
        header: 'Run',
        sortKey: 'created_at',
        cellClassName: 'whitespace-nowrap',
        render: (r) => {
          const stamp = formatDateTime(r.created_at)
          const [date, time] = stamp.split(', ')
          return (
            <span className="inline-flex flex-col leading-tight">
              <span>{date}</span>
              {time ? <span className="text-[11px] text-gray-400">{time}</span> : null}
            </span>
          )
        },
      },
      {
        key: 'status',
        header: 'Status',
        render: (r) => <StatusBadge value={r.status} tone={STATUS_TONE[r.status] ?? 'neutral'} />,
      },
      {
        key: 'inventory_closing_qty',
        header: 'Inventory qty',
        align: 'right',
        sortKey: 'inventory_closing_qty',
        render: (r) => formatQty(r.inventory_closing_qty),
      },
      // The same qualifiers the sheet carries. Two right-aligned money columns
      // whose owner is implied, and a bare "Difference" whose sign convention is
      // stated only in the exported file, is a screen two readers argue over.
      {
        key: 'inventory_closing_value',
        header: <ColumnHead label="Inventory value (₹)" note="valuation" />,
        align: 'right',
        sortKey: 'inventory_closing_value',
        render: (r) => formatMoney(r.inventory_closing_value),
      },
      {
        key: 'books_stock_ledger_balance',
        header: <ColumnHead label="Books stock ledger (₹)" note="Stock-in-Hand" />,
        align: 'right',
        sortKey: 'books_stock_ledger_balance',
        render: (r) =>
          booksAnswered(r) ? (
            formatMoney(r.books_stock_ledger_balance)
          ) : (
            <Tooltip label="Books did not answer for this run. A blank is not a zero balance.">
              <span className="text-amber-600">{NO_BOOKS}</span>
            </Tooltip>
          ),
      },
      {
        key: 'difference',
        header: <ColumnHead label="Difference (₹)" note="Inventory − Books" />,
        align: 'right',
        sortKey: 'difference',
        render: (r) => {
          const tone = differenceTone(r.difference)
          if (!booksAnswered(r)) return <span className="text-gray-400">—</span>
          return (
            <span
              className={cx(
                'font-semibold tabular-nums',
                tone === 'good' ? 'text-emerald-700' : tone === 'warning' ? 'text-amber-600' : 'text-red-600',
              )}
            >
              {formatMoney(r.difference)}
            </span>
          )
        },
      },
      {
        key: 'difference_pct',
        header: 'Difference %',
        align: 'right',
        render: (r) => {
          const pct = differencePercent(r)
          if (pct === null) return <span className="text-gray-400">—</span>
          const tone = differenceTone(r.difference)
          return (
            <Badge tone={tone === 'good' ? 'success' : tone === 'warning' ? 'warning' : 'danger'} size="xs">
              {formatPercent(pct)}
            </Badge>
          )
        },
      },
      {
        key: 'requested_by',
        header: 'By',
        render: (r) =>
          r.requested_by ? (
            <Tooltip label={r.requested_by}>
              <span className="block w-[7.5rem] truncate">{r.requested_by}</span>
            </Tooltip>
          ) : (
            <span className="text-gray-400">{NO_ACTOR}</span>
          ),
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        render: (r) => (
          <span className="inline-flex items-center justify-end gap-0.5 print:hidden">
            <Tooltip label="View run details and its full breakdown">
              <Link
                to={`/reconciliation/${r.run_id}`}
                aria-label={`View details of run ${r.run_id}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-primary"
              >
                <FileText className="h-4 w-4" aria-hidden />
              </Link>
            </Tooltip>
            <Tooltip label="Variance analysis for this run">
              <Link
                to={`/reconciliation/variance?run=${r.run_id}`}
                aria-label={`Variance analysis for run ${r.run_id}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-primary"
              >
                <ChartNoAxesCombined className="h-4 w-4" aria-hidden />
              </Link>
            </Tooltip>
            <Tooltip label="Audit trail — what Inventory sent Books">
              <Link
                to="/integration/outbox"
                aria-label={`Audit trail around run ${r.run_id}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-primary"
              >
                <History className="h-4 w-4" aria-hidden />
              </Link>
            </Tooltip>
          </span>
        ),
      },
    ],
    [],
  )

  const filterValues: ReconciliationFilterValues = {
    status: state.filters.status ?? '',
    from: state.filters.from ?? '',
    to: state.filters.to ?? '',
    allFy: state.filters.all_fy === '1',
  }
  const filtered = Boolean(filterValues.status || filterValues.from || filterValues.to || filterValues.allFy)
  const clearFilters = () => params.setFilters({ status: '', from: '', to: '', all_fy: '' })

  const meta = list.data?.meta ?? null
  const rows = list.data?.data ?? []
  const total = meta?.total ?? 0

  const summaryCards = latest
    ? [
        { label: 'Inventory value', value: `₹ ${formatMoney(latest.inventory_closing_value)}` },
        {
          label: 'Books stock ledger',
          value: booksAnswered(latest) ? `₹ ${formatMoney(latest.books_stock_ledger_balance)}` : NO_BOOKS,
          tone: booksAnswered(latest) ? ('default' as const) : ('warn' as const),
        },
        {
          label: 'Difference (Inventory − Books)',
          value: booksAnswered(latest) ? `₹ ${formatMoney(latest.difference)}` : '—',
          hint: formatPercent(differencePercent(latest), '') || undefined,
          tone: differenceTone(latest.difference) === 'critical' ? ('credit' as const) : ('default' as const),
        },
      ]
    : undefined

  return (
    <PageShell fullBleed>
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Inventory', to: '/' }, { label: 'Reconciliation' }]}
        icon={ArrowLeftRight}
        // Wraps rather than truncating: the shared header ellipsises a long
        // title, and "Inventory ↔ Books Reconci…" is not a heading.
        title={<span className="whitespace-normal">Inventory ↔ Books Reconciliation</span>}
        description="Compare your inventory value with the Stock-in-Hand ledger in Books, identify variances and take corrective action."
        meta={<span className="text-[11px] text-gray-500">{scopeLabel}</span>}
        escBack={false}
        actions={
          /* Capped so the five actions wrap onto two rows on a laptop instead
             of squeezing the title beside them down to an ellipsis; released
             at lg, where they fit on one line. */
          <div className="flex max-w-[23rem] flex-wrap items-center justify-end gap-2 lg:max-w-none">
            <ListSheetActions<ReconciliationRun>
              columns={EXPORT_COLUMNS}
              rows={rows}
              fetchAll={fetchAll}
              filenameBase="reconciliation-runs"
              title="Inventory ↔ Books reconciliation"
              description="Closing stock value compared with the Books Stock-in-Hand ledger, run by run"
              scopePeriod={latest ? `as at ${formatDate(latest.as_of_date)}` : undefined}
              summaryCards={summaryCards}
              metaLines={[
                latest ? `Latest run: #${latest.run_id} as at ${formatDate(latest.as_of_date)} (${humanize(latest.status)})` : '',
                state.filters.status ? `Status: ${humanize(state.filters.status)}` : '',
                state.filters.from || state.filters.to ? `As at between: ${state.filters.from || '…'} and ${state.filters.to || '…'}` : '',
                state.filters.all_fy === '1' ? 'Years: all financial years' : '',
              ].filter(Boolean)}
              footerNotes={[
                'Difference = Inventory closing value − Books stock ledger balance. Zero means the two agree at that date.',
                'Inventory and Books hold their own records and compare them over live APIs; neither copies the other’s tables.',
              ]}
              onRefresh={reloadAll}
              refreshing={list.loading}
              disabled={!list.data || total === 0}
            />
            {canRun ? (
              <>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
                  <span className="whitespace-nowrap">As at</span>
                  <Input
                    type="date"
                    size="md"
                    className="w-[9.5rem]"
                    value={asOf}
                    onChange={(e) => setAsOf(e.target.value)}
                    aria-label="Reconciliation date"
                  />
                </label>
                <Button
                  variant="primary"
                  size="md"
                  icon={Play}
                  loading={running}
                  disabled={running || !asOf}
                  onClick={runNow}
                >
                  {running ? 'Running…' : 'Run Reconciliation'}
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <RequirePermission permission={P.reconciliationRead} what="reconciliation runs">
        <ReconciliationSummary
          run={latest}
          previous={previous}
          loading={headlineLoading}
          breakdown={breakdown}
          breakdownLoading={detail.loading && !detail.data}
          onRetry={reloadAll}
          varianceTo={latest ? `/reconciliation/variance?run=${latest.run_id}` : '/reconciliation/variance'}
        />

        <ReconciliationTabs />

        {latest && !booksAnswered(latest) ? (
          <Notice
            kind="warning"
            title="Books data temporarily unavailable"
            actions={
              <Button variant="secondary" size="xs" onClick={reloadAll}>
                Retry
              </Button>
            }
          >
            The latest run could not reach the Books Stock-in-Hand ledger, so only the Inventory side of it is
            meaningful. Nothing is wrong with the stock figures — run again once Books answers.
          </Notice>
        ) : null}

        <ReconciliationExplainer screen="runs" />

        <ReconciliationFilters
          value={filterValues}
          onApply={(next) =>
            params.setFilters({
              status: next.status,
              from: next.from,
              to: next.to,
              all_fy: next.allFy ? '1' : '',
            })
          }
          onClear={clearFilters}
          branches={branches}
          boId={boId}
          onBranch={selectBranch}
          busy={list.loading}
        />

        <SmartTable<ReconciliationRun>
          columns={columns}
          rows={rows}
          rowKey={(r) => r.run_id}
          loading={list.loading}
          error={list.error}
          density="compact"
          minWidth={1040}
          rowClassName={(r) => (latest && r.run_id === latest.run_id ? 'bg-primary-light/50' : undefined)}
          sort={{ key: state.sort, order: state.order }}
          onSort={params.toggleSort}
          caption="Reconciliation runs"
          empty={
            filtered ? (
              <EmptyState
                icon={ListTree}
                title="No runs match these filters"
                description="Widen the dates, clear the status, or include every financial year."
                action={
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={ArrowLeftRight}
                title="No reconciliation runs yet"
                description="Run your first Inventory ↔ Books reconciliation to compare closing inventory valuation with the Books Stock-in-Hand ledger."
                action={
                  canRun ? (
                    <Button variant="primary" icon={Play} loading={running} onClick={runNow}>
                      Run Reconciliation
                    </Button>
                  ) : undefined
                }
              />
            )
          }
        />
        <Pagination meta={meta} onPage={params.setPage} onLimit={params.setLimit} limit={state.limit} />

        <div className="grid gap-3 lg:grid-cols-5">
          <Card padding="md" className="lg:col-span-3">
            <CardHeader
              title="Inventory vs Books Trend"
              description={`The last ${TREND_RUNS} completed runs, by accounting date`}
            />
            <ReconciliationTrend points={trend} />
          </Card>

          <Card padding="md" className="lg:col-span-2">
            <CardHeader
              title="Top Variances (Latest Run)"
              description={
                latest
                  ? `What explains the gap as at ${formatDate(latest.as_of_date)}`
                  : 'What explains the gap, once a run exists'
              }
              action={
                <Link
                  to={latest ? `/reconciliation/variance?run=${latest.run_id}` : '/reconciliation/variance'}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline print:hidden"
                >
                  View all →
                </Link>
              }
            />
            <TopVariances
              rows={varianceRows}
              loading={detail.loading && !detail.data}
              emptyMessage={
                latest
                  ? 'This run reports no bucket with a value or a count — nothing is standing between the two sides.'
                  : 'Run a reconciliation to see what explains the difference.'
              }
            />
            <p className="mt-3 border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-500">
              Books publishes one Stock-in-Hand balance for the company, not a balance per item, so the gap is
              explained by bucket and by the documents inside it.
            </p>
          </Card>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2 text-xs text-emerald-800 print:hidden">
          <span className="inline-flex items-center gap-2">
            <Lightbulb className="h-4 w-4 shrink-0" aria-hidden />
            Tip: Run reconciliation regularly to ensure your Inventory and Books remain in sync.
          </span>
          <Link to="/reconciliation/insights" className="font-semibold text-emerald-900 hover:underline">
            See reconciliation health →
          </Link>
        </div>
      </RequirePermission>
    </PageShell>
  )
}

export default ReconciliationRunsPage
