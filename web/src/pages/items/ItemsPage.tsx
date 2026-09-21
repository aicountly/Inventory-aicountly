import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Copy,
  MoreHorizontal,
  Package,
  PencilLine,
  Plus,
  ScrollText,
  SearchX,
  Trash2,
} from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ListSheetActions } from '../../components/ListSheetActions'
import { Notice } from '../../components/Notice'
import { useDebounce } from '../../hooks/useDebounce'
import { useFormOptions } from '../../hooks/useFormOptions'
import { MD_UP, XL_UP, useMediaQuery } from '../../hooks/useMediaQuery'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import { ConfigureColumns } from '../../registers/ConfigureColumns'
import { useColumnConfig } from '../../registers/useColumnConfig'
import { masterExportColumns } from '../../masters/exportColumns'
import { P } from '../../services/access'
import { errorMessage } from '../../services/api'
import type { ListQuery } from '../../services/api'
import { fetchAllRows } from '../../services/listAll'
import { itemsApi } from '../../services/items'
import type { ItemListQuery, ItemListRow } from '../../services/items'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { MenuButton } from '../../ui/MenuButton'
import type { MenuAction } from '../../ui/MenuButton'
import { ActiveBadge } from '../../ui/StatusBadge'
import { useToast } from '../../ui/ToastContext'
import { PageHeader } from '../../ui/shell/PageHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { SmartTable } from '../../ui/shell/SmartTable'
import type { SmartColumn } from '../../ui/shell/SmartTable'
import { ServerTablePagination } from '../../ui/shell/TablePagination'
import { formatDateTime, formatInt, formatMoney } from '../../utils/format'
import { itemsConfig } from './itemsConfig'
import { deriveInsights, trackingFlags } from './itemsModel'
import { ItemDetailDrawer } from './components/ItemDetailDrawer'
import { ItemIdentity } from './components/ItemIdentity'
import { ItemsBulkBar } from './components/ItemsBulkBar'
import { ItemsCardGrid } from './components/ItemsCardGrid'
import { ItemsCommandBar } from './components/ItemsCommandBar'
import { ItemsFilterBar, buildFilterSpecs, describeFilter } from './components/ItemsFilterBar'
import type { ItemsView } from './components/ItemsFilterBar'
import { ItemsInsightStrip } from './components/ItemsInsightStrip'
import { ItemsKpiStrip } from './components/ItemsKpiStrip'
import { StockQuantity } from './components/StockHealthBadge'

/** Server-side filters this screen keeps in the URL. */
const FILTER_KEYS = [
  'status',
  'stock_status',
  'item_type',
  'item_grp_id',
  'stock_cat_id',
  'brand_id',
  'unit_id',
  'valuation_method',
  'tracking',
  'has_hsn',
  'has_barcode',
  'has_sku',
] as const

const VIEW_KEY = 'inventory.items.view'
const COLUMN_KEY = 'items.list'

/**
 * What survives between `md` and `xl` — a laptop in a split window, a tablet in
 * landscape.
 *
 * Fifteen columns do not fit there, and the alternative to choosing is a table
 * whose last third is only reachable by dragging sideways: the reader stops
 * seeing the item name the moment they go looking for the quantity. These six
 * are what a stock controller scans a list FOR — which item, is it the right
 * one, how many, is it live, how stale. Everything dropped here is one click
 * away in the inspector, in full, and comes back by itself on a wide screen.
 */
const TABLET_COLUMNS = new Set(['item_name', 'item_sku', 'cat_name', 'on_hand', 'is_active', 'updated_at'])

/** Where the drawer's item id lives, so a reader can link straight to an item. */
const ITEM_PARAM = 'item'

function readView(): ItemsView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'table'
  } catch {
    // Private windows and blocked site data throw on read. The default view is
    // not worth failing a page render over.
    return 'table'
  }
}

/**
 * Items — the inventory command centre.
 *
 * WHAT CHANGED, AND WHY IT IS NOT A `MasterPage` ANY MORE. Every other master
 * in this app is a list of records that mean one thing each. An item means two:
 * what it IS (name, SKU, HSN, unit, tax attributes) and what there IS of it
 * (on hand, reserved, below reorder, below zero). The generic master screen can
 * only show the first, so the second was a column of numbers with nothing
 * saying which of them needed a decision. This screen answers both, and the
 * order of the page is the order of the questions: what do I have → what needs
 * attention → which ones → this one.
 *
 * WHAT IT DOES NOT DO. It never computes inventory. Quantities, availability,
 * cost layers and valuation are the posting engine's answers, rendered. It
 * never mutates a quantity: "Adjust stock" opens a stock journal, because a
 * quantity changed without a movement behind it is stock that exists in the
 * master and nowhere in the ledger. And it never asks for one row at a time —
 * the reorder thresholds behind every amber badge ride along in the list
 * response, so a page of 100 items is one request, not 101.
 */
