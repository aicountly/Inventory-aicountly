import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Boxes,
  Copy,
  Eye,
  History,
  MoreVertical,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  ScanLine,
  Trash2,
  Upload,
  Warehouse as WarehouseIcon,
  XCircle,
} from 'lucide-react'
import { useAccess } from '../../../access/AccessContext'
import { useCompany } from '../../../company/CompanyContext'
import { useScopeLabel } from '../../../company/useScopeLabel'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { Notice } from '../../../components/Notice'
import { RequirePermission } from '../../../components/RequirePermission'
import { ExportActions } from '../../../export/ExportActions'
import { exportRegisterCsv, slugifyExportFilename } from '../../../export/exportActions'
import { useExportIdentity } from '../../../export/useExportIdentity'
import { useDebounce } from '../../../hooks/useDebounce'
import { useDocumentTitle } from '../../../hooks/useDocumentTitle'
import { useFormOptions, invalidateFormOptions } from '../../../hooks/useFormOptions'
import { useListParams } from '../../../hooks/useListParams'
import { useQuery } from '../../../hooks/useQuery'
import { usePageKeyboard } from '../../../keyboard/usePageKeyboard'
import type { ExportableColumn } from '../../../registers/registerCells'
import { P } from '../../../services/access'
import { errorMessage } from '../../../services/api'
import { batchWorkspaceApi } from '../../../services/batchesApi'
import type { BatchFilters as BatchApiFilters, BatchHealth } from '../../../services/batchesApi'
import { fetchAllRows } from '../../../services/listAll'
import { batchesApi } from '../../../services/masters'
import type { Batch, BatchStatus } from '../../../services/masters'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { EmptyState } from '../../../ui/EmptyState'
import { MenuButton } from '../../../ui/MenuButton'
import type { MenuAction } from '../../../ui/MenuButton'
import { Tooltip } from '../../../ui/Tooltip'
import { AIC, cx } from '../../../ui/cx'
import { notify } from '../../../ui/notify'
import { BreadcrumbHeader } from '../../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../../ui/shell/PageShell'
import { SmartTable } from '../../../ui/shell/SmartTable'
import type { SmartColumn } from '../../../ui/shell/SmartTable'
import { ServerTablePagination } from '../../../ui/shell/TablePagination'
import { useToast } from '../../../ui/ToastContext'
import { copyText } from '../../../utils/clipboard'
import { formatDate, formatInt, formatQty, humanize, todayIso } from '../../../utils/format'
import { statusBadgeLabel } from '../../../ui/StatusBadge'
import { BatchAnalyticsRail } from './BatchAnalyticsRail'
import { BatchBulkBar } from './BatchBulkBar'
import { BatchDetailsDrawer } from './BatchDetailsDrawer'
import { BATCH_FILTER_KEYS, BatchFilters } from './BatchFilters'
import { BatchFormDialog } from './BatchFormDialog'
import type { BatchFormMode } from './BatchFormDialog'
import { BatchHero } from './BatchHero'
import { BatchImportDrawer } from './BatchImportDrawer'
import { BatchKpiCards } from './BatchKpiCards'
import { BatchScanDialog } from './BatchScanDialog'
import { printBatchLabels } from './batchLabels'
import {
  DEFAULT_NEAR_EXPIRY_DAYS,
  batchStatusChip,
  daysUntil,
  expiryNote,
  itemInitials,
  itemSubtitle,
  resolveExpiryPreset,
  warehouseLabel,
} from './batchPresentation'

/**
 * Masters › Batches — the batch workspace.
 *
 * One screen over one API. Every figure above the table, every row in it and
 * every legend entry in the rail comes from a live request to `/v1/batches`
 * scoped to the selected company, branch and financial year; nothing is
 * mirrored into another store, nothing is synchronised on a schedule, and
 * nothing survives a context switch (the queries carry the scope in their
 * `resetKey`, so the previous company's rows never sit under the new
 * company's name for even one frame).
 *
 * The division of labour with the server is deliberate and absolute:
 *
 *  - Paging, filtering, sorting and counting are the database's work. The
 *    browser holds one page. A master that will hold six figures of rows cannot
 *    be totalled in a loop over an array.
 *  - The KPI strip and the rail read `/v1/batches/summary`, keyed on the
 *    FILTERS and not the page, so turning to page four neither moves the
 *    figures nor pays for the scan again.
 *  - Expiry health is derived for display only — from the same rule the API
 *    uses, so a `?health=expiring` list and the badges on its rows agree — and
 *    is never written anywhere.
 *
 * Filters live in the URL, so the screen is a link: `?health=expired&
 * warehouse_id=3` is a complete, shareable description of what is on it.
 */

