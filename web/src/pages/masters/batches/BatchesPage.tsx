import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowLeftRight,
  Boxes,
  Copy,
  Download,
  Eye,
  MoreVertical,
  PencilLine,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  ScanLine,
  Trash2,
  Upload,
} from 'lucide-react'
import { useAccess } from '../../../access/AccessContext'
import { useCompany } from '../../../company/CompanyContext'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { Modal } from '../../../components/Modal'
import { Notice } from '../../../components/Notice'
import { MasterForm } from '../../../masters/MasterForm'
import { batchesConfig } from '../../../masters/configs'
import { masterExportColumns } from '../../../masters/exportColumns'
import type { FormValues } from '../../../masters/types'
import { ExportActions } from '../../../export/ExportActions'
import { slugifyExportFilename } from '../../../export/exportActions'
import { useExportIdentity } from '../../../export/useExportIdentity'
import { printHtmlDocument } from '../../../export/documentExport'
import type { ExportableColumn } from '../../../registers/registerCells'
import { useDebounce } from '../../../hooks/useDebounce'
import { useFormOptions, invalidateFormOptions } from '../../../hooks/useFormOptions'
import { useListParams } from '../../../hooks/useListParams'
import { useQuery } from '../../../hooks/useQuery'
import { usePageKeyboard } from '../../../keyboard/usePageKeyboard'
import { P } from '../../../services/access'
import { errorMessage } from '../../../services/api'
import type { ListQuery } from '../../../services/api'
import { fetchAllRows } from '../../../services/listAll'
import { batchesApi } from '../../../services/masters'
import type { Batch } from '../../../services/masters'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { EmptyState } from '../../../ui/EmptyState'
import { MenuButton } from '../../../ui/MenuButton'
import type { MenuAction } from '../../../ui/MenuButton'
import { Tooltip } from '../../../ui/Tooltip'
import { PageShell } from '../../../ui/shell/PageShell'
import { SmartTable } from '../../../ui/shell/SmartTable'
import type { SmartColumn } from '../../../ui/shell/SmartTable'
import { ServerTablePagination } from '../../../ui/shell/TablePagination'
import { useToast } from '../../../ui/ToastContext'
import { AIC, cx } from '../../../ui/cx'
import { copyText } from '../../../utils/clipboard'
import { formatDate, formatInt, formatGeneratedStamp, formatQty, humanize, todayIso } from '../../../utils/format'
import { useDocumentTitle } from '../../../hooks/useDocumentTitle'
import { BatchAnalyticsRail } from './BatchAnalyticsRail'
import type { QuickAction } from './BatchAnalyticsRail'
import { BatchBulkStatusDialog } from './BatchBulkStatusDialog'
import { BatchDetailsDrawer } from './BatchDetailsDrawer'
import { BatchFilters } from './BatchFilters'
import { BatchHero } from './BatchHero'
import { BatchImportDrawer } from './BatchImportDrawer'
import { BatchKpiCards } from './BatchKpiCards'
import { BatchScanDialog } from './BatchScanDialog'
import {
  BATCH_STATE_LABEL,
  BATCH_STATE_TONE,
  EXPIRY_WINDOW_DAYS,
  batchState,
  expiryCaption,
} from './batchExpiry'
import type { BatchState } from './batchExpiry'
import { BATCH_FILTER_KEYS, describeFilters, toApiFilters } from './batchFilters'
import { buildBatchLabelSheetHtml } from './batchLabelSheet'

/**
 * Masters → Batches.
 *
 * The operational view of every lot in the company: what it is, when it
 * expires, how much of it is left and where. It replaced the config-driven
 * `MasterPage` rendering of this screen because a batch is not a simple master
 * — it carries dates that decide whether stock is sellable, quantities spread
 * across warehouses, and a movement history — and none of that fits a generic
 * name-and-status list.
 *
 * Everything on it is live and server-side. Filtering, sorting, paging and the
 * figures above the table are all query parameters answered by
 * `GET /v1/batches` and `GET /v1/batches/summary`, under the company, branch
 * and financial year the app shell has selected. Nothing is cached across a
 * context switch (see `resetKey` below), nothing is totalled from the rows on
 * screen, and no batch data is stored anywhere but Inventory's own tables.
 *
 * The filter state lives in the URL, so a view is an address: `?state=expired`
 * is a link a warehouse manager can be sent.
 */