export function ItemsPage() {
  const { scope } = useCompany()
  const { can, loading: accessLoading } = useAccess()
  const toast = useToast()
  const navigate = useNavigate()

  const canRead = can(P.masters('items', 'read'))
  const canWrite = can(P.masters('items', 'write'))
  const canDelete = can(P.masters('items', 'delete'))

  const list = useListParams({ sort: 'item_name', filterKeys: FILTER_KEYS })
  const [searchParams, setSearchParams] = useSearchParams()
  const { options, error: optionsError } = useFormOptions()
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  // ---- search: typed now, requested 300ms later ---------------------------
  const [searchInput, setSearchInput] = useState(list.state.q)
  const debouncedSearch = useDebounce(searchInput, 300)
  const listSetQ = list.setQ
  const urlQ = list.state.q
  useEffect(() => {
    if (debouncedSearch !== urlQ) listSetQ(debouncedSearch)
    // `urlQ` is deliberately out of the deps: including it would push the URL
    // back into the box and fight a reader who is still typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, listSetQ])
  // Back / forward and the KPI links change the URL without touching the box.
  useEffect(() => {
    setSearchInput((current) => (current === urlQ ? current : urlQ))
  }, [urlQ])

  // ---- view + columns (local UI preference, never another app's database) --
  /*
   * Below `md` the table is not offered at all, whatever the reader last chose:
   * fifteen columns scrolled sideways on a 390px screen is a table nobody reads.
   *
   * The choice is made HERE rather than with `hidden md:block`, because
   * `display:none` hides a subtree from the eye while leaving every node in the
   * document — the two layouts would both render, doubling the DOM on a
   * hundred-row page and making a screen reader announce the whole catalogue
   * twice.
   */
  const wideEnoughForTable = useMediaQuery(MD_UP)
  const roomForEveryColumn = useMediaQuery(XL_UP)
  const [view, setView] = useState<ItemsView>(readView)
  const effectiveView: ItemsView = wideEnoughForTable ? view : 'cards'
  const chooseView = useCallback((next: ItemsView) => {
    setView(next)
    try {
      window.localStorage.setItem(VIEW_KEY, next)
    } catch {
      // A remembered view is a convenience; losing it is not an error.
    }
  }, [])

  // ---- data ---------------------------------------------------------------
  const listQuery = useMemo<ItemListQuery>(
    () => ({ ...list.query, ...list.state.filters, with_stock: true }),
    [list.query, list.state.filters],
  )

  const query = useQuery(
    (signal) => itemsApi.list(listQuery, signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id, listQuery],
    { enabled: !!scope && canRead, resetKey: scope?.cmp_id ?? null },
  )

  /*
   * The counters, on their own request.
   *
   * Separate so it can fail alone: a summary endpoint that 500s must cost the
   * reader the KPI strip, not the item list underneath it. It drops `status`
   * and `stock_status` because those are the two things the cards themselves
   * switch on — a card that re-counted itself after being clicked would always
   * read "24 of 24".
   */
  const summaryQuery = useQuery(
    (signal) => {
      const { status: _s, stock_status: _ss, ...rest } = list.state.filters
      void _s
      void _ss
      return itemsApi.summary({ ...rest, q: list.state.q || undefined }, signal)
    },
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id, list.state.filters, list.state.q],
    { enabled: !!scope && canRead, resetKey: scope?.cmp_id ?? null },
  )

  const rows = useMemo(() => query.data?.data ?? [], [query.data])
  const insights = useMemo(() => deriveInsights(summaryQuery.data), [summaryQuery.data])

  // ---- selection ----------------------------------------------------------
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  // A filter or page change means the ticked rows are no longer on screen, and
  // acting on an invisible selection is how the wrong 40 items get deactivated.
  useEffect(() => {
    setSelected(new Set())
  }, [listQuery])

  const toggleOne = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.item_id))
  const someOnPage = rows.some((r) => selected.has(r.item_id))
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allOnPage) rows.forEach((r) => next.delete(r.item_id))
      else rows.forEach((r) => next.add(r.item_id))
      return next
    })
  }

  // ---- drawer, addressable by URL -----------------------------------------
  const openId = Number(searchParams.get(ITEM_PARAM) ?? 0) || null
  const drawerItem = useMemo(() => rows.find((r) => r.item_id === openId) ?? null, [rows, openId])

  const openItem = useCallback(
    (item: ItemListRow) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set(ITEM_PARAM, String(item.item_id))
          return next
        },
        // A real history entry: Back closes the drawer, which is what Back
        // means to someone who just opened one.
        { replace: false },
      )
    },
    [setSearchParams],
  )
  const closeDrawer = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete(ITEM_PARAM)
        return next
      },
      { replace: true },
    )
  }, [setSearchParams])

  // ---- delete -------------------------------------------------------------
  const [deleting, setDeleting] = useState<ItemListRow | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await itemsApi.remove(deleting.item_id)
      toast.success('Item deleted')
      setDeleting(null)
      closeDrawer()
      query.reload()
      summaryQuery.reload()
    } catch (err) {
      // The API refuses an item still referenced by a document or a BOM, and
      // says why. That reason is the answer — it is never swallowed.
      setDeleteError(errorMessage(err))
    } finally {
      setDeleteBusy(false)
    }
  }

  const confirmBulkDelete = async () => {
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const result = await itemsApi.bulkDelete([...selected])
      if (result.deleted.length > 0) toast.success(`${result.deleted.length} deleted`)
      if (result.skipped.length > 0) {
        // Partial outcomes are reported as partial. "17 deleted" over a request
        // for 20 is a report the reader would have to audit to catch.
        toast.error(`${result.skipped.length} could not be deleted: ${result.skipped[0]?.message ?? 'still in use'}`)
      }
      setBulkDeleting(false)
      setSelected(new Set())
      query.reload()
      summaryQuery.reload()
    } catch (err) {
      setDeleteError(errorMessage(err))
    } finally {
      setDeleteBusy(false)
    }
  }

  // ---- bulk status --------------------------------------------------------
  const setActive = async (active: boolean) => {
    setBulkBusy(true)
    try {
      const result = await itemsApi.bulkUpdate([...selected].map((item_id) => ({ item_id, is_active: active ? 1 : 0 })))
      toast.success(`${result.updated} ${result.updated === 1 ? 'item' : 'items'} ${active ? 'activated' : 'deactivated'}`)
      setSelected(new Set())
      query.reload()
      summaryQuery.reload()
    } catch (err) {
      toast.error(errorMessage(err, 'The items could not be updated.'))
    } finally {
      setBulkBusy(false)
    }
  }

  // ---- barcode / Enter in the search box ----------------------------------
  const lookupCode = useCallback(
    async (code: string) => {
      if (!code) return
      try {
        const found = await itemsApi.byBarcode(code)
        openItem(found)
      } catch {
        // Not a barcode, then — leave it as an ordinary search, which the
        // debounce has already applied.
        listSetQ(code)
        setSearchInput(code)
      }
    },
    [openItem, listSetQ],
  )

  // ---- export / print -----------------------------------------------------
  const columnConfig = useColumnConfig(COLUMN_KEY, itemsConfig.columns)
  const exportColumns = useMemo(() => masterExportColumns(columnConfig.visibleColumns), [columnConfig.visibleColumns])
  const exportQuery = useMemo<ListQuery>(() => listQuery as ListQuery, [listQuery])
  const fetchAll = useCallback(
    () => fetchAllRows<ItemListRow>((page, limit) => itemsApi.list({ ...exportQuery, page, limit })),
    [exportQuery],
  )
  const exportMeta = useMemo(() => {
    const lines: string[] = []
    if (list.state.q) lines.push(`Search: ${list.state.q}`)
    for (const spec of buildFilterSpecs(options)) {
      const value = list.state.filters[spec.name]
      if (value) lines.push(describeFilter(spec, value))
    }
    return lines
  }, [list.state.q, list.state.filters, options])

  // ---- columns ------------------------------------------------------------
  const rowActions = useCallback(
    (item: ItemListRow): MenuAction[] => [
      {
        key: 'open',
        label: 'Open details',
        icon: Package,
        onSelect: () => openItem(item),
      },
      {
        key: 'edit',
        label: canWrite ? 'Edit item' : 'View item',
        icon: PencilLine,
        onSelect: () => navigate(`/items/${item.item_id}`),
      },
      ...(can(P.report('stock_ledger'))
        ? [{ key: 'ledger', label: 'View stock ledger', icon: ScrollText, onSelect: () => navigate(`/registers/stock-ledger?item_id=${item.item_id}`) }]
        : []),
      ...(canWrite
        ? [{ key: 'duplicate', label: 'Duplicate', icon: Copy, separated: true, onSelect: () => navigate(`/items/new?from=${item.item_id}`) }]
        : []),
      ...(canDelete
        ? [{
            key: 'delete',
            label: 'Delete',
            icon: Trash2,
            danger: true,
            separated: true,
            onSelect: () => {
              setDeleteError(null)
              setDeleting(item)
            },
          }]
        : []),
    ],
    [canWrite, canDelete, can, navigate, openItem],
  )

  const columns = useMemo<SmartColumn<ItemListRow>[]>(() => {
    const byKey = new Set(columnConfig.visibleColumns.map((c) => c.key))
    // Two gates, both of which have to allow the column: what the reader chose,
    // and what the viewport can actually show.
    const optional = <T,>(key: string, col: T): T[] =>
      byKey.has(key) && (roomForEveryColumn || TABLET_COLUMNS.has(key)) ? [col] : []

    return [
      ...(canWrite || canDelete
        ? [{
            key: '__select',
            width: 40,
            headerClassName: 'pr-0',
            cellClassName: 'pr-0',
            header: (
              <input
                type="checkbox"
                checked={allOnPage}
                ref={(el) => {
                  // "Some of this page" is neither checked nor unchecked, and
                  // the tri-state is the only honest rendering of it.
                  if (el) el.indeterminate = !allOnPage && someOnPage
                }}
                onChange={toggleAll}
                aria-label={allOnPage ? 'Clear selection on this page' : 'Select every item on this page'}
                className="h-4 w-4 cursor-pointer rounded border-gray-300 text-primary focus:ring-primary/40"
              />
            ),
            render: (r: ItemListRow) => (
              <input
                type="checkbox"
                checked={selected.has(r.item_id)}
                onChange={() => toggleOne(r.item_id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Select ${r.item_name}`}
                className="h-4 w-4 cursor-pointer rounded border-gray-300 text-primary focus:ring-primary/40"
              />
            ),
          } as SmartColumn<ItemListRow>]
        : []),
      {
        key: 'item_name',
        header: 'Item',
        sortKey: 'item_name',
        minWidth: 220,
        render: (r) => <ItemIdentity item={r} onOpen={() => openItem(r)} />,
      },
      ...optional<SmartColumn<ItemListRow>>('item_sku', {
        key: 'item_sku',
        header: 'SKU',
        sortKey: 'item_sku',
        render: (r) => <span className="font-mono text-[11px]">{r.item_sku ?? '—'}</span>,
      }),
      ...optional<SmartColumn<ItemListRow>>('item_upc', {
        key: 'item_upc',
        header: 'Barcode',
        render: (r) => <span className="font-mono text-[11px]">{r.item_upc ?? '—'}</span>,
      }),
      ...optional<SmartColumn<ItemListRow>>('grp_name', { key: 'grp_name', header: 'Group', sortKey: 'grp_name', render: (r) => r.grp_name ?? '—' }),
      ...optional<SmartColumn<ItemListRow>>('cat_name', { key: 'cat_name', header: 'Category', render: (r) => r.cat_name ?? '—' }),
      ...optional<SmartColumn<ItemListRow>>('brand_name', { key: 'brand_name', header: 'Brand', render: (r) => r.brand_name ?? '—' }),
      ...optional<SmartColumn<ItemListRow>>('unit_symbol', { key: 'unit_symbol', header: 'Unit', render: (r) => r.unit_symbol ?? r.unit_name ?? '—' }),
      ...optional<SmartColumn<ItemListRow>>('hsn_sac', {
        key: 'hsn_sac',
        header: 'HSN',
        render: (r) => <span className="font-mono text-[11px]">{r.hsn_sac ?? '—'}</span>,
      }),
      ...optional<SmartColumn<ItemListRow>>('mrp', { key: 'mrp', header: 'MRP', align: 'right', sortKey: 'mrp', render: (r) => formatMoney(r.mrp) }),
      ...optional<SmartColumn<ItemListRow>>('valuation_method', { key: 'valuation_method', header: 'Valuation', render: (r) => r.valuation_method }),
      ...optional<SmartColumn<ItemListRow>>('tracking', {
        key: 'tracking',
        header: 'Tracking',
        render: (r) => {
          const flags = trackingFlags(r)
          return flags.length ? flags.join(', ') : <span className="text-gray-400">—</span>
        },
      }),
      {
        key: 'on_hand',
        header: 'On hand',
        align: 'right',
        // The API can order by the same aggregate it filters on.
        sortKey: 'on_hand',
        render: (r) => <StockQuantity item={r} />,
      },
      { key: 'is_active', header: 'Status', render: (r) => <ActiveBadge active={r.is_active} /> },
      ...optional<SmartColumn<ItemListRow>>('updated_at', {
        key: 'updated_at',
        header: 'Updated',
        sortKey: 'updated_at',
        render: (r) => <span className="whitespace-nowrap text-gray-500">{formatDateTime(r.updated_at)}</span>,
      }),
      {
        key: '__actions',
        header: '',
        width: 48,
        render: (r) => (
          <MenuButton actions={rowActions(r)} label={`Actions for ${r.item_name}`} icon={MoreHorizontal} size="xs" />
        ),
      },
    ]
  }, [columnConfig.visibleColumns, roomForEveryColumn, canWrite, canDelete, allOnPage, someOnPage, selected, toggleOne, openItem, rowActions])

  // ---- URLs the KPI cards and insights link to ----------------------------
  const hrefFor = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(searchParams)
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value)
        else next.delete(key)
      }
      next.delete('page')
      next.delete(ITEM_PARAM)
      const qs = next.toString()
      return qs ? `/items?${qs}` : '/items'
    },
    [searchParams],
  )

  const hasFilters = Boolean(list.state.q) || Object.keys(list.state.filters).length > 0

  if (!accessLoading && !canRead) {
    return (
      <PageShell>
        <PageHeader title="Items" description="Manage, monitor and understand your inventory items." icon={Package} />
        <Notice kind="warning">You do not have permission to view items in this company.</Notice>
      </PageShell>
    )
  }

  return (
    <PageShell fullBleed>
      <PageHeader
        title="Items"
        description="Manage, monitor and understand your inventory items."
        icon={Package}
        meta={
          query.data ? (
            <span className="text-xs text-gray-500">
              {formatInt(query.data.meta.total)} {query.data.meta.total === 1 ? 'item' : 'items'} in this view
            </span>
          ) : undefined
        }
        actions={
          <>
            <ListSheetActions<ItemListRow>
              columns={exportColumns}
              rows={rows}
              fetchAll={fetchAll}
              filenameBase="items"
              title="Items"
              metaLines={exportMeta}
              onRefresh={() => {
                query.reload()
                summaryQuery.reload()
              }}
              refreshing={query.loading}
              disabled={!query.data || query.data.meta.total === 0}
              searchInputRef={searchInputRef}
            />
            {canWrite ? (
              <Button variant="primary" icon={Plus} onClick={() => navigate('/items/new')}>
                New item
              </Button>
            ) : null}
          </>
        }
      />

      <ItemsCommandBar
        value={searchInput}
        onChange={setSearchInput}
        onSubmit={(value) => void lookupCode(value)}
        onScanned={(code) => void lookupCode(code)}
        inputRef={searchInputRef}
        busy={query.loading}
      />

      <ItemsInsightStrip insights={insights} loading={summaryQuery.loading} hrefFor={hrefFor} />

      <ItemsKpiStrip
        summary={summaryQuery.data}
        loading={summaryQuery.loading}
        hrefFor={hrefFor}
        activeStockStatus={list.state.filters.stock_status ?? ''}
        activeStatus={list.state.filters.status ?? ''}
      />

      {optionsError ? <Notice kind="warning">{optionsError}</Notice> : null}

      <ItemsFilterBar
        filters={list.state.filters}
        onChange={list.setFilter}
        onClearAll={list.reset}
        options={options}
        view={view}
        onView={chooseView}
        showViewSwitcher={wideEnoughForTable}
        trailing={
          effectiveView === 'table' && roomForEveryColumn ? (
            <ConfigureColumns
              columns={itemsConfig.columns}
              visibility={columnConfig.visibility}
              onChange={columnConfig.setVisibility}
              disabled={!columnConfig.ready}
              title="Item columns"
              description="Item, On hand and Status always stay. Your choice is remembered in this browser."
            />
          ) : null
        }
      />

      {effectiveView === 'table' ? (
        <SmartTable<ItemListRow>
          columns={columns}
          rows={rows}
          rowKey="item_id"
          loading={query.loading}
          error={
            query.error
              ? { title: 'Items could not be loaded', description: query.error.message, onRetry: query.reload }
              : null
          }
          empty={
            hasFilters ? (
              <EmptyState
                size="sm"
                icon={SearchX}
                title="No items match these filters"
                description="Try a broader search, or clear the filters to see the whole catalogue."
                action={<Button variant="secondary" onClick={list.reset}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                icon={Package}
                title="No items yet"
                description="Create your first inventory item to start tracking stock, valuation and movement."
                action={
                  canWrite ? (
                    <Button variant="primary" icon={Plus} onClick={() => navigate('/items/new')}>
                      Create item
                    </Button>
                  ) : undefined
                }
              />
            )
          }
          onRowActivate={openItem}
          activateOnSingleClick
          keyboardResetKey={`${listQuery.page}-${columnConfig.columnsKey}`}
          searchInputRef={searchInputRef}
          stickyHeader
          scrollBody
          minWidth={roomForEveryColumn ? 1180 : 680}
          size="xs"
          footer={
            <ServerTablePagination
              meta={query.data?.meta ?? null}
              limit={list.state.limit}
              onPage={list.setPage}
              onLimit={list.setLimit}
              numbered
            />
          }
        />
      ) : null}

      {effectiveView === 'cards' ? (
        <div>
          {query.error ? (
          <Notice kind="error">
            {errorMessage(query.error, 'Items could not be loaded.')}{' '}
            <button type="button" onClick={query.reload} className="font-semibold underline">
              Retry
            </button>
          </Notice>
        ) : rows.length === 0 && !query.loading ? (
          <EmptyState
            icon={hasFilters ? SearchX : Package}
            title={hasFilters ? 'No items match these filters' : 'No items yet'}
            description={
              hasFilters
                ? 'Try a broader search, or clear the filters to see the whole catalogue.'
                : 'Create your first inventory item to start tracking stock, valuation and movement.'
            }
            action={
              hasFilters ? (
                <Button variant="secondary" onClick={list.reset}>Clear filters</Button>
              ) : canWrite ? (
                <Button variant="primary" icon={Plus} onClick={() => navigate('/items/new')}>Create item</Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-2.5">
            <ItemsCardGrid
              rows={rows}
              selected={selected}
              onToggle={toggleOne}
              onOpen={openItem}
              actionsFor={rowActions}
              selectable={canWrite || canDelete}
            />
            <ServerTablePagination
              meta={query.data?.meta ?? null}
              limit={list.state.limit}
              onPage={list.setPage}
              onLimit={list.setLimit}
            />
            </div>
          )}
        </div>
      ) : null}

      <ItemsBulkBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        onActivate={() => void setActive(true)}
        onDeactivate={() => void setActive(false)}
        onExport={() => toast.info('Use Export in the header — it writes every row matching the current filters.')}
        onDelete={() => {
          setDeleteError(null)
          setBulkDeleting(true)
        }}
        busy={bulkBusy}
        canWrite={canWrite}
        canDelete={canDelete}
        canExport
      />

      <ItemDetailDrawer
        item={drawerItem}
        onClose={closeDrawer}
        onDelete={(item) => {
          setDeleteError(null)
          setDeleting(item)
        }}
        onDuplicate={(item) => navigate(`/items/new?from=${item.item_id}`)}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete item?"
        message={
          <>
            <p className="mb-2">
              <strong>{deleting?.item_name}</strong> will be removed from every list and dropdown.
            </p>
            <p className="text-xs text-gray-500">
              Items used on documents or bills of materials cannot be deleted — deactivate them
              instead. Stock already posted against this item is not affected.
            </p>
          </>
        }
        confirmLabel="Delete item"
        danger
        busy={deleteBusy}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => !deleteBusy && setDeleting(null)}
      />

      <ConfirmDialog
        open={bulkDeleting}
        title={`Delete ${selected.size} ${selected.size === 1 ? 'item' : 'items'}?`}
        message={
          <>
            <p className="mb-2">
              {selected.size} {selected.size === 1 ? 'item' : 'items'} will be removed from every
              list and dropdown.
            </p>
            <p className="text-xs text-gray-500">
              Any item still used on a document or a bill of materials is skipped and reported back
              — the rest are deleted.
            </p>
          </>
        }
        confirmLabel={`Delete ${selected.size}`}
        danger
        busy={deleteBusy}
        error={deleteError}
        onConfirm={confirmBulkDelete}
        onCancel={() => !deleteBusy && setBulkDeleting(false)}
      />
    </PageShell>
  )
}
