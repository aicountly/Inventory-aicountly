import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, Warehouse } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAccess } from '../../../access/AccessContext'
import { useCompany } from '../../../company/CompanyContext'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ListSheetActions } from '../../../components/ListSheetActions'
import { Notice } from '../../../components/Notice'
import { useFormOptions, invalidateFormOptions } from '../../../hooks/useFormOptions'
import { useListParams } from '../../../hooks/useListParams'
import { useQuery } from '../../../hooks/useQuery'
import { useKeyboardScope } from '../../../keyboard/useKeyboardScope'
import { locationsConfig } from '../../../masters/configs'
import { defaultPayload } from '../../../masters/formValues'
import type { FormValues } from '../../../masters/types'
import { P } from '../../../services/access'
import { errorMessage, pageCount, pageForOffset, pageRange } from '../../../services/api'
import type { ListQuery } from '../../../services/api'
import { fetchAllRows } from '../../../services/listAll'
import { locationsApi } from '../../../services/masters'
import type { Location } from '../../../services/masters'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { EmptyState } from '../../../ui/EmptyState'
import { SmartTable } from '../../../ui/shell/SmartTable'
import { TablePagination } from '../../../ui/shell/TablePagination'
import { useToast } from '../../../ui/ToastContext'
import { AIC, cx } from '../../../ui/cx'
import { formatInt } from '../../../utils/format'
import { LocationCoverageDrawer, LocationFormDrawer, LocationInsightsDrawer } from './LocationDrawers'
import { LocationsHeader } from './LocationsHeader'
import { LocationsKpis } from './LocationsKpis'
import { LocationsSidebar } from './LocationsSidebar'
import { LocationsToolbar } from './LocationsToolbar'
import {
  LocationBulkBar,
  exportableLocationColumns,
  locationRowClass,
  useLocationColumns,
} from './LocationsTable'
import {
  isActive,
  locationInsights,
  locationStats,
  typeDistribution,
  warehouseCoverage,
} from './locationsModel'

/**
 * Locations — the zone / rack / shelf / bin master, as a workspace rather than
 * a bare table.
 *
 * It does NOT go through `MasterPage`. Everything that screen owns — the API,
 * the field list, the export derivation, the permission slugs — is reused
 * as-is; what it could not express is the rest of this page: a KPI strip
 * counted over the whole company, a contextual column, row selection with bulk
 * actions, and a table whose WAREHOUSE and PARENT columns print names instead
 * of `#3` and `#12`. Every other master still renders through `MasterPage`
 * untouched.
 *
 * TWO QUERIES, ON PURPOSE:
 *
 *  - `query` is the table: server-paged, server-sorted, server-filtered, so
 *    "1-50 of 431" is the server's count and paging a 5,000-bin warehouse costs
 *    one page.
 *  - `estate` is every location in the company, walked once per scope. The KPI
 *    strip, the donut, the coverage list, the insights and the parent-name
 *    lookup all read it. Counting those from the visible page instead would
 *    make "Total locations" mean "rows on screen", and a parent that happened
 *    to sit on page 3 would render as `#12` on page 1.
 */

const FILTER_KEYS = ['status', 'warehouse_id', 'location_type', 'parent_location_id'] as const
const EMPTY_ROWS: Location[] = []

