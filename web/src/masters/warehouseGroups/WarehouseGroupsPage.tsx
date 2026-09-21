import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Boxes, MoreHorizontal, Network, PanelRightClose, PanelRightOpen, Plus, Upload } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ListSheetActions } from '../../components/ListSheetActions'
import { Notice } from '../../components/Notice'
import { useDebounce } from '../../hooks/useDebounce'
import { useQuery } from '../../hooks/useQuery'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { P } from '../../services/access'
import { errorMessage, isApiError } from '../../services/api'
import { fetchAllRows } from '../../services/listAll'
import { warehouseGroupsApi, warehousesApi } from '../../services/masters'
import type { Warehouse, WarehouseGroup } from '../../services/masters'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Drawer } from '../../ui/Drawer'
import { EmptyState } from '../../ui/EmptyState'
import { MenuButton } from '../../ui/MenuButton'
import { ActiveBadge } from '../../ui/StatusBadge'
import { useToast } from '../../ui/ToastContext'
import { cx } from '../../ui/cx'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { TablePagination } from '../../ui/shell/TablePagination'
import { paginateRows } from '../../ui/shell/paginateRows'
import type { PageSize } from '../../ui/shell/paginateRows'
import type { ExportableColumn } from '../../registers/registerCells'
import { humanize } from '../../utils/format'
import { WarehouseGroupDeleteDialog } from './WarehouseGroupDeleteDialog'
import { WarehouseGroupFormDrawer } from './WarehouseGroupFormDrawer'
import type { FormMode, WarehouseGroupFormValues } from './WarehouseGroupFormDrawer'
import { WarehouseGroupsBulkBar } from './WarehouseGroupsBulkBar'
import { WarehouseGroupsCards } from './WarehouseGroupsCards'
import { WarehouseGroupsSidePanel } from './WarehouseGroupsSidePanel'
import { WarehouseGroupsStats } from './WarehouseGroupsStats'
import { WarehouseGroupsTable } from './WarehouseGroupsTable'
import { WarehouseGroupsToolbar } from './WarehouseGroupsToolbar'
import { WarehouseGroupsTree } from './WarehouseGroupsTree'
import { buildRowActions } from './rowActions'
import {
  SORT_KEYS,
  activeFilterCount,
  creatorOptions,
  filterGroups,
  groupStats,
  insights as deriveInsights,
  isActive,
  rangeLabel,
  sortGroups,
  warehouseCount,
} from './model'
import type { FilterState, SortKey, ViewMode } from './model'

/**
 * Masters → Warehouse groups.
 *
 * ## One request, four views
 *
 * The screen loads every warehouse group once and answers everything from that
 * one set: the figures, the table, the hierarchy, the cards, the structure
 * panel and the insights. Warehouse groups are a small master — tens of rows,
 * not tens of thousands — and the tree, the counts and the parent picker each
 * need the WHOLE set anyway, so paging the table server-side would mean four
 * requests that disagree with each other at the page boundary: a KPI card
 * reading "4 active" because four of the twenty-five rows in view were active
 * is a figure that changes when the reader turns a page.
 *
 * The walk is capped (`MAX_ROWS`). If a company ever passes it the screen says
 * so in a banner rather than quietly showing a subset and calling it a total.
 *
 * ## Where the data comes from
 *
 * `/v1/warehouse-groups` and `/v1/warehouses` — the endpoints Inventory already
 * had, through the shared API client, which injects the selected company /
 * financial year / branch on every call. Company, branch and financial year
 * themselves stay Manage's, read live through the existing relay; nothing here
 * copies or synchronises another product's masters.
 */

const MAX_ROWS = 5000
const PAGE_LIMIT = 200
const VIEW_STORAGE_KEY = 'inventory.warehouseGroups.view'
const PANEL_STORAGE_KEY = 'inventory.warehouseGroups.panel'
const WAREHOUSES_ROUTE = '/masters/warehouses'

const VIEWS: ViewMode[] = ['list', 'tree', 'cards']

/** Browser storage is a convenience, never a requirement: private windows throw. */
function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* ignore — the URL still carries the state that matters */
  }
}