const SEARCH_DEBOUNCE_MS = 350
const DEFAULT_SORT = 'expiry_date'

/**
 * What the sheet writes.
 *
 * Derived from `batchesConfig.columns` rather than retyped: those already carry
 * every batch column's header and its export resolver (a status badge writes
 * "Expired", not `expired`), and a second hand-kept list is how an export drifts
 * out of step with the screen it claims to be. The three columns this screen
 * shows that the shared list does not are spliced in after the column they
 * belong beside.
 */
const EXTRA_EXPORT_COLUMNS: Record<string, ExportableColumn<Batch>[]> = {
  item_name: [{ key: 'item_sku', csvHeader: 'SKU', csv: (r) => r.item_sku ?? '' }],
  on_hand: [
    { key: 'unit_symbol', csvHeader: 'Unit', csv: (r) => r.unit_symbol ?? '' },
    {
      key: 'warehouse',
      csvHeader: 'Warehouse',
      csv: (r) => (r.warehouses ?? []).map((w) => w.warehouse_name).filter(Boolean).join(', '),
    },
  ],
}

const EXPORT_COLUMNS: ExportableColumn<Batch>[] = masterExportColumns(batchesConfig.columns).flatMap(
  (column) => [column, ...(EXTRA_EXPORT_COLUMNS[column.key] ?? [])],
)

function Dash() {
  return <span className="text-gray-300">—</span>
}