const SEARCH_DEBOUNCE_MS = 350

/** The sheet's columns — the table's, in the table's order. */
const EXPORT_COLUMNS: ExportableColumn<Batch>[] = [
  { key: 'batch_no', csvHeader: 'Batch' },
  { key: 'item_name', csvHeader: 'Item', csv: (r) => r.item_name ?? `#${r.item_id}` },
  { key: 'item_sku', csvHeader: 'SKU', csv: (r) => r.item_sku ?? '' },
  { key: 'category', csvHeader: 'Category', csv: (r) => r.stock_category_name ?? '' },
  { key: 'lot_no', csvHeader: 'Lot', csv: (r) => r.lot_no ?? '' },
  { key: 'mfg_date', csvHeader: 'Manufactured', format: 'date' },
  { key: 'expiry_date', csvHeader: 'Expires', format: 'date' },
  { key: 'on_hand', csvHeader: 'On hand', align: 'right', format: 'qty', csv: (r) => r.stock?.on_hand ?? '' },
  { key: 'unit_symbol', csvHeader: 'Unit', csv: (r) => r.unit_symbol ?? '' },
  {
    key: 'warehouse',
    csvHeader: 'Warehouse',
    csv: (r) => {
      const where = warehouseLabel(r)
      return where ? `${where.name}${where.extra > 0 ? ` +${where.extra} more` : ''}` : ''
    },
  },
  // The badge reads "Quarantine"; the sheet must not read `quarantine` under
  // the same header.
  { key: 'status', csvHeader: 'Status', csv: (r) => statusBadgeLabel(r.status) },
]

function Dash() {
  return <span className="text-gray-300">—</span>
}