const EXPORT_COLUMNS: ExportableColumn<WarehouseGroup>[] = [
  { key: 'grp_name', csvHeader: 'Group name', format: 'text' },
  { key: 'grp_code', csvHeader: 'Code', format: 'text', csv: (r) => r.grp_code ?? '' },
  { key: 'description', csvHeader: 'Description', format: 'text', csv: (r) => r.description ?? '' },
  { key: 'parent', csvHeader: 'Parent group', format: 'text', csv: (r) => (r.parent_grp_id ? String(r.parent_grp_id) : '') },
  { key: 'warehouse_count', csvHeader: 'Warehouses', align: 'right', format: 'int', csv: (r) => warehouseCount(r) },
  { key: 'is_active', csvHeader: 'Status', format: 'text', csv: (r) => (isActive(r) ? 'Active' : 'Inactive') },
  { key: 'updated_at', csvHeader: 'Updated on', format: 'datetime' },
  { key: 'updated_by_name', csvHeader: 'Updated by', format: 'text', csv: (r) => r.updated_by_name ?? r.updated_by ?? '' },
]

export function WarehouseGroupsPage() {
  const { scope } = useCompany()
  const { can, loading: accessLoading } = useAccess()
  const toast = useToast()
  const navigate = useNavigate()

  const canRead = can(P.masters('warehouse_groups', 'read'))
  const canWrite = can(P.masters('warehouse_groups', 'write'))
  const canDeleteGroups = can(P.masters('warehouse_groups', 'delete'))
  const canReadWarehouses = can(P.masters('warehouses', 'read'))
  const canReadAudit = can(P.auditRead)

  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null

  // ---- URL state ----------------------------------------------------------
  const [params, setParams] = useSearchParams()

  const storedView = readPreference(VIEW_STORAGE_KEY)
  const urlView = params.get('view')
  const view: ViewMode = VIEWS.includes(urlView as ViewMode)
    ? (urlView as ViewMode)
    : VIEWS.includes(storedView as ViewMode)
      ? (storedView as ViewMode)
      : 'list'

  const filters = useMemo<FilterState>(() => {
    const sort = params.get('sort')
    return {
      q: params.get('q') ?? '',
      status: (params.get('status') as FilterState['status']) || 'all',
      createdBy: params.get('created_by') ?? '',
      contents: (params.get('contents') as FilterState['contents']) || 'all',
      level: (params.get('level') as FilterState['level']) || 'all',
      updatedFrom: params.get('updated_from') ?? '',
      sort: SORT_KEYS.includes(sort as SortKey) ? (sort as SortKey) : 'name_asc',
    }
  }, [params])

  const page = Math.max(1, Number(params.get('page') ?? 1) || 1)
  const rawLimit = params.get('limit')
  const pageSize: PageSize = rawLimit === 'all' ? 'all' : Number(rawLimit ?? 25) || 25

  const writeParams = useCallback(
    (patch: Record<string, string | number | null>, resetPage = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === '' || value === undefined) next.delete(key)
            else next.set(key, String(value))
          }
          if (resetPage) next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  /*
   * The search box is typed into, so it holds its own value and hands it to the
   * URL once it has settled. Writing every keystroke through the router would
   * re-run the filter on each character and leave a trail of history states.
   */
  const [searchDraft, setSearchDraft] = useState(filters.q)
  const debouncedSearch = useDebounce(searchDraft, 250)
  const lastPushedSearch = useRef(filters.q)
  useEffect(() => {
    if (debouncedSearch === lastPushedSearch.current) return
    lastPushedSearch.current = debouncedSearch
    writeParams({ q: debouncedSearch })
  }, [debouncedSearch, writeParams])
  useEffect(() => {
    // A filter reset or a Back rewrote the URL: follow it.
    if (filters.q !== lastPushedSearch.current) {
      lastPushedSearch.current = filters.q
      setSearchDraft(filters.q)
    }
  }, [filters.q])

  const applyFilters = useCallback(
    (patch: Partial<FilterState>) => {
      // `q` is deliberately left out of the URL write: the draft above owns it
      // and the debounce pushes it, so typing does not re-run the filter (or
      // touch history) on every character.
      if (patch.q !== undefined) setSearchDraft(patch.q)
      const rest = { ...patch }
      delete rest.q
      if (Object.keys(rest).length === 0) return
      writeParams({
        ...(patch.status !== undefined ? { status: patch.status === 'all' ? null : patch.status } : {}),
        ...(patch.createdBy !== undefined ? { created_by: patch.createdBy || null } : {}),
        ...(patch.contents !== undefined ? { contents: patch.contents === 'all' ? null : patch.contents } : {}),
        ...(patch.level !== undefined ? { level: patch.level === 'all' ? null : patch.level } : {}),
        ...(patch.updatedFrom !== undefined ? { updated_from: patch.updatedFrom || null } : {}),
        ...(patch.sort !== undefined ? { sort: patch.sort === 'name_asc' ? null : patch.sort } : {}),
      })
    },
    [writeParams],
  )

  const clearFilters = useCallback(() => {
    lastPushedSearch.current = ''
    setSearchDraft('')
    writeParams({ q: null, status: null, created_by: null, contents: null, level: null, updated_from: null })
  }, [writeParams])

  const setView = useCallback(
    (next: ViewMode) => {
      writePreference(VIEW_STORAGE_KEY, next)
      writeParams({ view: next === 'list' ? null : next })
    },
    [writeParams],
  )

  const [panelOpen, setPanelOpen] = useState(() => readPreference(PANEL_STORAGE_KEY) !== 'closed')
  const togglePanel = () => {
    setPanelOpen((open) => {
      writePreference(PANEL_STORAGE_KEY, open ? 'closed' : 'open')
      return !open
    })
  }

  // ---- data ---------------------------------------------------------------
  const groupsQuery = useQuery(
    (signal) =>
      fetchAllRows<WarehouseGroup>(
        (p, limit) => warehouseGroupsApi.list({ page: p, limit, sort: 'grp_name', order: 'asc' }, signal),
        { limit: PAGE_LIMIT, maxRows: MAX_ROWS },
      ),
    [scopeKey],
    { enabled: Boolean(scope) && canRead, resetKey: scopeKey },
  )

  const warehousesQuery = useQuery(
    (signal) =>
      fetchAllRows<Warehouse>(
        (p, limit) => warehousesApi.list({ page: p, limit, sort: 'warehouse_name', order: 'asc' }, signal),
        { limit: PAGE_LIMIT, maxRows: MAX_ROWS },
      ),
    [scopeKey],
    { enabled: Boolean(scope) && canRead && canReadWarehouses, resetKey: scopeKey },
  )

  const allRows = useMemo(() => groupsQuery.data?.rows ?? [], [groupsQuery.data])
  const warehouses = canReadWarehouses ? (warehousesQuery.data?.rows ?? null) : null
  const loading = groupsQuery.loading && !groupsQuery.data

  const reload = useCallback(() => {
    groupsQuery.reload()
    if (canReadWarehouses) warehousesQuery.reload()
  }, [groupsQuery, warehousesQuery, canReadWarehouses])

  const stats = useMemo(() => groupStats(allRows, warehouses), [allRows, warehouses])
  const creators = useMemo(() => creatorOptions(allRows), [allRows])
  const insightList = useMemo(() => deriveInsights(allRows, warehouses), [allRows, warehouses])

  const filtered = useMemo(
    () => sortGroups(filterGroups(allRows, filters), filters.sort),
    [allRows, filters],
  )

  // The tree draws the whole hierarchy; paging it would cut branches in half.
  const paged = useMemo(
    () => paginateRows(filtered, page, view === 'tree' ? 'all' : pageSize),
    [filtered, page, pageSize, view],
  )

  // ---- selection ----------------------------------------------------------
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(() => new Set())
  // A selection can only mean something while the rows it names are on record.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev
      const live = new Set(allRows.map((r) => r.warehouse_group_id))
      const next = new Set([...prev].filter((id) => live.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [allRows])

  const selectedRows = useMemo(
    () => allRows.filter((r) => selectedIds.has(r.warehouse_group_id)),
    [allRows, selectedIds],
  )

  const toggleRow = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAllOnPage = useCallback(() => {
    setSelectedIds((prev) => {
      const ids = paged.pageRows.map((r) => r.warehouse_group_id)
      const all = ids.length > 0 && ids.every((id) => prev.has(id))
      const next = new Set(prev)
      for (const id of ids) {
        if (all) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }, [paged.pageRows])

  // ---- form ---------------------------------------------------------------
  const [form, setForm] = useState<{ mode: FormMode; row: WarehouseGroup | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)

  const openCreate = useCallback(() => {
    if (!canWrite) return
    setSaveError(null)
    setForm({ mode: 'create', row: null })
  }, [canWrite])

  const openRow = useCallback(
    (row: WarehouseGroup) => {
      setSaveError(null)
      setForm({ mode: canWrite ? 'edit' : 'view', row })
    },
    [canWrite],
  )

  /*
   * `?new=1` opens the create form on arrival — the Masters landing page's
   * Quick Create menu needs a link it can put in an anchor. The flag is
   * consumed before the form opens, so a reload or a Back does not reopen it,
   * and it waits for access: `can()` answers false while permissions are in
   * flight and acting on that would swallow the request of a user who may in
   * fact create.
   */
  const createRequested = params.get('new') === '1'
  const openCreateRef = useRef(openCreate)
  openCreateRef.current = openCreate
  useEffect(() => {
    if (!createRequested || accessLoading) return
    writeParams({ new: null }, false)
    if (canWrite) openCreateRef.current()
  }, [createRequested, accessLoading, canWrite, writeParams])

  const submitForm = async (values: WarehouseGroupFormValues, andAnother: boolean) => {
    if (!form) return
    setSaving(true)
    setSaveError(null)
    const payload = {
      grp_name: values.grp_name,
      grp_code: values.grp_code || null,
      description: values.description || null,
      parent_grp_id: values.parent_grp_id ? Number(values.parent_grp_id) : null,
      is_active: values.is_active ? 1 : 0,
    }
    try {
      if (form.mode === 'create') {
        await warehouseGroupsApi.create(payload)
        toast.success('Warehouse group created')
      } else if (form.row) {
        await warehouseGroupsApi.update(form.row.warehouse_group_id, payload)
        toast.success('Warehouse group updated')
      }
      setForm(andAnother && form.mode === 'create' ? { mode: 'create', row: null } : null)
      reload()
    } catch (err) {
      setSaveError(err)
      if (!isApiError(err)) toast.error(errorMessage(err, "Couldn't save the warehouse group. Please try again."))
    } finally {
      setSaving(false)
    }
  }

  // ---- status -------------------------------------------------------------
  const [busy, setBusy] = useState(false)

  const setActive = async (rows: readonly WarehouseGroup[], active: boolean) => {
    const targets = rows.filter((r) => isActive(r) !== active)
    if (targets.length === 0) {
      toast.info(active ? 'Those groups are already active.' : 'Those groups are already inactive.')
      return
    }
    setBusy(true)
    let done = 0
    const failures: string[] = []
    for (const row of targets) {
      try {
        await warehouseGroupsApi.update(row.warehouse_group_id, { is_active: active ? 1 : 0 })
        done += 1
      } catch (err) {
        failures.push(`${row.grp_name}: ${errorMessage(err)}`)
      }
    }
    setBusy(false)
    reload()
    if (done > 0) {
      toast.success(
        done === 1
          ? `Warehouse group ${active ? 'activated' : 'deactivated'}`
          : `${done} warehouse groups ${active ? 'activated' : 'deactivated'}`,
      )
    }
    if (failures.length > 0) {
      toast.error(failures.length === 1 ? failures[0] : `${failures.length} groups could not be updated.`)
    }
  }

  // ---- delete -------------------------------------------------------------
  const [deleting, setDeleting] = useState<WarehouseGroup[] | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const confirmDelete = async () => {
    if (!deleting) return
    const targets = deleting.filter((r) => warehouseCount(r) === 0 && Number(r.child_count ?? 0) === 0)
    setDeleteBusy(true)
    setDeleteError(null)
    let done = 0
    const failures: string[] = []
    for (const row of targets) {
      try {
        await warehouseGroupsApi.remove(row.warehouse_group_id)
        done += 1
      } catch (err) {
        failures.push(`${row.grp_name}: ${errorMessage(err)}`)
      }
    }
    setDeleteBusy(false)
    if (failures.length > 0) {
      setDeleteError(failures.join(' · '))
    } else {
      setDeleting(null)
    }
    if (done > 0) {
      setSelectedIds(new Set())
      toast.success(done === 1 ? 'Warehouse group deleted' : `${done} warehouse groups deleted`)
      reload()
    }
  }

  // ---- warehouses drawer ---------------------------------------------------
  const [inspecting, setInspecting] = useState<WarehouseGroup | null>(null)
  const inspectedWarehouses = useMemo(() => {
    if (!inspecting || !warehouses) return []
    return warehouses.filter((w) => Number(w.warehouse_group_id) === inspecting.warehouse_group_id)
  }, [inspecting, warehouses])

  // ---- row actions ---------------------------------------------------------
  /*
   * The row menu is rebuilt only when the abilities behind it change, so it is
   * not re-created on every keystroke in the search box. `setActive` closes
   * over this render's state and would go stale inside that memo, so the menu
   * reaches it through a ref that is refreshed every render instead of
   * capturing whichever copy happened to exist when the menu was built.
   */
  const setActiveRef = useRef(setActive)
  setActiveRef.current = setActive

  const actionsFor = useCallback(
    (row: WarehouseGroup) =>
      buildRowActions(
        row,
        { canWrite, canDelete: canDeleteGroups, canReadAudit, canReadWarehouses },
        {
          onView: openRow,
          onEdit: openRow,
          onDuplicate: (r) => {
            setSaveError(null)
            setForm({ mode: 'create', row: r })
          },
          onToggleActive: (r) => void setActiveRef.current([r], !isActive(r)),
          onShowWarehouses: setInspecting,
          onAudit: (r) => navigate(`/audit?entity_type=warehouse_group&entity_id=${r.warehouse_group_id}`),
          onDelete: (r) => {
            setDeleteError(null)
            setDeleting([r])
          },
        },
      ),
    [canWrite, canDeleteGroups, canReadAudit, canReadWarehouses, openRow, navigate],
  )

  // ---- keyboard ------------------------------------------------------------
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  /*
   * Ctrl+N creates, which is what Ctrl+N does everywhere else in Inventory.
   * A bare `N` is deliberately NOT bound: `n` is the prefix of the global
   * create sequences (`n r`, `n i`, `n t`, `n c`), and a page binding shadows
   * the prefix — taking those four shortcuts away from this screen only.
   * `/`, Ctrl+R and Ctrl+P come from ListSheetActions' own page scope.
   */
  const shortcuts = useMemo(
    () => ({
      'ctrl+n': (e: KeyboardEvent) => {
        if (!canWrite) return
        e.preventDefault()
        openCreateRef.current()
      },
    }),
    [canWrite],
  )
  useKeyboardScope('page', shortcuts)

  // ---- export --------------------------------------------------------------
  const exportRows = selectedRows.length > 0 ? selectedRows : filtered
  const fetchAllForExport = useCallback(
    async () => ({ rows: [...exportRows], total: exportRows.length, truncated: false }),
    [exportRows],
  )
  const exportMeta = useMemo(() => {
    const lines: string[] = []
    if (filters.q) lines.push(`Search: ${filters.q}`)
    if (filters.status !== 'all') lines.push(`Status: ${humanize(filters.status)} only`)
    if (filters.createdBy) {
      lines.push(`Created by: ${creators.find((c) => c.value === filters.createdBy)?.label ?? filters.createdBy}`)
    }
    if (filters.contents !== 'all') lines.push(filters.contents === 'with' ? 'Contains warehouses' : 'Empty groups only')
    if (filters.level !== 'all') lines.push(filters.level === 'root' ? 'Top-level groups only' : 'Sub-groups only')
    if (filters.updatedFrom) lines.push(`Updated since: ${filters.updatedFrom}`)
    if (selectedRows.length > 0) lines.push(`Selection: ${selectedRows.length} groups`)
    return lines
  }, [filters, creators, selectedRows.length])

  // ---- render --------------------------------------------------------------
  if (!accessLoading && !canRead) {
    return (
      <PageShell fullBleed>
        <BreadcrumbHeader
          breadcrumbs={[{ label: 'Masters', to: '/masters' }, { label: 'Warehouse groups' }]}
          icon={Network}
          title="Warehouse groups"
          escBack={false}
        />
        <Notice kind="warning">You do not have permission to view warehouse groups in this company.</Notice>
      </PageShell>
    )
  }

  const filtersActive = activeFilterCount(filters) > 0 || filters.q !== ''
  const empty = filtersActive ? (
    <EmptyState
      icon={Boxes}
      title="No warehouse groups match your filters."
      description="Nothing on record answers this combination. Widen the search, or clear the filters to see every group."
      action={
        <Button variant="secondary" onClick={clearFilters}>
          Clear filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={Boxes}
      title="No warehouse groups yet"
      description="Create your first warehouse group to organise warehouses for easier reporting, operations and access control."
      action={
        canWrite ? (
          <Button icon={Plus} onClick={openCreate}>
            Create warehouse group
          </Button>
        ) : undefined
      }
    />
  )

  const overflowActions = [
    ...(canWrite
      ? [
          {
            key: 'bulk-activate',
            label: `Activate ${selectedRows.length || 'selected'} groups`,
            onSelect: () => void setActive(selectedRows, true),
            disabled: selectedRows.length === 0,
          },
          {
            key: 'bulk-deactivate',
            label: `Deactivate ${selectedRows.length || 'selected'} groups`,
            onSelect: () => void setActive(selectedRows, false),
            disabled: selectedRows.length === 0,
          },
        ]
      : []),
    ...(canReadAudit
      ? [
          {
            key: 'audit',
            label: 'View audit history',
            separated: true,
            onSelect: () => navigate('/audit?entity_type=warehouse_group'),
          },
        ]
      : []),
    {
      key: 'panel',
      label: panelOpen ? 'Hide insights panel' : 'Show insights panel',
      separated: !canReadAudit,
      onSelect: togglePanel,
    },
  ]

  const mainColumn = (
    <div className="min-w-0 space-y-3">
      <WarehouseGroupsToolbar
        filters={{ ...filters, q: searchDraft }}
        onChange={(patch) => applyFilters(patch)}
        onClear={clearFilters}
        creators={creators}
        view={view}
        onViewChange={setView}
        searchInputRef={searchInputRef}
        shown={filtered.length}
        total={allRows.length}
      />

      <WarehouseGroupsBulkBar
        count={selectedRows.length}
        canWrite={canWrite}
        canDelete={canDeleteGroups}
        busy={busy}
        onActivate={() => void setActive(selectedRows, true)}
        onDeactivate={() => void setActive(selectedRows, false)}
        onDelete={() => {
          setDeleteError(null)
          setDeleting(selectedRows)
        }}
        onClear={() => setSelectedIds(new Set())}
      />

      {view === 'list' ? (
        <>
          <WarehouseGroupsTable
            rows={paged.pageRows}
            loading={loading}
            error={groupsQuery.error}
            onRetry={reload}
            empty={empty}
            selected={selectedIds}
            onToggle={toggleRow}
            onToggleAll={toggleAllOnPage}
            onOpen={openRow}
            onShowWarehouses={setInspecting}
            actionsFor={actionsFor}
            sort={filters.sort}
            onSortChange={(sort) => applyFilters({ sort })}
            searchInputRef={searchInputRef}
            offset={(paged.page - 1) * (pageSize === 'all' ? 0 : Number(pageSize))}
          />
          {filtered.length > 0 ? (
            <TablePagination
              page={paged.page}
              pageSize={pageSize}
              total={paged.total}
              totalPages={paged.totalPages}
              from={paged.from}
              to={paged.to}
              numbered
              allowAll
              onPageChange={(p) => writeParams({ page: p > 1 ? p : null }, false)}
              onPageSizeChange={(size) => writeParams({ limit: size === 25 ? null : String(size) })}
            />
          ) : null}
        </>
      ) : view === 'tree' ? (
        <WarehouseGroupsTree
          rows={filtered}
          warehouses={warehouses}
          loading={loading}
          empty={empty}
          onOpen={openRow}
          actionsFor={actionsFor}
          totalLabel={`All warehouse groups (${filtered.length})`}
        />
      ) : (
        <>
          <WarehouseGroupsCards
            rows={paged.pageRows}
            loading={loading}
            empty={empty}
            selected={selectedIds}
            onToggle={toggleRow}
            onOpen={openRow}
            onShowWarehouses={setInspecting}
            actionsFor={actionsFor}
            canWrite={canWrite}
            canReadWarehouses={canReadWarehouses}
          />
          {filtered.length > 0 ? (
            <TablePagination
              page={paged.page}
              pageSize={pageSize}
              total={paged.total}
              totalPages={paged.totalPages}
              from={paged.from}
              to={paged.to}
              allowAll
              onPageChange={(p) => writeParams({ page: p > 1 ? p : null }, false)}
              onPageSizeChange={(size) => writeParams({ limit: size === 25 ? null : String(size) })}
            />
          ) : null}
        </>
      )}

      <Card padding="sm" className="flex flex-wrap items-center gap-2 text-xs text-gray-500 print:hidden">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-600" aria-hidden>
          💡
        </span>
        <strong className="text-amber-700">Pro tip</strong>
        <p className="m-0 min-w-0 flex-1 leading-relaxed">
          Group warehouses the way you report on them — by region, business unit or warehouse type — and every
          stock report, access rule and reconciliation inherits that structure for free.
        </p>
        <Link to="/masters" className="shrink-0 font-semibold text-primary no-underline hover:underline">
          Masters overview
        </Link>
      </Card>
    </div>
  )

  return (
    <PageShell fullBleed>
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Masters', to: '/masters' }, { label: 'Warehouse groups' }]}
        icon={Network}
        title="Warehouse groups"
        description="Organise your warehouses into logical groups for better control, reporting and access management."
        meta={
          groupsQuery.data ? (
            <span className="text-[11px] text-gray-500">
              {rangeLabel(paged.from, paged.to, filtered.length)}
              {filtered.length !== allRows.length ? ` · ${allRows.length} on record` : ''}
            </span>
          ) : undefined
        }
        escBack={false}
        actions={
          <>
            <MenuButton
              label="More actions"
              actions={overflowActions}
              icon={MoreHorizontal}
              variant="secondary"
              size="md"
            />
            <Button
              variant="secondary"
              size="md"
              icon={Upload}
              disabled
              title="Warehouse groups have no import endpoint yet — create them here, or through the API."
            >
              Import
            </Button>
            <ListSheetActions<WarehouseGroup>
              columns={EXPORT_COLUMNS}
              rows={exportRows}
              fetchAll={fetchAllForExport}
              filenameBase="warehouse-groups"
              title="Warehouse groups"
              description="Warehouse groups in the selected company"
              metaLines={exportMeta}
              onRefresh={reload}
              refreshing={groupsQuery.loading}
              disabled={exportRows.length === 0}
              searchInputRef={searchInputRef}
            />
            {canWrite ? (
              <Button variant="primary" size="md" icon={Plus} onClick={openCreate}>
                New warehouse group
              </Button>
            ) : null}
          </>
        }
      />

      <WarehouseGroupsStats
        stats={stats}
        loading={loading}
        warehousesRoute={WAREHOUSES_ROUTE}
        canReadWarehouses={canReadWarehouses}
      />

      {groupsQuery.data?.truncated ? (
        <Notice kind="warning" title={`Showing the first ${MAX_ROWS.toLocaleString()} groups.`}>
          This company has more warehouse groups than this screen loads at once, so every figure above counts the
          first {MAX_ROWS.toLocaleString()}. Narrow the search to work with the rest.
        </Notice>
      ) : null}

      {groupsQuery.error && allRows.length > 0 ? (
        <Notice kind="error" actions={<Button variant="secondary" size="sm" onClick={reload}>Retry</Button>}>
          Couldn&apos;t refresh warehouse groups. {groupsQuery.error.message}
        </Notice>
      ) : null}

      <div
        className={cx(
          'grid items-start gap-3',
          panelOpen ? 'grid-cols-1 wide:grid-cols-[minmax(0,1fr)_20rem]' : 'grid-cols-1',
        )}
      >
        {mainColumn}

        {panelOpen ? (
          <aside className="min-w-0" aria-label="Warehouse group insights">
            <div className="mb-2 flex justify-end print:hidden">
              <Button variant="ghost" size="xs" icon={PanelRightClose} onClick={togglePanel}>
                Hide panel
              </Button>
            </div>
            <WarehouseGroupsSidePanel
              rows={allRows}
              warehouses={warehouses}
              stats={stats}
              insights={insightList}
              loading={loading}
              onOpen={openRow}
              onApplyFilters={applyFilters}
              onViewAll={() => setView('tree')}
              warehousesRoute={WAREHOUSES_ROUTE}
              canReadWarehouses={canReadWarehouses}
            />
          </aside>
        ) : (
          <div className="hidden justify-end wide:flex print:hidden">
            <Button variant="ghost" size="xs" icon={PanelRightOpen} onClick={togglePanel}>
              Show panel
            </Button>
          </div>
        )}
      </div>

      <WarehouseGroupFormDrawer
        open={form !== null}
        mode={form?.mode ?? 'create'}
        row={form?.row ?? null}
        allRows={allRows}
        saving={saving}
        serverError={saveError}
        onClose={() => {
          if (!saving) {
            setForm(null)
            setSaveError(null)
          }
        }}
        onSubmit={submitForm}
      />

      <WarehouseGroupDeleteDialog
        open={deleting !== null}
        rows={deleting ?? []}
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => !deleteBusy && setDeleting(null)}
        onConfirm={confirmDelete}
      />

      <Drawer
        open={inspecting !== null}
        onClose={() => setInspecting(null)}
        title={inspecting ? `Warehouses in ${inspecting.grp_name}` : 'Warehouses'}
        description={
          inspecting
            ? `${inspectedWarehouses.length} of ${stats.warehousesTotal ?? inspectedWarehouses.length} warehouses in this company`
            : undefined
        }
        width="md"
        footer={
          <div className="flex items-center justify-between gap-2">
            <Link to={WAREHOUSES_ROUTE} className="text-xs font-semibold text-primary no-underline hover:underline">
              Open the warehouses master →
            </Link>
            <Button variant="secondary" size="md" onClick={() => setInspecting(null)}>
              Close
            </Button>
          </div>
        }
      >
        {inspectedWarehouses.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Boxes}
            title="No warehouses in this group"
            description="Open a warehouse and set its warehouse group to file it here."
          />
        ) : (
          <ul className="list-none space-y-1.5 p-0">
            {inspectedWarehouses.map((w) => (
              <li
                key={w.warehouse_id}
                className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-800">{w.warehouse_name}</span>
                  <span className="block text-[11px] text-gray-500">
                    {w.warehouse_code ? <span className="font-mono">{w.warehouse_code}</span> : null}
                    {w.warehouse_code ? ' · ' : ''}
                    {humanize(w.warehouse_type)}
                  </span>
                </span>
                {Number(w.is_default) === 1 ? <Badge tone="primary" size="xs">Default</Badge> : null}
                <ActiveBadge active={w.is_active} />
              </li>
            ))}
          </ul>
        )}
      </Drawer>
    </PageShell>
  )
}

export default WarehouseGroupsPage
