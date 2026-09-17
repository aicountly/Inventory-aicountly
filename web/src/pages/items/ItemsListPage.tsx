import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CircleCheck,
  CircleSlash,
  Filter,
  MoreVertical,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  ScrollText,
  SquareCheckBig,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { ActiveBadge } from '../../components/StatusBadge'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ListSheetActions } from '../../components/ListSheetActions'
import { Notice } from '../../components/Notice'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ConfigureColumns } from '../../registers/ConfigureColumns'
import { useColumnConfig } from '../../registers/useColumnConfig'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { MenuButton } from '../../ui/MenuButton'
import type { MenuAction } from '../../ui/MenuButton'
import { SearchBox } from '../../ui/SearchBox'
import { Select } from '../../ui/Select'
import { AIC, cx } from '../../ui/cx'
import { notify } from '../../ui/notify'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { PageTabBar } from '../../ui/shell/PageTabBar'
import { SmartTable } from '../../ui/shell/SmartTable'
import type { SmartColumn } from '../../ui/shell/SmartTable'
import { ServerTablePagination } from '../../ui/shell/TablePagination'
import { ExportActions } from '../../export/ExportActions'
import { slugifyExportFilename } from '../../export/exportActions'
import { useExportIdentity } from '../../export/useExportIdentity'
import { useDebounce } from '../../hooks/useDebounce'
import { useFormOptions } from '../../hooks/useFormOptions'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import type { CrudApi } from '../../services/masters'
import type { MasterConfig } from '../../masters/types'
import { P } from '../../services/access'
import { errorMessage } from '../../services/api'
import { fetchAllRows } from '../../services/listAll'
import { itemsApi, ITEM_TYPES } from '../../services/items'
import type { ItemListRow } from '../../services/items'
import { formatDateTime, formatInt, formatMoney, formatQty, humanize, todayIso } from '../../utils/format'
import { ItemPreviewDrawer } from './ItemPreviewDrawer'
import { ItemsQuickTools } from './ItemsQuickTools'
import { ItemsSummaryCards } from './ItemsSummaryCards'
import { ITEM_COLUMNS, toExportColumns, trackingFlags } from './itemsColumns'

const api: CrudApi<ItemListRow> = {
  list: (query, signal) => itemsApi.list(query, signal),
  get: (id, signal) => itemsApi.get(id, signal),
  create: (body) => itemsApi.create(body),
  update: (id, body) => itemsApi.update(id, body),
  remove: (id) => itemsApi.remove(id),
}

/**
 * The generic `MasterPage` engine this screen no longer renders through — see
 * `ItemsListPage` below, which is a bespoke page built from the same shared
 * primitives the register screens use.
 *
 * Kept, and still real, because `masters/realMasterExports.test.tsx` mounts it
 * through the actual `MasterPage` to prove every column's export resolves to
 * something: `tracking` and `on_hand` are computed rather than read straight
 * off the row, and a config that dropped their `exportValue` once shipped two
 * silently blank columns onto every CSV, spreadsheet and letterheaded sheet
 * this master produced.
 */
