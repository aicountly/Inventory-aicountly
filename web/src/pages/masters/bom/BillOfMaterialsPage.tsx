import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, PauseCircle, PlayCircle, X } from 'lucide-react'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ListSheetActions } from '../../../components/ListSheetActions'
import { Notice } from '../../../components/Notice'
import { PageHeader } from '../../../components/PageHeader'
import { Pagination } from '../../../components/Pagination'
import { useFormOptions, invalidateFormOptions } from '../../../hooks/useFormOptions'
import { useListParams } from '../../../hooks/useListParams'
import { usePageKeyboard } from '../../../keyboard/usePageKeyboard'
import { useKeyboardScope } from '../../../keyboard/useKeyboardScope'
import { errorMessage } from '../../../services/api'
import type { ListQuery } from '../../../services/api'
import { fetchAllRows } from '../../../services/listAll'
import { bomApi } from '../../../services/masters'
import type { Bom } from '../../../services/masters'
import type { BomTemplate } from '../../../services/bomAiService'
import type { PickedItem } from '../../../components/ItemPicker'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { useToast } from '../../../ui/ToastContext'
import { formatInt } from '../../../utils/format'
import { BomAiDialog } from './BomAiDialog'
import { BomCompareDialog } from './BomCompareDialog'
import { BomCostDialog } from './BomCostDialog'
import { BomEmptyState } from './BomEmptyState'
import { BomFilterDrawer } from './BomFilterDrawer'
import { BomGrid } from './BomGrid'
import { BomHero } from './BomHero'
import { BomImportDialog } from './BomImportDialog'
import { BomQuickActions } from './BomQuickActions'
import { BomStats } from './BomStats'
import { BomTable } from './BomTable'
import { BomToolbar } from './BomToolbar'
import type { BomViewMode } from './BomToolbar'
import { BomViewDrawer } from './BomViewDrawer'
import { BOM_LIST_EXPORT_COLUMNS } from './bomExportColumns'
import { BOM_FILTER_KEYS, activeFilterCount, clearedFilters, filterSummaryLines, toListQuery } from './bomFilters'
import type { BomFilters } from './bomFilters'
import { bomStatus } from './bomPresentation'
import { useBomList, useBomPermissions, useBomSummary } from './useBomWorkspace'

/**
 * Masters → Bill of materials.
 *
 * The screen a production or stores team works in: what recipes exist, how deep
 * they are, what they cost in material, and the actions that keep them current.
 *
 * ## What is held where
 *
 * Search, filters, sort, page, page size and the list / grid switch all live in
 * the URL through `useListParams`, so a narrowed view is a link somebody can
 * send and the browser's Back button works the way it does everywhere else.
 * Only genuinely transient things — which dialog is open, which rows are ticked
 * — are component state.
 *
 * ## What the figures mean
 *
 * The KPI strip is company-wide and does NOT follow the toolbar: the cards
 * answer "what do we have", the table answers "what am I looking at". Neither
 * is ever a page-scoped sum, and a cost that could not be read prints "Cost
 * unavailable" rather than a zero.
 *
 * ## What it preserves
 *
 * Everything the previous screen could do — search, the active / inactive
 * filter, refresh, the four exports, the letterheaded print sheet, paging, the
 * create and edit routes and the delete guard — is still here, under the same
 * permissions and against the same endpoints.
 */

const NEW_ROUTE = '/masters/bill-of-materials/new'
const CRUMBS = [{ label: 'Masters', to: '/masters' }]

type PendingAction =
  | { kind: 'toggle'; row: Bom }
  | { kind: 'delete'; row: Bom }
  | { kind: 'bulk'; active: boolean; rows: Bom[] }

