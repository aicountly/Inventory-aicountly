import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Filter, GitCompare, GitMerge, Play } from 'lucide-react'
import { useCan } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ListSheetActions } from '../../components/ListSheetActions'
import { Notice } from '../../components/Notice'
import { RequirePermission } from '../../components/RequirePermission'
import { useReferenceData } from '../../documents/useReferenceData'
import { useDebounce } from '../../hooks/useDebounce'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import type { ExportableColumn } from '../../registers/registerCells'
import { P } from '../../services/access'
import { errorMessage } from '../../services/api'
import { fetchAllRows } from '../../services/listAll'
import { settingsApi } from '../../services/settingsApi'
import { valuationApi } from '../../services/valuationApi'
import type { RevisionFilters, ValuationRevision } from '../../services/valuationApi'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { PageHeader } from '../../ui/shell/PageHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { ServerTablePagination } from '../../ui/shell/TablePagination'
import { useToast } from '../../ui/ToastContext'
import { currencySymbol, formatInt, formatMoney, humanize } from '../../utils/format'
import { AcknowledgeRevisionsDialog } from './revisions/AcknowledgeRevisionsDialog'
import { RevisionAnalytics } from './revisions/RevisionAnalytics'
import { RevisionDetailDrawer } from './revisions/RevisionDetailDrawer'
import { RevisionFilters as RevisionFilterPanel } from './revisions/RevisionFilters'
import { RevisionInsightsPanel } from './revisions/RevisionInsightsPanel'
import { RevisionKpiGrid } from './revisions/RevisionKpiGrid'
import { RevisionTable } from './revisions/RevisionTable'
import {
  BOOKS_STATE_SHEET_LABEL,
  DEFAULT_BOOKS_FILTER,
  REVISION_FILTER_KEYS,
  ackSelection,
  booksFilterQuery,
  booksState,
  filterSummaryLines,
} from './revisions/revisionsModel'
import '../views.css'

/**
 * The sheet's columns.
 *
 * Every rate and amount here is a VALUATION figure — what the stock cost, which is what
 * drives COGS and closing stock. None of it is the commercial rate agreed with a party; that
 * number belongs to Books and is not in this table. The column names say so in full, because
 * a printed sheet headed "Old rate" is a sheet somebody will read as a price.
 */
const EXPORT_COLUMNS: ExportableColumn<ValuationRevision>[] = [
  { key: 'revision_id', csvHeader: 'Revision', align: 'right', format: 'int' },
  { key: 'created_at', csvHeader: 'Created', format: 'datetime' },
  { key: 'books_state', csvHeader: 'Books', csv: (r) => BOOKS_STATE_SHEET_LABEL[booksState(r)] },
  { key: 'document_no', csvHeader: 'Document', csv: (r) => r.document_no ?? (r.document_id ? `#${r.document_id}` : '') },
  { key: 'document_date', csvHeader: 'Document date', format: 'date' },
  { key: 'document_type', csvHeader: 'Source document type', csv: (r) => humanize(r.document_type) },
  { key: 'source', csvHeader: 'Source', csv: (r) => (r.source_app ? `${r.source_app} · ${r.source_document_no ?? r.source_document_id ?? ''}`.trim() : '') },
  { key: 'item_name', csvHeader: 'Item', csv: (r) => r.item_name ?? (r.item_id ? `Item #${r.item_id}` : '') },
  { key: 'item_sku', csvHeader: 'SKU', csv: (r) => r.item_sku ?? '' },
  { key: 'warehouse_name', csvHeader: 'Warehouse', csv: (r) => r.warehouse_name ?? '' },
  { key: 'base_qty', csvHeader: 'Qty', align: 'right', format: 'qty' },
  { key: 'old_valuation_rate', csvHeader: 'Old valuation rate', align: 'right', format: 'amount' },
  { key: 'new_valuation_rate', csvHeader: 'New valuation rate', align: 'right', format: 'amount' },
  { key: 'old_valuation_amount', csvHeader: 'Old valuation amount', align: 'right', format: 'amount' },
  { key: 'new_valuation_amount', csvHeader: 'New valuation amount', align: 'right', format: 'amount' },
  { key: 'delta_amount', csvHeader: 'Valuation delta (new − old)', align: 'right', format: 'amount' },
  { key: 'job_id', csvHeader: 'Recalculation job', align: 'right', format: 'int' },
  { key: 'acknowledged_at', csvHeader: 'Acknowledged', format: 'datetime' },
  { key: 'acknowledged_by_app', csvHeader: 'Acknowledged by' },
]

