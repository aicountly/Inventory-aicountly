import { useCallback, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  BookOpen,
  ChevronDown,
  FilterX,
  Info,
  MapPin,
  MoreHorizontal,
  Plus,
  Printer,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
} from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { useCompany } from '../company/CompanyContext'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ListSheetActions } from '../components/ListSheetActions'
import { Notice } from '../components/Notice'
import { useKeyboardScope } from '../keyboard/useKeyboardScope'
import { masterExportColumns } from '../masters/exportColumns'
import { P } from '../services/access'
import { errorMessage } from '../services/api'
import { fetchAllRows } from '../services/listAll'
import { serialsApi } from '../services/masters'
import type { Serial } from '../services/masters'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { MenuButton } from '../ui/MenuButton'
import { Select } from '../ui/Select'
import { ServerTablePagination } from '../ui/shell/TablePagination'
import { BreadcrumbHeader } from '../ui/shell/BreadcrumbHeader'
import { PageShell } from '../ui/shell/PageShell'
import { useToast } from '../ui/ToastContext'
import { cx } from '../ui/cx'
import { formatInt, humanize, todayIso } from '../utils/format'
import { SERIAL_STATUSES } from '../services/masters'
import { PrintLabelsDialog } from './PrintLabelsDialog'
import { SerialBulkBar } from './SerialBulkBar'
import { SerialBulkEditDialog } from './SerialBulkEditDialog'
import type { BulkEditMode } from './SerialBulkEditDialog'
import { SerialDetailDrawer } from './SerialDetailDrawer'
import { SerialEmptyState } from './SerialEmptyState'
import { SerialFilterPanel } from './SerialFilterPanel'
import { SerialFormDrawer } from './SerialFormDrawer'
import { SerialGuideDrawer } from './SerialGuideDrawer'
import { SerialImportDrawer } from './SerialImportDrawer'
import { SerialKpiGrid } from './SerialKpiGrid'
import { SerialScanDialog } from './SerialScanDialog'
import { SerialSearchBox } from './SerialSearchBox'
import { SerialSidePanel } from './SerialSidePanel'
import { SerialTable } from './SerialTable'
import { serialExportColumns, serialsConfig } from './serialsConfig'
import { hasAnyFilter, serialFilterChips } from './serialFilters'
import { buildSerialFindings, serialInsightHeadline } from './serialInsights'
import { useSerialsWorkspace } from './useSerialsWorkspace'
import { DEFAULT_WARRANTY_THRESHOLDS } from './warranty'

/**
 * Masters › Serial numbers.
 *
 * The table is the page. Everything else — the counters above it, the tools
 * beside it — exists to get a reader to a row and tell them something true
 * about it, and none of it may stand between them and the list: a failed
 * summary leaves the rows alone, a failed lookup leaves the filters usable,
 * and the assistant not existing costs nothing at all.
 */
