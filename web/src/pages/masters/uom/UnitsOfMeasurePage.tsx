import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  Plus,
  Ruler,
  Search,
  Sparkles,
  SquarePen,
  Trash2,
  Upload,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useAccess } from '../../../access/AccessContext'
import { useCompany } from '../../../company/CompanyContext'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ListSheetActions } from '../../../components/ListSheetActions'
import { SearchInput } from '../../../components/SearchInput'
import { Notice } from '../../../components/Notice'
import { useQuery } from '../../../hooks/useQuery'
import { useListParams } from '../../../hooks/useListParams'
import { P } from '../../../services/access'
import { errorMessage } from '../../../services/api'
import type { ListQuery } from '../../../services/api'
import { fetchAllRows } from '../../../services/listAll'
import { uomApi } from '../../../services/masters'
import type { Uom } from '../../../services/masters'
import { uomExtras } from '../../../services/uomApi'
import type { SuggestedUnit } from '../../../services/uomAiApi'
import type { ExportableColumn } from '../../../registers/registerCells'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { EmptyState } from '../../../ui/EmptyState'
import { MenuButton } from '../../../ui/MenuButton'
import { Select } from '../../../ui/Select'
import { Tooltip } from '../../../ui/Tooltip'
import { useToast } from '../../../ui/ToastContext'
import { BreadcrumbBar } from '../../../ui/shell/BreadcrumbBar'
import { FilterBar } from '../../../ui/shell/FilterBar'
import { PageHeader } from '../../../ui/shell/PageHeader'
import { PageShell } from '../../../ui/shell/PageShell'
import { SmartTable } from '../../../ui/shell/SmartTable'
import type { SmartColumn } from '../../../ui/shell/SmartTable'
import { ServerTablePagination } from '../../../ui/shell/TablePagination'
import { AIC, cx } from '../../../ui/cx'
import { formatDateTime, formatInt } from '../../../utils/format'
import { UomAssistantPanel } from './UomAssistantPanel'
import { UomImportDrawer } from './UomImportDrawer'
import { UomFormDrawer } from './UomFormDrawer'
import { UomStats } from './UomStats'
import { UomUsageDrawer } from './UomUsageDrawer'
import { unitIcon, unitType } from './uomPresentation'

/**
 * Masters → Units of measure.
 *
 * This master left the config-driven `MasterPage` because what it needs is no
 * longer a list of columns: a usage count with a drill-down, a GST-aware type
 * split, tabs that are really filters, selection with dependency-checked bulk
 * actions and a contextual panel are this screen's own, and pushing them into
 * the shared config would have landed half of them on nine other masters that
 * did not ask for them.
 *
 * Everything the old screen could do, it still does, through the same parts:
 * the same `uomApi` CRUD, the same `useListParams` URL state, the same
 * `ListSheetActions` (CSV, Excel, PDF, letterheaded print, Refresh, Ctrl+P,
 * Ctrl+R, `/`), the same permission keys and the same company scope.
 */

type Tab = 'all' | 'active' | 'inactive' | 'standard' | 'custom'

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All units' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'standard', label: 'Standard' },
  { key: 'custom', label: 'Custom' },
]

/** A tab is a saved pair of filters, so the URL keeps holding the real ones. */
const TAB_FILTERS: Record<Tab, { status: string; type: string }> = {
  all: { status: '', type: '' },
  active: { status: 'active', type: '' },
  inactive: { status: 'inactive', type: '' },
  standard: { status: '', type: 'standard' },
  custom: { status: '', type: 'custom' },
}

/**
 * The caret half of the "New unit" split button.
 *
 * MenuButton puts `className` on its own trigger, so these land on the button
 * itself. Only the radius is overridden: Tailwind emits `px-1.5` BEFORE
 * `px-3.5`, so narrowing the caret from here would quietly do nothing, and a
 * class that looks like it works is worse than one that is not written.
 */
const SPLIT_CARET_CLASS = 'rounded-l-none border-l border-white/30'

const PANEL_HIDDEN_KEY = 'inventory.uom.assistant.hidden'

