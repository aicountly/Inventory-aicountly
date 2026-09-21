import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Filter, Plus, Warehouse as WarehouseIcon, X } from 'lucide-react'
import { useAccess } from '../../../access/AccessContext'
import { useCompany } from '../../../company/CompanyContext'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ListSheetActions } from '../../../components/ListSheetActions'
import { Modal } from '../../../components/Modal'
import { Notice } from '../../../components/Notice'
import { Pagination } from '../../../components/Pagination'
import { useFormOptions, invalidateFormOptions } from '../../../hooks/useFormOptions'
import { useListParams } from '../../../hooks/useListParams'
import { usePageKeyboard } from '../../../keyboard/usePageKeyboard'
import { useKeyboardScope } from '../../../keyboard/useKeyboardScope'
import { MasterForm } from '../../../masters/MasterForm'
import { warehousesConfig } from '../../../masters/configs'
import { masterExportColumns } from '../../../masters/exportColumns'
import { P } from '../../../services/access'
import { errorMessage, isApiError } from '../../../services/api'
import { WAREHOUSE_TYPES, warehousesApi } from '../../../services/masters'
import type { Warehouse } from '../../../services/masters'
import { toWarehouseFacts } from '../../../services/warehouseIntelligence'
import type { ExportableColumn } from '../../../registers/registerCells'
import { Button, Card, EmptyState, ErrorState, MenuButton, SearchBox, Select } from '../../../ui'
import { BreadcrumbHeader } from '../../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../../ui/shell/PageShell'
import { PageTabBar } from '../../../ui/shell/PageTabBar'
import { useToast } from '../../../ui/ToastContext'
import { formatCompactMoney, formatInt, humanize } from '../../../utils/format'
import type { FormValues } from '../../../masters/types'
import { WarehouseAiAssistant, WarehouseAiCard } from './WarehouseAiAssistant'
import { WarehouseAnalytics } from './WarehouseAnalytics'
import { WarehouseKpis } from './WarehouseKpis'
import { WarehouseTable } from './WarehouseTable'
import { WarehouseByLocationView, WarehouseCapacityView, WarehouseMapView } from './WarehouseViews'
import { capacityOf, EMPTY_STOCK, utilisationOf } from './warehouseMetrics'
import { isWarehouseView, useWarehousesScreen } from './useWarehousesScreen'
import type { WarehouseView } from './useWarehousesScreen'

/**
 * Masters > Warehouses.
 *
 * Every other simple master renders through `MasterPage`, and this one did too
 * until the screen grew a KPI strip, four views of the same rows, a stock
 * column from a different endpoint and an analytics row. Rather than bend the
 * shared page into a shape eight other masters would have to carry, this screen
 * composes the same parts directly: `warehousesConfig` still declares the
 * fields, the columns, the payload mapping and the permission slug, and the
 * form, the modal, the confirmation, the exports, the pagination and the
 * keyboard map are the components every list in this app uses.
 *
 * What that buys: create, edit, delete, export, print, search, filter, sort and
 * paging behave exactly as they did, because they are the same code — and the
 * screen above them can say something.
 */

const BREADCRUMBS = [
  { label: 'Inventory', to: '/dashboard' },
  { label: 'Masters', to: '/masters' },
  { label: 'Warehouses' },
]

const VIEW_TABS: { value: WarehouseView; label: string }[] = [
  { value: 'all', label: 'All warehouses' },
  { value: 'location', label: 'By location' },
  { value: 'capacity', label: 'Capacity view' },
  { value: 'map', label: 'Map view' },
]

const FILTER_KEYS = ['status', 'warehouse_type', 'view'] as const

