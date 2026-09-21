import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, RefreshCcw, RotateCcw } from 'lucide-react'
import { useCan } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ListSheetActions } from '../../components/ListSheetActions'
import { Pagination } from '../../components/Pagination'
import { RequirePermission } from '../../components/RequirePermission'
import { useInterval } from '../../hooks/useInterval'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { P } from '../../services/access'
import { ApiError } from '../../services/api'
import { fetchAllRows } from '../../services/listAll'
import { settingsApi } from '../../services/settingsApi'
import { valuationApi } from '../../services/valuationApi'
import type { EnqueueRecalcPayload, RecalcFilters, RecalcJob } from '../../services/valuationApi'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { useToast } from '../../ui/ToastContext'
import { formatInt, humanize } from '../../utils/format'
import { NewRecalculationDrawer } from './recalculations/NewRecalculationDrawer'
import { RECALC_EXPORT_COLUMNS } from './recalculations/recalculationExport'
import { RecalculationDetailsDrawer } from './recalculations/RecalculationDetailsDrawer'
import { RecalculationFilters } from './recalculations/RecalculationFilters'
import type { RecalcFilterValues } from './recalculations/RecalculationFilters'
import { RecalculationHelpPanels } from './recalculations/RecalculationHelpPanels'
import { RecalculationSummary } from './recalculations/RecalculationSummary'
import { RecalculationTable } from './recalculations/RecalculationTable'
import { isLive, recalcReference, triggerLabel } from './recalculations/recalculationModel'
import '../views.css'

/**
 * Valuation → Recalculations.
 *
 * The register of jobs that re-cost inventory forward from a date, and the one
 * place a person starts one. Everything on it is bounded by two rules:
 *
 *  1. No figure is invented. The KPI cards come from a server summary counted
 *     over the whole filtered set; a running job shows elapsed time and an
 *     indeterminate bar because the engine reports no progress; the create form
 *     shows no estimated impact because there is no preview endpoint.
 *  2. No action is offered that the server will refuse. Run, retry and cancel
 *     mirror what ValuationController actually accepts for each status.
 */

/** Filter keys kept in the URL. `status`, `item_id`, `trigger_kind`, `from`,
 *  `to` and `all_fy` keep their original names so the dashboard's drill-down
 *  (`?status=QUEUED,RUNNING`) and every existing bookmark still resolve. */
const FILTER_KEYS = [
  'status',
  'item_id',
  'warehouse_id',
  'trigger_kind',
  'dry_run',
  'has_cogs_impact',
  'date_field',
  'from',
  'to',
  'all_fy',
] as const

/** How often the register re-reads itself while a job is queued or running. */
const POLL_MS = 5000

type PendingAction =
  | { kind: 'run'; job: RecalcJob }
  | { kind: 'retry'; job: RecalcJob }
  | { kind: 'cancel'; job: RecalcJob }