const SUBTITLE =
  'Line-level valuation changes produced by recalculations are reviewed here and acknowledged once Books has re-posted the COGS. Anything left unacknowledged shows up in reconciliation.'

export function RevisionsPage() {
  const { scope } = useCompany()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  const canAcknowledge = useCan([P.valuationRecalculate, P.reconciliationResolve])
  const canRecalculate = useCan(P.valuationRecalculate)
  const canReconcile = useCan(P.reconciliationRead)
  const canViewDocuments = useCan(P.documentsRead)
  const canReadSettings = useCan(P.settingsRead)

  const params = useListParams({ sort: 'created_at', order: 'desc', limit: 25, filterKeys: REVISION_FILTER_KEYS })
  const { state } = params
  const books = state.filters.books || DEFAULT_BOOKS_FILTER
  const [days, setDays] = useState('10')

  /*
   * The search box is debounced before it touches the URL.
   *
   * useListParams navigates on every change, so typing "steel" un-debounced would push five
   * history entries and fire five requests, of which four are already stale by the time they
   * land. The box stays responsive because it holds its own value.
   */
  const [search, setSearch] = useState(state.q)
  const debouncedSearch = useDebounce(search, 300)
  const lastPushedSearch = useRef(state.q)
  useEffect(() => {
    if (debouncedSearch === lastPushedSearch.current) return
    lastPushedSearch.current = debouncedSearch
    params.setQ(debouncedSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- params identity changes every render
  }, [debouncedSearch])
  useEffect(() => {
    // The URL is the source of truth: a Back press or a reset has to reach the box.
    if (state.q !== lastPushedSearch.current) {
      lastPushedSearch.current = state.q
      setSearch(state.q)
    }
  }, [state.q])

  const listQuery = useMemo<RevisionFilters>(() => {
    const { books: _books, ...rest } = params.query as Record<string, unknown>
    void _books
    return { ...rest, ...booksFilterQuery(books) } as RevisionFilters
  }, [params.query, books])

  /** The same filters without paging — what the summary and the charts describe. */
  const summaryQuery = useMemo(() => {
    const { page, limit, offset, sort, order, ...rest } = listQuery
    void page
    void limit
    void offset
    void sort
    void order
    return { ...rest, days: Number(days) }
  }, [listQuery, days])

  const scopeKey = `${scope?.cmp_id ?? 0}:${scope?.fy_id ?? 0}:${scope?.bo_id ?? 0}`
  const listKey = JSON.stringify(listQuery)
  const summaryKey = JSON.stringify(summaryQuery)

  const list = useQuery((signal) => valuationApi.revisions(listQuery, signal), [listKey, scopeKey], {
    enabled: scope !== null,
    resetKey: scopeKey,
  })
  const summary = useQuery((signal) => valuationApi.revisionsSummary(summaryQuery, signal), [summaryKey, scopeKey], {
    enabled: scope !== null,
    resetKey: scopeKey,
  })
  const types = useQuery((signal) => settingsApi.documentTypes(signal), [scope?.cmp_id], { enabled: scope !== null })
  // Never assume rupees: the base currency is a company setting, and a reader without
  // settings.read simply gets the default rather than an error they cannot act on.
  const settings = useQuery((signal) => settingsApi.get(signal), [scope?.cmp_id], {
    enabled: scope !== null && canReadSettings,
  })
  const currency = settings.data?.base_currency_code || 'INR'

  const { warehouses } = useReferenceData()
  const rows = useMemo(() => list.data?.data ?? [], [list.data])

  const documentTypeLabel = useCallback(
    (code: string | null) => {
      if (!code) return ''
      return types.data?.find((t) => t.code === code)?.label ?? humanize(code)
    },
    [types.data],
  )

  // ---- selection ------------------------------------------------------------------------

  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set())
  // A selection belongs to the rows it was made on. When the filters or the page change those
  // rows are gone, and carrying ids forward would acknowledge revisions nobody looked at.
  useEffect(() => {
    setSelected(new Set())
  }, [listKey, scopeKey])

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const selectable = rows.filter((r) => !r.acknowledged)
      const allOn = selectable.length > 0 && selectable.every((r) => prev.has(r.revision_id))
      return allOn ? new Set() : new Set(selectable.map((r) => r.revision_id))
    })
  }, [rows])

  const selection = useMemo(() => ackSelection(rows, selected), [rows, selected])

  // ---- acknowledgement ------------------------------------------------------------------

  const [dialogOpen, setDialogOpen] = useState(false)
  const [ackBusy, setAckBusy] = useState(false)
  const [ackError, setAckError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ValuationRevision | null>(null)
  /** Set when one row was acknowledged from its own menu, so the tick-box selection survives. */
  const [ackTarget, setAckTarget] = useState<ValuationRevision | null>(null)

  /** What the dialog is actually about: the one row, or the whole selection. */
  const pending = useMemo(
    () => (ackTarget ? ackSelection([ackTarget], new Set([ackTarget.revision_id])) : selection),
    [ackTarget, selection],
  )

  const acknowledgeOne = useCallback((row: ValuationRevision) => {
    setAckTarget(row)
    setAckError(null)
    setDialogOpen(true)
  }, [])

  const closeAckDialog = useCallback(() => {
    if (ackBusy) return
    setDialogOpen(false)
    setAckTarget(null)
    setAckError(null)
  }, [ackBusy])

  const confirmAck = useCallback(async () => {
    // The guard is the point, not a nicety: two clicks on a slow network would post the same
    // acknowledgement twice into an append-only audit log.
    if (ackBusy) return
    const ids = pending.eligible.map((r) => r.revision_id)
    if (ids.length === 0) return
    setAckBusy(true)
    setAckError(null)
    try {
      const res = await valuationApi.ackRevisions(ids)
      const unknown = res.unknown_revision_ids.length
      const parts = [`${formatInt(res.acknowledged)} revision${res.acknowledged === 1 ? '' : 's'} acknowledged as ${res.acknowledged_by_app}`]
      if (res.already_acknowledged > 0) parts.push(`${formatInt(res.already_acknowledged)} already were`)
      if (unknown > 0) parts.push(`${formatInt(unknown)} could not be found`)
      // Partial failure is reported as what it is, and nothing is hidden on the strength of a
      // request we only half know the outcome of — the list is reloaded from the server.
      if (unknown > 0) toast.error(`${parts.join(', ')}.`)
      else toast.success(`${parts.join(', ')}.`)
      setDialogOpen(false)
      // A single-row acknowledgement leaves the rest of the reader's selection alone.
      setSelected((prev) => {
        if (!ackTarget) return new Set()
        const next = new Set(prev)
        next.delete(ackTarget.revision_id)
        return next
      })
      setAckTarget(null)
      setDetail(null)
      list.reload()
      summary.reload()
    } catch (e) {
      setAckError(errorMessage(e, 'Could not acknowledge the revisions.'))
    } finally {
      setAckBusy(false)
    }
  }, [ackBusy, ackTarget, pending.eligible, toast, list, summary])

  // ---- derived chrome --------------------------------------------------------------------

  const refresh = useCallback(() => {
    list.reload()
    summary.reload()
  }, [list, summary])

  const searchInputRef = useRef<HTMLInputElement>(null)
  const activeFilterCount = useMemo(
    () =>
      Object.entries(state.filters).filter(([k, v]) => v !== '' && !(k === 'books' && v === DEFAULT_BOOKS_FILTER))
        .length + (state.q ? 1 : 0),
    [state.filters, state.q],
  )

  const sourceLink = useCallback(
    (documentType: string) => {
      const sp = new URLSearchParams(location.search)
      sp.set('document_type', documentType)
      sp.delete('page')
      return `/valuation/revisions?${sp.toString()}`
    },
    [location.search],
  )

  const warehouseLabel = state.filters.warehouse_id
    ? (warehouses.find((w) => String(w.warehouse_id) === state.filters.warehouse_id)?.warehouse_name ??
      `Warehouse #${state.filters.warehouse_id}`)
    : undefined
  const metaLines = useMemo(
    () =>
      filterSummaryLines(state.filters, state.q, {
        warehouse: warehouseLabel,
        documentType: state.filters.document_type ? documentTypeLabel(state.filters.document_type) : undefined,
        item: state.filters.item_id ? `#${state.filters.item_id}` : undefined,
      }),
    [state.filters, state.q, warehouseLabel, documentTypeLabel],
  )

  const total = list.data?.meta.total ?? 0
  const noDataAtAll = summary.data !== null && summary.data.company.revisions === 0

  const emptyNode = noDataAtAll ? (
    <EmptyState
      icon={GitCompare}
      title="No valuation revisions yet"
      description="Valuation changes generated by a back-dated recalculation appear here, ready for Books to re-post the COGS against."
      action={
        canRecalculate ? (
          <Button icon={Play} onClick={() => navigate('/valuation/recalculations')}>
            Run recalculation
          </Button>
        ) : undefined
      }
    />
  ) : (
    <EmptyState
      icon={Filter}
      title="No revisions match these filters"
      description="Try widening the Books status, the item, the source document or the date range."
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="secondary" onClick={params.reset} disabled={activeFilterCount === 0}>
            Reset filters
          </Button>
          <Button variant="ghost" onClick={refresh}>
            Refresh
          </Button>
        </div>
      }
    />
  )

  return (
    <PageShell fullBleed compact>
      <PageHeader
        icon={GitCompare}
        title="Valuation revisions"
        description={SUBTITLE}
        actions={
          <>
            {canAcknowledge ? (
              <Button
                disabled={selection.eligible.length === 0 || ackBusy}
                onClick={() => {
                  setAckTarget(null)
                  setAckError(null)
                  setDialogOpen(true)
                }}
              >
                Acknowledge selected ({formatInt(selection.eligible.length)})
              </Button>
            ) : null}
            {canRecalculate ? (
              <Button variant="secondary" icon={Play} onClick={() => navigate('/valuation/recalculations')}>
                Run recalculation
              </Button>
            ) : null}
            {canReconcile ? (
              <Button variant="secondary" icon={GitMerge} onClick={() => navigate('/reconciliation/posting-status')}>
                Open reconciliation
              </Button>
            ) : null}
            <ListSheetActions<ValuationRevision>
              columns={EXPORT_COLUMNS}
              rows={rows}
              fetchAll={() => fetchAllRows<ValuationRevision>((page, limit) => valuationApi.revisions({ ...listQuery, page, limit }))}
              filenameBase="valuation-revisions"
              title="Valuation revisions"
              description="Line-level valuation changes a recalculation produced, and whether Books has applied them"
              metaLines={metaLines}
              footerNotes={[
                'Every rate and amount here is a valuation figure — what the stock cost. Commercial rates and amounts live in Books.',
              ]}
              onRefresh={refresh}
              refreshing={list.loading || summary.loading}
              disabled={!list.data || total === 0}
              searchInputRef={searchInputRef}
            />
          </>
        }
      />

      <RequirePermission permission={P.report('valuation')} what="valuation revisions">
        {summary.error ? (
          <Notice
            kind="warning"
            actions={
              <Button variant="secondary" size="xs" onClick={summary.reload}>
                Retry
              </Button>
            }
          >
            The summary figures could not be loaded, so the cards and charts are hidden. The revisions below are
            unaffected.
          </Notice>
        ) : (
          <RevisionKpiGrid
            summary={summary.data}
            loading={summary.loading}
            currency={currency}
            canRecalculate={canRecalculate}
            canReconcile={canReconcile}
          />
        )}

        <RevisionFilterPanel
          filters={state.filters}
          search={search}
          onSearch={setSearch}
          onFilter={params.setFilter}
          onFilters={params.setFilters}
          onReset={params.reset}
          warehouses={warehouses}
          documentTypes={types.data ?? []}
          searchInputRef={searchInputRef}
          activeCount={activeFilterCount}
          currencySymbol={currencySymbol(currency)}
        />

        <div className="grid min-w-0 grid-cols-1 items-start gap-2 xl:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0">
            <RevisionTable
              rows={rows}
              loading={list.loading}
              error={
                list.error
                  ? {
                      title: 'Unable to load valuation revisions',
                      description: list.error.message,
                      onRetry: refresh,
                    }
                  : null
              }
              sort={{ key: state.sort, order: state.order }}
              onSort={params.toggleSort}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
              canAcknowledge={canAcknowledge}
              canViewDocuments={canViewDocuments}
              canReconcile={canReconcile}
              onOpen={setDetail}
              onAcknowledgeRow={acknowledgeOne}
              onNavigate={(to) => navigate(to)}
              documentTypeLabel={documentTypeLabel}
              empty={emptyNode}
              resetKey={listKey}
              title={`${formatInt(total)} revision${total === 1 ? '' : 's'}`}
              description={
                summary.data
                  ? `Net valuation delta ${formatMoney(summary.data.filtered.net_delta)} · ${formatInt(summary.data.filtered.increased)} up · ${formatInt(summary.data.filtered.decreased)} down`
                  : 'Valuation figures in the company base currency'
              }
              headerAction={
                selection.eligible.length > 0 ? (
                  <span className="text-xs text-gray-500">
                    <strong className="tabular-nums text-gray-900">{formatInt(selection.eligible.length)}</strong>{' '}
                    selected
                    <button
                      type="button"
                      className="ml-2 font-semibold text-primary hover:underline"
                      onClick={() => setSelected(new Set())}
                    >
                      Clear
                    </button>
                  </span>
                ) : null
              }
              footer={
                <ServerTablePagination
                  meta={list.data?.meta ?? null}
                  limit={state.limit}
                  onPage={params.setPage}
                  onLimit={params.setLimit}
                />
              }
            />
          </div>

          <RevisionInsightsPanel
            summary={summary.error ? null : summary.data}
            loading={summary.loading}
            canRecalculate={canRecalculate}
            canReconcile={canReconcile}
          />
        </div>

        {summary.error ? null : (
          <RevisionAnalytics
            summary={summary.data}
            loading={summary.loading}
            days={days}
            onDays={setDays}
            currency={currency}
            documentTypeLabel={documentTypeLabel}
            sourceLink={sourceLink}
          />
        )}

        {/* Rendered only while open: the dialog owns focus, and a mounted-but-hidden one
            would put a focus trap on the page for a decision nobody is making. */}
        {dialogOpen ? (
          <AcknowledgeRevisionsDialog
            open
            selection={pending}
            busy={ackBusy}
            error={ackError}
            onConfirm={confirmAck}
            onCancel={closeAckDialog}
          />
        ) : null}

        <RevisionDetailDrawer
          revision={detail}
          onClose={() => setDetail(null)}
          onAcknowledge={acknowledgeOne}
          canAcknowledge={canAcknowledge}
          canViewDocuments={canViewDocuments}
          documentTypeLabel={documentTypeLabel}
          busy={ackBusy}
        />

        <p className="px-1 text-[11px] leading-relaxed text-gray-400 print:hidden">
          Inventory owns the valuation and the cost of stock; Books owns the ledger. Acknowledging a revision
          records that Books has re-posted the accounting COGS — it posts nothing itself. Every rate and amount
          here is a valuation figure, in the company base currency; commercial rates live in Books.
        </p>
      </RequirePermission>
    </PageShell>
  )
}