export const itemsConfig: MasterConfig<ItemListRow> = {
  slug: 'items',
  permissionSlug: 'items',
  title: 'Items',
  singular: 'Item',
  idKey: 'item_id',
  nameOf: (r) => r.item_name,
  api,
  defaultSort: 'item_name',
  searchPlaceholder: 'Search name, alias, SKU or barcode…',
  listQuery: { with_stock: 1 },
  createRoute: '/items/new',
  editRoute: (r) => `/items/${r.item_id}`,
  deleteHint: 'Items used on documents or bills of materials cannot be deleted — deactivate them instead.',
  filters: [
    { name: 'item_type', label: 'Type', options: ITEM_TYPES.map((t) => ({ value: t, label: humanize(t) })), allLabel: 'All types' },
    { name: 'item_grp_id', label: 'Group', options: (o) => (o?.item_groups ?? []).map((g) => ({ value: g.item_grp_id, label: g.grp_name })), allLabel: 'All groups' },
    { name: 'stock_cat_id', label: 'Category', options: (o) => (o?.stock_categories ?? []).map((c) => ({ value: c.stock_cat_id, label: c.cat_name })), allLabel: 'All categories' },
    { name: 'brand_id', label: 'Brand', options: (o) => (o?.brands ?? []).map((b) => ({ value: b.brand_id, label: b.brand_name })), allLabel: 'All brands' },
    { name: 'unit_id', label: 'Unit', options: (o) => (o?.units ?? []).map((u) => ({ value: u.unit_id, label: `${u.unit_name}${u.unit_symbol ? ` (${u.unit_symbol})` : ''}` })), allLabel: 'All units' },
  ],
  columns: [
    {
      key: 'item_name',
      header: 'Item',
      sortKey: 'item_name',
      render: (r) => (
        <>
          <strong>{r.item_name}</strong>
          {r.item_alias ? <span className="muted"> · {r.item_alias}</span> : null}
        </>
      ),
    },
    { key: 'item_sku', header: 'SKU', sortKey: 'item_sku', render: (r) => <span className="mono">{r.item_sku ?? '—'}</span> },
    { key: 'item_upc', header: 'Barcode', render: (r) => <span className="mono">{r.item_upc ?? '—'}</span> },
    { key: 'grp_name', header: 'Group', sortKey: 'grp_name' },
    { key: 'cat_name', header: 'Category' },
    { key: 'brand_name', header: 'Brand' },
    { key: 'unit_symbol', header: 'Unit', render: (r) => r.unit_symbol ?? r.unit_name ?? '—' },
    { key: 'hsn_sac', header: 'HSN', render: (r) => <span className="mono">{r.hsn_sac ?? '—'}</span> },
    { key: 'mrp', header: 'MRP', align: 'right', render: (r) => formatMoney(r.mrp) },
    { key: 'valuation_method', header: 'Valuation', render: (r) => r.valuation_method },
    {
      key: 'tracking',
      header: 'Tracking',
      render: (r) => {
        const flags = trackingFlags(r)
        return flags.length ? flags.join(', ') : <span className="muted">—</span>
      },
      exportValue: (r) => trackingFlags(r).join(', '),
    },
    {
      key: 'on_hand',
      header: 'On hand',
      align: 'right',
      render: (r) => (r.stock ? formatQty(r.stock.on_hand) : '—'),
      exportValue: (r) => r.stock?.on_hand ?? '',
      exportFormat: 'qty',
    },
    { key: 'is_active', header: 'Status', render: (r) => <ActiveBadge active={r.is_active} /> },
    { key: 'updated_at', header: 'Updated', sortKey: 'updated_at', render: (r) => <span className="nowrap muted">{formatDateTime(r.updated_at)}</span> },
  ],
  fields: [],
}

const ITEM_FILTER_KEYS = ['status', 'item_type', 'item_grp_id', 'stock_cat_id', 'brand_id', 'unit_id', 'missing_sku'] as const
const DROPDOWN_FILTER_KEYS = ['item_type', 'item_grp_id', 'stock_cat_id', 'brand_id', 'unit_id'] as const

const SEARCH_DEBOUNCE_MS = 300

const MISSING_SKU_BANNER_KEY = 'inventory.items.missingSkuBanner.dismissed'
function readBannerDismissed(): boolean {
  try {
    return sessionStorage.getItem(MISSING_SKU_BANNER_KEY) === '1'
  } catch {
    return false
  }
}
function dismissBanner(): void {
  try {
    sessionStorage.setItem(MISSING_SKU_BANNER_KEY, '1')
  } catch {
    // A dismissed banner reappearing next session costs nothing worth failing over.
  }
}

/**
 * Items.
 *
 * A bespoke page rather than a `MasterPage` config: the mockup this rebuilds
 * needs a stat-card row, a preview drawer, row selection and a quick-tools
 * strip, none of which `MasterConfig` can express. It is composed from the
 * same shared primitives the register screens already use, for the same
 * visual and code consistency across the app.
 */
