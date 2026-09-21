import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardCheck,
  CircleAlert,
  ScanBarcode,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Notice } from '../../components/Notice'
import { useCompany } from '../../company/CompanyContext'
import { useQuery } from '../../hooks/useQuery'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { useColumnConfig } from '../../registers/useColumnConfig'
import { errorMessage, isApiError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { lookupApi } from '../../services/lookupApi'
import { settingsApi } from '../../services/settingsApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { useToast } from '../../ui/ToastContext'
import { BreadcrumbHeader, PageShell, StickyActionBar } from '../../ui/shell'
import { currencySymbol, formatMoney, todayIso } from '../../utils/format'
import { canCreate, permissionKeysFor, STATUS_LABELS } from '../actions'
import { isBlankLine, newHeader, toPayload, validateDraft } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { unitOptionsFrom } from '../LineEditor'
import { offendingDraftKeys, parseNegativeStock } from '../negativeStock'
import type { NegativeStockDetail } from '../negativeStock'
import type { DocumentTypeSpec } from '../registry'
import type { InventoryDocument, LineSerial, PostingWarning } from '../types'
import { useReferenceData } from '../useReferenceData'
import { AssistDrawer } from './AssistDrawer'
import { BatchCountDrawer } from './BatchCountDrawer'
import { COUNT_COLUMNS_PREF_KEY, columnsFor } from './countColumns'
import { CountSheet } from './CountSheet'
import { CountSheetFilters } from './CountSheetFilters'
import { CountSheetImportModal } from './CountSheetImportModal'
import { applyPreview } from './countSheetImport'
import type { ImportPreview } from './countSheetImport'
import { assessReadiness, buildRows, isCounted, summarise } from './countModel'
import type { LineSnapshot } from './countModel'
import type { CountInsight } from './countInsights'
import { DEFAULT_FILTERS, filterRows } from './countFilters'
import type { CountFilters } from './countFilters'
import { loadCountSheet, loadVarianceHistory } from './physicalCountApi'
import { usePhysicalCountInsights } from './usePhysicalCountInsights'
import { PhysicalCountDocumentDetails } from './PhysicalCountDocumentDetails'
import { PhysicalCountInsightRail } from './PhysicalCountInsightRail'
import { PhysicalCountSetup, DEFAULT_SETUP } from './PhysicalCountSetup'
import type { CountSetup } from './PhysicalCountSetup'
import { PhysicalCountSummary } from './PhysicalCountSummary'
import { PostPhysicalCountDialog } from './PostPhysicalCountDialog'
import { ScannerDrawer } from './ScannerDrawer'
import { SerialCountDrawer } from './SerialCountDrawer'

/**
 * Physical Stock Count — the counting workspace.
 *
 * Replaces the generic document form for this one type, and only for this one
 * type: `DocumentFormPage` still routes every other native type to
 * `DocumentForm`, and everything underneath is shared. The draft shape
 * (`HeaderDraft` / `LineDraft`), the validation (`validateDraft`), the payload
 * (`toPayload`), the endpoints (`documentsApi.create` / `update` / `post`), the
 * negative-stock override and the permission keys are the ones the rest of
 * Documents uses. Nothing about how a physical count POSTS has changed.
 *
 * What is new is everything around the act of counting: a snapshot loader that
 * batches its reads, derived figures that update as the operator types, a rule
 * engine that flags what looks wrong, and a readiness gate that says what has
 * to be fixed before the server will accept the document.
 *
 * ## Permissions
 *
 * `reports.valuation.read` gates unit cost, and with it variance value, the
 * value KPI, the value filter and the trend card — the same key the valuation
 * endpoint itself enforces, so the screen and the API agree about who may see
 * cost. `documents.physical_adjustment.post` (or `documents.post`) gates the
 * Post action; a profile that may create but not post keeps Save draft.
 *
 * ## Saving
 *
 * There is no autosave in Inventory today, so the footer says "unsaved changes"
 * and means it. Nothing here pretends a draft is safe when it is only in a tab.
 */

export interface PhysicalStockCountPageProps {
  spec: DocumentTypeSpec
  /** Editing an existing draft. */
  documentId?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  /** Status of the stored document, for the header badge. */
  status?: string
  documentNo?: string | null
  onSaved: (doc: InventoryDocument, posted: boolean) => void
}

export function PhysicalStockCountPage({
  spec,
  documentId,
  initial,
  status = 'DRAFT',
  documentNo = null,
  onSaved,
}: PhysicalStockCountPageProps) {
  const toast = useToast()
  const { can } = useAccess()
  const { scope } = useCompany()
  const { warehouses, defaultWarehouseId, warehouseName, error: refError } = useReferenceData()

  // --- draft -------------------------------------------------------------
  const [header, setHeader] = useState<HeaderDraft>(() => initial?.header ?? newHeader(spec, todayIso()))
  const [lines, setLines] = useState<LineDraft[]>(() => initial?.lines ?? [])
  const [snapshots, setSnapshots] = useState<Record<string, LineSnapshot>>({})
  const [setup, setSetup] = useState<CountSetup>(DEFAULT_SETUP)
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [dirty, setDirty] = useState(false)

  // --- request state -----------------------------------------------------
  const [loadingSheet, setLoadingSheet] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadNotes, setLoadNotes] = useState<string[]>([])
  const [loadedCount, setLoadedCount] = useState<number | null>(initial?.lines?.length ?? null)
  const [busy, setBusy] = useState<'save' | 'post' | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [apiError, setApiError] = useState<string | null>(null)
  const [negative, setNegative] = useState<NegativeStockDetail[] | null>(null)
  const [override, setOverride] = useState(false)
  const [warnings, setWarnings] = useState<PostingWarning[]>([])

  // --- screen state ------------------------------------------------------
  const [filters, setFilters] = useState<CountFilters>(DEFAULT_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [postOpen, setPostOpen] = useState(false)
  const [serialKey, setSerialKey] = useState<string | null>(null)
  const [batchKey, setBatchKey] = useState<string | null>(null)
  const [highlightKey, setHighlightKey] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<null | (() => void)>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // --- permissions -------------------------------------------------------
  // The same key `ValuationController::unitCosts` authorizes, so the screen and
  // the endpoint cannot disagree about who may see cost.
  const canViewCost = can('reports.valuation.read')
  const canPost = can(permissionKeysFor('post', spec.code))
  const canOverride = can('stock.negative_override')
  const canSave = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)

  // --- company currency --------------------------------------------------
  const settings = useQuery((signal) => settingsApi.get(signal), [scope?.cmp_id], { enabled: scope !== null })
  const currencyCode = settings.data?.base_currency_code?.trim() || null
  const money = useCallback(
    (value: number) => {
      // No symbol until the company's own currency is known: a rupee sign on a
      // company that keeps its books in dirhams is worse than a bare number.
      const amount = formatMoney(value)
      return currencyCode ? `${currencySymbol(currencyCode)} ${amount}` : amount
    },
    [currencyCode],
  )

  // --- variance history --------------------------------------------------
  const history = useQuery((signal) => loadVarianceHistory(5, signal), [scope?.cmp_id, scope?.bo_id], {
    enabled: scope !== null && canViewCost,
  })

  // --- columns -----------------------------------------------------------
  const configurableColumns = useMemo(() => columnsFor(canViewCost), [canViewCost])
  const { visibility, setVisibility } = useColumnConfig(COUNT_COLUMNS_PREF_KEY, configurableColumns)

  // --- derived -----------------------------------------------------------
  const today = todayIso()
  const rows = useMemo(
    () => buildRows(lines, snapshots, { today, showCost: canViewCost }),
    [lines, snapshots, today, canViewCost],
  )
  const summary = useMemo(() => summarise(rows), [rows])

  const { insights, loading: insightsLoading, error: insightsError, refresh: refreshInsights } =
    usePhysicalCountInsights(rows, summary, { documentId: savedId })

  const readiness = useMemo(
    () => assessReadiness(rows, header, insights.anomalies),
    [rows, header, insights.anomalies],
  )

  const filtered = useMemo(() => filterRows(rows, filters, warehouseName), [rows, filters, warehouseName])

  /** Serial ids already spoken for, so a unit cannot be counted on two lines. */
  const serialOwners = useMemo(() => {
    const map = new Map<number, string>()
    for (const line of lines) for (const s of line.serials) map.set(s.serial_id, line.key)
    return map
  }, [lines])

  const offending = useMemo(() => new Set(negative ? offendingDraftKeys(lines, negative) : []), [negative, lines])

  const serialRow = useMemo(() => rows.find((r) => r.line.key === serialKey) ?? null, [rows, serialKey])
  const batchRow = useMemo(() => rows.find((r) => r.line.key === batchKey) ?? null, [rows, batchKey])
  const batchSiblings = useMemo(() => {
    if (!batchRow) return []
    return rows.filter(
      (r) => r.line.item_id === batchRow.line.item_id && r.line.warehouse_id === batchRow.line.warehouse_id,
    )
  }, [rows, batchRow])

  // --- effects -----------------------------------------------------------

  // Pre-fill the default warehouse once reference data lands (new documents only).
  useEffect(() => {
    if (documentId || header.default_warehouse_id !== null || defaultWarehouseId === null) return
    setHeader((h) => ({ ...h, default_warehouse_id: defaultWarehouseId }))
    setSetup((s) => (s.warehouseId === null ? { ...s, warehouseId: defaultWarehouseId } : s))
  }, [defaultWarehouseId, documentId, header.default_warehouse_id])

  // Editing: stored lines know their own unit and nothing else. One bulk lookup
  // restores the tracking flags and unit options the sheet needs, the same way
  // DocumentForm does it — never one request per line.
  const hydrated = useRef(false)
  useEffect(() => {
    if (!initial || hydrated.current) return undefined
    hydrated.current = true
    const ids = [...new Set(initial.lines.map((l) => l.item_id).filter((id): id is number => id !== null))]
    if (ids.length === 0) return undefined
    const controller = new AbortController()
    lookupApi
      .itemsByIds(ids, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        const byId = new Map(items.map((it) => [it.item_id, it]))
        setLines((ls) =>
          ls.map((l) => {
            const it = l.item_id !== null ? byId.get(l.item_id) : undefined
            if (!it) return l
            const units = unitOptionsFrom(it)
            return {
              ...l,
              item_sku: l.item_sku ?? it.item_sku,
              track_batch: l.track_batch || Number(it.track_batch) === 1,
              track_serial: l.track_serial || Number(it.track_serial) === 1,
              units: units.length > l.units.length ? units : l.units,
            }
          }),
        )
        setSnapshots((prev) => {
          const next = { ...prev }
          for (const l of initial.lines) {
            const it = l.item_id !== null ? byId.get(l.item_id) : undefined
            const units = it ? unitOptionsFrom(it) : []
            const def = units.find((u) => u.is_default) ?? units[0]
            next[l.key] = {
              ...(next[l.key] ?? {
                unitCost: null,
                availableQty: null,
                onHandQty: null,
                bookSerialCount: null,
                batchExpiry: null,
                warehouseName: null,
                unitSymbol: null,
              }),
              warehouseName: warehouseName(l.warehouse_id) || null,
              unitSymbol: def?.unit_symbol ?? null,
            }
          }
          return next
        })
      })
      .catch(() => {
        /* the stored unit still works; the sheet simply stays minimal */
      })
    return () => controller.abort()
  }, [initial, warehouseName])

  // Scroll a revealed row into view once it is on the rendered page.
  useEffect(() => {
    if (!highlightKey) return
    const el = document.getElementById(`count-row-${highlightKey}`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlightKey, filtered])

  // --- actions -----------------------------------------------------------

  const patchHeader = useCallback((patch: Partial<HeaderDraft>) => {
    setHeader((h) => ({ ...h, ...patch }))
    setDirty(true)
  }, [])

  const patchLine = useCallback((key: string, patch: Partial<LineDraft>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    setDirty(true)
  }, [])

  const removeLine = useCallback((key: string) => {
    setLines((ls) => ls.filter((l) => l.key !== key))
    setSnapshots((s) => {
      const next = { ...s }
      delete next[key]
      return next
    })
    setDirty(true)
  }, [])

  const toggleRecount = useCallback((key: string) => {
    setSnapshots((s) => ({ ...s, [key]: { ...(s[key] ?? EMPTY), recount: !(s[key]?.recount ?? false) } }))
    setDirty(true)
  }, [])

  const reveal = useCallback((lineKeys: string[], label: string) => {
    if (lineKeys.length === 0) return
    setFilters((f) => ({ ...f, lineKeys, lineKeysLabel: label }))
    setHighlightKey(lineKeys[0])
  }, [])

  const revealInsight = useCallback((insight: CountInsight) => reveal(insight.lineKeys, insight.title), [reveal])

  const loadSheet = useCallback(async () => {
    setLoadingSheet(true)
    setLoadError(null)
    setLoadNotes([])
    try {
      const result = await loadCountSheet({
        spec,
        warehouseId: setup.warehouseId,
        includeZeroBookQty: setup.includeZeroBookQty,
        loadBatchWise: setup.loadBatchWise,
        loadSerialWise: setup.loadSerialWise,
        withCost: canViewCost,
        warehouseName,
      })
      // Counts already entered survive a re-load.
      //
      // Loading again is the normal way to widen a count (another warehouse,
      // batch-wise instead of item-wise) or to resume a saved draft, and a
      // snapshot that wiped what somebody had already walked the aisles for
      // would be the worst bug this screen could have. Lines are re-identified
      // by item + warehouse + batch rather than by key, because a line restored
      // from a saved document carries a fresh key.
      const carried = new Map<string, { physical_qty: string; serials: typeof lines[number]['serials'] }>()
      for (const l of lines) {
        if (isCounted(l)) carried.set(identityOf(l), { physical_qty: l.physical_qty, serials: l.serials })
      }
      const matched = new Set<string>()
      const merged = result.lines.map((l) => {
        const id = identityOf(l)
        const prev = carried.get(id)
        if (!prev) return l
        matched.add(id)
        return { ...l, physical_qty: prev.physical_qty, serials: prev.serials }
      })

      // A counted line the new snapshot does not cover is kept rather than
      // dropped: it is somebody's work, and it is what the document would post.
      const orphans = lines.filter((l) => isCounted(l) && !matched.has(identityOf(l)))
      const nextLines = [...merged, ...orphans]
      const nextSnapshots = { ...result.snapshots }
      for (const l of orphans) if (snapshots[l.key]) nextSnapshots[l.key] = snapshots[l.key]

      const notes = [...result.notes]
      if (matched.size > 0) {
        notes.push(`${matched.size} counted quantit${matched.size === 1 ? 'y was' : 'ies were'} carried over to the reloaded sheet.`)
      }
      if (orphans.length > 0) {
        notes.push(`${orphans.length} counted line${orphans.length === 1 ? '' : 's'} outside this selection ${orphans.length === 1 ? 'was' : 'were'} kept.`)
      }

      setLines(nextLines)
      setSnapshots(nextSnapshots)
      setLoadNotes(notes)
      setLoadedCount(nextLines.length)
      setFilters((f) => ({ ...f, lineKeys: null, lineKeysLabel: null }))
      setDirty(nextLines.length > 0)
      toast.success(`${nextLines.length.toLocaleString()} line${nextLines.length === 1 ? '' : 's'} loaded.`)
    } catch (err) {
      setLoadError(errorMessage(err, 'Unable to load stock quantities.'))
      toast.error('Unable to load stock quantities.')
    } finally {
      setLoadingSheet(false)
    }
  }, [spec, setup, canViewCost, warehouseName, toast, lines, snapshots])

  const applyImport = useCallback(
    (preview: ImportPreview) => {
      setLines((ls) => applyPreview(ls, preview))
      setDirty(true)
      toast.success(
        `${preview.matched.length} counted quantit${preview.matched.length === 1 ? 'y' : 'ies'} applied from the file.`,
      )
    },
    [toast],
  )

  const persist = useCallback(
    async (post: boolean): Promise<void> => {
      setErrors([])
      setApiError(null)
      setWarnings([])
      if (!post) setNegative(null)

      // Only counted lines are submitted.
      //
      // A loaded-but-uncounted line has a book quantity and nothing else, and
      // `DocumentService::normalizeLines` rejects exactly that ("qty must be
      // greater than zero") — there is no column on `inv_document_lines` for
      // "this was on the sheet but nobody counted it". So the sheet's uncounted
      // rows stay working state in the browser, and the document carries what
      // was actually counted. Validation runs over the same set the payload
      // does, so it cannot pass here and fail on the server.
      const submitted = lines.filter((l) => isCounted(l))
      const errs = validateDraft(header, submitted, spec)
      if (errs.length) {
        setErrors(errs)
        toast.error('Fix the highlighted problems before saving.')
        return
      }

      const payload = toPayload(header, submitted, spec)
      setBusy(post ? 'post' : 'save')
      let id = savedId
      try {
        let doc: InventoryDocument
        if (id) doc = await documentsApi.update(id, payload)
        else {
          doc = await documentsApi.create(payload)
          id = doc.document_id
          setSavedId(id)
        }
        if (post) {
          doc = await documentsApi.post(doc.document_id, { negativeOverride: override && canOverride })
          setWarnings(doc.warnings ?? [])
          toast.success(`Physical stock count ${doc.document_no ?? `#${doc.document_id}`} posted.`)
        } else {
          const skipped = lines.filter((l) => !isBlankLine(l) && !isCounted(l)).length
          toast.success(
            skipped > 0
              ? `Draft saved. ${skipped.toLocaleString()} uncounted line${skipped === 1 ? '' : 's'} were not stored — load book quantities again to carry on counting.`
              : 'Physical stock count saved as draft.',
          )
        }
        setDirty(false)
        setPostOpen(false)
        onSaved(doc, post)
      } catch (err) {
        const neg = parseNegativeStock(err)
        if (neg) {
          setNegative(neg)
          setApiError(
            id
              ? `Draft #${id} is saved but could not be posted: ${errorMessage(err)}`
              : errorMessage(err, 'Unable to post the physical stock count.'),
          )
        } else {
          setApiError(describeError(err, post))
        }
        toast.error(post ? 'Unable to post the physical stock count.' : 'Unable to save the draft.')
      } finally {
        setBusy(null)
      }
    },
    [header, lines, spec, savedId, override, canOverride, onSaved, toast],
  )

  // Ctrl+S saves the draft, Ctrl+Enter opens the posting confirmation. Both are
  // registered in the `form` scope, above the page but below a modal, so a
  // dialog's own bindings still win. Ctrl+K stays the command palette's.
  useKeyboardScope(
    'form',
    useMemo(
      () => ({
        'ctrl+s': (e: KeyboardEvent) => {
          e.preventDefault()
          if (busy || !canSave) return
          void persist(false)
        },
        'ctrl+enter': (e: KeyboardEvent) => {
          e.preventDefault()
          if (busy || !canPost || lines.length === 0) return
          setPostOpen(true)
        },
      }),
      [busy, canSave, canPost, lines.length, persist],
    ),
    { allowInInput: true },
  )

  useUnsavedChanges({
    when: dirty && busy === null,
    onBlocked: (_to, proceed) => setLeaving(() => proceed),
  })

  const activeLines = lines.filter((l) => !isBlankLine(l))
  const statusLabel = STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status

  return (
    <PageShell paddingBottom fullBleed>
      <BreadcrumbHeader
        breadcrumbs={[
          { label: 'Documents', to: '/documents' },
          { label: 'Physical Stock Count' },
        ]}
        title={savedId ? `Physical stock count ${documentNo ?? `#${savedId}`}` : 'Physical stock count'}
        description="Compare book quantity against counted quantity by item and warehouse. Identify variances and keep your inventory accurate."
        icon={ClipboardCheck}
        badge={<Badge tone={status === 'DRAFT' ? 'neutral' : 'info'}>{statusLabel}</Badge>}
        escDirty={dirty}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={Upload}
              onClick={() => setImportOpen(true)}
              disabled={busy !== null}
            >
              Import count sheet
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={ScanBarcode}
              onClick={() => setScannerOpen(true)}
              disabled={busy !== null || activeLines.length === 0}
              title={activeLines.length === 0 ? 'Load book quantities first' : 'Count with a handheld scanner'}
            >
              Scan items
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={Sparkles}
              onClick={() => setAssistOpen(true)}
              className="border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-300 hover:bg-violet-100 hover:text-violet-800"
            >
              Assist
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void persist(false)}
              loading={busy === 'save'}
              disabled={busy !== null || !canSave}
            >
              {savedId ? 'Save changes' : 'Save draft'}
            </Button>
            {canPost ? (
              <Button
                size="sm"
                icon={ShieldCheck}
                onClick={() => setPostOpen(true)}
                disabled={busy !== null || activeLines.length === 0}
              >
                Save &amp; post
              </Button>
            ) : null}
          </>
        }
      />

      {refError ? <Notice kind="warning">{refError}</Notice> : null}

      <PhysicalCountSummary
        summary={summary}
        money={money}
        showCost={canViewCost}
        loading={loadingSheet && lines.length === 0}
        onFilter={(preset) => setFilters((f) => ({ ...f, preset, lineKeys: null, lineKeysLabel: null }))}
      />

      <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <PhysicalCountDocumentDetails
            header={header}
            onChange={patchHeader}
            warehouses={warehouses}
            disabled={busy !== null}
            errors={
              errors.some((e) => e.toLowerCase().includes('document date'))
                ? { document_date: 'Enter the document date.' }
                : {}
            }
          />

          <PhysicalCountSetup
            setup={setup}
            onChange={(patch) => setSetup((s) => ({ ...s, ...patch }))}
            warehouses={warehouses}
            onLoad={() => void loadSheet()}
            onImport={() => setImportOpen(true)}
            loading={loadingSheet}
            disabled={busy !== null}
            notes={loadNotes}
            loadedCount={loadedCount}
            error={loadError}
            onRetry={() => void loadSheet()}
            canImport={activeLines.length > 0}
          />

          {errors.length > 0 ? (
            <Notice kind="error" title="Fix before saving">
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {errors.slice(0, 8).map((e) => (
                  <li key={e}>{e}</li>
                ))}
                {errors.length > 8 ? <li>and {errors.length - 8} more.</li> : null}
              </ul>
            </Notice>
          ) : null}

          {apiError && !negative ? <Notice kind="error">{apiError}</Notice> : null}

          {negative ? (
            <Notice kind="error" title="Insufficient stock">
              {apiError ? <div className="mb-1">{apiError}</div> : null}
              <ul className="list-disc space-y-0.5 pl-4">
                {negative.map((d, i) => (
                  <li key={`${d.item_id}-${d.warehouse_id}-${i}`}>
                    {d.item_name ?? `Item #${d.item_id}`}: on hand {d.on_hand}, required {d.required}, short by{' '}
                    <strong>{d.short_by}</strong>
                  </li>
                ))}
              </ul>
              {canOverride ? (
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-primary focus:ring-primary/30"
                    checked={override}
                    onChange={(e) => setOverride(e.target.checked)}
                  />
                  Post anyway and let stock go negative
                </label>
              ) : (
                <p className="mt-1 text-xs">
                  Posting into negative stock needs the &ldquo;override negative-stock block&rdquo; permission.
                </p>
              )}
            </Notice>
          ) : null}

          {warnings.length > 0 ? (
            <Notice kind="warning" title="Posted with warnings">
              <ul className="list-disc space-y-0.5 pl-4">
                {warnings.map((w, i) => (
                  <li key={`${w.code}-${i}`}>{w.message}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          <CountSheet
            rows={filtered}
            totalRows={rows.length}
            filters={filters}
            onFiltersChange={setFilters}
            onOpenFilters={() => setFiltersOpen(true)}
            visibility={visibility}
            onVisibilityChange={setVisibility}
            onPatchLine={patchLine}
            onRemoveLine={removeLine}
            onOpenSerials={(row) => setSerialKey(row.line.key)}
            onOpenBatches={(row) => setBatchKey(row.line.key)}
            onToggleRecount={toggleRecount}
            warehouseName={warehouseName}
            money={money}
            showCost={canViewCost}
            canRemoveLines={canSave}
            highlightKey={highlightKey}
            loading={loadingSheet}
            disabled={busy !== null}
            searchInputRef={searchRef}
            onLoad={() => void loadSheet()}
            onImport={() => setImportOpen(true)}
            canImport={activeLines.length > 0}
          />

          {offending.size > 0 ? (
            <p className="text-[11px] text-red-600">
              {offending.size} line{offending.size === 1 ? '' : 's'} named in the negative-stock block above.
            </p>
          ) : null}
        </div>

        <PhysicalCountInsightRail
          insights={insights}
          insightsLoading={insightsLoading}
          insightsError={insightsError}
          onReveal={revealInsight}
          onOpenAssist={() => setAssistOpen(true)}
          onRefresh={refreshInsights}
          rows={rows}
          extra={insights.anomalies}
          onRevealLines={reveal}
          points={history.data}
          historyLoading={history.loading}
          money={money}
          showCost={canViewCost}
        />
      </div>

      <StickyActionBar
        status={
          <span className="flex items-center gap-2">
            {readiness.canPost && !dirty ? (
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            ) : (
              <CircleAlert
                className={`h-4 w-4 shrink-0 ${readiness.canPost ? 'text-gray-400' : 'text-amber-500'}`}
                aria-hidden
              />
            )}
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-gray-900">{readiness.summary}</span>
              {/* Inventory has no draft autosave, so this never claims one. */}
              <span className="block text-[11px] text-gray-500">
                {dirty
                  ? 'Unsaved changes — save the draft before leaving.'
                  : savedId
                    ? `Saved as draft #${savedId}.`
                    : 'Nothing entered yet.'}
              </span>
            </span>
          </span>
        }
        totals={
          <>
            <span className="text-xs text-gray-600">
              {summary.countedLines}/{summary.itemsLoaded} counted
            </span>
            {canViewCost && summary.varianceValue !== null ? (
              <span className="text-xs text-gray-600">
                Variance <strong className="tabular-nums">{money(summary.varianceValue)}</strong>
              </span>
            ) : null}
          </>
        }
      >
        <Link
          className="inline-flex h-8 items-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 no-underline transition-colors hover:border-primary/40 hover:bg-primary-light hover:text-primary"
          to={savedId ? `/documents/${savedId}` : '/documents'}
        >
          Cancel
        </Link>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void persist(false)}
          loading={busy === 'save'}
          disabled={busy !== null || !canSave}
        >
          {savedId ? 'Save changes' : 'Save draft'}
        </Button>
        {canPost ? (
          <Button
            size="sm"
            icon={ShieldCheck}
            onClick={() => setPostOpen(true)}
            disabled={busy !== null || activeLines.length === 0}
          >
            Save &amp; post
          </Button>
        ) : null}
      </StickyActionBar>

      <CountSheetFilters
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        onApply={setFilters}
        warehouses={warehouses}
        showCost={canViewCost}
      />

      <ScannerDrawer
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        rows={rows}
        onPatchLine={patchLine}
        onHighlight={setHighlightKey}
        warehouseName={warehouseName}
        disabled={busy !== null}
      />

      <CountSheetImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        rows={rows}
        lines={lines}
        warehouseName={warehouseName}
        onApply={applyImport}
        scopeLabel={scope ? String(scope.cmp_id) : ''}
      />

      <SerialCountDrawer
        row={serialRow}
        onClose={() => setSerialKey(null)}
        onApply={(lineKey, serials: LineSerial[]) => {
          patchLine(lineKey, { serials })
          setSerialKey(null)
        }}
        usedElsewhere={serialOwners}
        warehouseName={warehouseName}
        disabled={busy !== null}
      />

      <BatchCountDrawer
        row={batchRow}
        siblings={batchSiblings}
        onClose={() => setBatchKey(null)}
        onPatchLine={patchLine}
        disabled={busy !== null}
      />

      <AssistDrawer
        open={assistOpen}
        onClose={() => setAssistOpen(false)}
        rows={rows}
        summary={summary}
        insights={insights}
        readiness={readiness}
        money={money}
        showCost={canViewCost}
        onReveal={reveal}
      />

      <PostPhysicalCountDialog
        open={postOpen}
        onClose={() => setPostOpen(false)}
        onConfirm={() => void persist(true)}
        summary={summary}
        readiness={readiness}
        money={money}
        showCost={canViewCost}
        posting={busy === 'post'}
        onReveal={reveal}
        documentNo={documentNo}
      />

      <ConfirmDialog
        open={leaving !== null}
        title="Discard unsaved changes?"
        message="The counted quantities on this sheet have not been saved. Leaving now loses them."
        confirmLabel="Discard"
        danger
        onCancel={() => setLeaving(null)}
        onConfirm={() => {
          const proceed = leaving
          setLeaving(null)
          setDirty(false)
          // The guard reads `dirty` through a ref on the next tick, so the
          // navigation is queued rather than fired inside this handler.
          setTimeout(() => proceed?.(), 0)
        }}
      />
    </PageShell>
  )
}

/** What makes two count lines the same line, across a reload or a saved draft. */
function identityOf(line: Pick<LineDraft, 'item_id' | 'warehouse_id' | 'batch_id'>): string {
  return `${line.item_id ?? ''}|${line.warehouse_id ?? ''}|${line.batch_id ?? ''}`
}

const EMPTY: LineSnapshot = {
  unitCost: null,
  availableQty: null,
  onHandQty: null,
  bookSerialCount: null,
  batchExpiry: null,
  warehouseName: null,
  unitSymbol: null,
}

function describeError(err: unknown, posting: boolean): string {
  if (isApiError(err)) {
    return err.field ? `${err.message} (${err.field})` : err.message
  }
  return errorMessage(err, posting ? 'Unable to post the physical stock count.' : 'Unable to save the draft.')
}

export default PhysicalStockCountPage