export function SerialsWorkspacePage() {
  const { can, loading: accessLoading } = useAccess()
  const { companyName } = useCompany()
  const toast = useToast()
  const canRead = can(P.masters('serials', 'read'))
  const canWrite = can(P.masters('serials', 'write'))
  const canDelete = can(P.masters('serials', 'delete'))

  const workspace = useSerialsWorkspace(canRead)
  const { list, rows, meta, summary } = workspace
  const [searchParams] = useSearchParams()
  const searchRef = useRef<HTMLInputElement>(null)
  const today = todayIso()

  // ---- UI state -----------------------------------------------------------
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importMethod, setImportMethod] = useState<'paste' | 'file' | 'range' | 'scan'>('paste')
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [labelRows, setLabelRows] = useState<Serial[]>([])
  const [bulkEdit, setBulkEdit] = useState<BulkEditMode | null>(null)
  const [detail, setDetail] = useState<Serial | null>(null)
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row: Serial | null } | null>(null)
  const [deleting, setDeleting] = useState<Serial | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  /** Kept as rows, not ids: labels for a selection made across pages need them. */
  const [selection, setSelection] = useState<Map<number, Serial>>(() => new Map())

  const selectedIds = useMemo(() => new Set(selection.keys()), [selection])
  const clearSelection = useCallback(() => setSelection(new Map()), [])

  const toggleRow = useCallback((serialId: number) => {
    setSelection((current) => {
      const next = new Map(current)
      if (next.has(serialId)) next.delete(serialId)
      else {
        const row = rows.find((r) => r.serial_id === serialId)
        if (row) next.set(serialId, row)
      }
      return next
    })
  }, [rows])

  const toggleAllOnPage = useCallback(() => {
    setSelection((current) => {
      const next = new Map(current)
      const allSelected = rows.length > 0 && rows.every((r) => next.has(r.serial_id))
      if (allSelected) rows.forEach((r) => next.delete(r.serial_id))
      else rows.forEach((r) => next.set(r.serial_id, r))
      return next
    })
  }, [rows])

  // ---- filters ------------------------------------------------------------
  const filterNames = useMemo(() => {
    const warehouses: Record<string, string> = {}
    for (const w of workspace.options?.warehouses ?? []) warehouses[String(w.warehouse_id)] = w.warehouse_name
    const locations: Record<string, string> = {}
    for (const l of workspace.locations) locations[String(l.location_id)] = l.location_code
    const batches: Record<string, string> = {}
    for (const b of workspace.batches) batches[String(b.batch_id)] = b.batch_no
    const groups: Record<string, string> = {}
    for (const g of workspace.options?.item_groups ?? []) groups[String(g.item_grp_id)] = g.grp_name
    const brands: Record<string, string> = {}
    for (const b of workspace.options?.brands ?? []) brands[String(b.brand_id)] = b.brand_name
    const categories: Record<string, string> = {}
    for (const c of workspace.options?.stock_categories ?? []) categories[String(c.stock_cat_id)] = c.cat_name
    const statuses: Record<string, string> = {}
    for (const s of SERIAL_STATUSES) statuses[s] = humanize(s)
    statuses.in_stock = 'In stock'
    statuses.allocated = 'Allocated'
    statuses.out = 'Out of stock'
    return {
      warehouse_id: warehouses,
      location_id: locations,
      batch_id: batches,
      item_grp_id: groups,
      brand_id: brands,
      stock_cat_id: categories,
      status: statuses,
    }
  }, [workspace.options, workspace.locations, workspace.batches])

  const chips = useMemo(() => serialFilterChips(list.state.filters, filterNames), [list.state.filters, filterNames])
  const advancedCount = useMemo(
    () => chips.filter((c) => !['status', 'warehouse_id'].includes(c.key)).length,
    [chips],
  )
  const narrowed = hasAnyFilter(list.state.filters, list.state.q)

  /** A KPI card's link: this page, this status bucket, every other filter kept. */
  const hrefForStatus = useCallback(
    (group: string) => {
      const next = new URLSearchParams(searchParams)
      if (group) next.set('status', group)
      else next.delete('status')
      next.delete('page')
      const qs = next.toString()
      return qs ? `/masters/serials?${qs}` : '/masters/serials'
    },
    [searchParams],
  )

  const applyFilters = useCallback(
    (patch: Record<string, string>) => {
      list.setFilters(patch)
      clearSelection()
    },
    [list, clearSelection],
  )

  const clearEverything = useCallback(() => {
    list.reset()
    clearSelection()
  }, [list, clearSelection])

  // ---- actions ------------------------------------------------------------
  const openCreate = useCallback(() => {
    if (!canWrite) return
    setForm({ mode: 'create', row: null })
  }, [canWrite])

  const openImport = useCallback(
    (method: 'paste' | 'file' | 'range' | 'scan') => {
      if (!canWrite) return
      setImportMethod(method)
      setImportOpen(true)
    },
    [canWrite],
  )

  const printLabelsFor = useCallback(
    (serials: Serial[]) => {
      if (serials.length === 0) {
        toast.info('Select one or more serial numbers first.')
        return
      }
      setLabelRows(serials)
      setLabelsOpen(true)
    },
    [toast],
  )

  const printSelectedLabels = useCallback(() => {
    printLabelsFor(selection.size > 0 ? [...selection.values()] : rows)
  }, [printLabelsFor, selection, rows])

  /** Scanned or typed: search for it, and open it if exactly one matches. */
  const applyScannedCode = useCallback(
    async (code: string) => {
      setScanOpen(false)
      list.setQ(code)
      try {
        const res = await serialsApi.list({ q: code, limit: 2 })
        if (res.data.length === 1) setDetail(res.data[0])
        else if (res.data.length === 0) toast.info(`No serial number matches “${code}”.`)
      } catch (err) {
        toast.error(errorMessage(err, 'The scan could not be looked up.'))
      }
    },
    [list, toast],
  )

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await serialsApi.remove(deleting.serial_id)
      toast.success('Serial number deleted')
      setDeleting(null)
      setDetail(null)
      clearSelection()
      workspace.reload()
    } catch (err) {
      setDeleteError(errorMessage(err))
    } finally {
      setDeleteBusy(false)
    }
  }

  // ---- keyboard -----------------------------------------------------------
  // `/` and Ctrl+R / Ctrl+P come from ListSheetActions' usePageKeyboard below.
  // These two are the list-screen habits: N for new, R to refresh.
  useKeyboardScope(
    'page',
    useMemo(
      () => ({
        n: (e: KeyboardEvent) => {
          if (!canWrite) return
          e.preventDefault()
          openCreate()
        },
        r: (e: KeyboardEvent) => {
          e.preventDefault()
          workspace.reload()
        },
      }),
      [canWrite, openCreate, workspace],
    ),
  )

  // ---- exports ------------------------------------------------------------
  const exportColumns = useMemo(() => masterExportColumns(serialExportColumns(workspace.costVisible)), [workspace.costVisible])
  const fetchAll = useCallback(
    () => fetchAllRows<Serial>((page, limit) => serialsApi.list({ ...workspace.query, page, limit })),
    [workspace.query],
  )
  const exportMeta = useMemo(() => {
    const lines: string[] = []
    if (list.state.q) lines.push(`Search: ${list.state.q}`)
    for (const chip of chips) lines.push(`${chip.label}: ${chip.value}`)
    if (!workspace.costVisible) lines.push('Unit cost is withheld from this profile and is not in this file.')
    return lines
  }, [list.state.q, chips, workspace.costVisible])

  const findings = useMemo(() => buildSerialFindings(summary), [summary])
  const headline = useMemo(() => serialInsightHeadline(findings, summary), [findings, summary])

  // ---- render -------------------------------------------------------------
  if (!accessLoading && !canRead) {
    return (
      <PageShell>
        <BreadcrumbHeader breadcrumbs={[{ label: 'Masters', to: '/masters' }, { label: 'Serial numbers' }]} title="Serial numbers" />
        <Notice kind="warning">You do not have permission to view serial numbers in this company.</Notice>
      </PageShell>
    )
  }

  const total = meta?.total ?? 0
  const showEmptyState = !workspace.loading && !workspace.error && rows.length === 0

  return (
    <PageShell fullBleed>
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Masters', to: '/masters' }, { label: 'Serial numbers' }]}
        title={
          <span className="inline-flex items-center gap-2">
            Serial numbers
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              aria-label="About serial tracking"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 text-gray-400 transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <Info className="h-3 w-3" aria-hidden />
            </button>
          </span>
        }
        description="Track and manage item-wise serial numbers across your inventory lifecycle."
        meta={
          summary ? (
            <span className="text-xs text-gray-500">
              {formatInt(summary.total)} registered in {companyName || 'this company'}
              {summary.unplaced > 0 ? (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="font-semibold text-amber-600 underline-offset-2 hover:underline"
                    onClick={() => applyFilters({ placed: '0' })}
                  >
                    {formatInt(summary.unplaced)} not placed
                  </button>
                </>
              ) : null}
            </span>
          ) : undefined
        }
        actions={
          <>
            <Button variant="secondary" size="sm" icon={BookOpen} onClick={() => setGuideOpen(true)}>
              Serial tracking guide
            </Button>
            {canWrite ? (
              <span className="inline-flex items-center">
                <Button size="sm" icon={Plus} onClick={openCreate} className="rounded-r-none">
                  New serial number
                </Button>
                <MenuButton
                  label="More ways to add serial numbers"
                  icon={ChevronDown}
                  variant="primary"
                  size="sm"
                  className="rounded-l-none border-l border-white/25 px-1.5"
                  width={232}
                  actions={[
                    { key: 'one', label: 'Add one serial number', icon: Plus, onSelect: openCreate },
                    { key: 'paste', label: 'Bulk add — paste a list', icon: Upload, onSelect: () => openImport('paste') },
                    { key: 'file', label: 'Import from a CSV file', icon: Upload, onSelect: () => openImport('file') },
                    { key: 'range', label: 'Generate a numbered range', icon: Upload, onSelect: () => openImport('range') },
                    { key: 'scan', label: 'Scan serials in', icon: ScanLine, onSelect: () => openImport('scan') },
                  ]}
                />
              </span>
            ) : null}
          </>
        }
      />

      <SerialKpiGrid
        summary={summary}
        loading={workspace.summaryLoading}
        failed={workspace.summaryFailed}
        costVisible={workspace.costVisible}
        currency={workspace.currency}
        hrefForStatus={hrefForStatus}
        onRetry={workspace.reload}
      />

      {workspace.optionsError ? <Notice kind="warning">{workspace.optionsError}</Notice> : null}

      <div className="grid grid-cols-1 items-start gap-3 wide:grid-cols-[minmax(0,1fr)_16rem]">
        <Card padding="none" className="min-w-0 overflow-hidden">
          {/* ---- toolbar ---- */}
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 p-2.5">
            <SerialSearchBox
              ref={searchRef}
              value={list.state.q}
              onChange={list.setQ}
              onSubmit={(value) => {
                if (!value) return
                const exact = rows.find((r) => r.serial_no.toLowerCase() === value.toLowerCase())
                if (exact) setDetail(exact)
              }}
              onScan={() => setScanOpen(true)}
              className="w-full sm:w-[min(22rem,40vw)]"
            />

            {/* The width lives on a wrapper: `Select` is `block w-full`, and a
                second width utility on the same element is decided by stylesheet
                order rather than by the class list. */}
            <div className="w-[9rem] shrink-0">
            <Select
              value={list.state.filters.status ?? ''}
              onChange={(e) => applyFilters({ status: e.target.value })}
              aria-label="Status"
              size="md"
            >
              <option value="">All statuses</option>
              <option value="in_stock">In stock</option>
              <option value="allocated">Allocated</option>
              <option value="out">Out of stock</option>
              <optgroup label="Exact status">
                {SERIAL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </optgroup>
            </Select>
            </div>

            <div className="w-[10.5rem] shrink-0">
            <Select
              value={list.state.filters.warehouse_id ?? ''}
              onChange={(e) => applyFilters({ warehouse_id: e.target.value, location_id: '' })}
              aria-label="Warehouse"
              size="md"
            >
              <option value="">All warehouses</option>
              {(workspace.options?.warehouses ?? []).map((w) => (
                <option key={w.warehouse_id} value={w.warehouse_id}>
                  {w.warehouse_name}
                </option>
              ))}
            </Select>
            </div>

            <Button
              variant="secondary"
              size="md"
              icon={SlidersHorizontal}
              onClick={() => setFiltersOpen(true)}
            >
              More filters
              {advancedCount > 0 ? (
                <Badge tone="primary" size="xs" className="ml-1.5">
                  {advancedCount}
                </Badge>
              ) : null}
            </Button>

            {narrowed ? (
              <Button variant="ghost" size="md" icon={FilterX} onClick={clearEverything}>
                Clear
              </Button>
            ) : null}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {canWrite ? (
                <MenuButton
                  label="Import serial numbers"
                  variant="secondary"
                  size="sm"
                  icon={Upload}
                  width={232}
                  actions={[
                    { key: 'paste', label: 'Paste a list', onSelect: () => openImport('paste') },
                    { key: 'file', label: 'Upload a CSV file', onSelect: () => openImport('file') },
                    { key: 'range', label: 'Generate a range', onSelect: () => openImport('range') },
                    { key: 'scan', label: 'Scan them in', onSelect: () => openImport('scan') },
                  ]}
                >
                  Import
                </MenuButton>
              ) : null}

              <ListSheetActions<Serial>
                columns={exportColumns}
                rows={rows}
                fetchAll={fetchAll}
                filenameBase="serial-numbers"
                title="Serial numbers"
                description="Every tracked serial with its status, placement and warranty"
                metaLines={exportMeta}
                onRefresh={workspace.reload}
                refreshing={workspace.loading}
                disabled={total === 0}
                searchInputRef={searchRef}
              />

              <MenuButton
                label="More actions"
                variant="secondary"
                size="sm"
                icon={MoreHorizontal}
                width={236}
                actions={[
                  { key: 'labels', label: 'Print labels', icon: Printer, onSelect: printSelectedLabels },
                  {
                    key: 'place',
                    label: 'Change location for the selection',
                    icon: MapPin,
                    disabled: !canWrite || selection.size === 0,
                    onSelect: () => setBulkEdit('place'),
                  },
                  {
                    key: 'warranty',
                    label: 'Update warranty for the selection',
                    icon: ShieldCheck,
                    disabled: !canWrite || selection.size === 0,
                    onSelect: () => setBulkEdit('warranty'),
                  },
                  {
                    key: 'expiring',
                    label: 'Show warranties expiring in 90 days',
                    icon: ShieldCheck,
                    separated: true,
                    onSelect: () => applyFilters({ warranty_status: 'expiring', warranty_days: '90' }),
                  },
                  {
                    key: 'unplaced',
                    label: 'Show serials with no warehouse',
                    icon: MapPin,
                    onSelect: () => applyFilters({ placed: '0' }),
                  },
                ]}
              />
            </div>
          </div>

          {/* ---- active filters ---- */}
          {chips.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-100 bg-gray-50/60 px-2.5 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Filters</span>
              {chips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white py-0.5 pl-2 pr-1 text-[11px] text-gray-700"
                >
                  <span className="text-gray-400">{chip.label}:</span>
                  <span className="max-w-[10rem] truncate font-medium">{chip.value}</span>
                  <button
                    type="button"
                    onClick={() => applyFilters({ [chip.key]: '' })}
                    aria-label={`Remove the ${chip.label.toLowerCase()} filter`}
                    className="grid h-4 w-4 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <SerialTable
            rows={rows}
            loading={workspace.loading}
            error={workspace.error}
            onRetry={workspace.reload}
            empty={
              showEmptyState ? (
                <SerialEmptyState
                  filtered={narrowed}
                  canWrite={canWrite}
                  onAdd={openCreate}
                  onBulkAdd={() => openImport('paste')}
                  onScan={() => setScanOpen(true)}
                  onClearFilters={clearEverything}
                  onGuide={() => setGuideOpen(true)}
                />
              ) : null
            }
            selected={selectedIds}
            onToggle={toggleRow}
            onToggleAll={toggleAllOnPage}
            sort={{ key: list.state.sort, order: list.state.order }}
            onSort={list.toggleSort}
            onOpen={setDetail}
            onEdit={(row) => setForm({ mode: 'edit', row })}
            onPrintLabel={(row) => printLabelsFor([row])}
            onDelete={(row) => {
              setDeleteError(null)
              setDeleting(row)
            }}
            canWrite={canWrite}
            canDelete={canDelete}
            costVisible={workspace.costVisible}
            currency={workspace.currency}
            today={today}
            thresholds={
              summary
                ? { soonDays: summary.warranty.soon_days, upcomingDays: summary.warranty.upcoming_days }
                : DEFAULT_WARRANTY_THRESHOLDS
            }
          />

          <SerialBulkBar
            count={selection.size}
            onClear={clearSelection}
            onPrintLabels={() => printLabelsFor([...selection.values()])}
            onMove={() => setBulkEdit('place')}
            onWarranty={() => setBulkEdit('warranty')}
            canWrite={canWrite}
          />

          <div className="border-t border-gray-100 px-3 py-2">
            <ServerTablePagination
              meta={meta}
              limit={list.state.limit}
              onPage={list.setPage}
              onLimit={list.setLimit}
              numbered
            />
          </div>
        </Card>

        <SerialSidePanel
          findings={findings}
          headline={headline}
          findingsLoading={workspace.summaryLoading && !summary}
          canWrite={canWrite}
          onScan={() => setScanOpen(true)}
          onBulkAdd={() => openImport('paste')}
          onPrintLabels={printSelectedLabels}
          onApplyFilters={applyFilters}
          warrantyHref={`/masters/serials?warranty_status=expiring&warranty_days=90`}
          className={cx('min-w-0')}
        />
      </div>

      {/* ---- overlays ---- */}
      <SerialFilterPanel
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={list.state.filters}
        onApply={applyFilters}
        onClear={clearEverything}
        options={workspace.options}
        batches={workspace.batches}
        locations={workspace.locations}
        costVisible={workspace.costVisible}
      />

      <SerialGuideDrawer open={guideOpen} onClose={() => setGuideOpen(false)} />

      <SerialScanDialog open={scanOpen} onClose={() => setScanOpen(false)} onDetected={(code) => void applyScannedCode(code)} />

      <SerialImportDrawer
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          clearSelection()
          workspace.reload()
        }}
        warehouses={workspace.options?.warehouses ?? []}
        initialMethod={importMethod}
      />

      <SerialDetailDrawer
        serial={detail}
        open={detail !== null}
        onClose={() => setDetail(null)}
        onEdit={(row) => {
          setDetail(null)
          setForm({ mode: 'edit', row })
        }}
        onPrintLabel={(row) => printLabelsFor([row])}
        canWrite={canWrite}
        costVisible={workspace.costVisible}
        currency={workspace.currency}
        today={today}
        thresholds={
          summary ? { soonDays: summary.warranty.soon_days, upcomingDays: summary.warranty.upcoming_days } : DEFAULT_WARRANTY_THRESHOLDS
        }
        names={{
          warehouses: filterNames.warehouse_id,
          locations: filterNames.location_id,
          batches: filterNames.batch_id,
        }}
      />

      <SerialFormDrawer
        open={form !== null}
        mode={form?.mode ?? 'create'}
        row={form?.row ?? null}
        onClose={() => setForm(null)}
        onSaved={(saved, stayOpen) => {
          if (!stayOpen) setForm(null)
          workspace.reload()
          if (!stayOpen) setDetail(saved)
        }}
        onOpenExisting={(serialNo) => {
          setForm(null)
          list.setQ(serialNo)
        }}
        onBulkAdd={() => {
          setForm(null)
          openImport('paste')
        }}
        options={workspace.options}
        costVisible={workspace.costVisible}
        canWrite={canWrite}
      />

      <SerialBulkEditDialog
        open={bulkEdit !== null}
        mode={bulkEdit ?? 'place'}
        serialIds={[...selection.keys()]}
        onClose={() => setBulkEdit(null)}
        onDone={() => {
          clearSelection()
          workspace.reload()
        }}
        warehouses={workspace.options?.warehouses ?? []}
      />

      <PrintLabelsDialog open={labelsOpen} onClose={() => setLabelsOpen(false)} serials={labelRows} />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete serial number?"
        message={
          <>
            <p style={{ margin: '0 0 0.5rem' }}>
              <strong>{deleting?.serial_no}</strong> will be removed permanently.
            </p>
            <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
              {serialsConfig.deleteHint}
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

export default SerialsWorkspacePage