export function BillOfMaterialsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { canRead, canWrite, canDelete, canViewCost, canImport, canExport, loading: accessLoading } =
    useBomPermissions()
  const { options, error: optionsError } = useFormOptions()

  const list = useListParams({
    sort: 'bom_name',
    order: 'asc',
    filterKeys: [...BOM_FILTER_KEYS, 'view'],
  })
  const { view: viewParam, ...filterParams } = list.state.filters
  const filters = filterParams as BomFilters
  const view: BomViewMode = viewParam === 'grid' ? 'grid' : 'list'

  const summary = useBomSummary(canRead && !accessLoading)
  const query = useBomList({
    search: list.state.q,
    filters,
    page: list.state.page,
    limit: list.state.limit,
    sort: list.state.sort,
    order: list.state.order,
    enabled: canRead && !accessLoading,
  })
  const rows = useMemo(() => query.data?.data ?? [], [query.data])

  /* ---- selection ------------------------------------------------------- */
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  // A selection that survived a filter change would let a bulk action reach
  // rows the reader can no longer see.
  const selectionKey = `${list.state.q}|${JSON.stringify(filters)}|${list.state.page}|${list.state.limit}`
  const lastSelectionKey = useRef(selectionKey)
  if (lastSelectionKey.current !== selectionKey) {
    lastSelectionKey.current = selectionKey
    if (selected.size > 0) setSelected(new Set())
  }
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.bom_id)), [rows, selected])

  /* ---- dialogs --------------------------------------------------------- */
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [compareWith, setCompareWith] = useState<Bom | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [viewing, setViewing] = useState<Bom | null>(null)
  const [costing, setCosting] = useState<Bom | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const reloadAll = useCallback(() => {
    query.reload()
    summary.reload()
  }, [query, summary])

  /* ---- actions --------------------------------------------------------- */
  const openEditor = (row: Bom) => navigate(`/masters/bill-of-materials/${row.bom_id}`)

  const createNew = useCallback(
    (params?: Record<string, string>) => {
      const search = params ? `?${new URLSearchParams(params).toString()}` : ''
      navigate(`${NEW_ROUTE}${search}`)
    },
    [navigate],
  )

  const duplicate = async (row: Bom) => {
    try {
      const copy = await bomApi.duplicate(row.bom_id)
      toast.success(`"${copy.bom_name}" created as an inactive copy.`)
      invalidateFormOptions()
      reloadAll()
      navigate(`/masters/bill-of-materials/${copy.bom_id}`)
    } catch (err) {
      toast.error(errorMessage(err, 'Could not duplicate the bill of materials.'))
    }
  }

  const confirmPending = async () => {
    if (!pending) return
    setActionBusy(true)
    setActionError(null)
    try {
      if (pending.kind === 'toggle') {
        const next = bomStatus(pending.row) !== 'active'
        await bomApi.setActive(pending.row.bom_id, next)
        toast.success(next ? 'Bill of materials activated.' : 'Bill of materials deactivated.')
      } else if (pending.kind === 'delete') {
        await bomApi.remove(pending.row.bom_id)
        toast.success('Bill of materials deleted.')
      } else {
        // One at a time: each write is its own transaction and its own audit
        // entry on the API, and a partial failure has to be reportable.
        const failures: string[] = []
        for (const row of pending.rows) {
          try {
            await bomApi.setActive(row.bom_id, pending.active)
          } catch (err) {
            failures.push(`${row.bom_name}: ${errorMessage(err)}`)
          }
        }
        const done = pending.rows.length - failures.length
        if (failures.length > 0) {
          setActionError(
            `${formatInt(done)} of ${formatInt(pending.rows.length)} updated. ${failures.join(' · ')}`,
          )
          setActionBusy(false)
          reloadAll()
          return
        }
        toast.success(
          `${formatInt(done)} bill${done === 1 ? '' : 's'} ${pending.active ? 'activated' : 'deactivated'}.`,
        )
        setSelected(new Set())
      }
      setPending(null)
      invalidateFormOptions()
      reloadAll()
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setActionBusy(false)
    }
  }

  /* ---- export ---------------------------------------------------------- */
  const searchRef = useRef<HTMLInputElement | null>(null)
  const exportQuery = useMemo<ListQuery>(
    () => ({ q: list.state.q || undefined, sort: list.state.sort, order: list.state.order, with_preview: 1, ...toListQuery(filters) }),
    [list.state.q, list.state.sort, list.state.order, filters],
  )
  // Walks the API rather than the rows on screen: a sheet exported from page 1
  // of 9 whose footer counted 431 bills would contradict itself.
  const fetchAll = useCallback(
    () => fetchAllRows<Bom>((page, limit) => bomApi.list({ ...exportQuery, page, limit })),
    [exportQuery],
  )
  const exportMeta = useMemo(
    () => filterSummaryLines(filters, list.state.q, options),
    [filters, list.state.q, options],
  )

  /* ---- keyboard -------------------------------------------------------- */
  usePageKeyboard({ searchInputRef: searchRef, onRefresh: reloadAll })
  useKeyboardScope(
    'page',
    useMemo(
      () => ({
        n: (e: KeyboardEvent) => {
          if (!canWrite) return
          e.preventDefault()
          createNew()
        },
      }),
      [canWrite, createNew],
    ),
  )

  /* ---- title ----------------------------------------------------------- */
  useEffect(() => {
    const previous = document.title
    document.title = 'Bill of Materials | Aicountly Inventory'
    return () => {
      document.title = previous
    }
  }, [])

  if (!accessLoading && !canRead) {
    return (
      <div>
        <PageHeader title="Bills of materials" breadcrumbs={CRUMBS} />
        <Notice kind="warning">
          You do not have permission to view bills of materials in this company.
        </Notice>
      </div>
    )
  }

  const total = query.data?.meta.total ?? 0
  const narrowed = activeFilterCount(filters) > 0 || list.state.q.trim() !== ''
  const emptyState = (
    <BomEmptyState
      filtered={narrowed}
      canWrite={canWrite}
      canImport={canImport}
      onCreate={() => createNew()}
      onImport={() => setImportOpen(true)}
      onCreateWithAi={() => setAiOpen(true)}
      onClearFilters={() => list.setFilters(clearedFilters())}
      onTemplate={(template: BomTemplate) => createNew({ template: template.key })}
    />
  )

  const sheetActions = canExport ? (
    <ListSheetActions<Bom>
      columns={BOM_LIST_EXPORT_COLUMNS}
      rows={rows}
      fetchAll={fetchAll}
      filenameBase="bills-of-materials"
      title="Bills of materials"
      description="Product structures, components and manufacturing recipes."
      metaLines={exportMeta}
      onRefresh={reloadAll}
      refreshing={query.loading}
      disabled={total === 0}
      searchInputRef={searchRef}
    />
  ) : null

  const selectionBar =
    selected.size > 0 ? (
      <>
        <span className="text-[12px] font-semibold text-gray-900">
          {formatInt(selected.size)} selected
        </span>
        {canWrite ? (
          <>
            <Button
              variant="secondary"
              icon={PlayCircle}
              onClick={() => setPending({ kind: 'bulk', active: true, rows: selectedRows })}
            >
              Activate
            </Button>
            <Button
              variant="secondary"
              icon={PauseCircle}
              onClick={() => setPending({ kind: 'bulk', active: false, rows: selectedRows })}
            >
              Deactivate
            </Button>
          </>
        ) : null}
        {selected.size === 2 ? (
          <Button
            variant="secondary"
            icon={Copy}
            onClick={() => {
              setCompareWith(selectedRows[0] ?? null)
              setCompareOpen(true)
            }}
          >
            Compare the two
          </Button>
        ) : null}
        <Button variant="ghost" icon={X} onClick={() => setSelected(new Set())} className="ml-auto">
          Clear selection
        </Button>
      </>
    ) : null

  return (
    <div className="space-y-3">
      <BomHero sample={rows[0] ?? null} onCreateWithAi={() => setAiOpen(true)} />

      {optionsError ? <Notice kind="warning">{optionsError}</Notice> : null}

      <BomStats summary={summary.data} loading={summary.loading} canViewCost={canViewCost} />

      {/* The rail appears only where there is room for it; below `wide` the
          panel drops under the table so the rows keep the full width. */}
      <div className="grid items-start gap-3 wide:grid-cols-[minmax(0,1fr)_17rem]">
        <main className="min-w-0 space-y-3">
          <BomToolbar
            search={list.state.q}
            onSearch={list.setQ}
            searchRef={searchRef}
            filters={filters}
            onFilter={list.setFilter}
            onOpenFilters={() => setFiltersOpen(true)}
            onClearFilters={() => {
              list.setFilters({ ...clearedFilters(), q: '' })
            }}
            options={options}
            view={view}
            onView={(next) => list.setFilter('view', next === 'grid' ? 'grid' : '')}
            onImport={() => setImportOpen(true)}
            onNew={() => createNew()}
            canWrite={canWrite}
            canImport={canImport}
            sheetActions={sheetActions}
            selection={selectionBar}
          />

          {view === 'grid' ? (
            <BomGrid
              rows={rows}
              loading={query.loading}
              error={query.error}
              onRetry={query.reload}
              empty={emptyState}
              onView={setViewing}
              onEdit={openEditor}
              canWrite={canWrite}
            />
          ) : (
            <BomTable
              rows={rows}
              loading={query.loading}
              error={query.error}
              onRetry={query.reload}
              empty={emptyState}
              sort={{ key: list.state.sort, order: list.state.order }}
              onSort={list.toggleSort}
              selected={selected}
              onToggleRow={(id, checked) =>
                setSelected((current) => {
                  const next = new Set(current)
                  if (checked) next.add(id)
                  else next.delete(id)
                  return next
                })
              }
              onToggleAll={(checked) =>
                setSelected(checked ? new Set(rows.map((r) => r.bom_id)) : new Set())
              }
              canWrite={canWrite}
              canDelete={canDelete}
              canViewCost={canViewCost}
              resetKey={`${selectionKey}|${list.state.sort}|${list.state.order}`}
              onView={setViewing}
              onEdit={openEditor}
              onDuplicate={(row) => void duplicate(row)}
              onCompare={(row) => {
                setCompareWith(row)
                setCompareOpen(true)
              }}
              onCost={setCosting}
              onToggleActive={(row) => setPending({ kind: 'toggle', row })}
              onPrint={setViewing}
              onExport={setViewing}
              onDelete={(row) => setPending({ kind: 'delete', row })}
            />
          )}

          {total > 0 ? (
            <Card padding="none" className="px-3 py-2">
              <Pagination
                meta={query.data?.meta ?? null}
                limit={list.state.limit}
                onPage={list.setPage}
                onLimit={list.setLimit}
              />
            </Card>
          ) : null}
        </main>

        <BomQuickActions
          canWrite={canWrite}
          canImport={canImport}
          canViewCost={canViewCost}
          onNew={() => createNew()}
          onImport={() => setImportOpen(true)}
          onTemplates={() => setAiOpen(true)}
          onCostEstimation={() => {
            const target = selectedRows[0] ?? rows[0] ?? null
            if (!target) {
              toast.error('Create a bill of materials first — there is nothing to cost yet.')
              return
            }
            setCosting(target)
          }}
          onCompare={() => {
            setCompareWith(selectedRows[0] ?? rows[0] ?? null)
            setCompareOpen(true)
          }}
          onReport={() => {
            // The report IS the export: same columns, same letterhead, same
            // filters. Pointing at it beats a second half-built screen.
            searchRef.current?.focus()
            toast.success('Use Export in the toolbar for the BOM report — it carries the filters you have set.')
          }}
          onTryAi={() => setAiOpen(true)}
          onPlayVideo={() => toast.success('Tutorial coming soon.')}
        />
      </div>

      <BomFilterDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        onApply={list.setFilters}
        options={options}
      />

      <BomViewDrawer
        bomId={viewing?.bom_id ?? null}
        fallback={viewing}
        onClose={() => setViewing(null)}
        onEdit={(bom) => {
          setViewing(null)
          openEditor(bom)
        }}
        onCost={(bom) => {
          setViewing(null)
          setCosting(bom)
        }}
        canWrite={canWrite}
        canViewCost={canViewCost}
        canExport={canExport}
      />

      <BomCostDialog
        bomId={costing?.bom_id ?? null}
        bomName={costing?.bom_name ?? ''}
        onClose={() => setCosting(null)}
        onEdit={
          costing
            ? () => {
                const target = costing
                setCosting(null)
                openEditor(target)
              }
            : undefined
        }
      />

      <BomCompareDialog
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        initial={compareWith}
      />

      <BomAiDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        canWrite={canWrite}
        onStartFromItem={(item: PickedItem | null) => {
          setAiOpen(false)
          createNew(item ? { finished_item_id: String(item.item_id) } : undefined)
        }}
        onCopyExisting={() => {
          setAiOpen(false)
          setCompareWith(selectedRows[0] ?? rows[0] ?? null)
          setCompareOpen(true)
        }}
        onUseTemplate={(template) => {
          setAiOpen(false)
          createNew({ template: template.key })
        }}
      />

      <BomImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={reloadAll}
      />

      <ConfirmDialog
        open={pending !== null}
        busy={actionBusy}
        error={actionError}
        danger={pending?.kind === 'delete'}
        title={
          pending?.kind === 'delete'
            ? 'Delete bill of materials?'
            : pending?.kind === 'bulk'
              ? pending.active
                ? 'Activate the selected bills?'
                : 'Deactivate the selected bills?'
              : pending && bomStatus(pending.row) === 'active'
                ? 'Deactivate BOM?'
                : 'Activate BOM?'
        }
        confirmLabel={
          pending?.kind === 'delete'
            ? 'Delete'
            : pending?.kind === 'bulk'
              ? pending.active
                ? 'Activate'
                : 'Deactivate'
              : pending && bomStatus(pending.row) === 'active'
                ? 'Deactivate'
                : 'Activate'
        }
        message={
          pending?.kind === 'delete' ? (
            <>
              <p className="mb-2">
                <strong>{pending.row.bom_name}</strong> will be removed from every list and dropdown.
              </p>
              <p className="text-[12px] text-gray-500">
                Production documents that already used it are unaffected — the API refuses the delete
                while any of them still reference it. Prefer deactivating a bill you may need to read
                again.
              </p>
            </>
          ) : pending?.kind === 'bulk' ? (
            <p>
              {formatInt(pending.rows.length)} bill{pending.rows.length === 1 ? '' : 's'} will be{' '}
              {pending.active ? 'made available for production' : 'withdrawn from production'}.
              Historical records are not changed.
            </p>
          ) : pending && bomStatus(pending.row) === 'active' ? (
            <>
              <p className="mb-2">
                <strong>{pending.row.bom_name}</strong> will no longer be available as a
                manufacturing recipe.
              </p>
              <p className="text-[12px] text-gray-500">Historical records will not be changed.</p>
            </>
          ) : pending ? (
            <p>
              <strong>{pending.row.bom_name}</strong> becomes available for production documents to
              explode.
            </p>
          ) : null
        }
        onConfirm={confirmPending}
        onCancel={() => {
          if (actionBusy) return
          setPending(null)
          setActionError(null)
        }}
      />

      {/* Used by the confirm dialog copy above and the KPI captions. */}
      <span className="sr-only" role="status">
        {query.loading ? 'Loading bills of materials' : `${formatInt(total)} bills of materials`}
      </span>
    </div>
  )
}

export default BillOfMaterialsPage