export function WarehousesPage() {
  const { companyName } = useCompany()
  const navigate = useNavigate()
  const { can, loading: accessLoading } = useAccess()
  const toast = useToast()

  const canRead = can(P.masters('warehouses', 'read'))
  const canWrite = can(P.masters('warehouses', 'write'))
  const canDelete = can(P.masters('warehouses', 'delete'))

  const list = useListParams({ sort: warehousesConfig.defaultSort, filterKeys: FILTER_KEYS })
  const view: WarehouseView = isWarehouseView(list.state.filters.view) ? list.state.filters.view : 'all'
  const screen = useWarehousesScreen(list, view)
  const formOptions = useFormOptions()

  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set())
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(() => new Set())

  const formatValue = useCallback((value: number) => formatCompactMoney(value, screen.currency), [screen.currency])

  // ---- create / edit ------------------------------------------------------
  const [editing, setEditing] = useState<{ mode: 'create' | 'edit'; row: Warehouse | null; values?: FormValues } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const formId = 'warehouse-form'

  const openCreate = useCallback(() => {
    setSaveError(null)
    setEditing({ mode: 'create', row: null })
  }, [])

  const openEdit = useCallback((row: Warehouse) => {
    setSaveError(null)
    setEditing({ mode: 'edit', row })
  }, [])

  /*
   * Duplicate opens the CREATE form pre-filled from the row, rather than
   * copying on the server. The code is cleared because it is unique per company
   * and the API would reject the copy; the default flag is cleared because a
   * company has one default and duplicating should not quietly move it.
   */
  const openDuplicate = useCallback((row: Warehouse) => {
    setSaveError(null)
    const values = warehousesConfig.toValues?.(row, null) ?? {}
    setEditing({
      mode: 'create',
      row: null,
      values: { ...values, warehouse_name: `${row.warehouse_name} (copy)`, warehouse_code: '', is_default: false },
    })
  }, [])

  const closeForm = useCallback(() => {
    if (!saving) setEditing(null)
  }, [saving])

  const afterChange = useCallback(() => {
    invalidateFormOptions()
    screen.reload()
  }, [screen])

  const submit = useCallback(
    async (values: FormValues) => {
      if (!editing) return
      setSaving(true)
      setSaveError(null)
      try {
        const payload = warehousesConfig.toPayload?.(values, editing.row) ?? values
        if (editing.mode === 'create') {
          await warehousesApi.create(payload)
          toast.success('Warehouse created successfully')
        } else if (editing.row) {
          await warehousesApi.update(editing.row.warehouse_id, payload)
          toast.success('Warehouse updated successfully')
        }
        setEditing(null)
        afterChange()
      } catch (err) {
        setSaveError(err)
      } finally {
        setSaving(false)
      }
    },
    [editing, toast, afterChange],
  )

  // ---- row actions --------------------------------------------------------
  const withBusy = useCallback(async (id: number, work: () => Promise<void>) => {
    setBusyIds((prev) => new Set(prev).add(id))
    try {
      await work()
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [])

  const setActive = useCallback(
    (row: Warehouse, active: boolean) =>
      withBusy(row.warehouse_id, async () => {
        try {
          await warehousesApi.update(row.warehouse_id, { is_active: active ? 1 : 0 })
          toast.success(active ? 'Warehouse activated' : 'Warehouse deactivated')
          afterChange()
        } catch (err) {
          toast.error(errorMessage(err, 'Unable to update warehouse. Please try again.'))
        }
      }),
    [withBusy, toast, afterChange],
  )

  const setDefault = useCallback(
    (row: Warehouse) =>
      withBusy(row.warehouse_id, async () => {
        try {
          await warehousesApi.update(row.warehouse_id, { is_default: 1 })
          toast.success(`${row.warehouse_name} is now the default warehouse`)
          afterChange()
        } catch (err) {
          toast.error(errorMessage(err, 'Unable to update warehouse. Please try again.'))
        }
      }),
    [withBusy, toast, afterChange],
  )

  // ---- delete -------------------------------------------------------------
  const [deleting, setDeleting] = useState<Warehouse | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const confirmDelete = useCallback(async () => {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await warehousesApi.remove(deleting.warehouse_id)
      toast.success('Warehouse deleted')
      setDeleting(null)
      afterChange()
    } catch (err) {
      /*
       * The API refuses a warehouse that documents or movements still point at,
       * and says which and how many. That is the useful half; the actionable
       * half — deactivate it instead — is this screen's to add. Only shown for
       * the code the API actually returned, never guessed at.
       */
      setDeleteError(
        isApiError(err) && err.code === 'delete_blocked'
          ? `${err.message}. You can deactivate it instead, which keeps every existing record intact and takes it out of the dropdowns.`
          : errorMessage(err, 'Unable to delete warehouse. Please try again.'),
      )
    } finally {
      setDeleteBusy(false)
    }
  }, [deleting, toast, afterChange])

  // ---- selection ----------------------------------------------------------
  const toggleRow = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const ids = screen.rows.map((r) => r.warehouse_id)
      const all = ids.length > 0 && ids.every((id) => prev.has(id))
      return all ? new Set() : new Set(ids)
    })
  }, [screen.rows])

  const bulkSetActive = useCallback(
    async (active: boolean) => {
      const rows = screen.rows.filter((r) => selected.has(r.warehouse_id) && Number(r.is_active) === (active ? 0 : 1))
      if (rows.length === 0) {
        toast.info(active ? 'Every selected warehouse is already active' : 'Every selected warehouse is already inactive')
        return
      }
      const results = await Promise.allSettled(rows.map((r) => warehousesApi.update(r.warehouse_id, { is_active: active ? 1 : 0 })))
      const failed = results.filter((r) => r.status === 'rejected').length
      if (failed === 0) toast.success(`${formatInt(rows.length)} ${rows.length === 1 ? 'warehouse' : 'warehouses'} ${active ? 'activated' : 'deactivated'}`)
      else toast.error(`${formatInt(failed)} of ${formatInt(rows.length)} could not be updated. Please try again.`)
      setSelected(new Set())
      afterChange()
    },
    [screen.rows, selected, toast, afterChange],
  )

  // ---- export -------------------------------------------------------------
  /*
   * The sheet writes the table's own columns — the config's, plus the two this
   * screen adds from the stock report. A reader must be able to lay the file
   * beside the screen and find the same numbers, which is why the stock and
   * utilisation resolvers read the same map the cells do.
   */
  const exportColumns = useMemo<ExportableColumn<Warehouse>[]>(() => {
    const base = masterExportColumns(warehousesConfig.columns)
    if (!screen.canSeeStock) return base
    const stockColumns: ExportableColumn<Warehouse>[] = [
      {
        key: 'stock_qty',
        header: 'Current stock',
        csvHeader: 'Current stock',
        align: 'right',
        format: 'qty',
        csv: (row) => (screen.stock.get(row.warehouse_id) ?? EMPTY_STOCK).qty,
      },
      {
        key: 'utilisation',
        header: 'Utilisation',
        csvHeader: 'Utilisation %',
        align: 'right',
        format: 'text',
        csv: (row) => {
          const pct = utilisationOf(capacityOf(row), (screen.stock.get(row.warehouse_id) ?? EMPTY_STOCK).qty)
          return pct === null ? 'Not configured' : `${pct.toFixed(1)}%`
        },
      },
    ]
    if (screen.canSeeStockValue) {
      stockColumns.splice(1, 0, {
        key: 'stock_value',
        header: 'Stock value',
        csvHeader: 'Stock value',
        align: 'right',
        format: 'amount',
        amount: true,
        csv: (row) => (screen.stock.get(row.warehouse_id) ?? EMPTY_STOCK).value ?? '',
      })
    }
    // After Capacity, before the policy and status columns — the table's order.
    const at = base.findIndex((c) => c.key === 'area')
    const cut = at === -1 ? base.length : at + 1
    return [...base.slice(0, cut), ...stockColumns, ...base.slice(cut)]
  }, [screen.stock, screen.canSeeStock, screen.canSeeStockValue])

  const exportMeta = useMemo(() => {
    const lines: string[] = []
    if (list.state.q) lines.push(`Search: ${list.state.q}`)
    const status = list.state.filters.status
    if (status) lines.push(`Status: ${status === 'active' ? 'Active only' : 'Inactive only'}`)
    if (list.state.filters.warehouse_type) lines.push(`Type: ${humanize(list.state.filters.warehouse_type)}`)
    if (!screen.canSeeStock) lines.push('Stock columns omitted: the warehouse stock report is not permitted for this user')
    return lines
  }, [list.state.q, list.state.filters, screen.canSeeStock])

  // ---- keyboard -----------------------------------------------------------
  usePageKeyboard({ searchInputRef, onRefresh: screen.reload, onNew: canWrite ? openCreate : undefined })

  /*
   * `n` for a new warehouse, the bare key, as the rest of the app uses bare
   * keys. `isTypingTarget` keeps it from firing while the user is in the search
   * box or anywhere inside the form, where `n` is simply the letter n.
   */
  useKeyboardScope(
    'page',
    useMemo(
      () => ({
        n: (e: KeyboardEvent) => {
          e.preventDefault()
          openCreate()
        },
      }),
      [openCreate],
    ),
    { enabled: canWrite && !accessLoading && editing === null },
  )

  // ---- derived ------------------------------------------------------------
  /* The alternate views and the analytics reason over every row; the table over its page. */
  const analyticsRows = view === 'all' ? screen.rows : screen.allRows
  const aiFacts = useMemo(
    () => toWarehouseFacts(analyticsRows, (id) => screen.stock.get(id) ?? EMPTY_STOCK),
    [analyticsRows, screen.stock],
  )
  const totalStockQty = useMemo(() => {
    if (!screen.canSeeStock) return null
    let sum = 0
    for (const value of screen.stock.values()) sum += value.qty
    return sum
  }, [screen.stock, screen.canSeeStock])

  const hasFilters = list.state.q !== '' || Boolean(list.state.filters.status) || Boolean(list.state.filters.warehouse_type)
  const isEmpty = !screen.listLoading && screen.total === 0 && !hasFilters
  const selectedCount = screen.rows.filter((r) => selected.has(r.warehouse_id)).length

  if (!accessLoading && !canRead) {
    return (
      <PageShell>
        <BreadcrumbHeader breadcrumbs={BREADCRUMBS} title="Warehouses" icon={WarehouseIcon} />
        <Notice kind="warning">You do not have permission to view warehouses in this company.</Notice>
      </PageShell>
    )
  }

  return (
    <PageShell fullBleed>
      <BreadcrumbHeader
        breadcrumbs={BREADCRUMBS}
        title="Warehouses"
        icon={WarehouseIcon}
        description="Manage warehouses, monitor capacity and optimise stock movement"
        actions={
          <>
            {/*
              In `actions`, not `aside`: PageHeader's aside slot is decoration —
              it is aria-hidden and hidden below 1536px, which would make this
              card unreachable by keyboard and invisible on a laptop.
            */}
            <WarehouseAiCard onClick={() => setAiOpen(true)} className="order-first w-full sm:w-auto xl:order-none" />
            <ListSheetActions<Warehouse>
              columns={exportColumns}
              rows={screen.rows}
              fetchAll={screen.fetchAll}
              filenameBase="warehouses"
              title="Warehouses"
              description={companyName || undefined}
              metaLines={exportMeta}
              onRefresh={screen.reload}
              refreshing={screen.listLoading}
              disabled={screen.total === 0}
              searchInputRef={searchInputRef}
            />
            {canWrite ? (
              <Button icon={Plus} onClick={openCreate} kbd="N">
                New warehouse
              </Button>
            ) : null}
          </>
        }
      />

      <WarehouseKpis summary={screen.summary} loading={screen.summaryLoading} stockQty={totalStockQty} />

      {formOptions.error ? <Notice kind="warning">{formOptions.error}</Notice> : null}
      {screen.allRowsTruncated ? (
        <Notice kind="info">This company has more warehouses than this view can group at once; the table above shows every one.</Notice>
      ) : null}

      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-3 xl:flex-row xl:items-center xl:justify-between xl:gap-4">
          <PageTabBar
            label={<span className="sr-only">Warehouse views</span>}
            value={view}
            onChange={(next) => list.setFilter('view', next === 'all' ? '' : next)}
            options={VIEW_TABS}
          />

          <div className="flex flex-wrap items-center gap-2">
            <SearchBox
              ref={searchInputRef}
              value={list.state.q}
              onChange={list.setQ}
              placeholder="Search warehouses, code or location…"
              kbd="/"
              aria-label="Search warehouses"
              className="min-w-[220px] flex-1 xl:flex-none xl:w-[280px]"
            />
            <Select
              size="sm"
              value={list.state.filters.status ?? ''}
              onChange={(e) => list.setFilter('status', e.target.value)}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
            <Select
              size="sm"
              value={list.state.filters.warehouse_type ?? ''}
              onChange={(e) => list.setFilter('warehouse_type', e.target.value)}
              aria-label="Filter by type"
            >
              <option value="">All types</option>
              {WAREHOUSE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </Select>
            {hasFilters ? (
              <Button variant="ghost" size="sm" icon={X} onClick={list.reset}>
                Clear
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                <Filter className="w-3.5 h-3.5" aria-hidden />
                No filters
              </span>
            )}
          </div>
        </div>

        {selectedCount > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-primary-light/40 px-3 py-2">
            <span className="text-xs font-semibold text-gray-900">
              {formatInt(selectedCount)} selected
            </span>
            {canWrite ? (
              <MenuButton
                label="Bulk actions"
                size="sm"
                variant="secondary"
                actions={[
                  { key: 'activate', label: 'Activate', onSelect: () => void bulkSetActive(true) },
                  { key: 'deactivate', label: 'Deactivate', onSelect: () => void bulkSetActive(false) },
                ]}
              >
                Bulk actions
              </MenuButton>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          </div>
        ) : null}

        {screen.listError ? (
          <ErrorState
            title="We couldn’t load warehouses."
            description="The list could not be fetched. Your filters are still applied — try again."
            onRetry={screen.reload}
            className="py-10"
          />
        ) : isEmpty ? (
          <EmptyState
            icon={WarehouseIcon}
            title="Create your first warehouse"
            description="Organise stock by physical or virtual locations and get better visibility across your inventory."
            action={
              canWrite ? (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button icon={Plus} onClick={openCreate}>
                    New warehouse
                  </Button>
                  <Button variant="ghost" onClick={() => navigate('/masters/warehouse-groups')}>
                    Learn about warehouse groups
                  </Button>
                </div>
              ) : undefined
            }
            className="py-12"
          />
        ) : view === 'all' ? (
          <>
            <WarehouseTable
              rows={screen.rows}
              stock={screen.stock}
              canSeeStock={screen.canSeeStock}
              canSeeStockValue={screen.canSeeStockValue}
              formatValue={formatValue}
              canWrite={canWrite}
              canDelete={canDelete}
              loading={screen.listLoading}
              sort={list.state.sort}
              order={list.state.order}
              onSort={list.toggleSort}
              selected={selected}
              onToggleRow={toggleRow}
              onToggleAll={toggleAll}
              busyIds={busyIds}
              onView={openEdit}
              onEdit={openEdit}
              onDuplicate={openDuplicate}
              onSetDefault={setDefault}
              onToggleActive={(row) => void setActive(row, Number(row.is_active) !== 1)}
              onDelete={(row) => {
                setDeleteError(null)
                setDeleting(row)
              }}
            />
            {!screen.listLoading && screen.total === 0 && hasFilters ? (
              <EmptyState
                icon={WarehouseIcon}
                title="No warehouses match"
                description="No warehouse matches the current search and filters."
                action={<Button variant="secondary" onClick={list.reset}>Clear filters</Button>}
                className="py-10"
              />
            ) : null}
            <div className="border-t border-gray-100 px-3">
              <Pagination meta={screen.meta} limit={list.state.limit} onPage={list.setPage} onLimit={list.setLimit} />
            </div>
          </>
        ) : view === 'location' ? (
          <WarehouseByLocationView rows={screen.allRows} stock={screen.stock} canSeeStock={screen.canSeeStock} loading={screen.allRowsLoading} onOpen={openEdit} />
        ) : view === 'capacity' ? (
          <WarehouseCapacityView rows={screen.allRows} stock={screen.stock} canSeeStock={screen.canSeeStock} loading={screen.allRowsLoading} onOpen={openEdit} />
        ) : (
          <WarehouseMapView rows={screen.allRows} stock={screen.stock} canSeeStock={screen.canSeeStock} loading={screen.allRowsLoading} onOpen={openEdit} />
        )}
      </Card>

      {isEmpty ? null : (
        <WarehouseAnalytics
          summary={screen.summary}
          rows={analyticsRows}
          stock={screen.stock}
          canSeeStock={screen.canSeeStock}
          canSeeStockValue={screen.canSeeStockValue}
          currency={screen.currency}
          locationCount={screen.locationCount}
          loading={screen.listLoading || screen.summaryLoading}
        />
      )}

      <WarehouseAiAssistant facts={aiFacts} open={aiOpen} onOpenChange={setAiOpen} />

      <Modal
        open={editing !== null}
        title={editing?.mode === 'create' ? 'New warehouse' : canWrite ? 'Edit warehouse' : 'Warehouse'}
        onClose={closeForm}
        busy={saving}
        size={warehousesConfig.modalSize}
        footer={
          <>
            <Button variant="secondary" onClick={closeForm} disabled={saving}>
              {canWrite ? 'Cancel' : 'Close'}
            </Button>
            {canWrite ? (
              <Button type="submit" form={formId} loading={saving}>
                {editing?.mode === 'create' ? 'Create warehouse' : 'Save changes'}
              </Button>
            ) : null}
          </>
        }
      >
        {editing ? (
          <MasterForm<Warehouse>
            key={`${editing.mode}-${editing.row?.warehouse_id ?? 'new'}`}
            formId={formId}
            fields={warehousesConfig.fields}
            mode={editing.mode}
            row={editing.row}
            options={formOptions.options}
            rows={screen.rows}
            initialValues={editing.values ?? warehousesConfig.toValues?.(editing.row, formOptions.options)}
            readOnly={!canWrite}
            serverError={saveError}
            onSubmit={submit}
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete warehouse?"
        message={
          <>
            <p style={{ margin: '0 0 0.5rem' }}>
              <strong>{deleting?.warehouse_name}</strong> will be removed from every list and dropdown.
            </p>
            <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
              This action may affect warehouse assignments and historical references. Records that already point at it keep
              working; the API refuses the delete while it is still in use.
            </p>
            {deleting && Number(deleting.is_default) === 1 ? (
              <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.875rem' }}>
                This warehouse is currently configured as the default warehouse.
              </p>
            ) : null}
          </>
        }
        confirmLabel="Delete warehouse"
        danger
        busy={deleteBusy}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => !deleteBusy && setDeleting(null)}
      />
    </PageShell>
  )
}