export function RecalculationsPage() {
  const { scope } = useCompany()
  const toast = useToast()
  const canRecalculate = useCan(P.valuationRecalculate)

  const params = useListParams({ sort: 'created_at', order: 'desc', limit: 50, filterKeys: FILTER_KEYS })
  const { state, query } = params
  const f = state.filters

  const values = useMemo<RecalcFilterValues>(
    () => ({
      status: f.status ?? '',
      q: state.q,
      from: f.from ?? '',
      to: f.to ?? '',
      all_fy: f.all_fy ?? '',
      item_id: f.item_id ?? '',
      warehouse_id: f.warehouse_id ?? '',
      trigger_kind: f.trigger_kind ?? '',
      dry_run: f.dry_run ?? '',
      has_cogs_impact: f.has_cogs_impact ?? '',
      date_field: f.date_field ?? '',
    }),
    [f, state.q],
  )

  const scopeKey = `${scope?.cmp_id ?? ''}:${scope?.fy_id ?? ''}:${scope?.bo_id ?? ''}`

  const jobs = useQuery(
    (signal) => valuationApi.recalcJobs(query as RecalcFilters, signal),
    [JSON.stringify(query), scopeKey],
    { enabled: scope !== null, resetKey: scopeKey },
  )

  /*
   * The cards are counted with every filter EXCEPT status, so the breakdown
   * stays a breakdown while the register is filtered to one status — see
   * ValuationController::recalcSummary. Paging and sorting are irrelevant to a
   * total, so they are left out too, which also stops a page change refetching
   * figures that cannot have moved.
   */
  const summaryQuery = useMemo<RecalcFilters>(
    () => ({
      q: state.q || undefined,
      item_id: f.item_id || undefined,
      warehouse_id: f.warehouse_id || undefined,
      trigger_kind: f.trigger_kind || undefined,
      dry_run: f.dry_run || undefined,
      has_cogs_impact: f.has_cogs_impact || undefined,
      date_field: f.date_field || undefined,
      from: f.from || undefined,
      to: f.to || undefined,
      all_fy: f.all_fy || undefined,
    }),
    [f, state.q],
  )
  const summary = useQuery(
    (signal) => valuationApi.recalcSummary(summaryQuery, signal),
    [JSON.stringify(summaryQuery), scopeKey],
    { enabled: scope !== null, resetKey: scopeKey },
  )

  // Base currency, valuation method and COGS revision mode — company settings,
  // never assumed. Fetched once per company, not per filter change.
  const settings = useQuery((signal) => settingsApi.get(signal), [scope?.cmp_id], {
    enabled: scope !== null,
    resetKey: scope?.cmp_id ?? null,
  })
  const currencyCode = settings.data?.base_currency_code || 'INR'

  const rows = useMemo(() => jobs.data?.data ?? [], [jobs.data])

  /* ------------------------------------------------------- live polling */

  const anyLive = useMemo(() => rows.some(isLive), [rows])
  const [tabVisible, setTabVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const onVisibility = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  /*
   * Polling is the narrowest it can be: only while this page holds a job that
   * can still change, only while the tab is in front of the user, and stopped
   * the moment the last one settles. A register left open on a second monitor
   * over a weekend must not spend the night asking the server the same question.
   */
  const pollMs = anyLive && tabVisible ? POLL_MS : null
  useInterval(() => {
    jobs.reload()
    summary.reload()
  }, pollMs)
  // The elapsed clock on a running row, ticked separately: it needs a second,
  // the data does not.
  useInterval(() => setNow(Date.now()), anyLive && tabVisible ? 1000 : null)

  /* ---------------------------------------------------------- selection */

  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const toggleRow = useCallback((jobId: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }, [])

  const togglePage = useCallback(
    (checked: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const row of rows) {
          if (checked) next.add(row.job_id)
          else next.delete(row.job_id)
        }
        return next
      })
    },
    [rows],
  )

  /* ------------------------------------------------ company / FY changes */

  const [newOpen, setNewOpen] = useState(false)
  const [preferDryRun, setPreferDryRun] = useState(true)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [detailSeed, setDetailSeed] = useState<RecalcJob | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState<Set<number>>(() => new Set())
  const [submitting, setSubmitting] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)

  /*
   * A company, FY or branch switch invalidates more than the rows. A selection
   * of job ids means nothing under another tenant, an open drawer is showing a
   * record that is no longer in scope, and an item or warehouse filter names an
   * id that may not exist there. The status, dates and search are tenant-neutral
   * and are deliberately kept, so a reader looking at failures in one company
   * is still looking at failures after they switch.
   */
  const lastScope = useRef(scopeKey)
  useEffect(() => {
    if (lastScope.current === scopeKey) return
    lastScope.current = scopeKey
    clearSelection()
    setDetailId(null)
    setDetailSeed(null)
    setNewOpen(false)
    if (f.item_id || f.warehouse_id || state.page > 1) {
      params.setFilters({ item_id: '', warehouse_id: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- params/filters read at the moment of the switch
  }, [scopeKey])

  // A page or filter change re-draws the rows under the tick boxes, so a
  // selection carried across it would be invisible and still act on records the
  // reader can no longer see.
  const pageKey = `${state.page}:${state.limit}:${JSON.stringify(state.filters)}:${state.q}`
  const lastPageKey = useRef(pageKey)
  useEffect(() => {
    if (lastPageKey.current === pageKey) return
    lastPageKey.current = pageKey
    clearSelection()
  }, [pageKey, clearSelection])

  /* -------------------------------------------------------------- detail */

  const detail = useQuery(
    (signal) => valuationApi.recalcJob(detailId as number, signal),
    [detailId],
    { enabled: detailId !== null },
  )
  // The row is shown the instant it is clicked; the detail response (which adds
  // the revision aggregate) replaces it when it lands.
  const detailJob = detailId !== null ? (detail.data ?? detailSeed) : null

  const openDetail = useCallback((job: RecalcJob) => {
    setDetailSeed(job)
    setDetailId(job.job_id)
  }, [])

  const closeDetail = useCallback(() => {
    setDetailId(null)
    setDetailSeed(null)
  }, [])

  /* ------------------------------------------------------------- actions */

  const markBusy = (jobId: number, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev)
      if (on) next.add(jobId)
      else next.delete(jobId)
      return next
    })

  const refreshAll = useCallback(() => {
    jobs.reload()
    summary.reload()
    if (detailId !== null) detail.reload()
  }, [jobs, summary, detail, detailId])

  const runOrRetry = async (job: RecalcJob, retrying: boolean) => {
    markBusy(job.job_id, true)
    try {
      const done = await valuationApi.runRecalc(job.job_id)
      const ref = recalcReference(done.job_id)
      if (String(done.status).toUpperCase() === 'COMPLETED') {
        toast.success(
          `${ref} completed — ${formatInt(done.revised_line_count ?? 0)} of ${formatInt(done.affected_line_count ?? 0)} lines revised.`,
        )
      } else {
        toast.info(`${ref} is ${String(done.status).toLowerCase()}.`)
      }
      refreshAll()
    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? e.message
          : retrying
            ? 'Could not retry the recalculation.'
            : 'Could not run the recalculation.',
      )
      refreshAll()
    } finally {
      markBusy(job.job_id, false)
      setPending(null)
    }
  }

  const cancelJob = async (job: RecalcJob) => {
    markBusy(job.job_id, true)
    try {
      await valuationApi.cancelRecalc(job.job_id)
      toast.success(`${recalcReference(job.job_id)} cancelled. Nothing was re-costed.`)
      refreshAll()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not cancel the recalculation.')
      refreshAll()
    } finally {
      markBusy(job.job_id, false)
      setPending(null)
    }
  }

  const createJob = async (payload: EnqueueRecalcPayload, idempotencyKey: string) => {
    setSubmitting(true)
    try {
      const job = await valuationApi.enqueueRecalc(payload, idempotencyKey)
      const ref = recalcReference(job.job_id)
      const status = String(job.status).toUpperCase()
      toast.success(
        status === 'COMPLETED'
          ? `${ref} completed — ${formatInt(job.revised_line_count ?? 0)} lines revised.`
          : `${ref} has been ${status.toLowerCase()}${job.dry_run ? ' as a dry run' : ''}.`,
      )
      setNewOpen(false)
      refreshAll()
      // Straight into the job that was just started: it is the only thing the
      // person who pressed the button wants to look at next.
      openDetail(job)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not queue the recalculation.')
    } finally {
      setSubmitting(false)
    }
  }

  const openNew = useCallback(
    (dryRun: boolean) => {
      if (!canRecalculate) return
      setPreferDryRun(dryRun)
      setNewOpen(true)
    },
    [canRecalculate],
  )

  /* ------------------------------------------------------------ keyboard */

  /*
   * `/`, Ctrl+F, Ctrl+R and Ctrl+P are registered by ListSheetActions. These are
   * the two this screen adds. Bare letters, so useKeyboardScope's typing guard
   * keeps them from firing while the reader is in the search box or the drawer.
   */
  const shortcuts = useMemo(
    () => ({
      n: (e: KeyboardEvent) => {
        if (!canRecalculate) return
        e.preventDefault()
        openNew(true)
      },
      r: (e: KeyboardEvent) => {
        e.preventDefault()
        refreshAll()
      },
    }),
    [canRecalculate, openNew, refreshAll],
  )
  useKeyboardScope('page', shortcuts, { enabled: !newOpen && detailId === null })

  /* -------------------------------------------------------------- render */

  const filterCount =
    Object.values(values).filter((v) => v !== '' && v !== 'queued').length
  const filtered = filterCount > 0
  const total = jobs.data?.meta.total ?? 0

  /*
   * The letterhead already carries company · FY · branch through
   * `useExportIdentity`, so these are only what NARROWED the register. The
   * period passed beside them is the one the query actually covers: with "All
   * years" on, the rows are drawn from every financial year and letting the
   * selected FY speak for them would make the sheet claim a scope it does not have.
   */
  const scopePeriod = values.all_fy === '1' ? 'All financial years' : undefined
  const metaLines = useMemo(
    () =>
      [
        values.status ? `Status: ${humanize(values.status.replace(/,/g, ' + '))}` : '',
        values.q ? `Search: ${values.q}` : '',
        values.trigger_kind ? `Trigger: ${triggerLabel(values.trigger_kind)}` : '',
        values.dry_run ? `Mode: ${values.dry_run === '1' ? 'dry runs only' : 'live runs only'}` : '',
        values.item_id ? `Item id: ${values.item_id}` : '',
        values.warehouse_id ? `Warehouse id: ${values.warehouse_id}` : '',
        values.has_cogs_impact === '1' ? 'Only jobs that moved COGS' : '',
        values.from || values.to ? `Dated between: ${values.from || '…'} and ${values.to || '…'}` : '',
        values.all_fy === '1' ? 'Years: all financial years' : '',
      ].filter(Boolean),
    [values],
  )

  const empty = filtered ? (
    <EmptyState
      icon={RefreshCcw}
      title="No recalculations match your filters."
      description="Nothing in this company's recalculation history fits the narrowing you have applied."
      action={
        <Button variant="secondary" onClick={params.reset}>
          Clear filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={RotateCcw}
      title="No recalculation jobs yet"
      description="Recalculations appear here when a back-dated receipt, a corrected cost or a valuation setting means inventory costing has to be replayed from a date forward."
      action={
        canRecalculate ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button icon={Plus} onClick={() => openNew(true)}>
              New recalculation
            </Button>
          </div>
        ) : undefined
      }
    />
  )

  return (
    <>
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Valuation', to: '/valuation' }, { label: 'Recalculations' }]}
        icon={RotateCcw}
        title="Valuation recalculations"
        description="Back-dated receipts and edits re-run the costing from a date forward. Each job records the lines whose valuation changed and publishes the COGS revisions Books applies."
        escBack={false}
        actions={
          <>
            <ListSheetActions<RecalcJob>
              columns={RECALC_EXPORT_COLUMNS}
              rows={rows}
              fetchAll={() =>
                fetchAllRows<RecalcJob>((page, limit) =>
                  valuationApi.recalcJobs({ ...(query as RecalcFilters), page, limit }),
                )
              }
              filenameBase="valuation-recalculations"
              title="Valuation recalculations"
              description="Back-dated re-costing jobs and the COGS revisions they published"
              metaLines={metaLines}
              scopePeriod={scopePeriod}
              onRefresh={refreshAll}
              refreshing={jobs.loading}
              disabled={total === 0}
              searchInputRef={searchRef}
            />
            {canRecalculate ? (
              <Button icon={Plus} onClick={() => openNew(true)} kbd="N">
                New recalculation
              </Button>
            ) : null}
          </>
        }
      />

      <RequirePermission permission={P.report('valuation')} what="recalculations">
        <div className="mt-3 space-y-2.5">
          <RecalculationSummary
            summary={summary.data}
            currencyCode={currencyCode}
            loading={summary.loading}
            error={summary.error}
          />

          <RecalculationFilters
            values={values}
            onChange={(key, value) => (key === 'q' ? params.setQ(value) : params.setFilter(key, value))}
            onChangeMany={(patch) => params.setFilters(patch as Record<string, string>)}
            onSearch={params.setQ}
            onClearAll={params.reset}
            searchInputRef={searchRef}
          />

          {selected.size > 0 ? (
            <div
              className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary-light/40 px-3.5 py-2 text-xs text-gray-700 print:hidden"
              role="status"
            >
              <strong className="font-semibold text-gray-900">
                {formatInt(selected.size)} selected
              </strong>
              {/*
                Selection carries no bulk action yet, and none is invented here:
                nothing in the API cancels or re-runs a set of jobs in one call,
                and faking it with a loop of requests would produce a partial
                result nobody could reconcile. It marks rows for reading and
                comparison, and says so.
              */}
              <span className="text-gray-500">
                Marked for comparison. Bulk run and cancel are not available — each job is run or
                cancelled on its own row.
              </span>
              <Button variant="ghost" size="xs" className="ml-auto" onClick={clearSelection}>
                Clear selection
              </Button>
            </div>
          ) : null}

          <RecalculationTable
            rows={rows}
            loading={jobs.loading}
            error={jobs.error}
            onRetry={refreshAll}
            empty={empty}
            sort={{ key: state.sort, order: state.order }}
            onSort={params.toggleSort}
            currencyCode={currencyCode}
            selected={selected}
            onToggleRow={toggleRow}
            onTogglePage={togglePage}
            onOpen={openDetail}
            onRun={(job) => setPending({ kind: 'run', job })}
            onRetryJob={(job) => setPending({ kind: 'retry', job })}
            onCancel={(job) => setPending({ kind: 'cancel', job })}
            canRecalculate={canRecalculate}
            busy={busy}
            now={now}
          />

          <Pagination
            meta={jobs.data?.meta ?? null}
            onPage={params.setPage}
            onLimit={params.setLimit}
            limit={state.limit}
          />

          <RecalculationHelpPanels onNewRecalculation={() => openNew(true)} canRecalculate={canRecalculate} />
        </div>
      </RequirePermission>

      <NewRecalculationDrawer
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onSubmit={createJob}
        settings={settings.data}
        preferDryRun={preferDryRun}
        submitting={submitting}
      />

      <RecalculationDetailsDrawer
        open={detailId !== null}
        onClose={closeDetail}
        job={detailJob}
        loading={detail.loading}
        error={detail.error}
        onReload={detail.reload}
        currencyCode={currencyCode}
        canRecalculate={canRecalculate}
        busy={detailJob ? busy.has(detailJob.job_id) : false}
        onRun={(job) => setPending({ kind: 'run', job })}
        onRetry={(job) => setPending({ kind: 'retry', job })}
        onCancel={(job) => setPending({ kind: 'cancel', job })}
      />

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'cancel'
            ? `Cancel ${recalcReference(pending.job.job_id)}?`
            : pending
              ? `${pending.kind === 'retry' ? 'Retry' : 'Run'} ${recalcReference(pending.job.job_id)}?`
              : ''
        }
        confirmLabel={pending?.kind === 'cancel' ? 'Cancel job' : pending?.kind === 'retry' ? 'Retry' : 'Run now'}
        danger={pending?.kind === 'cancel'}
        busy={pending ? busy.has(pending.job.job_id) : false}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return
          if (pending.kind === 'cancel') void cancelJob(pending.job)
          else void runOrRetry(pending.job, pending.kind === 'retry')
        }}
        message={
          pending?.kind === 'cancel' ? (
            <p>
              The job is dropped from the queue before it starts. Nothing is re-costed and no
              revision is published.
            </p>
          ) : pending ? (
            <p>
              {pending.job.dry_run
                ? 'This is a dry run: the costing is replayed and reported, and nothing is written.'
                : 'This writes the revised valuation from the effective date onwards and publishes the applicable COGS revisions to Books.'}
            </p>
          ) : null
        }
      />
    </>
  )
}
