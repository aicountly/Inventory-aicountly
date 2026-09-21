import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Columns3, Plus, Tag, Upload } from 'lucide-react'
import type { MenuAction } from '../../../ui/MenuButton'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { MenuButton } from '../../../ui/MenuButton'
import { BreadcrumbHeader } from '../../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../../ui/shell/PageShell'
import { ServerTablePagination } from '../../../ui/shell/TablePagination'
import { useToast } from '../../../ui/ToastContext'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ListSheetActions } from '../../../components/ListSheetActions'
import { Notice } from '../../../components/Notice'
import { useAccess } from '../../../access/AccessContext'
import { useCompany } from '../../../company/CompanyContext'
import { useDebounce } from '../../../hooks/useDebounce'
import { useListParams } from '../../../hooks/useListParams'
import { useQuery } from '../../../hooks/useQuery'
import { useKeyboardScope } from '../../../keyboard/useKeyboardScope'
import { P } from '../../../services/access'
import { errorMessage } from '../../../services/api'
import { fetchAllRows } from '../../../services/listAll'
import { brandsApi } from '../../../services/masters'
import type { Brand } from '../../../services/masters'
import {
  BRAND_SALES_UNAVAILABLE,
  brandSalesMessage,
  fetchBrandSales,
  indexBrandSales,
  showsSalesColumn,
} from '../../../services/brandAnalyticsApi'
import { csvFilename, downloadCsv, toCsv } from '../../../utils/csv'
import { currencySymbol, formatDate, formatInt, todayIso } from '../../../utils/format'
import { BrandDetailDrawer } from './BrandDetailDrawer'
import { BrandFormDrawer, brandToFormValues } from './BrandFormDrawer'
import type { BrandFormMode, BrandFormValues } from './BrandFormDrawer'
import { BrandsBulkBar } from './BrandsBulkBar'
import { BrandsEmptyState, BrandsNoResults } from './BrandsEmptyState'
import { BrandsImportDialog } from './BrandsImportDialog'
import { BrandsInsightsRail } from './BrandsInsightsRail'
import type { BrandAssistantSuggestion } from './BrandsInsightsRail'
import { BrandsKpiGrid } from './BrandsKpiGrid'
import { BrandsTable, CONFIGURABLE_BRAND_COLUMNS, DEFAULT_BRAND_COLUMN_KEYS } from './BrandsTable'
import { BrandsToolbar } from './BrandsToolbar'
import { buildBrandInsights } from './brandInsights'
import {
  BRAND_FILTER_KEYS,
  brandExportMetaLines,
  buildBrandListQuery,
  createdRange,
  readBrandFilters,
  sortKeyOf,
  sortParamsOf,
} from './brandsQuery'
import type { BrandSortKey, CreatedPreset } from './brandsQuery'

/**
 * `/masters/brands` — the Brands workspace.
 *
 * It replaces the generic `MasterPage` for this one master, and only for this
 * one: everything a brand has that a stock category does not — an item count
 * worth clicking, a revenue column that belongs to another product, a linkage
 * problem worth surfacing — needed a screen that knows what a brand is. The
 * parts it is built from (PageShell, BreadcrumbHeader, StatCard, SmartTable,
 * Drawer, MenuButton, ServerTablePagination, ListSheetActions, ConfirmDialog,
 * the toast) are the ones every other Inventory screen uses, so it inherits
 * their keyboard behaviour, their dark mode and their print rules rather than
 * re-inventing any of it.
 *
 * Three properties are worth stating because they are easy to break later:
 *
 *  - **State lives in the URL.** Search, status, period, linkage, sort, page
 *    and page size are all query parameters, so a filtered view can be
 *    reloaded, bookmarked and pasted to a colleague.
 *  - **Figures are counted by the server.** The KPI strip and the insights come
 *    from `/v1/brands/metrics` over the whole company; nothing above the table
 *    is derived from the page of rows under it.
 *  - **Revenue is borrowed, never stored.** Sales come from Books through a
 *    live relay. When that service is not connected the column is simply not
 *    drawn — no zeros, no estimates, and nothing of Books' is kept here.
 */

const COLUMN_STORAGE_KEY = 'inventory.masters.brands.columns'