export function BatchesPage() {
  const { scope, companyName, fy, branch } = useCompany()
  const { can, loading: accessLoading } = useAccess()
  const toast = useToast()
  const exportIdentity = useExportIdentity()
  const scopeLabel = useScopeLabel()
  useDocumentTitle('Batches | Aicountly Inventory')

  const canRead = can(P.masters('batches', 'read'))
  const canWrite = can(P.masters('batches', 'write'))
  const canDelete = can(P.masters('batches', 'delete'))

  const params = useListParams({
    sort: 'batch_no',
    order: 'asc',
    limit: 50,
    filterKeys: BATCH_FILTER_KEYS,
  })
  const { state } = params
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const printRef = useRef<(() => void) | null>(null)
  const today = todayIso()

  /* -- search: typed locally, committed to the URL once it settles ---------- */
  const [searchDraft, setSearchDraft] = useState(state.q)
  const debouncedSearch = useDebounce(searchDraft, SEARCH_DEBOUNCE_MS)
  useEffect(() => {
    setSearchDraft(state.q)
  }, [state.q])
  useEffect(() => {
    if (debouncedSearch !== state.q) params.setQ(debouncedSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the settled value may commit
  }, [debouncedSearch])

  const formOptions = useFormOptions()

  /*
   * The URL's vocabulary → the API's.
   *
   * `warehouse_id` does two jobs on purpose: it restricts the rows to batches
   * recorded in that warehouse AND narrows the on-hand figures to it, because a
   * reader who picked a warehouse means both. The preset in `expiry` resolves
   * to a real date range here rather than being sent as a word the API would
   * have to interpret.
   */
  const apiFilters = useMemo<BatchApiFilters>(() => {
    const f = state.filters
    const warehouse = f.warehouse_id || ''
    return {
      q: state.q || undefined,
      status: f.status || undefined,
      health: f.health || undefined,
      item_id: f.item_id || undefined,
      item_grp_id: f.item_grp_id || undefined,
      stock_cat_id: f.stock_cat_id || undefined,
      brand_id: f.brand_id || undefined,
      lot_no: f.lot_no || undefined,
      mfg_from: f.mfg_from || undefined,
      mfg_to: f.mfg_to || undefined,
      stock: (f.stock as 'with' | 'zero' | undefined) || undefined,
      in_warehouse_id: warehouse || undefined,
      warehouse_id: warehouse || undefined,
      ...resolveExpiryPreset(f.expiry ?? '', today),
      ...(f.expiry_from ? { expiry_from: f.expiry_from } : {}),
      ...(f.expiry_to ? { expiry_to: f.expiry_to } : {}),
      with_stock: 1,
    }
  }, [state.filters, state.q, today])

  const listQuery = useMemo<BatchApiFilters>(
    () => ({ ...apiFilters, page: state.page, limit: state.limit, sort: state.sort, order: state.order }),
    [apiFilters, state.page, state.limit, state.sort, state.order],
  )

  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null
  const listKey = JSON.stringify(listQuery)
  const filterKey = JSON.stringify(apiFilters)

  const list = useQuery((signal) => batchWorkspaceApi.list(listQuery, signal), [listKey, scopeKey], {
    enabled: scope !== null && canRead,
    resetKey: scopeKey,
  })

  /* The figures are keyed on the FILTERS, never on the page. */
  const summary = useQuery(
    (signal) => batchWorkspaceApi.summary(apiFilters, signal),
    [filterKey, scopeKey],
    { enabled: scope !== null && canRead, resetKey: scopeKey },
  )

  const rows = useMemo(() => list.data?.data ?? [], [list.data])
  const nearExpiryDays = summary.data?.near_expiry_days ?? DEFAULT_NEAR_EXPIRY_DAYS

  const refresh = useCallback(() => {
    list.reload()
    summary.reload()
  }, [list, summary])

  // ---- selection ----------------------------------------------------------
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  // A selection is about the rows in front of the reader; a new page, a new
  // filter or a context switch is a different set of rows.
  useEffect(() => {
    setSelected(new Set())
  }, [listKey, scopeKey])

  const toggleRow = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.batch_id))
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.batch_id)), [rows, selected])

  // ---- panels -------------------------------------------------------------
  const [detail, setDetail] = useState<Batch | null>(null)
  const [form, setForm] = useState<{ mode: BatchFormMode; row: Batch | null } | null>(null)
  const [scanning, setScanning] = useState(false)
  const [importing, setImporting] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<BatchStatus | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [deleting, setDeleting] = useState<Batch | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const openCreate = useCallback(() => {
    if (!canWrite) return
    setForm({ mode: 'create', row: null })
  }, [canWrite])

  /*
   * `?new=1` opens the create form on arrival — the masters landing page's
   * Quick Create menu links here. The flag is consumed on arrival so a reload
   * or a Back does not reopen it, and it waits for access to load, because
   * `can()` answers false while permissions are in flight.
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
    if (canWrite) setForm({ mode: 'create', row: null })
  }, [createRequested, accessLoading, canWrite, setSearchParams])

  usePageKeyboard({
    searchInputRef,
    onRefresh: refresh,
    onPrint: () => printRef.current?.(),
    onNew: canWrite ? openCreate : undefined,
  })

  // ---- filters ------------------------------------------------------------
  const setFilter = useCallback((key: string, value: string) => params.setFilter(key, value), [params])
  const setFilters = useCallback((patch: Record<string, string>) => params.setFilters(patch), [params])
  const clearFilters = useCallback(() => {
    params.setFilters({ ...Object.fromEntries(BATCH_FILTER_KEYS.map((k) => [k, ''])), q: '' })
    setSearchDraft('')
  }, [params])

  /** The current URL with `health` replaced — what the KPI cards link to. */
  const healthLink = useCallback(
    (health: BatchHealth | '') => {
      const next = new URLSearchParams(searchParams)
      if (health) next.set('health', health)
      else next.delete('health')
      next.delete('page')
      const qs = next.toString()
      return `/masters/batches${qs ? `?${qs}` : ''}`
    },
    [searchParams],
  )

  const copy = useCallback(async (value: string, what: string) => {
    const ok = await copyText(value)
    if (ok) notify.success(`${what} copied`)
    else notify.error(`Could not copy the ${what.toLowerCase()}`)
  }, [])

  // ---- export -------------------------------------------------------------
  const metaLines = useMemo(() => {
    const f = state.filters
    const warehouse = (formOptions.options?.warehouses ?? []).find(
      (w) => String(w.warehouse_id) === f.warehouse_id,
    )
    return [
      state.q ? `Search: ${state.q}` : '',
      f.status ? `Status: ${humanize(f.status)}` : '',
      f.health ? `Expiry health: ${humanize(f.health)}` : '',
      warehouse ? `Warehouse: ${warehouse.warehouse_name}` : f.warehouse_id ? `Warehouse #${f.warehouse_id}` : '',
      f.item_id ? `Item #${f.item_id}` : '',
      f.lot_no ? `Lot: ${f.lot_no}` : '',
      f.expiry_from || f.expiry_to ? `Expires between: ${f.expiry_from || '…'} and ${f.expiry_to || '…'}` : '',
      f.stock === 'with' ? 'On hand above zero' : f.stock === 'zero' ? 'Zero on hand' : '',
      `Sorted by: ${humanize(state.sort)} ${state.order === 'desc' ? 'descending' : 'ascending'}`,
    ].filter(Boolean)
  }, [state.q, state.filters, state.sort, state.order, formOptions.options])

  const summaryCards = useMemo(() => {
    const s = summary.data
    if (!s) return undefined
    return [
      { label: 'Total batches', value: formatInt(s.total) },
      { label: 'Active', value: formatInt(s.active) },
      { label: 'Expiring soon', value: formatInt(s.expiring_soon), tone: 'warn' as const },
      { label: 'Expired', value: formatInt(s.expired), tone: 'credit' as const },
      { label: 'On hand', value: formatQty(s.total_on_hand, '0') },
    ]
  }, [summary.data])

  const fetchAll = useCallback(
    () => fetchAllRows<Batch>((page, limit) => batchWorkspaceApi.list({ ...apiFilters, page, limit, sort: state.sort, order: state.order })),
    [apiFilters, state.sort, state.order],
  )

  const exportFilename = slugifyExportFilename(['batches', companyName, today])

  /** The rail's one-click export: the whole filtered set, as CSV. */
  const quickExport = useCallback(async () => {
    try {
      const all = await fetchAll()
      await exportRegisterCsv<Batch>({
        columns: EXPORT_COLUMNS,
        rows: all.rows,
        identity: exportIdentity,
        title: 'Batches',
        metaLines,
        filenameBase: exportFilename,
        partial: all.truncated ? { exported: all.rows.length, total: all.total } : undefined,
      })
    } catch (err) {
      notify.error(errorMessage(err, 'The batches could not be exported.'))
    }
  }, [exportFilename, exportIdentity, fetchAll, metaLines])

  // ---- labels -------------------------------------------------------------
  const printLabels = useCallback(
    (batches: readonly Batch[]) => {
      if (batches.length === 0) {
        notify.info('Nothing to label.')
        return
      }
      const ok = printBatchLabels({
        batches,
        identity: exportIdentity,
        scopeNote: metaLines.join(' · ') || undefined,
      })
      if (!ok) notify.error('The label sheet could not be opened. Check the browser’s popup settings.')
    },
    [exportIdentity, metaLines],
  )

  // ---- bulk status --------------------------------------------------------
  const applyBulkStatus = useCallback(async () => {
    if (!pendingStatus) return
    setBulkBusy(true)
    try {
      const result = await batchWorkspaceApi.bulkStatus([...selected], pendingStatus)
      toast.success(
        result.updated === 0
          ? `Every selected batch was already ${humanize(pendingStatus).toLowerCase()}.`
          : `${formatInt(result.updated)} batch${result.updated === 1 ? '' : 'es'} marked ${humanize(pendingStatus).toLowerCase()}.`,
      )
      setPendingStatus(null)
      setSelected(new Set())
      refresh()
    } catch (err) {
      notify.error(errorMessage(err, 'The batches could not be updated.'))
    } finally {
      setBulkBusy(false)
    }
  }, [pendingStatus, refresh, selected, toast])

  // ---- delete -------------------------------------------------------------
  const confirmDelete = useCallback(async () => {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await batchesApi.remove(deleting.batch_id)
      toast.success('Batch deleted.')
      setDeleting(null)
      setDetail(null)
      refresh()
    } catch (err) {
      setDeleteError(errorMessage(err))
    } finally {
      setDeleteBusy(false)
    }
  }, [deleting, refresh, toast])

  const afterSave = useCallback(
    (saved: Batch, mode: BatchFormMode) => {
      setForm(null)
      // A new batch changes the dropdowns the document editors read.
      invalidateFormOptions()
      refresh()
      if (mode === 'edit') setDetail((d) => (d && d.batch_id === saved.batch_id ? { ...d, ...saved } : d))
    },
    [refresh],
  )

  // ---- columns ------------------------------------------------------------
  const columns = useMemo<SmartColumn<Batch>[]>(
    () => [
      {
        key: '__select',
        width: 34,
        alwaysVisible: true,
        headerClassName: 'print:hidden',
        cellClassName: 'print:hidden',
        header: (
          <input
            type="checkbox"
            className="h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))]"
            checked={allOnPageSelected}
            onChange={() =>
              setSelected(allOnPageSelected ? new Set() : new Set(rows.map((r) => r.batch_id)))
            }
            aria-label="Select every batch on this page"
          />
        ),
        render: (r) => (
          <input
            type="checkbox"
            className="h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))]"
            checked={selected.has(r.batch_id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleRow(r.batch_id)}
            aria-label={`Select batch ${r.batch_no}`}
          />
        ),
      },
      {
        key: 'batch_no',
        header: 'Batch',
        sortKey: 'batch_no',
        minWidth: 150,
        render: (r) => (
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setDetail(r)
              }}
              className="truncate font-mono text-[12px] font-bold text-gray-900 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              {r.batch_no}
            </button>
            <Tooltip label="Print a label with this batch’s barcode">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  printLabels([r])
                }}
                aria-label={`Print a label for batch ${r.batch_no}`}
                className="rounded p-0.5 text-gray-300 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 print:hidden"
              >
                <ScanLine className="h-3.5 w-3.5" aria-hidden />
              </button>
            </Tooltip>
          </span>
        ),
      },
      {
        key: 'item_name',
        header: 'Item',
        sortKey: 'item_name',
        minWidth: 200,
        render: (r) => {
          const subtitle = itemSubtitle(r)
          return (
            <span className="flex items-center gap-2">
              {/* Items carry no image in this API, so a tile of initials
                  stands in rather than a broken <img> or a stock photo. */}
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-gray-200 bg-gray-50 text-[10px] font-bold text-gray-500"
                aria-hidden
              >
                {itemInitials(r.item_name)}
              </span>
              <span className="min-w-0">
                <span className="block max-w-[15rem] truncate text-[12px] font-semibold text-gray-900">
                  {r.item_name ?? `Item #${r.item_id}`}
                </span>
                {subtitle ? (
                  <span className="block max-w-[15rem] truncate text-[10px] text-gray-500">{subtitle}</span>
                ) : null}
              </span>
            </span>
          )
        },
      },
      {
        key: 'lot_no',
        header: 'Lot',
        sortKey: 'lot_no',
        minWidth: 110,
        render: (r) =>
          r.lot_no ? (
            <Tooltip label="Copy lot number">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void copy(r.lot_no as string, 'Lot number')
                }}
                className="inline-flex items-center gap-1 font-mono text-[11px] text-gray-600 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                {r.lot_no}
                <Copy className="h-3 w-3 shrink-0 opacity-40" aria-hidden />
              </button>
            </Tooltip>
          ) : (
            <Dash />
          ),
      },
      {
        key: 'mfg_date',
        header: 'Manufactured',
        sortKey: 'mfg_date',
        minWidth: 116,
        render: (r) => <span className="whitespace-nowrap">{formatDate(r.mfg_date)}</span>,
      },
      {
        key: 'expiry_date',
        header: 'Expires',
        sortKey: 'expiry_date',
        minWidth: 124,
        render: (r) => {
          const days = daysUntil(r.expiry_date, today)
          if (!r.expiry_date) return <Dash />
          return (
            <span className="whitespace-nowrap">
              {formatDate(r.expiry_date)}
              {days !== null ? (
                <span
                  className={cx(
                    'block text-[10px] font-medium',
                    days < 0
                      ? 'text-red-600'
                      : days <= nearExpiryDays
                        ? 'text-amber-600'
                        : 'text-gray-400',
                  )}
                >
                  {expiryNote(days)}
                </span>
              ) : null}
            </span>
          )
        },
      },
      {
        key: 'on_hand',
        header: 'On hand',
        sortKey: 'on_hand',
        align: 'right',
        minWidth: 108,
        render: (r) => {
          if (!r.stock) return <Dash />
          const zero = Number(r.stock.on_hand) === 0
          return (
            // A zero-stock batch is history, not a mistake: it recedes rather
            // than disappearing, because its traceability still matters.
            <span className={cx('whitespace-nowrap', zero && 'text-gray-400')}>
              <strong className={cx('tabular-nums', zero ? 'font-medium' : 'font-semibold text-gray-900')}>
                {formatQty(r.stock.on_hand)}
              </strong>
              {r.unit_symbol ? <span className="ml-1 text-[10px] text-gray-500">{r.unit_symbol}</span> : null}
            </span>
          )
        },
      },
      {
        key: 'warehouse',
        header: 'Warehouse',
        minWidth: 150,
        render: (r) => {
          const where = warehouseLabel(r)
          if (!where) return <Dash />
          return (
            <span className="flex items-center gap-1.5">
              <WarehouseIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
              <span className="min-w-0 truncate text-[12px]">{where.name}</span>
              {where.extra > 0 ? (
                <Tooltip label={`In ${where.extra + 1} warehouses. Open the batch to see each one.`}>
                  <span className="shrink-0 rounded-full bg-gray-100 px-1.5 text-[10px] font-semibold text-gray-500">
                    +{where.extra}
                  </span>
                </Tooltip>
              ) : null}
            </span>
          )
        },
      },
      {
        key: 'status',
        header: 'Status',
        sortKey: 'status',
        minWidth: 128,
        render: (r) => {
          const chip = batchStatusChip(r, today, nearExpiryDays)
          return (
            <Badge tone={chip.tone} size="xs" dot className="normal-case">
              {chip.label}
              {/* Expiry is never colour alone: the exact state is read out. */}
              <span className="sr-only"> — {chip.srText}</span>
            </Badge>
          )
        },
      },
      {
        key: '__actions',
        header: '',
        align: 'right',
        width: 104,
        headerClassName: 'print:hidden',
        cellClassName: 'print:hidden',
        render: (r) => {
          const actions: MenuAction[] = [
            { key: 'view', label: 'View batch', icon: Eye, onSelect: () => setDetail(r) },
            {
              key: 'movements',
              label: 'View movements',
              icon: History,
              onSelect: () => window.open(`/registers/movement-register?batch_id=${r.batch_id}`, '_self'),
            },
            { key: 'label', label: 'Print label', icon: Printer, separated: true, onSelect: () => printLabels([r]) },
            {
              key: 'copy',
              label: 'Copy batch number',
              icon: Copy,
              onSelect: () => void copy(r.batch_no, 'Batch number'),
            },
          ]
          if (canWrite) {
            actions.push({
              key: 'edit',
              label: 'Edit batch',
              icon: Pencil,
              separated: true,
              onSelect: () => setForm({ mode: 'edit', row: r }),
            })
            if (String(r.status).toLowerCase() !== 'closed') {
              actions.push({
                key: 'close',
                label: 'Close batch',
                icon: XCircle,
                onSelect: () => {
                  setSelected(new Set([r.batch_id]))
                  setPendingStatus('closed')
                },
              })
            }
          }
          if (canDelete) {
            actions.push({
              key: 'delete',
              label: 'Delete batch',
              icon: Trash2,
              danger: true,
              separated: true,
              onSelect: () => {
                setDeleteError(null)
                setDeleting(r)
              },
            })
          }
          return (
            // The row opens on a single click, so the controls inside it must
            // not also open it on the way past.
            <span
              className="flex items-center justify-end gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <Tooltip label="View batch">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDetail(r)
                  }}
                  aria-label={`View batch ${r.batch_no}`}
                  className="grid h-7 w-7 place-items-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <Eye className="h-4 w-4" aria-hidden />
                </button>
              </Tooltip>
              {canWrite ? (
                <Tooltip label="Edit batch">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setForm({ mode: 'edit', row: r })
                    }}
                    aria-label={`Edit batch ${r.batch_no}`}
                    className="grid h-7 w-7 place-items-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </button>
                </Tooltip>
              ) : null}
              <MenuButton label={`More actions for batch ${r.batch_no}`} icon={MoreVertical} actions={actions} width={210} />
            </span>
          )
        },
      },
    ],
    [allOnPageSelected, canDelete, canWrite, copy, nearExpiryDays, printLabels, rows, selected, today, toggleRow],
  )

  const filtersActive = state.q !== '' || BATCH_FILTER_KEYS.some((k) => (state.filters[k] ?? '') !== '')

  const headerActions = (
    <>
      {canWrite ? (
        <Button variant="secondary" size="sm" icon={Upload} onClick={() => setImporting(true)}>
          Import
        </Button>
      ) : null}
      <ExportActions<Batch>
        columns={EXPORT_COLUMNS}
        rows={rows}
        fetchAll={fetchAll}
        filename={exportFilename}
        identity={exportIdentity}
        title="Batches"
        description="Batch-wise stock, expiry and traceability"
        metaLines={metaLines}
        summaryCards={summaryCards}
        onRefresh={refresh}
        refreshing={list.loading}
        disabled={!list.data || list.data.meta.total === 0}
        printRef={printRef}
        size="sm"
      />
      {canWrite ? (
        <Button size="sm" icon={Plus} onClick={openCreate} kbd="Ctrl N">
          New batch
        </Button>
      ) : null}
    </>
  )

  return (
    <PageShell fullBleed>
      <BreadcrumbHeader
        compact
        breadcrumbs={[{ label: 'Masters', to: '/masters' }, { label: 'Batches' }]}
        title="Batches"
        escBack={false}
        actions={headerActions}
      />

      <BatchHero />

      <RequirePermission permission={P.masters('batches', 'read')} what="batches">
        <BatchKpiCards
          summary={summary.data}
          loading={summary.loading}
          error={summary.error}
          onRetry={summary.reload}
          healthLink={healthLink}
          activeHealth={state.filters.health ?? ''}
        />

        <div className="grid min-w-0 grid-cols-1 gap-3 wide:grid-cols-[minmax(0,1fr)_17rem] ultra:grid-cols-[minmax(0,1fr)_18.5rem]">
          <main className="min-w-0">
            <Card padding="none" className="overflow-hidden">
              <BatchFilters
                filters={state.filters}
                onSet={setFilter}
                onSetMany={setFilters}
                onClear={clearFilters}
                search={searchDraft}
                onSearchChange={setSearchDraft}
                options={formOptions.options}
                searchInputRef={searchInputRef}
              />

              <BatchBulkBar
                count={selected.size}
                onChangeStatus={(s) => setPendingStatus(s)}
                onPrintLabels={() => printLabels(selectedRows)}
                onExport={() =>
                  void exportRegisterCsv<Batch>({
                    columns: EXPORT_COLUMNS,
                    rows: selectedRows,
                    identity: exportIdentity,
                    title: 'Batches — selection',
                    metaLines: [`Selection: ${formatInt(selectedRows.length)} of the batches on this page`, ...metaLines],
                    filenameBase: `${exportFilename}-selection`,
                  })
                }
                onClear={() => setSelected(new Set())}
                canWrite={canWrite}
                canPrint={canRead}
                busy={bulkBusy}
              />

              {list.error && rows.length > 0 ? (
                <Notice
                  kind="warning"
                  className="m-3"
                  title="Showing the last result that loaded."
                  actions={
                    <Button variant="secondary" size="xs" onClick={list.reload}>
                      Retry
                    </Button>
                  }
                >
                  The batches could not be refreshed.
                </Notice>
              ) : null}

              <SmartTable<Batch>
                columns={columns}
                rows={rows}
                rowKey={(r) => r.batch_id}
                loading={list.loading}
                cardPadding="none"
                className="border-0 shadow-none"
                error={
                  list.error && rows.length === 0
                    ? {
                        title: 'Couldn’t load batches.',
                        description: 'Check your connection or try again. Your filters have been kept.',
                        onRetry: list.reload,
                      }
                    : null
                }
                empty={
                  filtersActive ? (
                    <EmptyState
                      icon={Boxes}
                      title="No batches match these filters"
                      description="Try changing or clearing one or more filters."
                      action={
                        <Button variant="secondary" size="sm" icon={RotateCcw} onClick={clearFilters}>
                          Clear filters
                        </Button>
                      }
                    />
                  ) : (
                    <EmptyState
                      icon={Boxes}
                      title="No batches yet"
                      description="Create batches to track lot-wise stock, manufacturing dates, expiry and traceability."
                      action={
                        canWrite ? (
                          <span className="flex flex-wrap items-center justify-center gap-2">
                            <Button size="sm" icon={Plus} onClick={openCreate}>
                              New batch
                            </Button>
                            <Button variant="secondary" size="sm" icon={Upload} onClick={() => setImporting(true)}>
                              Import batches
                            </Button>
                          </span>
                        ) : undefined
                      }
                    />
                  )
                }
                sort={{ key: state.sort, order: state.order }}
                onSort={params.toggleSort}
                onRowActivate={(r) => setDetail(r)}
                activateOnSingleClick
                keyboardResetKey={listKey}
                searchInputRef={searchInputRef}
                stickyHeader
                minWidth={1180}
                caption="Batches"
                footer={
                  <ServerTablePagination
                    meta={list.data?.meta ?? null}
                    limit={state.limit}
                    onPage={params.setPage}
                    onLimit={params.setLimit}
                    numbered
                  />
                }
              />
            </Card>
          </main>

          <BatchAnalyticsRail
            summary={summary.data}
            loading={summary.loading}
            error={summary.error}
            onRetry={summary.reload}
            scopeLabel={scopeLabel}
            healthLink={healthLink}
            activeHealth={state.filters.health ?? ''}
            onScan={() => setScanning(true)}
            onBulkUpdate={() => setPendingStatus('closed')}
            onPrintLabels={() => printLabels(selectedRows.length > 0 ? selectedRows : rows)}
            onExport={() => void quickExport()}
            selectedCount={selected.size}
            rowCount={rows.length}
            canWrite={canWrite}
            canPrint={canRead}
          />
        </div>
      </RequirePermission>

      <BatchDetailsDrawer
        batch={detail}
        onClose={() => setDetail(null)}
        onEdit={(b) => setForm({ mode: 'edit', row: b })}
        onPrintLabel={(b) => printLabels([b])}
        canWrite={canWrite}
        today={today}
        nearExpiryDays={nearExpiryDays}
      />

      <BatchFormDialog
        open={form !== null}
        mode={form?.mode ?? 'create'}
        row={form?.row ?? null}
        readOnly={!canWrite}
        onClose={() => setForm(null)}
        onSaved={afterSave}
      />

      <BatchScanDialog
        open={scanning}
        onClose={() => setScanning(false)}
        onFound={(b) => {
          setScanning(false)
          setDetail(b)
        }}
      />

      <BatchImportDrawer
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(created) => {
          toast.success(`${formatInt(created)} batch${created === 1 ? '' : 'es'} imported.`)
          invalidateFormOptions()
          refresh()
        }}
      />

      <ConfirmDialog
        open={pendingStatus !== null}
        title={`Mark ${formatInt(selected.size)} batch${selected.size === 1 ? '' : 'es'} as ${humanize(pendingStatus ?? '').toLowerCase()}?`}
        message={
          <>
            <p className="m-0">
              The status is stored on each batch and shown everywhere it appears — including the batch
              pickers inside inventory documents.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Nothing is deleted and no stock moves. Every change is written to the audit log.
            </p>
          </>
        }
        confirmLabel="Apply status"
        danger={pendingStatus === 'recalled'}
        busy={bulkBusy}
        onConfirm={() => void applyBulkStatus()}
        onCancel={() => !bulkBusy && setPendingStatus(null)}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete batch?"
        message={
          <>
            <p className="m-0">
              <strong className="font-mono">{deleting?.batch_no}</strong> will be removed permanently.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              A batch with stock, movements, openings, serials or document lines cannot be deleted — the
              API refuses it, and closing the batch is the safe alternative that keeps its history.
            </p>
          </>
        }
        confirmLabel="Delete"
        danger
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => !deleteBusy && setDeleting(null)}
      />

      {/* Scope is part of what the figures mean; it is stated once, at the end,
          where a reader checks it rather than reads it. */}
      <p className={cx(AIC, 'text-[11px] text-gray-400 print:hidden')}>
        {companyName || 'This company'} · {fy?.label ?? 'Financial year'} ·{' '}
        {branch ? branch.name : 'All branches'} · figures come live from Inventory.
      </p>
    </PageShell>
  )
}

export default BatchesPage
