import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Layers, PlusCircle, Sparkles, Upload } from 'lucide-react'
import { useAccess } from '../../../access/AccessContext'
import { useCompany } from '../../../company/CompanyContext'
import { Notice } from '../../../components/Notice'
import { ListSheetActions } from '../../../components/ListSheetActions'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { Drawer } from '../../../ui/Drawer'
import { EmptyState } from '../../../ui/EmptyState'
import { PageShell } from '../../../ui/shell/PageShell'
import { BreadcrumbHeader } from '../../../ui/shell/BreadcrumbHeader'
import { TablePagination } from '../../../ui/shell/TablePagination'
import { invalidateFormOptions } from '../../../hooks/useFormOptions'
import { useListParams } from '../../../hooks/useListParams'
import { useQuery } from '../../../hooks/useQuery'
import { usePageKeyboard } from '../../../keyboard/usePageKeyboard'
import { P } from '../../../services/access'
import { errorMessage, pageCount, pageForOffset, pageRange } from '../../../services/api'
import type { ListQuery } from '../../../services/api'
import { fetchAllRows } from '../../../services/listAll'
import { stockCategoriesApi } from '../../../services/masters'
import type { StockCategory } from '../../../services/masters'
import { bulkSetStockCategoryStatus, fetchStockCategorySummary } from '../../../services/stockCategories'
import { analyseStockCategories } from '../../../services/stockCategoryAi'
import type { AiAnalysis } from '../../../services/stockCategoryAi'
import { useToast } from '../../../ui/ToastContext'
import { downloadCsv, toCsv } from '../../../utils/csv'
import { formatDateTime, formatInt, todayIso } from '../../../utils/format'
import type { ExportableColumn } from '../../../registers/registerCells'
import { DeleteStockCategoryDialog } from './DeleteStockCategoryDialog'
import { StockCategoryAiPanel } from './StockCategoryAiPanel'
import { StockCategoryBulkBar } from './StockCategoryBulkBar'
import { StockCategoryFormDrawer } from './StockCategoryFormDrawer'
import type { FormMode, StockCategoryFormValues } from './StockCategoryFormDrawer'
import { StockCategoryGrid } from './StockCategoryGrid'
import { StockCategoryImportDrawer } from './StockCategoryImportDrawer'
import type { ImportOutcome } from './StockCategoryImportDrawer'
import { StockCategorySummaryCards } from './StockCategorySummaryCards'
import { StockCategoryTable } from './StockCategoryTable'
import { StockCategoryToolbar, SORT_CHOICES } from './StockCategoryToolbar'
import type { StockCategoryView } from './StockCategoryToolbar'
import { StockCategoryTour } from './StockCategoryTour'
import { IMPORT_TEMPLATE_CSV } from './stockCategoryImport'
import { reviewCategories } from './categoryReview'
import type { CategoryReview, ReviewFinding } from './categoryReview'

/**
 * Masters → Stock categories.
 *
 * This screen was a config-driven `MasterPage` like every other simple master.
 * It is now its own page for three reasons that the shared one cannot serve
 * without becoming a different component: company-wide figures over the list,
 * a usage count per row with the actions that count implies (open the items,
 * refuse the delete), and a selection that survives paging. Every other master
 * still renders through `MasterPage`, untouched.
 *
 * What did NOT change: the endpoints (`/v1/stock-categories` CRUD), the
 * permission keys (`masters.stock_categories.*`), the URL, the export
 * pipeline, the audit trail, or where company / branch / financial year come
 * from. `item_count`, the summary and the bulk status action are additions to
 * Inventory's own API — no table was copied, no master was duplicated, and
 * nothing is synchronised from another Aicountly product.
 *
 * Two figures on this page could have been computed in the browser and are
 * not. The KPI totals come from `/summary` and the usage counts come with the
 * rows, because a total derived from the fifty rows on screen reads exactly
 * like a total and is wrong on page 2.
 */

const CRUMBS = [{ label: 'Masters', to: '/masters' }, { label: 'Stock categories' }] as const