function readHidden(): boolean {
  try {
    return window.sessionStorage.getItem(PANEL_HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

function writeHidden(hidden: boolean): void {
  try {
    window.sessionStorage.setItem(PANEL_HIDDEN_KEY, hidden ? '1' : '0')
  } catch {
    // Blocked storage: the panel simply reappears next visit.
  }
}

export function UnitsOfMeasurePage() {
  const { scope } = useCompany()
  const { can, loading: accessLoading } = useAccess()
  const toast = useToast()

  const canRead = can(P.masters('uom', 'read'))
  const canWrite = can(P.masters('uom', 'write'))
  const canDelete = can(P.masters('uom', 'delete'))
  const canReadItems = can(P.masters('items', 'read'))

  const list = useListParams({ sort: 'unit_name', filterKeys: ['status', 'type', 'used'] })
  const searchRef = useRef<HTMLInputElement>(null)

  // ---- data ---------------------------------------------------------------
  const listQuery = useMemo<ListQuery>(() => ({ ...list.query, ...list.state.filters }), [list.query, list.state.filters])

  const query = useQuery(
    (signal) => uomApi.list(listQuery, signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id, listQuery],
    { enabled: Boolean(scope) && canRead, resetKey: scope?.cmp_id ?? null },
  )
  const rows = useMemo(() => query.data?.data ?? [], [query.data])

  /*
   * The figures above the list are counted by the API over the whole master,
   * NOT summed from the page below. They deliberately do not follow the filters
   * — "Total units" has to mean the same thing on every tab, or the tab counts
   * beside it become circular.
   */
  const summaryQuery = useQuery(
    (signal) => uomExtras.summary(signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    { enabled: Boolean(scope) && canRead, resetKey: scope?.cmp_id ?? null },
  )
  const summary = summaryQuery.data

  // The GST catalogue is only needed by the form, so it is not fetched until a
  // form has been opened at least once.
  const [uqcWanted, setUqcWanted] = useState(false)
  const uqcQuery = useQuery((signal) => uomExtras.uqcCodes(signal), [uqcWanted], { enabled: uqcWanted })
  const uqcOptions = useMemo(() => uqcQuery.data ?? [], [uqcQuery.data])

  // ---- tabs ---------------------------------------------------------------
  const tab: Tab = useMemo(() => {
    const { status, type } = list.state.filters
    if (type === 'standard') return 'standard'
    if (type === 'custom') return 'custom'
    if (status === 'active') return 'active'
    if (status === 'inactive') return 'inactive'
    return 'all'
  }, [list.state.filters])

  const tabCount = (key: Tab): number | null => {
    if (!summary) return null
    switch (key) {
      case 'all':
        return summary.total
      case 'active':
        return summary.active
      case 'inactive':
        return summary.inactive
      case 'standard':
        return summary.standard
      case 'custom':
        return summary.custom
    }
  }

  // ---- selection ----------------------------------------------------------
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  // A selection that survived a filter change would act on rows nobody can see.
  useEffect(() => {
    setSelected(new Set())
  }, [listQuery])

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.unit_id)), [rows, selected])
  const allVisibleSelected = rows.length > 0 && rows.every((r) => selected.has(r.unit_id))

  const toggleRow = (id: number) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleAllVisible = () =>
    setSelected((s) => {
      const next = new Set(s)
      if (allVisibleSelected) for (const r of rows) next.delete(r.unit_id)
      else for (const r of rows) next.add(r.unit_id)
      return next
    })

  // ---- drawers ------------------------------------------------------------
  const [editing, setEditing] = useState<{ mode: 'create' | 'edit'; row: Uom | null } | null>(null)
  const [usageOf, setUsageOf] = useState<Uom | null>(null)
  const [importing, setImporting] = useState(false)

  const openImport = useCallback(() => {
    if (!canWrite) return
    // The form's GST catalogue doubles as the import's code whitelist, so a
    // sheet is checked against the same list the picker offers.
    setUqcWanted(true)
    setImporting(true)
  }, [canWrite])

  const openCreate = useCallback(
    (prefill?: SuggestedUnit) => {
      if (!canWrite) return
      setUqcWanted(true)
      setEditing({
        mode: 'create',
        row: prefill
          ? ({
              unit_id: 0,
              unit_name: prefill.name,
              unit_symbol: prefill.symbol,
              print_name: prefill.name,
              uqc_gst: prefill.uqc,
              decimal_places: 4,
              is_active: 1,
            } as Uom)
          : null,
      })
    },
    [canWrite],
  )

  const openEdit = useCallback((row: Uom, patch?: { uqc_gst?: string }) => {
    setUqcWanted(true)
    setEditing({ mode: 'edit', row: patch ? { ...row, ...patch } : row })
  }, [])

  const afterSave = (saved: Uom, opts: { again: boolean }) => {
    toast.success(editing?.mode === 'create' ? `${saved.unit_name} created` : `${saved.unit_name} saved`)
    if (!opts.again) setEditing(null)
    query.reload()
    summaryQuery.reload()
  }

  // ---- delete -------------------------------------------------------------
  const [deleting, setDeleting] = useState<Uom | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deletingUsage = deleting?.usage_count ?? 0

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await uomApi.remove(deleting.unit_id)
      toast.success(`${deleting.unit_name} deleted`)
      setDeleting(null)
      query.reload()
      summaryQuery.reload()
    } catch (err) {
      setDeleteError(errorMessage(err))
    } finally {
      setDeleteBusy(false)
    }
  }

  // ---- bulk ---------------------------------------------------------------
  const [bulkBusy, setBulkBusy] = useState(false)

  const bulkSetActive = async (active: boolean) => {
    if (bulkBusy || selectedRows.length === 0) return
    setBulkBusy(true)
    let done = 0
    let failed = 0
    for (const row of selectedRows) {
      try {
        await uomApi.update(row.unit_id, { is_active: active ? 1 : 0 })
        done += 1
      } catch {
        failed += 1
      }
    }
    setBulkBusy(false)
    setSelected(new Set())
    query.reload()
    summaryQuery.reload()
    if (failed === 0) toast.success(`${done} ${done === 1 ? 'unit' : 'units'} ${active ? 'activated' : 'deactivated'}`)
    else toast.error(`${done} updated, ${failed} could not be changed`)
  }

  /*
   * Bulk delete refuses the used ones before it starts.
   *
   * The API would refuse them one at a time anyway, but a run that deletes four
   * and then reports three failures leaves the reader working out which four
   * went. The set is split first, the safe ones are deleted, and the rest are
   * named.
   */
  const [bulkDelete, setBulkDelete] = useState(false)
  const deletableSelection = useMemo(() => selectedRows.filter((r) => (r.usage_count ?? 0) === 0), [selectedRows])
  const blockedSelection = useMemo(() => selectedRows.filter((r) => (r.usage_count ?? 0) > 0), [selectedRows])

  const runBulkDelete = async () => {
    setBulkBusy(true)
    let done = 0
    let failed = 0
    for (const row of deletableSelection) {
      try {
        await uomApi.remove(row.unit_id)
        done += 1
      } catch {
        failed += 1
      }
    }
    setBulkBusy(false)
    setBulkDelete(false)
    setSelected(new Set())
    query.reload()
    summaryQuery.reload()
    if (failed === 0) toast.success(`${done} ${done === 1 ? 'unit' : 'units'} deleted`)
    else toast.error(`${done} deleted, ${failed} refused by the server`)
  }

  // ---- assistant ----------------------------------------------------------
  const [panelHidden, setPanelHidden] = useState(readHidden)
  const hidePanel = () => {
    setPanelHidden(true)
    writeHidden(true)
  }
  const showPanel = () => {
    setPanelHidden(false)
    writeHidden(false)
  }

  const loadAllUnits = useCallback(
    async () => (await fetchAllRows<Uom>((page, limit) => uomApi.list({ page, limit }))).rows,
    [],
  )

  // ---- export -------------------------------------------------------------
  const exportColumns = useMemo<ExportableColumn<Uom>[]>(
    () => [
      { key: 'unit_name', header: 'Unit', csvHeader: 'Unit', format: 'text' },
      { key: 'unit_symbol', header: 'Symbol', csvHeader: 'Symbol', format: 'text' },
      { key: 'print_name', header: 'Print name', csvHeader: 'Print name', format: 'text' },
      { key: 'uqc_gst', header: 'GST UQC', csvHeader: 'GST UQC', format: 'text' },
      { key: 'decimal_places', header: 'Decimals', csvHeader: 'Decimals', align: 'right', format: 'int' },
      { key: 'uom_type', header: 'Type', csvHeader: 'Type', format: 'text', csv: (r) => (unitType(r) === 'standard' ? 'Standard' : 'Custom') },
      { key: 'usage_count', header: 'Used in', csvHeader: 'Used in items', align: 'right', format: 'int', csv: (r) => r.usage_count ?? 0 },
      { key: 'is_active', header: 'Status', csvHeader: 'Status', format: 'text', csv: (r) => (Number(r.is_active) === 1 ? 'Active' : 'Inactive') },
      { key: 'updated_at', header: 'Updated', csvHeader: 'Updated', format: 'datetime' },
    ],
    [],
  )

  const exportMeta = useMemo(() => {
    const lines: string[] = []
    if (list.state.q) lines.push(`Search: ${list.state.q}`)
    const { status, type, used } = list.state.filters
    if (status) lines.push(`Status: ${status === 'active' ? 'Active only' : 'Inactive only'}`)
    if (type) lines.push(`Type: ${type === 'standard' ? 'Standard (mapped to a GST UQC)' : 'Custom (no GST UQC)'}`)
    if (used) lines.push(`Usage: ${used === 'used' ? 'Used by items' : 'Not used by any item'}`)
    return lines
  }, [list.state.q, list.state.filters])

  const fetchAll = useCallback(
    () => fetchAllRows<Uom>((page, limit) => uomApi.list({ ...listQuery, page, limit })),
    [listQuery],
  )

  // ---- columns ------------------------------------------------------------
  const columns = useMemo<SmartColumn<Uom>[]>(() => {
    const cols: SmartColumn<Uom>[] = []

    if (canWrite || canDelete) {
      cols.push({
        key: 'select',
        width: 36,
        header: (
          <>
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleAllVisible}
              disabled={rows.length === 0}
              aria-label={allVisibleSelected ? 'Clear selection' : 'Select every unit on this page'}
              className="h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))]"
            />
            <span className="sr-only">Select</span>
          </>
        ),
        render: (row) => (
          <input
            type="checkbox"
            checked={selected.has(row.unit_id)}
            onChange={() => toggleRow(row.unit_id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${row.unit_name}`}
            className="h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))]"
          />
        ),
      })
    }

    cols.push(
      {
        key: 'unit_name',
        header: 'Unit',
        sortKey: 'unit_name',
        minWidth: 170,
        render: (row) => {
          const Icon = unitIcon(row)
          return (
            <span className="flex items-center gap-2.5">
              <span
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary-light/60 text-primary"
                aria-hidden
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <strong className="truncate font-semibold text-gray-900">{row.unit_name}</strong>
            </span>
          )
        },
      },
      { key: 'unit_symbol', header: 'Symbol', sortKey: 'unit_symbol', cellClassName: 'font-medium text-gray-800' },
      { key: 'print_name', header: 'Print name', sortKey: 'print_name' },
      {
        key: 'uqc_gst',
        header: 'GST UQC',
        sortKey: 'uqc_gst',
        render: (row) =>
          row.uqc_gst ? (
            <span className="font-mono text-xs tracking-wide text-gray-700">{row.uqc_gst}</span>
          ) : (
            <span className="text-gray-300">—</span>
          ),
      },
      { key: 'decimal_places', header: 'Decimals', align: 'right', sortKey: 'decimal_places' },
      {
        key: 'uom_type',
        header: 'Type',
        render: (row) =>
          unitType(row) === 'standard' ? (
            <Badge tone="info" size="xs">
              Standard
            </Badge>
          ) : (
            <Badge tone="neutral" size="xs">
              Custom
            </Badge>
          ),
      },
      {
        key: 'usage_count',
        header: 'Used in',
        align: 'right',
        sortKey: 'usage_count',
        render: (row) => {
          const count = row.usage_count ?? 0
          const label = `${formatInt(count)} ${count === 1 ? 'item' : 'items'}`
          if (count === 0) return <span className="text-gray-400">{label}</span>
          if (!canReadItems) return <span className="font-semibold text-gray-700">{label}</span>
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setUsageOf(row)
              }}
              className="rounded font-semibold text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label={`Show the ${label} using ${row.unit_name}`}
            >
              {label}
            </button>
          )
        },
      },
      {
        key: 'is_active',
        header: 'Status',
        sortKey: 'is_active',
        render: (row) =>
          Number(row.is_active) === 1 ? (
            <Badge tone="success" size="xs" dot>
              Active
            </Badge>
          ) : (
            <Badge tone="neutral" size="xs" dot>
              Inactive
            </Badge>
          ),
      },
      {
        key: 'updated_at',
        header: 'Updated',
        sortKey: 'updated_at',
        render: (row) => <span className="whitespace-nowrap text-gray-500">{formatDateTime(row.updated_at)}</span>,
      },
      {
        key: 'actions',
        header: <span className="sr-only">Actions</span>,
        align: 'right',
        width: 90,
        render: (row) => (
          <span className="inline-flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
            <Button
              size="xs"
              variant="ghost"
              icon={SquarePen}
              onClick={() => openEdit(row)}
              aria-label={`${canWrite ? 'Edit' : 'View'} ${row.unit_name}`}
            />
            <MenuButton
              label={`More actions for ${row.unit_name}`}
              size="xs"
              actions={[
                ...(canReadItems && (row.usage_count ?? 0) > 0
                  ? [{ key: 'usage', label: 'View usage', onSelect: () => setUsageOf(row) }]
                  : []),
                ...(canWrite
                  ? [
                      {
                        key: 'duplicate',
                        label: 'Duplicate',
                        onSelect: () =>
                          openCreate({
                            name: `${row.unit_name} copy`,
                            symbol: '',
                            uqc: row.uqc_gst ?? '',
                            reason: '',
                          }),
                      },
                      {
                        key: 'toggle',
                        label: Number(row.is_active) === 1 ? 'Deactivate' : 'Activate',
                        onSelect: async () => {
                          try {
                            await uomApi.update(row.unit_id, { is_active: Number(row.is_active) === 1 ? 0 : 1 })
                            toast.success(`${row.unit_name} ${Number(row.is_active) === 1 ? 'deactivated' : 'activated'}`)
                            query.reload()
                            summaryQuery.reload()
                          } catch (err) {
                            toast.error(errorMessage(err))
                          }
                        },
                      },
                    ]
                  : []),
                ...(canDelete
                  ? [
                      {
                        key: 'delete',
                        label: 'Delete',
                        icon: Trash2,
                        danger: true,
                        separated: true,
                        onSelect: () => {
                          setDeleteError(null)
                          setDeleting(row)
                        },
                      },
                    ]
                  : []),
              ]}
            />
          </span>
        ),
      },
    )
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers are stable enough for a column list
  }, [canWrite, canDelete, canReadItems, rows, selected, allVisibleSelected, openEdit, openCreate, toast])

  // ---- gates --------------------------------------------------------------
  if (!accessLoading && !canRead) {
    return (
      <PageShell>
        <PageHeader title="Units of measure" icon={Ruler} />
        <Notice kind="warning">You do not have permission to view units of measure in this company.</Notice>
      </PageShell>
    )
  }

  const hasFilters = Boolean(list.state.q) || Object.keys(list.state.filters).length > 0
  const totalUnits = summary?.total ?? null
  const isEmptyMaster = !query.loading && rows.length === 0 && !hasFilters && (totalUnits === 0 || totalUnits === null)

  const listBody: ReactNode = isEmptyMaster ? (
    <EmptyState
      icon={Ruler}
      title="Create your first unit of measure"
      description="Units of measure let Inventory track quantities consistently across items, documents and stock movements — and map them to the codes GST returns expect."
      action={
        canWrite ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button icon={Plus} onClick={() => openCreate()}>
              New unit
            </Button>
            <Button variant="secondary" icon={Upload} onClick={openImport}>
              Import units
            </Button>
          </div>
        ) : null
      }
    />
  ) : (
    <>
      <SmartTable<Uom>
        columns={columns}
        rows={rows}
        rowKey="unit_id"
        loading={query.loading}
        error={
          query.error
            ? {
                title: 'We couldn’t load units of measure.',
                description: query.error.message,
                onRetry: query.reload,
              }
            : null
        }
        onRowActivate={(row) => openEdit(row)}
        activateOnSingleClick
        searchInputRef={searchRef}
        keyboardResetKey={`${list.state.q}:${list.state.sort}:${list.state.order}:${list.state.page}`}
        sort={{ key: list.state.sort, order: list.state.order }}
        onSort={list.toggleSort}
        minWidth={1020}
        caption="Units of measure"
        className="hidden md:block"
        empty={
          <EmptyState
            icon={Search}
            size="sm"
            title={list.state.q ? `No units match “${list.state.q}”.` : 'No units match these filters.'}
            description="Clear the filters to see every unit, or create the one you were looking for."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" variant="secondary" onClick={list.reset}>
                  Clear filters
                </Button>
                {canWrite && list.state.q ? (
                  <Button size="sm" icon={Plus} onClick={() => openCreate({ name: list.state.q, symbol: '', uqc: '', reason: '' })}>
                    Create “{list.state.q}”
                  </Button>
                ) : null}
              </div>
            }
          />
        }
      />

      {/* Below md the table becomes cards: eleven columns squeezed into a phone
          is a table nobody can read, and horizontal scrolling hides the status
          and the actions, which are what a phone visit is usually for. */}
      <ul className="grid gap-2 md:hidden" aria-label="Units of measure">
        {rows.map((row) => {
          const Icon = unitIcon(row)
          const count = row.usage_count ?? 0
          return (
            <li key={row.unit_id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary-light/60 text-primary"
                    aria-hidden
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <strong className="block truncate text-sm font-semibold text-gray-900">{row.unit_name}</strong>
                    <span className="block truncate text-xs text-gray-500">{row.unit_symbol ?? '—'}</span>
                  </div>
                </div>
                <Badge tone={Number(row.is_active) === 1 ? 'success' : 'neutral'} size="xs" dot>
                  {Number(row.is_active) === 1 ? 'Active' : 'Inactive'}
                </Badge>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-gray-50 px-2.5 py-1.5">
                  <dt className="text-[10px] uppercase tracking-wide text-gray-400">GST UQC</dt>
                  <dd className="mt-0.5 font-mono text-xs text-gray-800">{row.uqc_gst ?? '—'}</dd>
                </div>
                <div className="rounded-lg bg-gray-50 px-2.5 py-1.5">
                  <dt className="text-[10px] uppercase tracking-wide text-gray-400">Used in</dt>
                  <dd className="mt-0.5 text-xs text-gray-800">
                    {count > 0 && canReadItems ? (
                      <button
                        type="button"
                        onClick={() => setUsageOf(row)}
                        className="font-semibold text-primary underline-offset-2 hover:underline"
                      >
                        {formatInt(count)} {count === 1 ? 'item' : 'items'}
                      </button>
                    ) : (
                      `${formatInt(count)} ${count === 1 ? 'item' : 'items'}`
                    )}
                  </dd>
                </div>
              </dl>

              <details className="mt-2 group">
                <summary className="cursor-pointer list-none text-[11px] font-medium text-gray-500 transition-colors hover:text-primary">
                  <span className="inline-flex items-center gap-1">
                    More details
                    <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" aria-hidden />
                  </span>
                </summary>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                  <div>
                    <dt className="text-gray-400">Print name</dt>
                    <dd className="text-gray-700">{row.print_name ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">Decimals</dt>
                    <dd className="tabular-nums text-gray-700">{row.decimal_places}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">Type</dt>
                    <dd className="text-gray-700">{unitType(row) === 'standard' ? 'Standard' : 'Custom'}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">Updated</dt>
                    <dd className="text-gray-700">{formatDateTime(row.updated_at)}</dd>
                  </div>
                </dl>
              </details>

              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="secondary" block icon={SquarePen} onClick={() => openEdit(row)}>
                  {canWrite ? 'Edit' : 'View'}
                </Button>
                <MenuButton
                  label={`More actions for ${row.unit_name}`}
                  size="sm"
                  variant="secondary"
                  actions={[
                    ...(canReadItems && count > 0 ? [{ key: 'usage', label: 'View usage', onSelect: () => setUsageOf(row) }] : []),
                    ...(canDelete
                      ? [
                          {
                            key: 'delete',
                            label: 'Delete',
                            icon: Trash2,
                            danger: true,
                            onSelect: () => {
                              setDeleteError(null)
                              setDeleting(row)
                            },
                          },
                        ]
                      : []),
                  ]}
                >
                  More
                </MenuButton>
              </div>
            </li>
          )
        })}
      </ul>

      <ServerTablePagination
        meta={query.data?.meta ?? null}
        limit={list.state.limit}
        onPage={list.setPage}
        onLimit={list.setLimit}
        numbered
      />
    </>
  )

  return (
    <PageShell fullBleed>
      <BreadcrumbBar items={[{ label: 'Masters', to: '/masters' }, { label: 'Units of measure' }]} />

      <PageHeader
        title="Units of measure"
        icon={Ruler}
        description="Define and manage units of measure used for items across your business"
        actions={
          <>
            <ListSheetActions<Uom>
              columns={exportColumns}
              rows={rows}
              fetchAll={fetchAll}
              filenameBase="units-of-measure"
              title="Units of measure"
              metaLines={exportMeta}
              onRefresh={() => {
                query.reload()
                summaryQuery.reload()
              }}
              refreshing={query.loading}
              disabled={!query.data || query.data.meta.total === 0}
              searchInputRef={searchRef}
              onNew={canWrite ? () => openCreate() : undefined}
            />
            {canWrite ? (
              <Button variant="secondary" icon={Upload} onClick={openImport}>
                Import
              </Button>
            ) : null}
            {panelHidden ? (
              <Button variant="secondary" icon={Sparkles} onClick={showPanel}>
                <span className="hidden sm:inline">Aicountly AI</span>
              </Button>
            ) : null}
            {canWrite ? (
              <span className="inline-flex">
                <Button icon={Plus} onClick={() => openCreate()} kbd="Ctrl+N" className="rounded-r-none">
                  New unit
                </Button>
                <MenuButton
                  label="More ways to add a unit"
                  variant="primary"
                  size="sm"
                  icon={ChevronDown}
                  className={SPLIT_CARET_CLASS}
                  actions={[
                    { key: 'manual', label: 'Create manually', onSelect: () => openCreate() },
                    {
                      key: 'uqc',
                      label: 'Create from a GST UQC',
                      onSelect: () => {
                        setUqcWanted(true)
                        openCreate()
                      },
                    },
                    { key: 'import', label: 'Import from a spreadsheet', icon: Upload, onSelect: openImport },
                  ]}
                />
              </span>
            ) : null}
          </>
        }
      />

      <UomStats summary={summary} loading={summaryQuery.loading} />

      <div className={cx(AIC, 'grid items-start gap-4 wide:grid-cols-[minmax(0,1fr)_288px]')}>
        <div className="min-w-0 space-y-3">
          <nav
            className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto border-b border-gray-200 px-1 print:hidden"
            aria-label="Filter units"
          >
            {TABS.map(({ key, label }) => {
              const count = tabCount(key)
              const isActive = tab === key
              return (
                <button
                  key={key}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => list.setFilters(TAB_FILTERS[key])}
                  className={cx(
                    '-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2 text-[13px] font-medium transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    isActive
                      ? 'border-primary text-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-900',
                  )}
                >
                  {label}
                  {count !== null ? (
                    <span className={cx('tabular-nums', isActive ? 'text-primary/70' : 'text-gray-400')}>({formatInt(count)})</span>
                  ) : null}
                </button>
              )
            })}
          </nav>

          <FilterBar
            actions={
              <>
                {selectedRows.length > 0 ? (
                  <MenuButton
                    label="Bulk actions"
                    variant="outline"
                    size="sm"
                    icon={ChevronDown}
                    actions={[
                      ...(canWrite
                        ? [
                            { key: 'activate', label: `Activate ${selectedRows.length}`, onSelect: () => void bulkSetActive(true), disabled: bulkBusy },
                            { key: 'deactivate', label: `Deactivate ${selectedRows.length}`, onSelect: () => void bulkSetActive(false), disabled: bulkBusy },
                          ]
                        : []),
                      ...(canDelete
                        ? [
                            {
                              key: 'delete',
                              label: `Delete ${selectedRows.length}`,
                              icon: Trash2,
                              danger: true,
                              separated: true,
                              disabled: bulkBusy,
                              onSelect: () => setBulkDelete(true),
                            },
                          ]
                        : []),
                    ]}
                  >
                    {selectedRows.length} selected
                  </MenuButton>
                ) : null}
              </>
            }
          >
            {/* SearchInput, not the bare SearchBox: it holds the keystrokes
                and reports after a pause, which is what keeps one request per
                search instead of one per letter. */}
            <SearchInput
              ref={searchRef}
              value={list.state.q}
              onChange={list.setQ}
              placeholder="Search by name, symbol or print name…"
              className="min-w-[min(18rem,100%)] flex-1"
              aria-label="Search units of measure"
            />
            <Select
              value={list.state.filters.status ?? ''}
              onChange={(e) => list.setFilter('status', e.target.value)}
              aria-label="Filter by status"
            >
              <option value="">Active and inactive</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
            <Tooltip label="Standard units carry a GST unit quantity code and can be reported as they are. Custom units have none yet.">
              <Select
                value={list.state.filters.type ?? ''}
                onChange={(e) => list.setFilter('type', e.target.value)}
                aria-label="Filter by type"
              >
                <option value="">All types</option>
                <option value="standard">Standard</option>
                <option value="custom">Custom</option>
              </Select>
            </Tooltip>
            <Select
              value={list.state.filters.used ?? ''}
              onChange={(e) => list.setFilter('used', e.target.value)}
              aria-label="Filter by usage"
            >
              <option value="">Used and unused</option>
              <option value="used">Used by items</option>
              <option value="unused">Not used</option>
            </Select>
            {hasFilters ? (
              <Button variant="ghost" size="sm" onClick={list.reset}>
                Clear
              </Button>
            ) : null}
          </FilterBar>

          {listBody}
        </div>

        {!panelHidden ? (
          <UomAssistantPanel
            className="hidden wide:flex wide:sticky wide:top-4"
            rows={rows}
            loadAllUnits={loadAllUnits}
            canWrite={canWrite}
            onPrefillCreate={(draft) => openCreate(draft)}
            onEdit={openEdit}
            onShowUnused={() => list.setFilters({ used: 'unused', status: '', type: '' })}
            onDismiss={hidePanel}
          />
        ) : null}
      </div>

      <UomFormDrawer
        open={editing !== null}
        mode={editing?.mode ?? 'create'}
        row={editing?.row ?? null}
        visibleRows={rows}
        uqcOptions={uqcOptions}
        uqcUnavailable={Boolean(uqcQuery.error) || (uqcWanted && !uqcQuery.loading && uqcOptions.length === 0)}
        canWrite={canWrite}
        onClose={() => setEditing(null)}
        onSaved={afterSave}
      />

      <UomUsageDrawer unit={usageOf} onClose={() => setUsageOf(null)} />

      <UomImportDrawer
        open={importing}
        onClose={() => setImporting(false)}
        loadExisting={loadAllUnits}
        knownUqcCodes={uqcOptions.map((o) => o.code)}
        onImported={() => {
          query.reload()
          summaryQuery.reload()
        }}
      />

      <ConfirmDialog
        open={deleting !== null && deletingUsage === 0}
        title={`Delete “${deleting?.unit_name ?? ''}”?`}
        message={
          <>
            <p className="m-0">
              <strong>{deleting?.unit_name}</strong> will be removed from every list and dropdown.
            </p>
            <p className="m-0 text-xs text-gray-500">
              Nothing uses it, so no item or document changes. This cannot be undone from here.
            </p>
          </>
        }
        confirmLabel="Delete unit"
        danger
        busy={deleteBusy}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => !deleteBusy && setDeleting(null)}
      />

      {/* A used unit is not offered a delete it cannot have. The dialog says
          what is in the way and opens the list of it, rather than letting the
          click through to a 409 the reader has to interpret. */}
      <ConfirmDialog
        open={deleting !== null && deletingUsage > 0}
        title={`“${deleting?.unit_name ?? ''}” is in use`}
        message={
          <>
            <p className="m-0">
              This unit is currently used by <strong>{formatInt(deletingUsage)} {deletingUsage === 1 ? 'item' : 'items'}</strong> and cannot be
              deleted. Reassign those items to another unit first.
            </p>
            <p className="m-0 text-xs text-gray-500">
              Deactivating it instead keeps every existing record intact and stops it being offered on new ones.
            </p>
          </>
        }
        confirmLabel={canReadItems ? 'View affected items' : 'Close'}
        onConfirm={() => {
          const row = deleting
          setDeleting(null)
          if (canReadItems && row) setUsageOf(row)
        }}
        onCancel={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={bulkDelete}
        title={`Delete ${deletableSelection.length} of ${selectedRows.length} selected units?`}
        message={
          <>
            {deletableSelection.length > 0 ? (
              <p className="m-0">
                {formatInt(deletableSelection.length)} {deletableSelection.length === 1 ? 'unit is' : 'units are'} used by nothing and will be
                deleted.
              </p>
            ) : (
              <p className="m-0">None of the selected units can be deleted.</p>
            )}
            {blockedSelection.length > 0 ? (
              <p className="m-0 text-xs text-gray-500">
                {formatInt(blockedSelection.length)} will be kept because {blockedSelection.length === 1 ? 'it is' : 'they are'} used by items:{' '}
                {blockedSelection
                  .slice(0, 5)
                  .map((r) => r.unit_name)
                  .join(', ')}
                {blockedSelection.length > 5 ? ` and ${blockedSelection.length - 5} more` : ''}.
              </p>
            ) : null}
          </>
        }
        confirmLabel={deletableSelection.length > 0 ? `Delete ${deletableSelection.length}` : 'Close'}
        danger={deletableSelection.length > 0}
        busy={bulkBusy}
        onConfirm={() => (deletableSelection.length > 0 ? void runBulkDelete() : setBulkDelete(false))}
        onCancel={() => !bulkBusy && setBulkDelete(false)}
      />
    </PageShell>
  )
}

export default UnitsOfMeasurePage