function readStoredColumns(): string[] {
  try {
    const raw = window.localStorage.getItem(COLUMN_STORAGE_KEY)
    if (!raw) return DEFAULT_BRAND_COLUMN_KEYS
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_BRAND_COLUMN_KEYS
    const keys = parsed.filter((k): k is string => typeof k === 'string')
    // The fixed columns are never stored as "off": a remembered preference from
    // before a column became fixed must not be able to hide it.
    return Array.from(new Set([...keys, 'select', 'brand', 'actions']))
  } catch {
    return DEFAULT_BRAND_COLUMN_KEYS
  }
}

function writeStoredColumns(keys: readonly string[]): void {
  try {
    window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // Private mode or blocked storage: the choice still holds for this visit.
  }
}

const BREADCRUMBS = [
  { label: 'Inventory', to: '/dashboard' },
  { label: 'Masters', to: '/masters' },
  { label: 'Brands' },
]

export function BrandsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { scope, fyRange, companyName } = useCompany()
  const { can, loading: accessLoading } = useAccess()

  const canRead = can(P.masters('brands', 'read'))
  const canWrite = can(P.masters('brands', 'write'))
  const canDelete = can(P.masters('brands', 'delete'))
  const canAudit = can(P.auditRead)

  // ---- URL state ----------------------------------------------------------
  const list = useListParams({ sort: 'brand_name', order: 'asc', filterKeys: BRAND_FILTER_KEYS })
  const filters = useMemo(() => readBrandFilters(list.state.q, list.state.filters), [list.state.q, list.state.filters])
  const sortKey = sortKeyOf(list.state.sort, list.state.order)

  /*
   * The search box is typed into far faster than a list can be fetched, so the
   * input is local and the URL lags it. `useDebounce` is what turns thirty
   * keystrokes into one request; `useQuery` aborts whatever is in flight when
   * the next one starts, so a slow early response cannot land after a fast
   * later one and put the wrong rows on screen.
   */
  const [searchText, setSearchText] = useState(list.state.q)
  const debouncedSearch = useDebounce(searchText, 300)
  const lastPushedSearch = useRef(list.state.q)
  useEffect(() => {
    if (debouncedSearch === lastPushedSearch.current) return
    lastPushedSearch.current = debouncedSearch
    list.setQ(debouncedSearch)
    // `list` is a fresh object each render but `setQ` is a stable useCallback,
    // so naming it is honest and cannot re-trigger the effect.
  }, [debouncedSearch, list.setQ])
  // Back / forward, a KPI card, or "clear filters" changed the URL: follow it.
  useEffect(() => {
    if (list.state.q !== lastPushedSearch.current) {
      lastPushedSearch.current = list.state.q
      setSearchText(list.state.q)
    }
  }, [list.state.q])

  const today = todayIso()
  const rangeContext = useMemo(
    () => ({ today, fyFrom: fyRange.from, fyTo: fyRange.to }),
    [today, fyRange.from, fyRange.to],
  )
  const effectiveSearch = useMemo(
    () => ({ ...filters, q: debouncedSearch }),
    [filters, debouncedSearch],
  )
  const listQuery = useMemo(
    () =>
      buildBrandListQuery(
        effectiveSearch,
        { page: list.state.page, limit: list.state.limit, sort: list.state.sort, order: list.state.order },
        rangeContext,
      ),
    [effectiveSearch, list.state.page, list.state.limit, list.state.sort, list.state.order, rangeContext],
  )

  // ---- data ---------------------------------------------------------------
  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null
  const enabled = Boolean(scope) && canRead

  const brands = useQuery(
    (signal) => brandsApi.list(listQuery, signal),
    [scopeKey, listQuery],
    // The company scope is a reset key, not a dependency to be kept warm: one
    // frame of another company's brands under this company's name is not a
    // stale figure, it is another tenant's data on screen.
    { enabled, resetKey: scopeKey },
  )

  const metrics = useQuery((signal) => brandsApi.metrics(signal), [scopeKey], {
    enabled,
    resetKey: scopeKey,
  })

  /*
   * Books' figures, asked for separately and allowed to fail on their own.
   *
   * Deliberately NOT folded into the brands request: if the accounting service
   * is slow or down, the brand master must still draw. It is keyed on the whole
   * scope because the FY selector in the header is exactly what decides which
   * year's turnover this is.
   */
  const sales = useQuery((signal) => fetchBrandSales(signal), [scopeKey], {
    enabled,
    resetKey: scopeKey,
  })

  const rows = useMemo(() => brands.data?.data ?? [], [brands.data])
  const salesData = sales.data ?? (sales.error ? BRAND_SALES_UNAVAILABLE : null)
  const salesByBrand = useMemo(
    () => (salesData ? indexBrandSales(salesData) : new Map()),
    [salesData],
  )
  const showSales = showsSalesColumn(salesData)
  const salesSymbol = currencySymbol(salesData?.currency ?? 'INR')

  const brandNameOf = useCallback(
    (id: number) => rows.find((r) => r.brand_id === id)?.brand_name ?? null,
    [rows],
  )

  // ---- selection ----------------------------------------------------------
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  // A selection is a set of rows the reader can see. Change what is on screen
  // and it no longer means anything, so it is dropped rather than carried into
  // a bulk action over rows nobody looked at.
  useEffect(() => {
    setSelectedIds(new Set())
  }, [listQuery, scopeKey])

  const toggleRow = useCallback((id: number, on: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(
    (on: boolean) => setSelectedIds(on ? new Set(rows.map((r) => r.brand_id)) : new Set()),
    [rows],
  )

  const selectedRows = useMemo(() => rows.filter((r) => selectedIds.has(r.brand_id)), [rows, selectedIds])

  // ---- columns ------------------------------------------------------------
  const [visibleColumns, setVisibleColumns] = useState<string[]>(readStoredColumns)
  const toggleColumn = (key: string) => {
    setVisibleColumns((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      writeStoredColumns(next)
      return next
    })
  }

  // ---- drawers ------------------------------------------------------------
  const [form, setForm] = useState<{ mode: BrandFormMode; brand: Brand | null; values?: BrandFormValues } | null>(null)
  const [detail, setDetail] = useState<Brand | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [deleting, setDeleting] = useState<Brand[] | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  const openCreate = useCallback(() => {
    if (!canWrite) return
    setDetail(null)
    setForm({ mode: 'create', brand: null })
  }, [canWrite])

  const openEdit = useCallback((brand: Brand) => {
    setDetail(null)
    setForm({ mode: 'edit', brand })
  }, [])

  const openDuplicate = useCallback((brand: Brand) => {
    setDetail(null)
    setForm({
      mode: 'create',
      brand: null,
      // A copy is a starting point, not a clone: the name has to change (the
      // API enforces it) and the code, being unique, cannot come along at all.
      values: { ...brandToFormValues(brand), brand_name: `${brand.brand_name} (copy)`, brand_code: '' },
    })
  }, [])

  /*
   * `?new=1` opens the create drawer on arrival — the Masters landing page's
   * Quick Create menu needs a link it can put in an anchor. The flag is
   * consumed before the drawer opens, so a reload or a Back does not reopen it,
   * and it waits for access to load because `can()` answers false while
   * permissions are in flight.
   */
  const [searchParams, setSearchParams] = useSearchParams()
  const createRequested = searchParams.get('new') === '1'
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
    if (canWrite) openCreate()
  }, [createRequested, accessLoading, canWrite, openCreate, setSearchParams])

  // ---- mutations ----------------------------------------------------------
  const refresh = useCallback(() => {
    brands.reload()
    metrics.reload()
  }, [brands.reload, metrics.reload])

  const submitForm = async (payload: Record<string, unknown>, again: boolean) => {
    if (!form) return
    if (form.mode === 'edit' && form.brand) {
      await brandsApi.update(form.brand.brand_id, payload)
      toast.success('Brand updated')
    } else {
      await brandsApi.create(payload)
      toast.success('Brand created')
    }
    if (!again) setForm(null)
    refresh()
  }

  const toggleActive = async (brand: Brand) => {
    const next = Number(brand.is_active) !== 1
    try {
      await brandsApi.setActive(brand.brand_id, next)
      toast.success(next ? 'Brand activated' : 'Brand deactivated')
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    let removed = 0
    try {
      for (const brand of deleting) {
        await brandsApi.remove(brand.brand_id)
        removed += 1
      }
      toast.success(removed === 1 ? 'Brand deleted' : `${formatInt(removed)} brands deleted`)
      setDeleting(null)
      setSelectedIds(new Set())
      refresh()
    } catch (err) {
      // The API refuses a brand that items still carry, and says how many. That
      // sentence is the whole answer, so it is shown verbatim rather than
      // flattened into "could not delete".
      setDeleteError(
        removed > 0
          ? `${formatInt(removed)} deleted, then: ${errorMessage(err)}`
          : errorMessage(err),
      )
      if (removed > 0) refresh()
    } finally {
      setDeleteBusy(false)
    }
  }

  const bulkSetActive = async (active: boolean) => {
    if (selectedRows.length === 0) return
    setBulkBusy(true)
    let changed = 0
    let failure: string | null = null
    for (const brand of selectedRows) {
      if ((Number(brand.is_active) === 1) === active) continue
      try {
        await brandsApi.setActive(brand.brand_id, active)
        changed += 1
      } catch (err) {
        failure = errorMessage(err)
        break
      }
    }
    setBulkBusy(false)
    if (changed > 0) {
      toast.success(`${formatInt(changed)} ${changed === 1 ? 'brand' : 'brands'} ${active ? 'activated' : 'deactivated'}`)
      setSelectedIds(new Set())
      refresh()
    }
    if (failure) toast.error(failure)
    else if (changed === 0) toast.info(`Nothing to change — every selected brand is already ${active ? 'active' : 'inactive'}.`)
  }

  // ---- export -------------------------------------------------------------
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const exportRange = useMemo(
    () => createdRange(filters.created, { ...rangeContext, customFrom: filters.createdFrom, customTo: filters.createdTo }),
    [filters, rangeContext],
  )
  const exportColumns = useMemo(
    () => [
      { key: 'brand_name', csvHeader: 'Brand', csv: (r: Brand) => r.brand_name },
      { key: 'brand_alias', csvHeader: 'Alias', csv: (r: Brand) => r.brand_alias ?? '' },
      { key: 'brand_code', csvHeader: 'Code', csv: (r: Brand) => r.brand_code ?? '' },
      { key: 'description', csvHeader: 'Description', csv: (r: Brand) => r.description ?? '' },
      { key: 'item_count', csvHeader: 'Items', align: 'right' as const, csv: (r: Brand) => r.item_count ?? 0 },
      ...(showSales
        ? [
            {
              key: 'sales_fy',
              csvHeader: `Sales (FY, ${salesData?.currency ?? 'INR'})`,
              align: 'right' as const,
              amount: true,
              // The raw figure, so a spreadsheet can add it up. Absent is not
              // zero: a brand Sales did not report is left blank rather than
              // totalled as though it sold nothing.
              csv: (r: Brand) => salesByBrand.get(r.brand_id)?.sales ?? '',
            },
          ]
        : []),
      { key: 'is_active', csvHeader: 'Status', csv: (r: Brand) => (Number(r.is_active) === 1 ? 'Active' : 'Inactive') },
      { key: 'created_at', csvHeader: 'Created', csv: (r: Brand) => formatDate(r.created_at, '') },
      { key: 'updated_at', csvHeader: 'Updated', csv: (r: Brand) => formatDate(r.updated_at, '') },
    ],
    [showSales, salesByBrand, salesData?.currency],
  )
  const fetchAll = useCallback(
    () => fetchAllRows<Brand>((page, limit) => brandsApi.list({ ...listQuery, page, limit })),
    [listQuery],
  )

  // ---- assistant suggestions ----------------------------------------------
  /*
   * Every suggestion is a VIEW of this list, applied in front of the reader.
   * None of them answers in prose, because none of them could be checked.
   */
  const suggestions = useMemo<BrandAssistantSuggestion[]>(
    () => [
      {
        key: 'no-items',
        label: 'Which brands have no items?',
        onSelect: () => list.setFilters({ has_items: '0', status: '', created: '' }),
      },
      {
        key: 'most-items',
        label: 'Show the brands carrying the most items',
        onSelect: () => list.setFilters({ ...sortParamsOf('items_desc'), has_items: '' }),
      },
      {
        key: 'this-month',
        label: 'What was added this month?',
        onSelect: () => list.setFilters({ created: 'month', created_from: '', created_to: '' }),
      },
      {
        key: 'inactive',
        label: 'Which brands are switched off?',
        onSelect: () => list.setFilters({ status: 'inactive', has_items: '' }),
      },
    ],
    [list.setFilters],
  )

  const insights = useMemo(
    () => buildBrandInsights({ metrics: metrics.data, sales: salesData, nameOf: brandNameOf }),
    [metrics.data, salesData, brandNameOf],
  )

  // ---- keyboard -----------------------------------------------------------
  // `/`, Ctrl+F, Ctrl+R and Ctrl+P are registered by ListSheetActions below
  // (one page scope, one set of bindings). Only the create key is added here.
  const newBindings = useMemo(
    () => ({
      n: (e: KeyboardEvent) => {
        if (!canWrite) return
        e.preventDefault()
        openCreate()
      },
    }),
    [canWrite, openCreate],
  )
  useKeyboardScope('page', newBindings)

  // ---- render -------------------------------------------------------------
  if (!accessLoading && !canRead) {
    return (
      <PageShell>
        <BreadcrumbHeader breadcrumbs={BREADCRUMBS} title="Brands" />
        <Notice kind="warning">You do not have permission to view brands in this company.</Notice>
      </PageShell>
    )
  }

  const total = brands.data?.meta.total ?? 0
  const isFiltered =
    Boolean(debouncedSearch.trim()) || Boolean(filters.status) || Boolean(filters.created) || Boolean(filters.hasItems)
  const columnActions: MenuAction[] = CONFIGURABLE_BRAND_COLUMNS.filter(
    (c) => c.key !== 'sales' || showSales,
  ).map((c) => ({
    key: c.key,
    label: `${visibleColumns.includes(c.key) ? '✓ ' : '   '}${c.label}`,
    onSelect: () => toggleColumn(c.key),
  }))

  return (
    <PageShell>
      <BreadcrumbHeader
        breadcrumbs={BREADCRUMBS}
        title="Brands"
        icon={Tag}
        badge={<Badge tone="info">Master data</Badge>}
        description="Manage your product brands with power, precision and AI."
        meta={
          brands.data ? (
            <span className="text-xs text-gray-500">
              {formatInt(total)} {total === 1 ? 'brand' : 'brands'}
              {isFiltered ? ' matching your filters' : ' in this company'}
            </span>
          ) : null
        }
        actions={
          <>
            <ListSheetActions<Brand>
              columns={exportColumns}
              rows={rows}
              fetchAll={fetchAll}
              filenameBase="brands"
              title="Brands"
              description="Inventory brand master"
              metaLines={brandExportMetaLines(effectiveSearch, exportRange)}
              onRefresh={refresh}
              refreshing={brands.loading}
              disabled={total === 0}
              searchInputRef={searchInputRef}
            />
            {canWrite ? (
              <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>
                Import
              </Button>
            ) : null}
            {canWrite ? (
              <Button icon={Plus} onClick={openCreate} kbd="N">
                New brand
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid items-start gap-3 wide:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-3">
          <BrandsKpiGrid
            metrics={metrics.data}
            sales={salesData}
            loading={metrics.loading}
            error={metrics.error ? errorMessage(metrics.error) : null}
            onRetry={metrics.reload}
            brandNameOf={brandNameOf}
          />

          <BrandsToolbar
            state={filters}
            searchText={searchText}
            sortKey={sortKey}
            searchInputRef={searchInputRef}
            onSearchChange={setSearchText}
            onStatusChange={(v) => list.setFilter('status', v)}
            onCreatedChange={(v: CreatedPreset) =>
              list.setFilters(
                v === 'custom'
                  ? { created: v }
                  : { created: v, created_from: '', created_to: '' },
              )
            }
            onSortChange={(key: BrandSortKey) => list.setFilters(sortParamsOf(key))}
            onAdvancedChange={(patch) => list.setFilters(patch)}
            onClearAll={() => {
              setSearchText('')
              lastPushedSearch.current = ''
              list.reset()
            }}
            busy={brands.loading}
            actions={
              columnActions.length > 0 ? (
                <MenuButton
                  actions={columnActions}
                  icon={Columns3}
                  label="Choose columns"
                  variant="secondary"
                  size="md"
                  width={200}
                />
              ) : null
            }
          />

          <BrandsBulkBar
            count={selectedIds.size}
            canWrite={canWrite}
            canDelete={canDelete}
            busy={bulkBusy}
            onActivate={() => void bulkSetActive(true)}
            onDeactivate={() => void bulkSetActive(false)}
            onExport={() => {
              // Exactly the ticked rows, nothing widened behind the reader's
              // back, written by the app's own CSV writer so a description with
              // a quote or a leading `=` survives the trip into a spreadsheet —
              // hand-rolled quoting got that wrong (CSV doubles a quote, it
              // does not backslash it) and dropped the BOM Excel needs for
              // accented names.
              downloadCsv(
                csvFilename('brands-selected', companyName),
                toCsv(
                  selectedRows,
                  exportColumns.map((c) => ({ header: c.csvHeader, value: c.csv })),
                ),
              )
              toast.success(
                `${formatInt(selectedRows.length)} ${selectedRows.length === 1 ? 'brand' : 'brands'} exported`,
              )
            }}
            onDelete={() => {
              setDeleteError(null)
              setDeleting(selectedRows)
            }}
            onClear={() => setSelectedIds(new Set())}
          />

          <Card padding="none" className="overflow-hidden">
            <BrandsTable
              rows={rows}
              loading={brands.loading}
              error={
                brands.error
                  ? {
                      title: 'Unable to load brands',
                      description: errorMessage(brands.error),
                      onRetry: brands.reload,
                    }
                  : null
              }
              empty={
                isFiltered ? (
                  <BrandsNoResults
                    query={debouncedSearch}
                    onClearFilters={() => {
                      setSearchText('')
                      lastPushedSearch.current = ''
                      list.reset()
                    }}
                  />
                ) : (
                  <BrandsEmptyState
                    canWrite={canWrite}
                    onCreate={openCreate}
                    onImport={() => setImportOpen(true)}
                  />
                )
              }
              visibleColumns={visibleColumns}
              salesByBrand={salesByBrand}
              showSales={showSales}
              salesCurrencySymbol={salesSymbol}
              selectedIds={selectedIds}
              onToggleRow={toggleRow}
              onToggleAll={toggleAll}
              canWrite={canWrite}
              canDelete={canDelete}
              canAudit={canAudit}
              onOpen={setDetail}
              onEdit={openEdit}
              onDuplicate={openDuplicate}
              onToggleActive={(b) => void toggleActive(b)}
              onAudit={(b) => navigate(`/audit?entity_type=brand&entity_id=${b.brand_id}`)}
              onViewItems={(b) => navigate(`/items?brand_id=${b.brand_id}`)}
              onDelete={(b) => {
                setDeleteError(null)
                setDeleting([b])
              }}
              sort={{ key: list.state.sort, order: list.state.order }}
              onSort={list.toggleSort}
              keyboardResetKey={`${list.state.page}:${list.state.sort}:${list.state.order}`}
              searchInputRef={searchInputRef}
            />
          </Card>

          {total > 0 ? (
            <ServerTablePagination
              meta={brands.data?.meta ?? null}
              limit={list.state.limit}
              onPage={list.setPage}
              onLimit={list.setLimit}
              numbered
            />
          ) : null}
        </div>

        <BrandsInsightsRail
          suggestions={suggestions}
          insights={insights}
          loading={metrics.loading && !metrics.data}
          analyticsNote={salesData && !salesData.available ? brandSalesMessage(salesData.reason) : ''}
        />
      </div>

      <BrandFormDrawer
        open={form !== null}
        mode={form?.mode ?? 'create'}
        brand={form?.brand ?? null}
        initialValues={form?.values}
        readOnly={!canWrite}
        onClose={() => setForm(null)}
        onSubmit={submitForm}
      />

      <BrandDetailDrawer
        open={detail !== null}
        brand={detail}
        sale={detail ? (salesByBrand.get(detail.brand_id) ?? null) : null}
        salesCurrencySymbol={salesSymbol}
        salesConnected={Boolean(salesData?.available)}
        canWrite={canWrite}
        canAudit={canAudit}
        onClose={() => setDetail(null)}
        onEdit={openEdit}
      />

      <BrandsImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onCreate={(payload) => brandsApi.create(payload)}
        onImported={() => refresh()}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={deleting && deleting.length > 1 ? `Delete ${deleting.length} brands?` : 'Delete brand?'}
        message={
          <>
            <p style={{ margin: '0 0 0.5rem' }}>
              {deleting && deleting.length === 1 ? (
                <>
                  <strong>{deleting[0].brand_name}</strong> will be removed from every list and
                  picker.
                </>
              ) : (
                <>
                  <strong>{deleting?.length ?? 0} brands</strong> will be removed from every list and
                  picker.
                </>
              )}
            </p>
            <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
              Items that already carry {deleting && deleting.length === 1 ? 'it' : 'them'} keep
              working, and the API refuses the delete while a brand is still in use.
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

export default BrandsPage
