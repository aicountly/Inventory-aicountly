import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  CircleDollarSign,
  FileStack,
  HelpCircle,
  Lightbulb,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  TriangleAlert,
  Upload,
  Wand2,
} from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Notice } from '../../components/Notice'
import { useQuery } from '../../hooks/useQuery'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { errorMessage, isApiError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { settingsApi } from '../../services/settingsApi'
import { Badge, Button, Kbd, MenuButton, Tooltip } from '../../ui'
import { useToast } from '../../ui/ToastContext'
import { ActionBarTotal, BreadcrumbHeader, PageShell, StickyActionBar } from '../../ui/shell'
import { csvFilename, downloadCsv, toCsv } from '../../utils/csv'
import { formatQty, todayIso } from '../../utils/format'
import { canCreate, permissionKeysFor, STATUS_LABELS } from '../actions'
import type { DocumentTypeSpec } from '../registry'
import type { DocumentStatus, InventoryDocument } from '../types'
import { useReferenceData } from '../useReferenceData'
import { AddMultipleItemsModal } from './AddMultipleItemsModal'
import { CopyRatesModal } from './CopyRatesModal'
import { ImportRatesModal } from './ImportRatesModal'
import type { ImportedRate } from './ImportRatesModal'
import { RevaluationAssistantPanel } from './RevaluationAssistantPanel'
import { RevaluationDetailsCard } from './RevaluationDetailsCard'
import { RevaluationHelpModal } from './RevaluationHelpModal'
import { RevaluationImpactSummary } from './RevaluationImpactSummary'
import { RevaluationItemsCard } from './RevaluationItemsCard'
import { RATE_SOURCES } from './revaluationApi'
import type { RateSourceId } from './revaluationApi'
import { createMoneyFormat } from './revaluationFormat'
import {
  activeLines,
  contextFor,
  EMPTY_LINE_FILTERS,
  lineImpact,
  newRevaluationDraft,
  newRevaluationLine,
  offendingLineKeys,
  revaluationTotals,
  staleLines,
  toRevaluationPayload,
  validateRevaluation,
  visibleLines,
} from './revaluationModel'
import type { LineFilters, RevaluationDraft, RevaluationLine, RevaluationMode, StaleLine, StockContextMap, ValuationScope } from './revaluationModel'
import { useRevaluationStock } from './useRevaluationStock'

export interface StockRevaluationPageProps {
  spec: DocumentTypeSpec
  /** Set when editing a stored draft. */
  documentId?: number
  initial?: RevaluationDraft
  existing?: InventoryDocument
}

type Phase = 'new' | 'draft' | 'saving' | 'posting' | 'posted' | 'failed'

/**
 * `/documents/new/revaluation` and the edit route for a REVALUATION draft.
 *
 * It owns the draft, the authoritative stock reads behind the preview, and the two writes
 * (`POST/PUT /v1/inventory-documents` then `POST .../post`) that every document editor uses. The
 * preview it shows is arithmetic over figures the API gave it; the value that is actually booked is
 * whatever the posting engine computes from live cost layers when the document posts.
 */
export function StockRevaluationPage({ spec, documentId, initial, existing }: StockRevaluationPageProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useAccess()
  const { fyRange, scope: companyScope, boId } = useCompany()
  const { warehouses, defaultWarehouseId, loading: warehousesLoading, error: warehousesError } = useReferenceData()

  const [draft, setDraft] = useState<RevaluationDraft>(() => initial ?? newRevaluationDraft(todayIso()))
  const [mode, setMode] = useState<RevaluationMode>('simple')
  const [filters, setFilters] = useState<LineFilters>(EMPTY_LINE_FILTERS)
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [status, setStatus] = useState<DocumentStatus | null>((existing?.status as DocumentStatus) ?? null)
  const [phase, setPhase] = useState<Phase>(documentId ? 'draft' : 'new')
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [showIssues, setShowIssues] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [stale, setStale] = useState<StaleLine[] | null>(null)
  const [flaggedKeys, setFlaggedKeys] = useState<ReadonlySet<string>>(new Set())

  const [helpOpen, setHelpOpen] = useState(false)
  const [addMultipleOpen, setAddMultipleOpen] = useState(false)
  const [copyRatesOpen, setCopyRatesOpen] = useState(false)
  const [copyRatesSource, setCopyRatesSource] = useState<RateSourceId | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importSeed, setImportSeed] = useState('')
  const [leaveTo, setLeaveTo] = useState<{ to: string; proceed: () => void } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [applyWarehouseTo, setApplyWarehouseTo] = useState<number | null>(null)

  const searchInputRef = useRef<HTMLInputElement>(null)

  // Company settings decide the valuation scope the posting engine will use and the currency every
  // figure is printed in. They need `settings.read`, which a warehouse profile may not hold — so a
  // refusal is not an error here, it falls back to the product defaults and says so.
  const settings = useQuery((signal) => settingsApi.get(signal), [companyScope?.cmp_id ?? 0], { enabled: Boolean(companyScope), keepData: false })
  const scope: ValuationScope = settings.data?.valuation_scope === 'warehouse' ? 'warehouse' : 'company'
  const scopeKnown = settings.data !== null
  const money = useMemo(() => createMoneyFormat(settings.data?.base_currency_code ?? 'INR'), [settings.data?.base_currency_code])

  const locks = useQuery((signal) => settingsApi.periodLocks(signal), [companyScope?.cmp_id ?? 0, boId], { enabled: Boolean(companyScope), keepData: false })
  const lockedUptoDate = useMemo(() => {
    const rows = (locks.data ?? []).filter((l) => !l.released_at && (l.bo_id === 0 || l.bo_id === boId))
    return rows.reduce<string | null>((latest, l) => (latest === null || l.locked_upto_date > latest ? l.locked_upto_date : latest), null)
  }, [locks.data, boId])

  const stock = useRevaluationStock(draft, scope, draft.documentDate, Boolean(companyScope))

  const canSaveDraft = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)
  const canPost = can(permissionKeysFor('post', spec.code))
  const canManageSettings = can('settings.write')
  const busy = phase === 'saving' || phase === 'posting'
  const readOnly = phase === 'posted'
  const disabled = busy || readOnly

  const totals = useMemo(() => revaluationTotals(draft, stock.contexts, scope), [draft, stock.contexts, scope])
  const issues = useMemo(
    () => validateRevaluation(draft, stock.contexts, { forPost: true, scope, fyRange, lockedUptoDate }),
    [draft, stock.contexts, scope, fyRange, lockedUptoDate],
  )
  const draftIssues = useMemo(
    () => validateRevaluation(draft, stock.contexts, { forPost: false, scope, fyRange, lockedUptoDate }),
    [draft, stock.contexts, scope, fyRange, lockedUptoDate],
  )
  const offending = useMemo(() => offendingLineKeys(showIssues ? issues : []), [issues, showIssues])
  const lineIssueCount = useMemo(() => new Set(issues.filter((i) => i.lineKey).map((i) => i.lineKey)).size, [issues])
  const shownKeys = useMemo(() => new Set(visibleLines(draft.lines, stock.contexts, scope, filters).map((l) => l.key)), [draft.lines, stock.contexts, scope, filters])

  // ---------------------------------------------------------------------------------------------
  // Draft mutation
  // ---------------------------------------------------------------------------------------------

  const mutate = useCallback((update: (d: RevaluationDraft) => RevaluationDraft) => {
    setDraft((d) => update(d))
    setDirty(true)
    setStale(null)
  }, [])

  const patchDraft = useCallback((patch: Partial<RevaluationDraft>) => mutate((d) => ({ ...d, ...patch })), [mutate])
  const patchLine = useCallback((key: string, patch: Partial<RevaluationLine>) => mutate((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })), [mutate])
  const removeLine = useCallback((key: string) => mutate((d) => ({ ...d, lines: d.lines.filter((l) => l.key !== key) })), [mutate])
  const duplicateLine = useCallback(
    (key: string) =>
      mutate((d) => {
        const index = d.lines.findIndex((l) => l.key === key)
        if (index < 0) return d
        const { key: _original, ...rest } = d.lines[index]
        // The copy exists to re-price another warehouse's layers, so it starts without a warehouse:
        // a straight copy would name the same scope and simply overwrite the line above it.
        const copy = newRevaluationLine({ ...rest, warehouseId: null })
        const lines = [...d.lines]
        lines.splice(index + 1, 0, copy)
        return { ...d, lines }
      }),
    [mutate],
  )

  const lineFromItem = useCallback(
    (item: ItemSearchRow, warehouseId: number | null): RevaluationLine => {
      const units = (item.units ?? []).map((u) => ({ unit_id: u.unit_id, unit_symbol: u.unit_symbol, unit_name: u.unit_name, conversion_factor: Number(u.conversion_factor) || 1, is_default: Number(u.is_default) === 1 }))
      const base = units.find((u) => u.is_default) ?? units[0]
      return newRevaluationLine({
        itemId: item.item_id,
        itemName: item.print_name || item.item_name,
        itemSku: item.item_sku,
        hsnSac: item.hsn_sac ?? null,
        // The valuation rate is per BASE unit, so the line carries the base unit and never offers
        // an alternate one: a cost typed against "box" would be booked against "piece".
        unitId: base?.unit_id ?? item.unit_id ?? null,
        unitSymbol: base?.unit_symbol ?? item.unit_symbol ?? null,
        units: base ? [base] : [],
        trackBatch: Number(item.track_batch) === 1,
        trackSerial: Number(item.track_serial) === 1,
        valuationMethod: item.valuation_method,
        warehouseId: warehouseId ?? item.default_warehouse_id ?? null,
      })
    },
    [],
  )

  // The duplicate check runs here, not inside the state updater: a toast fired from an updater is a
  // side effect React is free to run twice.
  const addItem = useCallback(
    (item: ItemSearchRow) => {
      const warehouseId = draft.defaultWarehouseId ?? item.default_warehouse_id ?? null
      const index = draft.lines.findIndex((l) => l.itemId === item.item_id && l.warehouseId === warehouseId)
      if (index >= 0) {
        toast.info(`${draft.lines[index].itemName} is already on line ${index + 1}.`)
        return
      }
      mutate((d) => ({ ...d, lines: [...d.lines, lineFromItem(item, d.defaultWarehouseId)] }))
    },
    [draft.defaultWarehouseId, draft.lines, mutate, lineFromItem, toast],
  )

  const addItems = useCallback(
    (items: ItemSearchRow[], warehouseId: number | null) => {
      const present = new Set(draft.lines.filter((l) => l.warehouseId === warehouseId).map((l) => l.itemId))
      const fresh = items.filter((i) => !present.has(i.item_id))
      if (fresh.length === 0) {
        toast.info('Every one of those items is already on the document.')
        return
      }
      if (fresh.length < items.length) toast.info(`${items.length - fresh.length} of them were already on the document.`)
      mutate((d) => ({ ...d, lines: [...d.lines, ...fresh.map((i) => lineFromItem(i, warehouseId))] }))
    },
    [draft.lines, mutate, lineFromItem, toast],
  )

  const applyRates = useCallback(
    (rates: { lineKey: string; newUnitCost: number }[]) => {
      if (rates.length === 0) return
      const byKey = new Map(rates.map((r) => [r.lineKey, r.newUnitCost]))
      mutate((d) => ({ ...d, lines: d.lines.map((l) => (byKey.has(l.key) ? { ...l, newUnitCost: String(byKey.get(l.key)) } : l)) }))
      setFlaggedKeys(new Set(byKey.keys()))
      toast.success(`${rates.length} rate${rates.length === 1 ? '' : 's'} filled in. Review them before posting.`)
    },
    [mutate, toast],
  )

  const importRates = useCallback(
    (rows: ImportedRate[]) => {
      const lines = [...draft.lines]
      const touched = new Set<string>()
      let updated = 0
      let added = 0
      for (const row of rows) {
        const warehouseId = row.warehouseId ?? draft.defaultWarehouseId
        const index = lines.findIndex((l) => l.itemId === row.item.item_id && l.warehouseId === warehouseId)
        if (index >= 0) {
          lines[index] = {
            ...lines[index],
            newUnitCost: row.newUnitCost === null ? lines[index].newUnitCost : String(row.newUnitCost),
            remarks: row.remarks || lines[index].remarks,
          }
          touched.add(lines[index].key)
          updated += 1
        } else {
          const line = { ...lineFromItem(row.item, warehouseId), newUnitCost: row.newUnitCost === null ? '' : String(row.newUnitCost), remarks: row.remarks }
          lines.push(line)
          touched.add(line.key)
          added += 1
        }
      }
      mutate((d) => ({ ...d, lines }))
      setFlaggedKeys(touched)
      toast.success(`${added + updated} item${added + updated === 1 ? '' : 's'} imported — ${added} added, ${updated} updated.`)
    },
    [draft.lines, draft.defaultWarehouseId, mutate, lineFromItem, toast],
  )

  /**
   * Changing the default warehouse must not silently move stock lines to another warehouse — it
   * would change which layers each line re-prices. The lines already entered are left alone and the
   * new default only pre-fills what is added next.
   */
  const changeDefaultWarehouse = useCallback(
    (warehouseId: number | null) => {
      patchDraft({ defaultWarehouseId: warehouseId })
      if (warehouseId !== null && draft.lines.some((l) => l.warehouseId !== warehouseId)) {
        setApplyWarehouseTo(warehouseId)
      }
    },
    [patchDraft, draft.lines],
  )

  // ---------------------------------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------------------------------

  const exportPreview = useCallback(() => {
    const rows = activeLines(draft).map((line, index) => {
      const ctx = contextFor(line, stock.contexts, scope)
      return {
        index: index + 1,
        line,
        currentUnitCost: ctx?.currentUnitCost ?? null,
        onHandQty: ctx?.onHandQty ?? null,
        impact: lineImpact(line.newUnitCost, ctx?.currentUnitCost ?? null, ctx?.onHandQty ?? null),
        warehouse: warehouses.find((w) => w.warehouse_id === line.warehouseId)?.warehouse_name ?? '',
      }
    })
    const csv = toCsv(rows, [
      { header: '#', value: (r) => r.index },
      { header: 'Item', value: (r) => r.line.itemName },
      { header: 'SKU', value: (r) => r.line.itemSku },
      { header: 'HSN', value: (r) => r.line.hsnSac },
      { header: 'Warehouse', value: (r) => r.warehouse },
      { header: 'Current unit cost', value: (r) => r.currentUnitCost },
      { header: 'New unit cost', value: (r) => r.line.newUnitCost },
      { header: 'On-hand qty', value: (r) => r.onHandQty },
      { header: 'Value impact', value: (r) => r.impact },
      { header: 'Remarks', value: (r) => r.line.remarks },
    ])
    downloadCsv(csvFilename('stock-revaluation-preview', draft.documentNo || '', draft.documentDate), csv)
    toast.success('Preview exported.')
  }, [draft, stock.contexts, scope, warehouses, toast])

  const persist = useCallback(
    async (post: boolean): Promise<void> => {
      setApiError(null)
      setShowIssues(true)
      const blocking = post ? issues : draftIssues
      if (blocking.length > 0) {
        toast.error(post ? `${blocking.length} thing${blocking.length === 1 ? '' : 's'} need attention before posting.` : 'Fix the highlighted fields before saving.')
        return
      }

      // The preview was computed from a snapshot. Re-read before posting and stop if the ground
      // moved: the server would post the right number, but not the number the user just approved.
      let contexts: StockContextMap = stock.contexts
      if (post) {
        setPhase('posting')
        try {
          contexts = await stock.refresh()
        } catch {
          /* keep the snapshot; the server revalidates anyway */
        }
        const moved = staleLines(draft, stock.contexts, contexts, scope)
        if (moved.length > 0) {
          setStale(moved)
          setPhase(savedId ? 'draft' : 'new')
          toast.error('Inventory changed while this was being prepared. Review it before posting.')
          return
        }
      } else {
        setPhase('saving')
      }

      const payload = toRevaluationPayload(draft, spec, contexts, scope)
      try {
        let doc: InventoryDocument = savedId ? await documentsApi.update(savedId, payload) : await documentsApi.create(payload)
        setSavedId(doc.document_id)
        setStatus(doc.status as DocumentStatus)
        setSavedAt(Date.now())
        setDirty(false)
        if (!post) {
          setPhase('draft')
          setShowIssues(false)
          toast.success('Stock revaluation saved as draft.')
          if (!documentId) navigate(`/documents/${doc.document_id}/edit`, { replace: true })
          return
        }
        doc = await documentsApi.post(doc.document_id)
        setStatus(doc.status as DocumentStatus)
        setPhase('posted')
        toast.success('Stock revaluation posted.')
        navigate(`/documents/${doc.document_id}`)
      } catch (err) {
        setPhase('failed')
        setApiError(describe(err))
        toast.error(post ? 'The revaluation could not be posted.' : 'The draft could not be saved.')
      }
    },
    [issues, draftIssues, draft, spec, scope, savedId, documentId, stock, navigate, toast],
  )

  // ---------------------------------------------------------------------------------------------
  // Keyboard, paste and the unsaved-changes guard
  // ---------------------------------------------------------------------------------------------

  const bindings = useMemo(
    () => ({
      'ctrl+s': (e: KeyboardEvent) => {
        e.preventDefault()
        if (!disabled && canSaveDraft) void persist(false)
      },
      'ctrl+enter': (e: KeyboardEvent) => {
        e.preventDefault()
        if (!disabled && canPost) void persist(true)
      },
    }),
    [disabled, canSaveDraft, canPost, persist],
  )
  useKeyboardScope('form', bindings, { allowInInput: true })

  // A multi-row paste anywhere outside a field opens the import dialog already filled, which is
  // where a pasted block of codes and rates can be checked before it touches the grid.
  useEffect(() => {
    if (disabled) return undefined
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['input', 'textarea', 'select'].includes(target.tagName?.toLowerCase() ?? '')) return
      if (target?.isContentEditable) return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (!text.includes('\n') && !text.includes('\t')) return
      e.preventDefault()
      setImportSeed(text)
      setImportOpen(true)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [disabled])

  useUnsavedChanges({
    when: dirty && !readOnly,
    onBlocked: (to, proceed) => setLeaveTo({ to, proceed }),
  })

  // Pre-fill the default warehouse once reference data lands (new documents only).
  useEffect(() => {
    if (documentId || draft.defaultWarehouseId !== null || defaultWarehouseId === null) return
    setDraft((d) => (d.defaultWarehouseId === null ? { ...d, defaultWarehouseId } : d))
  }, [defaultWarehouseId, documentId, draft.defaultWarehouseId])

  // ---------------------------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------------------------

  const statusBadge =
    phase === 'posted' || status === 'POSTED' ? (
      <Badge tone="success" dot>
        Posted
      </Badge>
    ) : phase === 'posting' ? (
      <Badge tone="info" dot>
        Posting…
      </Badge>
    ) : phase === 'failed' ? (
      <Badge tone="danger" dot>
        Failed
      </Badge>
    ) : savedId ? (
      <Badge tone="warning" dot>
        {status ? (STATUS_LABELS[status] ?? status) : 'Draft'}
      </Badge>
    ) : (
      <Badge tone="neutral" dot>
        New
      </Badge>
    )

  return (
    <PageShell paddingBottom>
      <BreadcrumbHeader
        breadcrumbs={[
          { label: 'Documents', to: '/documents' },
          { label: 'Stock revaluation', to: '/documents?document_type=REVALUATION' },
          { label: savedId ? (draft.documentNo || `Draft #${savedId}`) : 'New' },
        ]}
        title="Stock revaluation"
        description="Re-price the cost of stock on hand. Update item valuation across the selected warehouse."
        icon={CircleDollarSign}
        badge={statusBadge}
        escOnBack={() => (dirty ? setLeaveTo({ to: '/documents', proceed: () => navigate('/documents') }) : navigate('/documents'))}
        backTo="/documents"
        actions={
          <>
            <Button size="md" variant="secondary" icon={HelpCircle} onClick={() => setHelpOpen(true)}>
              How it works
            </Button>
            <MenuButton
              label="Rate templates"
              variant="secondary"
              size="md"
              width={280}
              buttonProps={{ disabled: disabled || draft.lines.length === 0, icon: Wand2, iconRight: ChevronDown }}
              actions={RATE_SOURCES.map((source) => ({
                key: source.id,
                label: `Revalue from ${source.label.toLowerCase()}`,
                onSelect: () => {
                  setCopyRatesSource(source.id)
                  setCopyRatesOpen(true)
                },
              }))}
            >
              Templates
            </MenuButton>
            <Button size="md" variant="secondary" icon={Upload} onClick={() => { setImportSeed(''); setImportOpen(true) }} disabled={disabled}>
              Import
            </Button>
            <Button size="md" variant="secondary" icon={RefreshCw} onClick={() => void stock.refresh()} disabled={disabled || stock.loading || draft.lines.length === 0}>
              Preview impact
            </Button>
            <MenuButton
              label="More actions"
              variant="ghost"
              size="md"
              width={248}
              actions={[
                { key: 'help', label: 'How a revaluation works', icon: HelpCircle, onSelect: () => setHelpOpen(true) },
                { key: 'register', label: 'All stock revaluations', icon: FileStack, onSelect: () => navigate('/documents?document_type=REVALUATION') },
                ...(canManageSettings ? [{ key: 'settings', label: 'Valuation settings', icon: Settings2, onSelect: () => navigate('/settings') }] : []),
                { key: 'reset', label: 'Clear this form', icon: RotateCcw, onSelect: () => setConfirmClear(true), danger: true, separated: true, disabled: disabled || (!dirty && draft.lines.length === 0) },
              ]}
            />
          </>
        }
      />

      <div className="flex items-center justify-end gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
        <Lightbulb className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
        <p className="text-[11px] text-emerald-900">
          <strong>Pro tip:</strong> revalue from market price, landed cost or the last purchase rate — Copy rates fills the column for you.
        </p>
        <button type="button" className="text-[11px] font-semibold text-emerald-700 underline" onClick={() => setHelpOpen(true)}>
          Learn more →
        </button>
      </div>

      {warehousesError ? <Notice kind="warning">{warehousesError}</Notice> : null}
      {!canSaveDraft ? <Notice kind="warning">You can look at this form, but your profile cannot save a stock revaluation.</Notice> : null}
      {readOnly ? (
        <Notice
          kind="info"
          actions={
            savedId ? (
              <Button size="sm" variant="secondary" onClick={() => navigate(`/documents/${savedId}`)}>
                Open the document
              </Button>
            ) : undefined
          }
        >
          This revaluation is posted. A posted document is not edited — reverse it, or raise a new revaluation.
        </Notice>
      ) : null}
      {stock.costError ? (
        <Notice kind="info">
          The current cost could not be read ({stock.costError}) so the impact preview is unavailable. Posting still re-prices from the live cost layers — the
          server, not this screen, decides the value.
        </Notice>
      ) : null}
      {stale ? (
        <Notice
          kind="warning"
          title="Inventory changed since this revaluation was prepared"
          actions={
            <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => { setStale(null); void stock.refresh() }}>
              Refresh &amp; review
            </Button>
          }
        >
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
            {stale.map((line) => (
              <li key={line.key}>
                {line.itemName}: on hand {formatQty(line.previousQty)} → <strong>{formatQty(line.currentQty)}</strong>
                {line.previousCost !== line.currentCost ? <>, cost {money.amount(line.previousCost)} → <strong>{money.amount(line.currentCost)}</strong></> : null}
              </li>
            ))}
          </ul>
          <div className="mt-1 text-xs opacity-80">Review the updated quantities and impact, then post again. Nothing has been posted.</div>
        </Notice>
      ) : null}
      {apiError ? (
        <Notice kind="error" title="The server refused this document">
          {apiError}
          {savedId ? <div className="mt-1 text-xs opacity-80">Draft #{savedId} is saved — your entries are safe.</div> : null}
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <RevaluationDetailsCard
          draft={draft}
          onPatch={(patch) => ('defaultWarehouseId' in patch ? changeDefaultWarehouse(patch.defaultWarehouseId ?? null) : patchDraft(patch))}
          mode={mode}
          onModeChange={setMode}
          warehouses={warehouses}
          warehousesLoading={warehousesLoading}
          issues={issues}
          showIssues={showIssues}
          disabled={disabled}
          scope={scope}
          scopeKnown={scopeKnown}
          defaultMethod={settings.data?.default_valuation_method ?? null}
          lockedUptoDate={lockedUptoDate}
          fyRange={fyRange}
          documentNoLocked={Boolean(documentId && draft.documentNo)}
          canManageSettings={canManageSettings}
        />
        <RevaluationAssistantPanel
          lines={draft.lines}
          contexts={stock.contexts}
          scope={scope}
          asOf={draft.documentDate}
          money={money}
          disabled={disabled}
          onApplyRates={applyRates}
          onFocusLines={(keys) => setFlaggedKeys(new Set(keys))}
        />
      </div>

      <RevaluationItemsCard
        lines={draft.lines}
        contexts={stock.contexts}
        scope={scope}
        money={money}
        warehouses={warehouses}
        disabled={disabled}
        filters={filters}
        onFiltersChange={setFilters}
        offendingKeys={offending}
        flaggedKeys={flaggedKeys}
        searchInputRef={searchInputRef}
        defaultWarehouseId={draft.defaultWarehouseId}
        onAddItem={addItem}
        onPatchLine={patchLine}
        onDuplicateLine={duplicateLine}
        onRemoveLine={removeLine}
        onOpenAddMultiple={() => setAddMultipleOpen(true)}
        onOpenCopyRates={() => { setCopyRatesSource(null); setCopyRatesOpen(true) }}
        onClearRates={() => mutate((d) => ({ ...d, lines: d.lines.map((l) => ({ ...l, newUnitCost: '' })) }))}
        onRemoveUnchanged={() =>
          mutate((d) => ({
            ...d,
            lines: d.lines.filter((l) => {
              const ctx = contextFor(l, stock.contexts, scope)
              return lineImpact(l.newUnitCost, ctx?.currentUnitCost ?? null, ctx?.onHandQty ?? null) !== 0
            }),
          }))
        }
        onRemoveAll={() => setConfirmClear(true)}
        onRecalculate={() => void stock.refresh()}
        onExportPreview={exportPreview}
      />

      <RevaluationImpactSummary totals={totals} money={money} scope={scope} loading={stock.loading} fetchedAt={stock.fetchedAt} onRefresh={() => void stock.refresh()} disabled={disabled} />

      {showIssues && lineIssueCount > 0 ? (
        <Notice kind="error" title={`${lineIssueCount} line${lineIssueCount === 1 ? '' : 's'} need attention before posting`}>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
            {issues
              .filter((i) => i.lineKey)
              .slice(0, 8)
              .map((i, index) => (
                <li key={`${i.lineKey}-${index}`}>{i.message}</li>
              ))}
          </ul>
          {issues.filter((i) => i.lineKey).length > 8 ? (
            <div className="mt-1 text-xs opacity-80">…and {issues.filter((i) => i.lineKey).length - 8} more.</div>
          ) : null}
        </Notice>
      ) : null}

      <StickyActionBar
        status={
          <div className="flex items-center gap-2 text-xs text-gray-500" aria-live="polite">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden /> : null}
            <span>
              {totals.lines} item{totals.lines === 1 ? '' : 's'}
              {savedId ? ` · draft #${savedId}` : ''}
              {dirty ? ' · unsaved changes' : savedAt ? ` · saved ${new Date(savedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
            {showIssues && issues.length > 0 ? (
              <span className="inline-flex items-center gap-1 font-semibold text-red-600">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                {issues.length} to fix
              </span>
            ) : null}
          </div>
        }
        totals={
          <>
            <ActionBarTotal label="Increase" value={money.amount(totals.increase)} tone="success" />
            <ActionBarTotal label="Decrease" value={money.amount(totals.decrease)} tone="danger" />
            <ActionBarTotal
              label="Net impact"
              value={money.signed(totals.net)}
              subValue={`${totals.lines} line${totals.lines === 1 ? '' : 's'} · ${formatQty(totals.onHandQty, '0')} on hand`}
              tone={totals.net > 0 ? 'success' : totals.net < 0 ? 'danger' : 'neutral'}
            />
          </>
        }
      >
        <Button variant="secondary" size="md" onClick={() => (dirty ? setLeaveTo({ to: '/documents', proceed: () => navigate('/documents') }) : navigate(savedId ? `/documents/${savedId}` : '/documents'))} disabled={busy}>
          Cancel
        </Button>
        <Tooltip label="Save without posting. A draft changes no stock value.">
          <Button variant="secondary" size="md" icon={Save} kbd="Ctrl S" onClick={() => void persist(false)} disabled={disabled || !canSaveDraft} loading={phase === 'saving'}>
            Save as draft
          </Button>
        </Tooltip>
        {canPost ? (
          <Button variant="primary" size="md" onClick={() => void persist(true)} disabled={disabled || (!canSaveDraft && !savedId)} loading={phase === 'posting'}>
            Save &amp; post
            <span className="ml-1.5 inline-flex items-center gap-0.5" aria-hidden>
              <Kbd>Ctrl</Kbd>
              <Kbd>↵</Kbd>
            </span>
          </Button>
        ) : (
          <Tooltip label="Your profile can prepare a revaluation but not post it.">
            <span>
              <Button variant="primary" size="md" disabled>
                Save &amp; post
              </Button>
            </span>
          </Tooltip>
        )}
      </StickyActionBar>

      <RevaluationHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} scope={scope} />
      <AddMultipleItemsModal
        open={addMultipleOpen}
        onClose={() => setAddMultipleOpen(false)}
        warehouses={warehouses}
        defaultWarehouseId={draft.defaultWarehouseId}
        existingItemIds={new Set(draft.lines.map((l) => l.itemId).filter((id): id is number => id !== null))}
        onAdd={addItems}
      />
      <CopyRatesModal
        key={copyRatesSource ?? 'copy-rates'}
        open={copyRatesOpen}
        onClose={() => setCopyRatesOpen(false)}
        lines={draft.lines}
        visibleKeys={shownKeys}
        contexts={stock.contexts}
        scope={scope}
        asOf={draft.documentDate}
        money={money}
        initialSource={copyRatesSource ?? undefined}
        onApply={applyRates}
      />
      <ImportRatesModal open={importOpen} onClose={() => setImportOpen(false)} warehouses={warehouses} defaultWarehouseId={draft.defaultWarehouseId} seedText={importSeed} onImport={importRates} />

      <ConfirmDialog
        open={confirmClear}
        title="Clear this form?"
        message={`${draft.lines.length} line${draft.lines.length === 1 ? '' : 's'} and everything typed here will be discarded. Nothing has been posted, so nothing in stock changes.`}
        confirmLabel="Clear it"
        danger
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false)
          setDraft((d) => ({ ...newRevaluationDraft(d.documentDate), defaultWarehouseId: d.defaultWarehouseId }))
          setShowIssues(false)
          setFlaggedKeys(new Set())
          setDirty(false)
        }}
      />
      <ConfirmDialog
        open={applyWarehouseTo !== null}
        title="Apply the new default warehouse to the lines already entered?"
        message={
          scope === 'warehouse'
            ? 'Moving a line to another warehouse changes which cost layers it re-prices, and its current cost and quantity are read again. Leave them as they are if each line was entered against the right warehouse.'
            : 'Stock is valued company-wide here, so a line’s warehouse does not change which layers it re-prices — but it is recorded on the document. Leave them as they are if each line was entered against the right warehouse.'
        }
        confirmLabel="Apply to existing lines"
        onCancel={() => setApplyWarehouseTo(null)}
        onConfirm={() => {
          const warehouseId = applyWarehouseTo
          setApplyWarehouseTo(null)
          if (warehouseId !== null) mutate((d) => ({ ...d, lines: d.lines.map((l) => ({ ...l, warehouseId })) }))
        }}
      />
      <ConfirmDialog
        open={leaveTo !== null}
        title="Leave without saving?"
        message="This revaluation has changes that have not been saved. Leaving discards them."
        confirmLabel="Discard and leave"
        danger
        onCancel={() => setLeaveTo(null)}
        onConfirm={() => {
          const go = leaveTo
          setLeaveTo(null)
          setDirty(false)
          go?.proceed()
        }}
      />
    </PageShell>
  )
}

function describe(err: unknown): string {
  if (isApiError(err)) {
    const field = err.field
    return field ? `${err.message} (${field})` : err.message
  }
  return errorMessage(err)
}

export default StockRevaluationPage