export function BatchesPage() {
  const { scope, companyName } = useCompany()
  const { can, loading: accessLoading } = useAccess()
  const toast = useToast()
  useDocumentTitle('Batches')

  const canRead = can(P.masters('batches', 'read'))
  const canWrite = can(P.masters('batches', 'write'))
  const canDelete = can(P.masters('batches', 'delete'))

  const params = useListParams({ sort: DEFAULT_SORT, order: 'asc', filterKeys: BATCH_FILTER_KEYS })
  const { state } = params
  const filters = state.filters
  const formOptions = useFormOptions()

  // "Today" is read once per mount rather than per render: a component that
  // recomputed it would re-grade every badge on every keystroke, and the
  // grading would silently shift under the reader at midnight mid-session.
  const today = useMemo(() => todayIso(), [])

  const [searchDraft, setSearchDraft] = useState(state.q)
  const debouncedSearch = useDebounce(searchDraft, SEARCH_DEBOUNCE_MS)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  // The URL is the source of truth, so a Back button or a shared link that
  // changes `q` has to push the box back into step.
  useEffect(() => {
    setSearchDraft((draft) => (draft === state.q ? draft : state.q))
  }, [state.q])
  useEffect(() => {
    if (debouncedSearch !== state.q) params.setQ(debouncedSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- params is rebuilt each render
  }, [debouncedSearch])

  /* ---- data ------------------------------------------------------------ */

  const apiFilters = useMemo(() => toApiFilters(filters), [filters])
  /*
   * Assembled field by field rather than spread from `params.query`: that
   * object carries every key held in the URL, and the toolbar keeps one of its
   * own there (`expiry`, the preset behind the date range) that the API knows
   * nothing about. Sending it would be a parameter the server ignores today
   * and could misread tomorrow.
   */
  const listQuery = useMemo<ListQuery>(
    () => ({
      q: state.q || undefined,
      page: state.page,
      limit: state.limit,
      sort: state.sort,
      order: state.order,
      ...apiFilters,
      with_stock: 1,
    }),
    [state.q, state.page, state.limit, state.sort, state.order, apiFilters],
  )
  // Filters only — no page, no sort: the figures describe the whole result, so
  // paging or re-sorting must not re-fetch them.
  const summaryQuery = useMemo(() => ({ q: state.q || undefined, ...apiFilters }), [state.q, apiFilters])

  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null
  const enabled = Boolean(scope) && canRead

  const list = useQuery(
    (signal) => batchesApi.list(listQuery, signal),
    [scopeKey, listQuery],
    { enabled, resetKey: scopeKey },
  )
  const summary = useQuery(
    (signal) => batchesApi.summary(summaryQuery, signal),
    [scopeKey, summaryQuery],
    { enabled, resetKey: scopeKey },
  )

  const rows = useMemo(() => list.data?.data ?? [], [list.data])
  const windowDays = summary.data?.expiry_window_days ?? EXPIRY_WINDOW_DAYS

  const reloadAll = useCallback(() => {
    list.reload()
    summary.reload()
  }, [list, summary])

  /* ---- selection ------------------------------------------------------- */

  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  // A selection is a set of rows the reader can see. Changing the filters or
  // the page changes which rows those are, so holding the old ids would let a
  // bulk action reach records that are no longer on screen.
  useEffect(() => {
    setSelected(new Set())
  }, [listQuery, scopeKey])

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

  /* ---- create / edit / delete ------------------------------------------ */

  const [editing, setEditing] = useState<{ mode: 'create' | 'edit'; row: Batch | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [detail, setDetail] = useState<Batch | null>(null)
  const [deleting, setDeleting] = useState<Batch | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [bulkStatus, setBulkStatus] = useState(false)
  const formId = 'batch-form'

  const openCreate = useCallback(() => {
    if (!canWrite) return
    setSaveError(null)
    setEditing({ mode: 'create', row: null })
  }, [canWrite])

  const openEdit = useCallback((row: Batch) => {
    setSaveError(null)
    setEditing({ mode: 'edit', row })
  }, [])

  /*
   * `?new=1` — the link the Masters landing page's Quick Create menu hands out.
   * Consumed on arrival so a reload or a Back does not reopen the form behind
   * the reader, and held until access has loaded: `can()` answers false while
   * permissions are in flight, and acting on that would swallow the request of
   * a user who is in fact allowed to create.
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

  const submit = async (values: FormValues) => {
    if (!editing) return
    setSaving(true)
    setSaveError(null)
    try {
      const payload = batchesConfig.toPayload?.(values, editing.row) ?? {}
      if (editing.mode === 'create') {
        await batchesApi.create(payload)
        toast.success('Batch created successfully.')
      } else if (editing.row) {
        await batchesApi.update(editing.row.batch_id, payload)
        toast.success('Batch updated successfully.')
      }
      setEditing(null)
      invalidateFormOptions()
      reloadAll()
    } catch (err) {
      setSaveError(err)
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await batchesApi.remove(deleting.batch_id)
      toast.success(`Batch ${deleting.batch_no} deleted.`)
      setDeleting(null)
      reloadAll()
    } catch (err) {
      setDeleteError(errorMessage(err))
    } finally {
      setDeleteBusy(false)
    }
  }

  const copy = useCallback(
    async (value: string, what: string) => {
      const ok = await copyText(value)
      if (ok) toast.success(`${what} copied.`)
      else toast.error(`${what} could not be copied.`)
    },
    [toast],
  )

  /* ---- printing -------------------------------------------------------- */

  const identity = useExportIdentity()
  const printLabels = useCallback(
    (batches: readonly Batch[]) => {
      if (batches.length === 0) return
      const ok = printHtmlDocument(
        buildBatchLabelSheetHtml({
          ...identity,
          generatedAt: formatGeneratedStamp(),
          labels: batches.map((b) => ({
            batch_no: b.batch_no,
            lot_no: b.lot_no,
            item_name: b.item_name,
            item_sku: b.item_sku,
            mfg_date: b.mfg_date,
            expiry_date: b.expiry_date,
            on_hand: b.stock?.on_hand ?? null,
            unit_symbol: b.unit_symbol,
            warehouse_name: b.warehouses?.[0]?.warehouse_name ?? null,
          })),
        }),
      )
      if (!ok) toast.error('The label sheet could not be opened. Check the browser’s popup settings.')
    },
    [identity, toast],
  )

  /* ---- export ---------------------------------------------------------- */

  const metaLines = useMemo(
    () =>
      describeFilters(filters, state.q, {
        warehouse: formOptions.options?.warehouses.find((w) => String(w.warehouse_id) === filters.warehouse_id)?.warehouse_name,
        itemGroup: formOptions.options?.item_groups.find((g) => String(g.item_grp_id) === filters.item_grp_id)?.grp_name,
        stockCategory: formOptions.options?.stock_categories.find((c) => String(c.stock_cat_id) === filters.stock_cat_id)?.cat_name,
        brand: formOptions.options?.brands.find((b) => String(b.brand_id) === filters.brand_id)?.brand_name,
        item: rows.find((r) => String(r.item_id) === filters.item_id)?.item_name ?? undefined,
      }),
    [filters, state.q, formOptions.options, rows],
  )

  // The sheet walks the API rather than the rows on screen: a file whose footer
  // counts 4,182 batches must not hold the 50 that happened to be on page one.
  const fetchAll = useCallback(
    () => fetchAllRows<Batch>((page, limit) => batchesApi.list({ ...listQuery, page, limit })),
    [listQuery],
  )

  const summaryCards = useMemo(() => {
    if (!summary.data) return undefined
    const s = summary.data
    return [
      { label: 'Total batches', value: formatInt(s.total) },
      { label: 'Active', value: formatInt(s.states.active) },
      { label: 'Expiring soon', value: formatInt(s.states.expiring_soon), tone: 'warn' as const },
      { label: 'Expired', value: formatInt(s.states.expired), tone: 'credit' as const },
      { label: 'On hand', value: formatQty(s.total_on_hand, '0') },
    ]
  }, [summary.data])

  const printRef = useRef<(() => void) | null>(null)
  usePageKeyboard({
    searchInputRef,
    onRefresh: reloadAll,
    onPrint: () => printRef.current?.(),
    onNew: canWrite ? openCreate : undefined,
  })

  /* ---- filter helpers -------------------------------------------------- */

  // Not memoised: `params` is rebuilt every render, so a `useCallback` here
  // would hold the first render's `reset` and look stable while being a
  // closure over stale state. The two consumers do not memoise either.
  const clearFilters = () => {
    setSearchDraft('')
    params.reset()
  }

  const stateHref = useCallback(
    (value: BatchState) => {
      const next = new URLSearchParams()
      if (state.q) next.set('q', state.q)
      for (const [key, v] of Object.entries(apiFilters)) {
        if (key !== 'state' && key !== 'status') next.set(key, v)
      }
      next.set('state', value)
      return `/masters/batches?${next.toString()}`
    },
    [state.q, apiFilters],
  )

  /* ---- quick actions --------------------------------------------------- */

  const quickActions: QuickAction[] = useMemo(
    () => [
      { key: 'scan', label: 'Scan batch', icon: ScanLine, onSelect: () => setScanning(true) },
      {
        key: 'bulk',
        label: 'Bulk update status',
        icon: PencilLine,
        onSelect: () => setBulkStatus(true),
        unavailable: !canWrite
          ? 'You do not have permission to edit batches.'
          : selected.size === 0
            ? 'Select one or more batches in the table first.'
            : undefined,
      },
      {
        key: 'labels',
        label: 'Print labels',
        icon: Printer,
        onSelect: () => printLabels(selected.size > 0 ? selectedRows : rows),
        unavailable: rows.length === 0 ? 'There are no batches to label.' : undefined,
      },
      /*
       * Export is a menu, not a single action — CSV, Excel, PDF and a
       * letterheaded sheet — and it already sits above the table carrying the
       * current filters. Duplicating it here would either be a second, weaker
       * implementation or a button that scrolls the reader somewhere else, so
       * this row says where the real one is instead of pretending to be it.
       */
      {
        key: 'export',
        label: 'Export batches',
        icon: Download,
        unavailable: 'Use Export at the top of the page — it carries the filters you have set.',
      },
    ],
    [canWrite, selected.size, selectedRows, rows, printLabels],
  )

  /* ---- columns --------------------------------------------------------- */

  const columns = useMemo<SmartColumn<Batch>[]>(
    () => [
      {
        key: '__select',
        width: 36,
        alwaysVisible: true,
        headerClassName: 'print:hidden',
        cellClassName: 'print:hidden',
        header: (
          <input
            type="checkbox"
            aria-label={allOnPageSelected ? 'Clear selection' : 'Select every batch on this page'}
            checked={allOnPageSelected}
            onChange={() =>
              setSelected(allOnPageSelected ? new Set() : new Set(rows.map((r) => r.batch_id)))
            }
            className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-primary focus:ring-primary/30"
          />
        ),
        render: (r) => (
          <input
            type="checkbox"
            aria-label={`Select batch ${r.batch_no}`}
            checked={selected.has(r.batch_id)}
            onChange={() => toggleRow(r.batch_id)}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-primary focus:ring-primary/30"
          />
        ),
      },
      {
        key: 'batch_no',
        header: 'Batch',
        sortKey: 'batch_no',
        minWidth: 168,
        render: (r) => (
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setDetail(r)
              }}
              className="truncate rounded font-mono text-[13px] font-bold text-gray-900 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {r.batch_no}
            </button>
            <Tooltip label="Copy batch number">
              <button
                type="button"
                aria-label={`Copy batch number ${r.batch_no}`}
                onClick={(e) => {
                  e.stopPropagation()
                  void copy(r.batch_no, 'Batch number')
                }}
                className="shrink-0 rounded p-0.5 text-gray-300 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Copy className="h-3 w-3" aria-hidden />
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
        render: (r) => (
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-400"
              aria-hidden
            >
              <Boxes className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block max-w-[15rem] truncate font-medium text-gray-900">
                {r.item_name ?? `Item #${r.item_id}`}
              </span>
              <span className="block max-w-[15rem] truncate text-[11px] text-gray-500">
                {r.stock_cat_name ?? r.item_grp_name ?? r.item_sku ?? ''}
              </span>
            </span>
          </span>
        ),
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
                className="rounded font-mono text-[12px] text-gray-600 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {r.lot_no}
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
        minWidth: 118,
        render: (r) => (r.mfg_date ? <span className="whitespace-nowrap">{formatDate(r.mfg_date)}</span> : <Dash />),
      },
      {
        key: 'expiry_date',
        header: 'Expires',
        sortKey: 'expiry_date',
        minWidth: 142,
        render: (r) => {
          if (!r.expiry_date) return <span className="text-[11px] text-gray-400">No expiry</span>
          const grade = batchState(r, today, windowDays)
          const caption = expiryCaption(r.expiry_date, today)
          return (
            <span className="block">
              <span className="block whitespace-nowrap">{formatDate(r.expiry_date)}</span>
              {caption ? (
                <span
                  className={cx(
                    'block text-[11px]',
                    grade === 'expired' ? 'font-semibold text-red-600' : grade === 'expiring_soon' ? 'font-semibold text-amber-700' : 'text-gray-400',
                  )}
                >
                  {caption}
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
        minWidth: 104,
        render: (r) => {
          const qty = r.stock?.on_hand ?? 0
          return (
            <span className={cx('whitespace-nowrap', qty === 0 && 'text-gray-400')}>
              <span className="font-semibold tabular-nums">{formatQty(qty, '0')}</span>
              {r.unit_symbol ? <span className="ml-1 text-[11px] text-gray-500">{r.unit_symbol}</span> : null}
            </span>
          )
        },
      },
      {
        key: 'warehouse',
        header: 'Warehouse',
        minWidth: 150,
        // Hidden below `xl`: a batch's warehouse is in the drawer, and keeping
        // this column on a laptop pushed the status pill off the card.
        headerClassName: 'hidden xl:table-cell',
        cellClassName: 'hidden xl:table-cell',
        render: (r) => {
          const places = r.warehouses ?? []
          if (places.length === 0) return <Dash />
          return (
            <span className="block min-w-0">
              <span className="block max-w-[11rem] truncate text-gray-700">{places[0].warehouse_name ?? 'Unassigned'}</span>
              {places.length > 1 ? (
                <span className="block text-[11px] text-gray-400">+{places.length - 1} more</span>
              ) : null}
            </span>
          )
        },
      },
      {
        key: 'status',
        header: 'Status',
        sortKey: 'status',
        minWidth: 124,
        render: (r) => {
          const grade = batchState(r, today, windowDays)
          const stored = String(r.status ?? '').toLowerCase()
          const badge = (
            <Badge tone={BATCH_STATE_TONE[grade]} size="xs" dot className="normal-case">
              {BATCH_STATE_LABEL[grade]}
            </Badge>
          )
          // The badge shows the screen's grading; where that differs from the
          // stored status, the tooltip says what the record actually holds.
          return grade === 'inactive' || (grade !== 'active' && stored !== grade) ? (
            <Tooltip label={`Stored status: ${humanize(r.status)}`}>{badge}</Tooltip>
          ) : (
            badge
          )
        },
      },
      {
        key: '__actions',
        header: '',
        align: 'right',
        width: 108,
        headerClassName: 'print:hidden',
        cellClassName: 'print:hidden',
        render: (r) => {
          const actions: MenuAction[] = [
            { key: 'view', label: 'View batch', icon: Eye, onSelect: () => setDetail(r) },
            {
              key: 'movements',
              label: 'View movements',
              icon: ArrowLeftRight,
              onSelect: () => window.open(`/registers/movement-register?item_id=${r.item_id}&batch_id=${r.batch_id}`, '_self'),
            },
            { key: 'label', label: 'Print label', icon: Printer, separated: true, onSelect: () => printLabels([r]) },
            { key: 'copy', label: 'Copy batch number', icon: Copy, onSelect: () => void copy(r.batch_no, 'Batch number') },
          ]
          if (canDelete) {
            actions.push({
              key: 'delete',
              label: 'Delete batch',
              icon: Trash2,
              separated: true,
              danger: true,
              onSelect: () => {
                setDeleteError(null)
                setDeleting(r)
              },
            })
          }
          return (
            <span className="flex items-center justify-end gap-0.5">
              <Tooltip label="View batch">
                <Button variant="ghost" size="xs" icon={Eye} aria-label={`View batch ${r.batch_no}`} onClick={(e) => {
                  e.stopPropagation()
                  setDetail(r)
                }} />
              </Tooltip>
              <Tooltip label={canWrite ? 'Edit batch' : 'View details'}>
                <Button
                  variant="ghost"
                  size="xs"
                  icon={Pencil}
                  aria-label={`${canWrite ? 'Edit' : 'View'} batch ${r.batch_no}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    openEdit(r)
                  }}
                />
              </Tooltip>
              <MenuButton label={`More actions for ${r.batch_no}`} icon={MoreVertical} variant="ghost" size="xs" actions={actions} width={204} />
            </span>
          )
        },
      },
    ],
    [allOnPageSelected, rows, selected, toggleRow, copy, today, windowDays, canWrite, canDelete, openEdit, printLabels],
  )

  /* ---- render ---------------------------------------------------------- */

  if (!accessLoading && !canRead) {
    return (
      <PageShell fullBleed>
        <BatchHero />
        <Notice kind="warning">You do not have permission to view batches in this company.</Notice>
      </PageShell>
    )
  }

  const total = list.data?.meta.total ?? 0
  const filtered = Boolean(state.q) || Object.values(filters).some(Boolean)

  return (
    <PageShell fullBleed>
      <BatchHero
        actions={
          <>
            {canWrite ? (
              <Button variant="secondary" size="md" icon={Upload} onClick={() => setImporting(true)}>
                Import
              </Button>
            ) : null}
            <ExportActions<Batch>
              columns={EXPORT_COLUMNS}
              rows={rows}
              fetchAll={fetchAll}
              filename={slugifyExportFilename(['batches', companyName, today])}
              identity={identity}
              title="Batches"
              description="Batch-wise stock, expiry and traceability"
              metaLines={metaLines}
              summaryCards={summaryCards}
              onRefresh={reloadAll}
              refreshing={list.loading}
              disabled={total === 0}
              printRef={printRef}
              size="sm"
            />
            {canWrite ? (
              <Button size="md" icon={Plus} onClick={openCreate} kbd="Ctrl N">
                New batch
              </Button>
            ) : null}
          </>
        }
      />

      <BatchKpiCards
        summary={summary.data}
        loading={summary.loading}
        error={summary.error}
        onRetry={summary.reload}
        stateHref={stateHref}
      />

      <div className="grid grid-cols-1 gap-2 wide:grid-cols-[minmax(0,1fr)_17rem] ultra:grid-cols-[minmax(0,1fr)_18.5rem]">
        <div className="min-w-0 space-y-2">
          <BatchFilters
            filters={filters}
            search={searchDraft}
            onSearchChange={setSearchDraft}
            setFilter={params.setFilter}
            setFilters={params.setFilters}
            onClear={clearFilters}
            options={formOptions.options}
            today={today}
            searchInputRef={searchInputRef}
          />

          {selected.size > 0 ? (
            <div
              className={cx(
                AIC,
                'flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-light px-3 py-2 text-xs text-gray-700 print:hidden',
              )}
              role="status"
            >
              <strong className="font-semibold text-primary">{formatInt(selected.size)} selected</strong>
              <span className="text-gray-500">on this page</span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {canWrite ? (
                  <Button variant="secondary" size="xs" icon={PencilLine} onClick={() => setBulkStatus(true)}>
                    Change status
                  </Button>
                ) : null}
                <Button variant="secondary" size="xs" icon={Printer} onClick={() => printLabels(selectedRows)}>
                  Print labels
                </Button>
                {/*
                  * ExportActions directly rather than the header's: the header
                  * claims Ctrl+P for the whole page, and two claims on one
                  * screen is a print button whose behaviour depends on mount
                  * order. Print is deliberately left out of this menu.
                  */}
                <ExportActions<Batch>
                  columns={EXPORT_COLUMNS}
                  rows={selectedRows}
                  filename={slugifyExportFilename(['batches-selection', companyName, today])}
                  identity={identity}
                  title="Batches — selected"
                  metaLines={[`Selection: ${formatInt(selectedRows.length)} of the batches on this page`, ...metaLines]}
                  formats={['csv', 'excel', 'pdf']}
                  size="xs"
                />
                <Button variant="ghost" size="xs" onClick={() => setSelected(new Set())}>
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
              The batch list could not be refreshed.
            </Notice>
          ) : null}

          <SmartTable<Batch>
            columns={columns}
            rows={rows}
            rowKey={(r) => r.batch_id}
            loading={list.loading}
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
              filtered ? (
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
            keyboardResetKey={`${state.page}:${state.sort}:${state.order}`}
            searchInputRef={searchInputRef}
            stickyHeader
            minWidth={1100}
            caption="Batches"
            rowClassName={(r) =>
              batchState(r, today, windowDays) === 'expired' ? 'bg-red-50/40' : undefined
            }
            /*
              * One counter, not two. The shared control already prints
              * "Showing 1–50 of 248" on its left; a second sentence beside it
              * counting the rows that happened to arrive read as a
              * contradiction on any page that was not full.
              */
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
        </div>

        <BatchAnalyticsRail
          summary={summary.data}
          loading={summary.loading}
          error={summary.error}
          onRetry={summary.reload}
          quickActions={quickActions}
          stateHref={stateHref}
        />
      </div>

      <BatchDetailsDrawer
        batch={detail}
        open={detail !== null}
        onClose={() => setDetail(null)}
        today={today}
        windowDays={windowDays}
        canWrite={canWrite}
        onEdit={(b) => {
          setDetail(null)
          openEdit(b)
        }}
        onPrintLabel={(b) => printLabels([b])}
        onCopy={(v, w) => void copy(v, w)}
      />

      <Modal
        open={editing !== null}
        title={editing?.mode === 'create' ? 'New batch' : canWrite ? 'Edit batch' : 'Batch'}
        onClose={() => !saving && setEditing(null)}
        busy={saving}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              {canWrite ? 'Cancel' : 'Close'}
            </Button>
            {canWrite ? (
              <Button type="submit" form={formId} loading={saving}>
                {editing?.mode === 'create' ? 'Create batch' : 'Save changes'}
              </Button>
            ) : null}
          </>
        }
      >
        {editing ? (
          <MasterForm<Batch>
            key={`${editing.mode}-${editing.row?.batch_id ?? 'new'}`}
            formId={formId}
            fields={batchesConfig.fields}
            mode={editing.mode}
            row={editing.row}
            options={formOptions.options}
            rows={rows}
            initialValues={batchesConfig.toValues?.(editing.row, formOptions.options) ?? {}}
            readOnly={!canWrite}
            serverError={saveError}
            onSubmit={submit}
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete batch?"
        message={
          <>
            <p style={{ margin: '0 0 0.5rem' }}>
              <strong>{deleting?.batch_no}</strong>
              {deleting?.item_name ? ` (${deleting.item_name})` : ''} will be removed permanently.
            </p>
            <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
              Only a batch with no stock and no document references can be deleted. If this lot has ever moved, set its
              status to Closed instead — that keeps its history and takes it out of the working list.
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

      <BatchImportDrawer
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(created) => {
          toast.success(`${formatInt(created)} ${created === 1 ? 'batch' : 'batches'} imported.`)
          reloadAll()
        }}
      />

      <BatchScanDialog
        open={scanning}
        onClose={() => setScanning(false)}
        onFound={(b) => {
          setScanning(false)
          setDetail(b)
        }}
      />

      <BatchBulkStatusDialog
        open={bulkStatus}
        batches={selectedRows}
        onClose={() => setBulkStatus(false)}
        onDone={(changed) => {
          if (changed > 0) {
            toast.success(`${formatInt(changed)} ${changed === 1 ? 'batch' : 'batches'} updated.`)
            reloadAll()
          }
        }}
      />
    </PageShell>
  )
}

export default BatchesPage