const EXPORT_COLUMNS: ExportableColumn<StockCategory>[] = [
  { key: 'cat_name', header: 'Category', csvHeader: 'Category', format: 'text' },
  { key: 'cat_alias', header: 'Alias', csvHeader: 'Alias', format: 'text' },
  {
    key: 'is_active',
    header: 'Status',
    csvHeader: 'Status',
    format: 'text',
    csv: (row) => (Number(row.is_active) === 1 ? 'Active' : 'Inactive'),
  },
  {
    key: 'item_count',
    header: 'Items',
    csvHeader: 'Items',
    align: 'right',
    format: 'int',
    csv: (row) => (typeof row.item_count === 'number' ? row.item_count : ''),
  },
  { key: 'updated_at', header: 'Updated', csvHeader: 'Updated', format: 'datetime' },
]

export function StockCategoriesPage() {
  const { scope, companyName } = useCompany()
  const { can, loading: accessLoading } = useAccess()
  const toast = useToast()

  const canRead = can(P.masters('stock_categories', 'read'))
  const canWrite = can(P.masters('stock_categories', 'write'))
  const canDelete = can(P.masters('stock_categories', 'delete'))
  const canReadItems = can(P.masters('items', 'read'))

  /**
   * The drill-down into Items, but only where it genuinely goes somewhere.
   *
   * `/items` already filters on `stock_cat_id` from the query string — the same
   * parameter its own Category filter writes — so this is that screen's
   * existing contract, not a new route invented for this one. A profile that
   * cannot read items gets no link at all rather than one that lands on a
   * permission notice.
   */
  const itemsLinkFor = useMemo(
    () => (canReadItems ? (stockCatId: number) => `/items?stock_cat_id=${stockCatId}` : undefined),
    [canReadItems],
  )

  const list = useListParams({ sort: 'cat_name', order: 'asc', filterKeys: ['status', 'view'] })
  const view: StockCategoryView = list.state.filters.view === 'grid' ? 'grid' : 'list'
  const status = list.state.filters.status ?? ''

  const listQuery = useMemo<ListQuery>(() => {
    const { view: _view, ...filters } = list.state.filters
    void _view
    return { ...list.query, ...filters }
  }, [list.query, list.state.filters])

  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null

  const query = useQuery(
    (signal) => stockCategoriesApi.list(listQuery, signal),
    [scopeKey, listQuery],
    { enabled: Boolean(scope) && canRead, resetKey: scopeKey },
  )

  const summaryQuery = useQuery((signal) => fetchStockCategorySummary(signal), [scopeKey], {
    enabled: Boolean(scope) && canRead,
    resetKey: scopeKey,
  })

  const rows = useMemo(() => query.data?.data ?? [], [query.data])
  const meta = query.data?.meta ?? null
  const total = meta?.total ?? 0
  const offset = meta?.offset ?? 0

  const reload = useCallback(() => {
    query.reload()
    summaryQuery.reload()
  }, [query, summaryQuery])

  // ---- selection -----------------------------------------------------------
  /*
   * The whole row is kept, not just the id: a delete has to know each
   * category's usage count and an export has to write its name, and both can
   * be asked about a row that paging has since scrolled past.
   */
  const [selected, setSelected] = useState<Map<number, StockCategory>>(() => new Map())
  const selectedIds = useMemo(() => new Set(selected.keys()), [selected])
  const clearSelection = useCallback(() => setSelected(new Map()), [])

  // A company switch makes the previous company's selection meaningless.
  useEffect(() => {
    clearSelection()
  }, [scopeKey, clearSelection])

  const toggleRow = useCallback((id: number, on: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (on) {
        const row = rowsRef.current.find((r) => Number(r.stock_cat_id) === id)
        if (row) next.set(id, row)
      } else {
        next.delete(id)
      }
      return next
    })
  }, [])

  const rowsRef = useRef<readonly StockCategory[]>(rows)
  rowsRef.current = rows

  const toggleAll = useCallback(
    (on: boolean) => {
      setSelected((prev) => {
        const next = new Map(prev)
        for (const row of rowsRef.current) {
          const id = Number(row.stock_cat_id)
          if (on) next.set(id, row)
          else next.delete(id)
        }
        return next
      })
    },
    [],
  )

  const selectedRows = useMemo(() => [...selected.values()], [selected])
  const offPage = useMemo(() => {
    const onPage = new Set(rows.map((r) => Number(r.stock_cat_id)))
    return selectedRows.filter((r) => !onPage.has(Number(r.stock_cat_id))).length
  }, [rows, selectedRows])

  // ---- create / edit -------------------------------------------------------
  const [form, setForm] = useState<{ mode: FormMode; row: StockCategory | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)

  const openCreate = useCallback(() => {
    if (!canWrite) return
    setSaveError(null)
    setForm({ mode: 'create', row: null })
  }, [canWrite])

  const openEdit = useCallback((row: StockCategory) => {
    setSaveError(null)
    setForm({ mode: 'edit', row })
  }, [])

  const openDuplicate = useCallback(
    (row: StockCategory) => {
      if (!canWrite) return
      setSaveError(null)
      setForm({ mode: 'duplicate', row })
    },
    [canWrite],
  )

  /*
   * `?new=1` opens the create drawer on arrival — the Masters landing page's
   * Quick Create menu needs a link it can put in an anchor. The flag is
   * consumed before the drawer opens, so a reload or a Back does not reopen it,
   * and it waits for access: `can()` answers false while permissions are in
   * flight, and acting on that would silently swallow a request from somebody
   * who is in fact allowed.
   */
  const [searchParams, setSearchParams] = useSearchParams()
  const createRequested = searchParams.get('new') === '1'
  const openCreateRef = useRef(openCreate)
  openCreateRef.current = openCreate
  useEffect(() => {
    if (!createRequested || accessLoading) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('new')
        return next
      },
      { replace: true },
    )
    if (canWrite) openCreateRef.current()
  }, [createRequested, accessLoading, canWrite, setSearchParams])

  const submitForm = async (values: StockCategoryFormValues) => {
    if (!form) return
    setSaving(true)
    setSaveError(null)
    const payload = {
      cat_name: values.cat_name,
      cat_alias: values.cat_alias === '' ? null : values.cat_alias,
      is_active: values.is_active,
    }
    try {
      if (form.mode === 'edit' && form.row) {
        await stockCategoriesApi.update(Number(form.row.stock_cat_id), payload)
        toast.success('Stock category updated')
      } else {
        await stockCategoriesApi.create(payload)
        toast.success('Stock category created')
      }
      setForm(null)
      // The item form's category dropdown reads a cached options payload.
      invalidateFormOptions()
      reload()
    } catch (err) {
      setSaveError(err)
    } finally {
      setSaving(false)
    }
  }

  // ---- status --------------------------------------------------------------
  const [busy, setBusy] = useState(false)

  const toggleStatus = async (row: StockCategory) => {
    if (!canWrite || busy) return
    const next = Number(row.is_active) === 1 ? 0 : 1
    setBusy(true)
    try {
      await stockCategoriesApi.update(Number(row.stock_cat_id), { is_active: next })
      toast.success(next === 1 ? 'Stock category activated' : 'Stock category deactivated')
      invalidateFormOptions()
      reload()
    } catch (err) {
      toast.error(errorMessage(err, 'The status could not be changed.'))
    } finally {
      setBusy(false)
    }
  }

  const bulkStatus = async (activate: boolean) => {
    if (!canWrite || busy || selectedRows.length === 0) return
    setBusy(true)
    try {
      const result = await bulkSetStockCategoryStatus(
        selectedRows.map((r) => Number(r.stock_cat_id)),
        activate,
      )
      if (result.updated === 0) {
        toast.info(activate ? 'Every selected category was already active' : 'Every selected category was already inactive')
      } else {
        toast.success(
          `${formatInt(result.updated)} ${result.updated === 1 ? 'category' : 'categories'} ${activate ? 'activated' : 'deactivated'}`,
        )
      }
      clearSelection()
      invalidateFormOptions()
      reload()
    } catch (err) {
      toast.error(errorMessage(err, 'The categories could not be updated.'))
    } finally {
      setBusy(false)
    }
  }

  // ---- delete --------------------------------------------------------------
  const [deleting, setDeleting] = useState<StockCategory[] | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const confirmDelete = async (deletable: readonly StockCategory[]) => {
    setDeleteBusy(true)
    setDeleteError(null)
    let removed = 0
    const failures: string[] = []
    for (const row of deletable) {
      try {
        await stockCategoriesApi.remove(Number(row.stock_cat_id))
        removed += 1
        setSelected((prev) => {
          const next = new Map(prev)
          next.delete(Number(row.stock_cat_id))
          return next
        })
      } catch (err) {
        failures.push(`${row.cat_name}: ${errorMessage(err)}`)
      }
    }
    setDeleteBusy(false)
    if (removed > 0) {
      toast.success(
        removed === 1 ? 'Stock category deleted' : `${formatInt(removed)} stock categories deleted`,
      )
      invalidateFormOptions()
      reload()
    }
    if (failures.length > 0) {
      // The server refused at least one. Its reason stays on screen rather than
      // becoming a toast that scrolls away before it is read.
      setDeleteError(failures.join(' · '))
      return
    }
    setDeleting(null)
  }

  // ---- export --------------------------------------------------------------
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const exportQuery = useMemo<ListQuery>(() => {
    const { page: _page, limit: _limit, ...rest } = listQuery
    void _page
    void _limit
    return rest
  }, [listQuery])

  const fetchAll = useCallback(
    () => fetchAllRows<StockCategory>((page, limit) => stockCategoriesApi.list({ ...exportQuery, page, limit })),
    [exportQuery],
  )

  const exportMeta = useMemo(() => {
    const lines: string[] = []
    if (list.state.q) lines.push(`Search: ${list.state.q}`)
    if (status) lines.push(`Status: ${status === 'active' ? 'Active only' : 'Inactive only'}`)
    const choice = SORT_CHOICES.find((c) => c.sort === list.state.sort && c.order === list.state.order)
    lines.push(`Sort: ${choice ? choice.label : `${list.state.sort} ${list.state.order}`}`)
    return lines
  }, [list.state.q, list.state.sort, list.state.order, status])

  const exportSelected = () => {
    if (selectedRows.length === 0) return
    const csv = toCsv(selectedRows, [
      { header: 'Category', value: (r) => r.cat_name },
      { header: 'Alias', value: (r) => r.cat_alias ?? '' },
      { header: 'Status', value: (r) => (Number(r.is_active) === 1 ? 'Active' : 'Inactive') },
      { header: 'Items', value: (r) => (typeof r.item_count === 'number' ? r.item_count : '') },
      { header: 'Updated', value: (r) => formatDateTime(r.updated_at, '') },
    ])
    downloadCsv(`stock-categories-selected-${todayIso()}.csv`, csv)
    toast.success(`${formatInt(selectedRows.length)} categories exported`)
  }

  const downloadTemplate = () => {
    downloadCsv('stock-categories-import-template.csv', IMPORT_TEMPLATE_CSV)
    toast.success('Template downloaded')
  }

  // ---- review + AI ---------------------------------------------------------
  const [review, setReview] = useState<CategoryReview | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  const runReview = useCallback(async () => {
    setReviewing(true)
    setReviewError(null)
    try {
      // Every category, not the page: "3 are unused" has to be a claim about
      // the company or it is not a claim at all.
      const all = await fetchAllRows<StockCategory>((page, limit) => stockCategoriesApi.list({ page, limit }))
      setReview(reviewCategories(all.rows))
    } catch (err) {
      setReviewError(errorMessage(err, 'The categories could not be read for review.'))
    } finally {
      setReviewing(false)
    }
  }, [])

  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null)
  const [analysing, setAnalysing] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  const runAnalysis = useCallback(async () => {
    setAnalysing(true)
    setAnalysisError(null)
    try {
      setAnalysis(await analyseStockCategories())
    } catch (err) {
      setAnalysis(null)
      setAnalysisError(errorMessage(err, 'The analysis service could not be reached.'))
    } finally {
      setAnalysing(false)
    }
  }, [])

  const showFinding = useCallback(
    (finding: ReviewFinding) => {
      const first = review?.findings.find((f) => f.id === finding.id)
      void first
      // The list has no "these ids" filter, and inventing one would be a new
      // API for a side panel. Searching the category's own name uses the
      // search the screen already has, and lands on the rows in question.
      const names = finding.detail.match(/"([^"]+)"/)
      const term = names?.[1] ?? ''
      if (term) list.setQ(term)
      setAiDrawerOpen(false)
    },
    [list, review],
  )

  // ---- chrome --------------------------------------------------------------
  const [importOpen, setImportOpen] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false)

  // `/`, Ctrl+R and Ctrl+P come from ListSheetActions; this adds Ctrl+N.
  // A bare `n` is deliberately NOT bound: it is the first key of the app-wide
  // "n then r / n then i" create sequences, and taking it here would break
  // them on this screen only.
  usePageKeyboard({ onNew: canWrite ? openCreate : undefined })

  const filtered = Boolean(list.state.q || status)
  const page = meta ? pageForOffset(meta.offset, meta.limit) : 1
  const totalPages = meta ? pageCount(meta.total, meta.limit) : 1
  const range = meta ? pageRange(meta) : { from: 0, to: 0 }

  const aiPanel = (
    <StockCategoryAiPanel
      analysis={analysis}
      analysing={analysing}
      analysisError={analysisError}
      onAnalyse={runAnalysis}
      review={review}
      reviewing={reviewing}
      reviewError={reviewError}
      onReview={runReview}
      onShowFinding={showFinding}
      canWrite={canWrite}
      onSelectPage={() => {
        toggleAll(true)
        setAiDrawerOpen(false)
      }}
      onDownloadTemplate={downloadTemplate}
      uncategorisedItems={summaryQuery.data?.uncategorised_items ?? null}
      uncategorisedItemsTo={canReadItems ? '/items?stock_cat_id=0' : undefined}
    />
  )

  if (!accessLoading && !canRead) {
    return (
      <PageShell>
        <BreadcrumbHeader breadcrumbs={CRUMBS} title="Stock categories" icon={Layers} />
        <Notice kind="warning">You do not have permission to view stock categories in this company.</Notice>
      </PageShell>
    )
  }

  const empty = filtered ? (
    <EmptyState
      icon={Layers}
      title="No stock categories match your filters."
      description="Nothing in this company matches the search and status you have set."
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="secondary" onClick={list.reset}>
            Clear filters
          </Button>
          {list.state.q ? (
            <Button variant="ghost" onClick={() => list.setQ('')}>
              Reset search
            </Button>
          ) : null}
        </div>
      }
    />
  ) : (
    <EmptyState
      icon={Layers}
      title="No stock categories yet"
      description="Create categories to organise inventory items for reporting, tracking and control."
      action={
        canWrite ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button icon={PlusCircle} onClick={openCreate}>
              New stock category
            </Button>
            <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>
              Import categories
            </Button>
          </div>
        ) : undefined
      }
    />
  )

  return (
    <PageShell>
      <BreadcrumbHeader
        breadcrumbs={CRUMBS}
        title="Stock categories"
        icon={Layers}
        description="Organise your inventory with categories for better classification, reporting and control."
        actions={
          <>
            <Button variant="secondary" size="md" onClick={() => setTourOpen(true)}>
              Watch tour
            </Button>
            {canWrite ? (
              <Button variant="secondary" size="md" icon={Upload} onClick={() => setImportOpen(true)}>
                Import
              </Button>
            ) : null}
            <ListSheetActions<StockCategory>
              columns={EXPORT_COLUMNS}
              rows={rows}
              fetchAll={fetchAll}
              filenameBase="stock-categories"
              title="Stock categories"
              description={companyName ? `Stock categories for ${companyName}` : undefined}
              metaLines={exportMeta}
              onRefresh={reload}
              refreshing={query.loading}
              disabled={!query.data || total === 0}
              searchInputRef={searchInputRef}
            />
            {/* The rail is a column at `wide` and a drawer below it — the same
                panel either way, never a second implementation. */}
            <Button
              variant="secondary"
              size="md"
              icon={Sparkles}
              className="wide:hidden"
              onClick={() => setAiDrawerOpen(true)}
            >
              Aicountly AI
            </Button>
            {canWrite ? (
              <Button size="md" icon={PlusCircle} onClick={openCreate}>
                New stock category
              </Button>
            ) : null}
          </>
        }
      />

      <div data-tour="summary">
        <StockCategorySummaryCards
          summary={summaryQuery.data}
          loading={summaryQuery.loading}
          failed={Boolean(summaryQuery.error)}
          itemsLinkFor={itemsLinkFor}
        />
      </div>

      <div className="grid items-start gap-3 wide:grid-cols-[minmax(0,1fr)_19rem]">
        <Card padding="none" className="min-w-0 overflow-hidden">
          <div data-tour="toolbar">
            <StockCategoryToolbar
              search={list.state.q}
              onSearch={list.setQ}
              searchInputRef={searchInputRef}
              status={status}
              onStatus={(v) => list.setFilter('status', v)}
              sort={list.state.sort}
              order={list.state.order}
              onSortChoice={(choice) => list.setFilters({ sort: choice.sort, order: choice.order })}
              view={view}
              onView={(v) => list.setFilter('view', v === 'grid' ? 'grid' : '')}
              filtered={filtered}
              onClear={list.reset}
            />
          </div>

          <StockCategoryBulkBar
            count={selectedRows.length}
            offPage={offPage}
            canWrite={canWrite}
            canDelete={canDelete}
            busy={busy || deleteBusy}
            onActivate={() => void bulkStatus(true)}
            onDeactivate={() => void bulkStatus(false)}
            onExport={exportSelected}
            onDelete={() => {
              setDeleteError(null)
              setDeleting(selectedRows)
            }}
            onClear={clearSelection}
          />

          <div data-tour="table" className="min-w-0">
            {view === 'grid' ? (
              <StockCategoryGrid
                rows={rows}
                loading={query.loading}
                error={query.error}
                selectedIds={selectedIds}
                onToggleRow={toggleRow}
                onOpen={openEdit}
                itemsLinkFor={itemsLinkFor}
                empty={empty}
                onRetry={query.reload}
              />
            ) : (
              <StockCategoryTable
                rows={rows}
                loading={query.loading}
                error={
                  query.error
                    ? {
                        title: 'Unable to load stock categories.',
                        description: query.error.message,
                        onRetry: query.reload,
                      }
                    : null
                }
                offset={offset}
                sort={{ key: list.state.sort, order: list.state.order }}
                onSort={list.toggleSort}
                selectedIds={selectedIds}
                onToggleRow={toggleRow}
                onToggleAll={toggleAll}
                canWrite={canWrite}
                canDelete={canDelete}
                itemsLinkFor={itemsLinkFor}
                onEdit={openEdit}
                onDuplicate={openDuplicate}
                onToggleStatus={(row) => void toggleStatus(row)}
                onDelete={(row) => {
                  setDeleteError(null)
                  setDeleting([row])
                }}
                empty={empty}
                searchInputRef={searchInputRef}
                keyboardResetKey={`${page}:${list.state.sort}:${list.state.order}:${list.state.q}:${status}`}
              />
            )}
          </div>

          {total > 0 ? (
            <div className="border-t border-gray-200 px-3 py-2.5">
              <TablePagination
                page={page}
                pageSize={list.state.limit}
                total={total}
                totalPages={totalPages}
                from={range.from}
                to={range.to}
                numbered
                onPageChange={list.setPage}
                onPageSizeChange={(size) => list.setLimit(size === 'all' ? list.state.limit : size)}
              />
            </div>
          ) : null}
        </Card>

        <div data-tour="ai" className="hidden wide:block">
          {aiPanel}
        </div>
      </div>

      <StockCategoryFormDrawer
        open={form !== null}
        mode={form?.mode ?? 'create'}
        row={form?.row ?? null}
        saving={saving}
        serverError={saveError}
        canWrite={canWrite}
        onClose={() => {
          if (!saving) setForm(null)
        }}
        onSubmit={(values) => void submitForm(values)}
      />

      <DeleteStockCategoryDialog
        open={deleting !== null}
        rows={deleting ?? []}
        busy={deleteBusy}
        error={deleteError}
        itemsLinkFor={itemsLinkFor}
        onConfirm={(deletable) => void confirmDelete(deletable)}
        onCancel={() => {
          if (!deleteBusy) {
            setDeleting(null)
            setDeleteError(null)
          }
        }}
      />

      <StockCategoryImportDrawer
        open={importOpen}
        onClose={() => setImportOpen(false)}
        fetchExisting={async () => (await fetchAllRows<StockCategory>((page_, limit) => stockCategoriesApi.list({ page: page_, limit }))).rows}
        createOne={(values) => stockCategoriesApi.create({ ...values })}
        onDownloadTemplate={downloadTemplate}
        onImported={(outcome: ImportOutcome) => {
          toast.success(
            `Import completed — ${formatInt(outcome.created)} ${outcome.created === 1 ? 'category' : 'categories'} created`,
          )
          invalidateFormOptions()
          reload()
        }}
      />

      <Drawer
        open={aiDrawerOpen}
        title="Aicountly AI"
        description="Insights and quick actions for this company's stock categories."
        width="md"
        onClose={() => setAiDrawerOpen(false)}
      >
        {aiPanel}
      </Drawer>

      <StockCategoryTour open={tourOpen} onClose={() => setTourOpen(false)} />
    </PageShell>
  )
}

export default StockCategoriesPage