export function LocationsPage() {
  const { scope } = useCompany()
  const { can, loading: accessLoading } = useAccess()
  const toast = useToast()

  const canRead = can(P.masters('locations', 'read'))
  const canWrite = can(P.masters('locations', 'write'))
  const canDelete = can(P.masters('locations', 'delete'))

  const list = useListParams({ sort: 'location_code', filterKeys: FILTER_KEYS })
  const formOptions = useFormOptions()
  const warehouses = formOptions.options?.warehouses ?? []

  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : ''
  const enabled = !!scope && canRead

  /* ------------------------------------------------------------- the table */

  const listQuery = useMemo<ListQuery>(
    () => ({ ...list.query, ...list.state.filters }),
    [list.query, list.state.filters],
  )

  const query = useQuery(
    (signal) => locationsApi.list(listQuery, signal),
    [scopeKey, listQuery],
    { enabled, resetKey: scopeKey },
  )
  const rows = query.data?.data ?? EMPTY_ROWS
  const meta = query.data?.meta ?? null

  /* ------------------------------------------- the whole company, for stats */

  const estate = useQuery(
    (signal) =>
      fetchAllRows<Location>((page, limit) =>
        locationsApi.list({ page, limit, sort: 'location_code', order: 'asc' }, signal),
      ),
    [scopeKey],
    { enabled, resetKey: scopeKey },
  )
  const estateRows = estate.data?.rows ?? EMPTY_ROWS

  const stats = useMemo(() => locationStats(estateRows), [estateRows])
  const distribution = useMemo(() => typeDistribution(estateRows), [estateRows])
  const coverage = useMemo(() => warehouseCoverage(estateRows, warehouses), [estateRows, warehouses])
  const insights = useMemo(() => locationInsights(estateRows, warehouses), [estateRows, warehouses])

  const reloadAll = useCallback(() => {
    invalidateFormOptions()
    query.reload()
    estate.reload()
  }, [query, estate])

  /* -------------------------------------------------------------- selection */

  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set())

  // A selection is a set of rows the user can see. When the query underneath
  // changes they are no longer on screen, and acting on them would be acting
  // on records the user is no longer looking at.
  useEffect(() => {
    setSelected(new Set())
  }, [listQuery, scopeKey])

  const toggleRow = useCallback((id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(rows.map((r) => Number(r.location_id))) : new Set())
    },
    [rows],
  )

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  /* ------------------------------------------------------------------ form */

  const [editing, setEditing] = useState<{
    mode: 'create' | 'edit'
    row: Location | null
    initialValues?: FormValues
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)

  const openCreate = useCallback(() => {
    setSaveError(null)
    setEditing({ mode: 'create', row: null })
  }, [])

  const openEdit = useCallback((row: Location) => {
    setSaveError(null)
    setEditing({ mode: 'edit', row })
  }, [])

  /**
   * Duplicate opens a CREATE form carrying the source row's values with the
   * code blanked. The code is unique per warehouse, so pre-filling it would
   * guarantee the one error the user cannot fix without retyping the field.
   */
  const openDuplicate = useCallback(
    (row: Location) => {
      setSaveError(null)
      const values = locationsConfig.toValues?.(row, formOptions.options) ?? {}
      setEditing({ mode: 'create', row: null, initialValues: { ...values, location_code: '' } })
    },
    [formOptions.options],
  )

  const closeForm = useCallback(() => {
    if (!saving) setEditing(null)
  }, [saving])

  const submitForm = useCallback(
    async (values: FormValues) => {
      if (!editing) return
      setSaving(true)
      setSaveError(null)
      try {
        const payload = locationsConfig.toPayload
          ? locationsConfig.toPayload(values, editing.row)
          : defaultPayload(locationsConfig.fields, values)
        if (editing.mode === 'create') {
          await locationsApi.create(payload)
          toast.success('Location created')
        } else if (editing.row) {
          await locationsApi.update(Number(editing.row.location_id), payload)
          toast.success('Location saved')
        }
        setEditing(null)
        reloadAll()
      } catch (err) {
        setSaveError(err)
      } finally {
        setSaving(false)
      }
    },
    [editing, toast, reloadAll],
  )

  /* ---------------------------------------------------------------- delete */

  const [deleting, setDeleting] = useState<Location | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const confirmDelete = useCallback(async () => {
    if (!deleting) return
    setBusy(true)
    setActionError(null)
    try {
      await locationsApi.remove(Number(deleting.location_id))
      toast.success('Location deleted')
      setDeleting(null)
      reloadAll()
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [deleting, toast, reloadAll])

  /* ------------------------------------------------------------ bulk / toggle */

  /**
   * `PUT /v1/locations/{id}` merges its body over the stored row
   * (MasterController::update), so a body of just `is_active` is a safe partial
   * update and nothing else on the record is touched.
   */
  const setActive = useCallback(
    async (targets: readonly Location[], active: boolean) => {
      if (targets.length === 0) return
      setBusy(true)
      setActionError(null)
      const results = await Promise.allSettled(
        targets.map((row) => locationsApi.update(Number(row.location_id), { is_active: active ? 1 : 0 })),
      )
      const failed = results.filter((r) => r.status === 'rejected')
      const done = results.length - failed.length
      if (done > 0) {
        toast.success(
          done === 1
            ? `Location ${active ? 'activated' : 'deactivated'}`
            : `${done} locations ${active ? 'activated' : 'deactivated'}`,
        )
      }
      // Partial failure is reported, never swallowed: the list is about to
      // reload and the untouched rows would otherwise just look unchanged.
      if (failed.length > 0) {
        const first = failed[0] as PromiseRejectedResult
        toast.error(
          failed.length === 1
            ? errorMessage(first.reason)
            : `${failed.length} of ${results.length} could not be updated — ${errorMessage(first.reason)}`,
        )
      }
      clearSelection()
      setBusy(false)
      reloadAll()
    },
    [toast, reloadAll, clearSelection],
  )

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(Number(r.location_id))),
    [rows, selected],
  )

  const confirmBulkDelete = useCallback(async () => {
    setBusy(true)
    setActionError(null)
    const results = await Promise.allSettled(
      selectedRows.map((row) => locationsApi.remove(Number(row.location_id))),
    )
    const failed = results.filter((r) => r.status === 'rejected')
    const done = results.length - failed.length
    setBusy(false)
    if (failed.length > 0) {
      const first = failed[0] as PromiseRejectedResult
      setActionError(
        `${done} deleted, ${failed.length} refused. ${errorMessage(first.reason)}`,
      )
      reloadAll()
      return
    }
    toast.success(done === 1 ? 'Location deleted' : `${done} locations deleted`)
    setBulkDeleting(false)
    clearSelection()
    reloadAll()
  }, [selectedRows, toast, reloadAll, clearSelection])

  /* ---------------------------------------------------------------- panels */

  const [panel, setPanel] = useState<'coverage' | 'insights' | null>(null)

  const applyInsightFilter = useCallback(
    (filter: Record<string, string>) => {
      setPanel(null)
      list.setFilters(filter)
    },
    [list],
  )

  /* ------------------------------------------------------------- shortcuts */

  const searchInputRef = useRef<HTMLInputElement | null>(null)

  /*
   * `n` only. `/`, Ctrl+F, Ctrl+R and Ctrl+P are already registered by
   * ListSheetActions through usePageKeyboard, and the provider walks every
   * active scope, so a second binding for any of those keys would be a second
   * handler for one keystroke. Nothing else in the app binds a bare `n`, and
   * useKeyboardScope ignores keys typed into an input.
   */
  const shortcuts = useMemo(
    () => ({
      n: (e: KeyboardEvent) => {
        if (!canWrite || editing || panel) return
        e.preventDefault()
        openCreate()
      },
    }),
    [canWrite, editing, panel, openCreate],
  )
  useKeyboardScope('page', shortcuts)

  /* --------------------------------------------------------------- columns */

  const columns = useLocationColumns({
    warehouses,
    allRows: estateRows,
    selected,
    onToggleRow: toggleRow,
    onToggleAll: toggleAll,
    pageRows: rows,
    selectable: canWrite || canDelete,
    onEdit: openEdit,
    onDuplicate: openDuplicate,
    onToggleActive: (row) => setActive([row], !isActive(row)),
    onDelete: (row) => {
      setActionError(null)
      setDeleting(row)
    },
    canWrite,
    canDelete,
  })

  const exportColumns = useMemo(() => exportableLocationColumns(columns), [columns])
  const fetchAll = useCallback(
    () => fetchAllRows<Location>((page, limit) => locationsApi.list({ ...listQuery, page, limit })),
    [listQuery],
  )

  const exportMeta = useMemo(() => {
    const lines: string[] = []
    if (list.state.q) lines.push(`Search: ${list.state.q}`)
    const { status, warehouse_id: wh, location_type: type, parent_location_id: parent } = list.state.filters
    if (status) lines.push(`Status: ${status === 'active' ? 'Active only' : 'Inactive only'}`)
    if (wh) {
      lines.push(
        `Warehouse: ${warehouses.find((w) => String(w.warehouse_id) === wh)?.warehouse_name ?? `#${wh}`}`,
      )
    }
    if (type) lines.push(`Type: ${type}`)
    if (parent === 'root') lines.push('Hierarchy: top level only')
    return lines
  }, [list.state.q, list.state.filters, warehouses])

  /* ----------------------------------------------------------------- guard */

  if (!accessLoading && !canRead) {
    return (
      <div className={cx(AIC)}>
        <Notice kind="warning">You do not have permission to view locations in this company.</Notice>
      </div>
    )
  }

  /* ------------------------------------------------------------------ view */

  const hasFilters = !!list.state.q || Object.keys(list.state.filters).length > 0
  const total = meta?.total ?? 0
  const range = meta ? pageRange(meta) : { from: 0, to: 0 }
  const firstLoad = query.loading && !query.data
  const noWarehouses = !formOptions.loading && warehouses.length === 0

  const emptyState =
    total === 0 && hasFilters ? (
      <EmptyState
        icon={MapPin}
        title="No locations match these filters"
        description="Try a different warehouse, type or search term."
        action={
          <Button variant="secondary" onClick={list.reset}>
            Clear filters
          </Button>
        }
      />
    ) : noWarehouses ? (
      <EmptyState
        icon={Warehouse}
        title="Create a warehouse first"
        description="Every location lives inside one warehouse — a zone, rack, shelf or bin needs somewhere to belong to."
        action={
          <Link
            to="/masters/warehouses"
            className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-white no-underline shadow-card transition-colors hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            Go to warehouses
          </Link>
        }
      />
    ) : (
      <EmptyState
        icon={MapPin}
        title="Create your first location"
        description="Locations are the addresses inside a warehouse — zones, racks, shelves and bins — that stock is counted, put away and picked from."
        action={
          canWrite ? (
            <Button onClick={openCreate}>New location</Button>
          ) : undefined
        }
      />
    )

  return (
    <div className={cx(AIC, 'min-h-full')}>
      <LocationsHeader
        onOpenCoverage={() => setPanel('coverage')}
        onOpenInsights={() => setPanel('insights')}
        disabled={estate.loading && !estate.data}
      />

      <LocationsKpis
        className="mb-4"
        stats={stats}
        warehouseCount={warehouses.length}
        loading={estate.loading && !estate.data}
        truncated={estate.data?.truncated ?? false}
      />

      {formOptions.error ? (
        <Notice kind="warning">{formOptions.error}</Notice>
      ) : null}
      {estate.error && !estate.loading ? (
        <Notice kind="warning">
          The summary above could not be refreshed — the table below is still live.
        </Notice>
      ) : null}

      {/*
        The rail only appears at `ultra` (1600px).

        The measurement, not a preference: this app keeps a 260px nav rail the
        mock did not account for, so at 1440px a 360px insight column leaves the
        table about 780px for nine columns — it fits by scrolling sideways, and
        a table you have to scroll to reach the row menu is worse than widgets
        that sit underneath. Below 1600 the widgets stack as a 2- or 3-up strip
        under a full-width table; above it, both fit properly side by side.
      */}
      <div className="grid items-start gap-4 ultra:grid-cols-[minmax(0,1fr)_360px]">
        <Card padding="none" className="min-w-0 overflow-hidden">
          <LocationsToolbar
            q={list.state.q}
            onQChange={list.setQ}
            searchInputRef={searchInputRef}
            status={list.state.filters.status ?? ''}
            warehouseId={list.state.filters.warehouse_id ?? ''}
            locationType={list.state.filters.location_type ?? ''}
            parentScope={list.state.filters.parent_location_id ?? ''}
            onFilter={list.setFilter}
            onClear={list.reset}
            hasFilters={hasFilters}
            warehouses={warehouses}
            canWrite={canWrite}
            onCreate={openCreate}
            sheetActions={
              <ListSheetActions<Location>
                columns={exportColumns}
                rows={rows}
                fetchAll={fetchAll}
                filenameBase="locations"
                title="Locations"
                metaLines={exportMeta}
                onRefresh={reloadAll}
                refreshing={query.loading}
                disabled={total === 0}
                searchInputRef={searchInputRef}
              />
            }
            bulkBar={
              selected.size > 0 ? (
                <LocationBulkBar
                  count={selected.size}
                  busy={busy}
                  canWrite={canWrite}
                  canDelete={canDelete}
                  onClear={clearSelection}
                  onActivate={() => setActive(selectedRows, true)}
                  onDeactivate={() => setActive(selectedRows, false)}
                  onDelete={() => {
                    setActionError(null)
                    setBulkDeleting(true)
                  }}
                />
              ) : undefined
            }
          />

          <SmartTable<Location>
            columns={columns}
            rows={rows}
            rowKey={(row) => Number(row.location_id)}
            loading={firstLoad}
            error={query.error ? { title: 'Could not load locations', description: errorMessage(query.error), onRetry: query.reload } : null}
            empty={emptyState}
            density="compact"
            stickyHeader
            size="sm"
            cardPadding="none"
            className="border-0 shadow-none rounded-none"
            minWidth={900}
            activateOnSingleClick
            onRowActivate={openEdit}
            rowClassName={(row) => locationRowClass(row, selected)}
            keyboardNav
            keyboardResetKey={`${list.state.page}:${list.state.sort}:${list.state.order}`}
            searchInputRef={searchInputRef}
            sort={{ key: list.state.sort, order: list.state.order }}
            onSort={list.toggleSort}
            caption="Locations"
          />

          {total > 0 ? (
            <div className="border-t border-gray-100 px-3.5 py-2">
              <TablePagination
                page={meta ? pageForOffset(meta.offset, meta.limit) : 1}
                pageSize={list.state.limit}
                total={total}
                totalPages={meta ? pageCount(meta.total, meta.limit) : 1}
                from={range.from}
                to={range.to}
                onPageChange={list.setPage}
                onPageSizeChange={(size) => {
                  if (typeof size === 'number') list.setLimit(size)
                }}
              />
            </div>
          ) : null}
        </Card>

        <LocationsSidebar
          coverage={coverage}
          distribution={distribution}
          insights={insights}
          total={stats.total}
          loading={estate.loading && !estate.data}
          onOpenCoverage={() => setPanel('coverage')}
          onOpenInsights={() => setPanel('insights')}
        />
      </div>

      <LocationFormDrawer
        open={editing !== null}
        mode={editing?.mode ?? 'create'}
        row={editing?.row ?? null}
        initialValues={editing?.initialValues}
        options={formOptions.options}
        rows={estateRows}
        saving={saving}
        saveError={saveError}
        readOnly={!canWrite}
        onSubmit={submitForm}
        onClose={closeForm}
      />

      <LocationCoverageDrawer
        open={panel === 'coverage'}
        coverage={coverage}
        total={stats.total}
        onClose={() => setPanel(null)}
      />

      <LocationInsightsDrawer
        open={panel === 'insights'}
        insights={insights}
        onClose={() => setPanel(null)}
        onApplyFilter={applyInsightFilter}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete location?"
        message={
          <>
            <p className="m-0 mb-2">
              <strong>{deleting ? locationsConfig.nameOf(deleting) : ''}</strong> will be removed from
              every list and dropdown.
            </p>
            <p className="m-0 text-sm text-gray-500">
              Stock movements that already reference it keep working. The API refuses the delete while
              a document line still points at it.
            </p>
          </>
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        error={actionError}
        onConfirm={confirmDelete}
        onCancel={() => !busy && setDeleting(null)}
      />

      <ConfirmDialog
        open={bulkDeleting}
        title={`Delete ${formatInt(selected.size)} ${selected.size === 1 ? 'location' : 'locations'}?`}
        message={
          <>
            <p className="m-0 mb-2">
              They will be removed from every list and dropdown.
            </p>
            <p className="m-0 text-sm text-gray-500">
              Any location still referenced by a document line is refused by the API and stays as it
              is — the rest are deleted.
            </p>
          </>
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        error={actionError}
        onConfirm={confirmBulkDelete}
        onCancel={() => !busy && setBulkDeleting(false)}
      />
    </div>
  )
}

export default LocationsPage