export function ItemsListPage() {
  const { scope, companyName } = useCompany()
  const { can, loading: accessLoading } = useAccess()
  const navigate = useNavigate()
  const exportIdentity = useExportIdentity()

  const canRead = can(P.masters('items', 'read'))
  const canWrite = can(P.masters('items', 'write'))
  const canDelete = can(P.masters('items', 'delete'))

  const params = useListParams({ sort: 'item_name', filterKeys: ITEM_FILTER_KEYS })
  const { state, query } = params
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const [searchDraft, setSearchDraft] = useState(state.q)
  const debouncedSearch = useDebounce(searchDraft, SEARCH_DEBOUNCE_MS)
  useEffect(() => setSearchDraft(state.q), [state.q])
  useEffect(() => {
    if (debouncedSearch !== state.q) params.setQ(debouncedSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the settled value may commit
  }, [debouncedSearch])

  const formOptions = useFormOptions()
  const cmpId = scope?.cmp_id ?? null
  const queryKey = JSON.stringify(query)

  const list = useQuery((signal) => itemsApi.list({ ...query, with_stock: true }, signal), [queryKey, cmpId], {
    enabled: scope !== null && canRead,
    resetKey: cmpId,
  })
  const rows = useMemo(() => list.data?.data ?? [], [list.data])

  /**
   * Minus `status`, so "Active" and "Inactive" can be counted side by side on
   * the tabs — a summary already narrowed to active items could never say how
   * many inactive ones exist for the tab beside it.
   */
  const summaryFilters = useMemo(() => {
    const { page: _page, limit: _limit, offset: _offset, sort: _sort, order: _order, status: _status, ...rest } = query
    return rest
  }, [query])
  const summaryKey = JSON.stringify(summaryFilters)
  const summary = useQuery((signal) => itemsApi.summary(summaryFilters, signal), [summaryKey, cmpId], {
    enabled: scope !== null && canRead,
    resetKey: cmpId,
  })

  const refresh = useCallback(() => {
    list.reload()
    summary.reload()
  }, [list, summary])

  const columnConfig = useColumnConfig('items', ITEM_COLUMNS)

  // ---- selection -------------------------------------------------------------
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Map<number, ItemListRow>>(() => new Map())
  const selectedRows = useMemo(() => [...selected.values()], [selected])
  const clearSelection = useCallback(() => setSelected(new Map()), [])
  useEffect(() => {
    clearSelection()
  }, [queryKey, cmpId, clearSelection])
  useEffect(() => {
    if (!selectMode) clearSelection()
  }, [selectMode, clearSelection])

  const toggleRow = useCallback((row: ItemListRow) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(row.item_id)) next.delete(row.item_id)
      else next.set(row.item_id, row)
      return next
    })
  }, [])
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.item_id))

  const [bulkBusy, setBulkBusy] = useState(false)
  const runBulkActive = async (value: 0 | 1) => {
    setBulkBusy(true)
    try {
      await itemsApi.bulkUpdate(selectedRows.map((r) => ({ item_id: r.item_id, is_active: value })))
      notify.success(`${selectedRows.length} item${selectedRows.length === 1 ? '' : 's'} ${value ? 'activated' : 'deactivated'}`)
      clearSelection()
      refresh()
    } catch (err) {
      notify.error(errorMessage(err, 'Could not update the selected items.'))
    } finally {
      setBulkBusy(false)
    }
  }

  // ---- preview drawer ----------------------------------------------------------
  const [preview, setPreview] = useState<ItemListRow | null>(null)

  // ---- single-row activate / delete ---------------------------------------------
  const toggleActive = async (row: ItemListRow) => {
    try {
      await itemsApi.update(row.item_id, { is_active: row.is_active ? 0 : 1 })
      notify.success(row.is_active ? 'Item deactivated' : 'Item activated')
      refresh()
    } catch (err) {
      notify.error(errorMessage(err, 'Could not update the item.'))
    }
  }

  const [deleting, setDeleting] = useState<ItemListRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await itemsApi.remove(deleting.item_id)
      notify.success('Item deleted')
      setDeleting(null)
      refresh()
    } catch (err) {
      setDeleteError(errorMessage(err))
    } finally {
      setDeleteBusy(false)
    }
  }

  // ---- the "complete your item details" banner -----------------------------------
  const [bannerDismissed, setBannerDismissed] = useState(readBannerDismissed)
  const reviewMissingSku = () => {
    setSearchDraft('')
    params.setFilters({ status: '', item_type: '', item_grp_id: '', stock_cat_id: '', brand_id: '', unit_id: '', missing_sku: '1' })
  }
  const reviewingMissingSku = state.filters.missing_sku === '1'

  // ---- the filter panel ----------------------------------------------------------
  const [filtersOpen, setFiltersOpen] = useState(false)
  const activeFilterCount = DROPDOWN_FILTER_KEYS.filter((k) => state.filters[k]).length
  const clearDropdownFilters = () => params.setFilters(Object.fromEntries(DROPDOWN_FILTER_KEYS.map((k) => [k, ''])))

  // ---- columns ------------------------------------------------------------------
  const columns = useMemo<SmartColumn<ItemListRow>[]>(() => {
    const cols: SmartColumn<ItemListRow>[] = []
    if (selectMode) {
      cols.push({
        key: '__select',
        width: 36,
        headerClassName: 'print:hidden',
        cellClassName: 'print:hidden',
        header: (
          <input
            type="checkbox"
            className="h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))]"
            checked={allOnPageSelected}
            onChange={() => setSelected(allOnPageSelected ? new Map() : new Map(rows.map((r) => [r.item_id, r])))}
            aria-label="Select every item on this page"
          />
        ),
        render: (r) => (
          <input
            type="checkbox"
            className="h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))]"
            checked={selected.has(r.item_id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleRow(r)}
            aria-label={`Select ${r.item_name}`}
          />
        ),
      })
    }
    cols.push(...columnConfig.visibleColumns)
    cols.push({
      key: '__actions',
      header: '',
      align: 'right',
      width: 44,
      headerClassName: 'print:hidden',
      cellClassName: 'print:hidden',
      render: (r) => {
        const actions: MenuAction[] = [
          { key: 'edit', label: canWrite ? 'Edit item' : 'View item', icon: Pencil, onSelect: () => navigate(`/items/${r.item_id}`) },
          { key: 'ledger', label: 'View stock ledger', icon: ScrollText, onSelect: () => navigate(`/registers/stock-ledger?item_id=${r.item_id}`) },
        ]
        if (canWrite) {
          actions.push({
            key: 'toggle',
            label: r.is_active ? 'Deactivate' : 'Activate',
            icon: r.is_active ? CircleSlash : CircleCheck,
            separated: true,
            onSelect: () => void toggleActive(r),
          })
        }
        if (canDelete) {
          actions.push({
            key: 'delete',
            label: 'Delete',
            icon: Trash2,
            danger: true,
            separated: !canWrite,
            onSelect: () => {
              setDeleteError(null)
              setDeleting(r)
            },
          })
        }
        return (
          <span onClick={(e) => e.stopPropagation()}>
            <MenuButton label={`${r.item_name} actions`} icon={MoreVertical} actions={actions} />
          </span>
        )
      },
    })
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toggleActive/navigate are stable enough for a row menu
  }, [selectMode, allOnPageSelected, rows, selected, toggleRow, columnConfig.visibleColumns, canWrite, canDelete])

  const exportColumns = useMemo(() => toExportColumns(columnConfig.visibleColumns), [columnConfig.visibleColumns])
  const fetchAll = useCallback(
    () => fetchAllRows<ItemListRow>((page, limit) => itemsApi.list({ ...query, with_stock: true, page, limit })),
    [query],
  )

  if (!accessLoading && !canRead) {
    return (
      <PageShell>
        <BreadcrumbHeader icon={Package} title="Items" />
        <Notice kind="warning">You do not have permission to view items in this company.</Notice>
      </PageShell>
    )
  }

  const totalCount = summary.data?.total ?? 0
  const activeCount = summary.data?.active ?? 0
  const missingSkuCount = summary.data?.missing_sku ?? 0

  const moreActions: MenuAction[] = [
    { key: 'refresh', label: 'Refresh', icon: RotateCcw, onSelect: refresh },
    { key: 'bulk-edit', label: 'Bulk edit items', icon: Pencil, onSelect: () => navigate('/items/bulk-edit') },
  ]

  return (
    <PageShell fullBleed>
      <BreadcrumbHeader
        icon={Package}
        title="Items"
        description="Manage your catalogue. Understand every item."
        actions={
          <>
            <Button
              variant="secondary"
              icon={Upload}
              onClick={() => notify.info('CSV import is coming soon. Use Bulk edit or New item for now.')}
            >
              Import
            </Button>
            <ListSheetActions<ItemListRow>
              columns={exportColumns}
              rows={rows}
              fetchAll={fetchAll}
              filenameBase="items"
              title="Items"
              description="The item master — units, tracking and stock on hand"
              disabled={!list.data || list.data.meta.total === 0}
              searchInputRef={searchInputRef}
            />
            {canWrite ? (
              <Button icon={Plus} onClick={() => navigate('/items/new')}>
                New item
              </Button>
            ) : null}
            <MenuButton label="More item actions" icon={MoreVertical} variant="secondary" actions={moreActions} />
          </>
        }
      />

      {formOptions.error ? <Notice kind="warning">{formOptions.error}</Notice> : null}

      <ItemsSummaryCards summary={summary.data} loading={summary.loading} error={summary.error} onRetry={summary.reload} />

      {missingSkuCount > 0 && !bannerDismissed ? (
        <Notice
          kind="success"
          title="Complete your item details"
          onDismiss={() => {
            dismissBanner()
            setBannerDismissed(true)
          }}
          actions={
            <Button variant="ghost" size="xs" onClick={reviewMissingSku}>
              Review items →
            </Button>
          }
        >
          {formatInt(missingSkuCount)} item{missingSkuCount === 1 ? ' has' : 's have'} no SKU or barcode. Add identifiers for faster search
          and scanning.
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <SearchBox
          ref={searchInputRef}
          value={searchDraft}
          onChange={setSearchDraft}
          placeholder="Search name, alias, SKU or barcode…"
          kbd="/"
          className="w-full sm:w-72"
        />
        <Button variant={filtersOpen ? 'outline' : 'secondary'} size="sm" icon={Filter} onClick={() => setFiltersOpen((v) => !v)} aria-pressed={filtersOpen}>
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </Button>
        <ConfigureColumns columns={ITEM_COLUMNS} visibility={columnConfig.visibility} onChange={columnConfig.setVisibility} disabled={!columnConfig.ready} />
        <Button variant={selectMode ? 'outline' : 'secondary'} size="sm" icon={SquareCheckBig} onClick={() => setSelectMode((v) => !v)} aria-pressed={selectMode}>
          Select
        </Button>
        {reviewingMissingSku ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
            Reviewing items with no SKU
            <button
              type="button"
              onClick={() => params.setFilter('missing_sku', '')}
              aria-label="Stop reviewing items with no SKU"
              className="rounded-full p-0.5 opacity-70 hover:opacity-100"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ) : null}
      </div>

      {filtersOpen ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 print:hidden">
          <Select value={state.filters.item_type ?? ''} onChange={(e) => params.setFilter('item_type', e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
          <Select value={state.filters.item_grp_id ?? ''} onChange={(e) => params.setFilter('item_grp_id', e.target.value)} aria-label="Group">
            <option value="">All groups</option>
            {(formOptions.options?.item_groups ?? []).map((g) => (
              <option key={g.item_grp_id} value={g.item_grp_id}>
                {g.grp_name}
              </option>
            ))}
          </Select>
          <Select value={state.filters.stock_cat_id ?? ''} onChange={(e) => params.setFilter('stock_cat_id', e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {(formOptions.options?.stock_categories ?? []).map((c) => (
              <option key={c.stock_cat_id} value={c.stock_cat_id}>
                {c.cat_name}
              </option>
            ))}
          </Select>
          <Select value={state.filters.brand_id ?? ''} onChange={(e) => params.setFilter('brand_id', e.target.value)} aria-label="Brand">
            <option value="">All brands</option>
            {(formOptions.options?.brands ?? []).map((b) => (
              <option key={b.brand_id} value={b.brand_id}>
                {b.brand_name}
              </option>
            ))}
          </Select>
          <Select value={state.filters.unit_id ?? ''} onChange={(e) => params.setFilter('unit_id', e.target.value)} aria-label="Unit">
            <option value="">All units</option>
            {(formOptions.options?.units ?? []).map((u) => (
              <option key={u.unit_id} value={u.unit_id}>
                {u.unit_name}
                {u.unit_symbol ? ` (${u.unit_symbol})` : ''}
              </option>
            ))}
          </Select>
          {activeFilterCount > 0 || reviewingMissingSku ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                clearDropdownFilters()
                if (reviewingMissingSku) params.setFilter('missing_sku', '')
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : null}

      <PageTabBar
        label="Status"
        value={state.filters.status ?? ''}
        onChange={(v) => params.setFilter('status', v)}
        options={[
          { value: '', label: `All items ${formatInt(totalCount)}` },
          { value: 'active', label: `Active ${formatInt(activeCount)}` },
          { value: 'inactive', label: `Inactive ${formatInt(totalCount - activeCount)}` },
        ]}
      />

      {selected.size > 0 ? (
        <div
          className={cx(AIC, 'flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-light px-3 py-2 text-xs text-gray-700 print:hidden')}
          role="status"
        >
          <strong className="font-semibold text-primary">{formatInt(selected.size)} selected</strong>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canWrite ? (
              <>
                <Button variant="secondary" size="xs" icon={CircleCheck} disabled={bulkBusy} onClick={() => void runBulkActive(1)}>
                  Activate
                </Button>
                <Button variant="secondary" size="xs" icon={CircleSlash} disabled={bulkBusy} onClick={() => void runBulkActive(0)}>
                  Deactivate
                </Button>
              </>
            ) : null}
            <ExportActions<ItemListRow>
              columns={exportColumns}
              rows={selectedRows}
              filename={slugifyExportFilename(['items-selection', companyName, todayIso()])}
              identity={exportIdentity}
              title="Items — selected"
              description="A hand-picked subset of the item master"
              formats={['csv', 'excel', 'pdf']}
              size="xs"
            />
            <Button variant="ghost" size="xs" onClick={clearSelection}>
              Clear selection
            </Button>
          </div>
        </div>
      ) : null}

      {list.error && rows.length > 0 ? (
        <Notice
          kind="warning"
          title="Showing the last result that loaded."
          actions={
            <Button variant="secondary" size="xs" onClick={list.reload}>
              Retry
            </Button>
          }
        >
          The items could not be refreshed.
        </Notice>
      ) : null}

      <SmartTable<ItemListRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.item_id}
        loading={list.loading}
        error={list.error && rows.length === 0 ? { title: 'Unable to load items.', description: 'Your filters have been kept.', onRetry: list.reload } : null}
        empty={
          <EmptyState
            icon={Package}
            title="No items found"
            description="Try changing your search or filters."
            action={
              state.q || activeFilterCount > 0 || reviewingMissingSku || state.filters.status ? (
                <Button variant="secondary" size="sm" icon={RotateCcw} onClick={params.reset}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        }
        sort={{ key: state.sort, order: state.order }}
        onSort={params.toggleSort}
        onRowActivate={(r) => setPreview(r)}
        activateOnSingleClick
        keyboardResetKey={queryKey}
        searchInputRef={searchInputRef}
        stickyHeader
        scrollBody
        minWidth={720}
        caption="Items"
        rowClassName={(r) => (preview?.item_id === r.item_id ? 'bg-primary-light/40' : undefined)}
        footer={<ServerTablePagination meta={list.data?.meta ?? null} limit={state.limit} onPage={params.setPage} onLimit={params.setLimit} />}
      />

      <ItemsQuickTools />

      <ItemPreviewDrawer row={preview} onClose={() => setPreview(null)} />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete item?"
        message={
          <>
            <p style={{ margin: '0 0 0.5rem' }}>
              <strong>{deleting?.item_name}</strong> will be removed from every list and dropdown.
            </p>
            <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
              Items used on documents or bills of materials cannot be deleted — deactivate them instead.
            </p>
          </>
        }
        confirmLabel="Delete"
        danger
        busy={deleteBusy}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => !deleteBusy && setDeleting(null)}
      />
    </PageShell>
  )
}

export default ItemsListPage
