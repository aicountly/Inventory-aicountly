import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, Printer, Save } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { useScopeLabel } from '../../company/useScopeLabel'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Notice } from '../../components/Notice'
import { useBaseCurrency } from '../../hooks/useBaseCurrency'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { errorMessage, isAbortError, isApiError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { lookupApi } from '../../services/lookupApi'
import { availabilityApi } from '../../services/stockApi'
import type { AvailabilityCheckLine } from '../../services/stockApi'
import { Button } from '../../ui/Button'
import { Skeleton } from '../../ui/Skeleton'
import { StatusBadge } from '../../ui/StatusBadge'
import { notify } from '../../ui/notify'
import { PageShell } from '../../ui/shell/PageShell'
import { StickyActionBar } from '../../ui/shell/StickyActionBar'
import { AIC, cx } from '../../ui/cx'
import { formatMoney, formatQty, todayIso } from '../../utils/format'
import { canCreate, permissionKeysFor } from '../actions'
import { draftFromDocument, lineBaseQty, newHeader, toPayload } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { offendingDraftKeys, parseNegativeStock } from '../negativeStock'
import type { NegativeStockDetail } from '../negativeStock'
import type { DocumentTypeSpec } from '../registry'
import type { InventoryDocument, PostingWarning } from '../types'
import { useAvailability } from '../useAvailability'
import type { AvailabilityEntry } from '../useAvailability'
import { useReferenceData } from '../useReferenceData'
import { unitOptionsFrom } from '../LineEditor'
import { AssemblyDetailsCard } from './AssemblyDetailsCard'
import { AssemblyPageHeader } from './AssemblyPageHeader'
import { AssemblyPreviewDialog } from './AssemblyPreviewDialog'
import { AssemblySummaryStrip } from './AssemblySummaryStrip'
import type { PostAssemblyStock } from './AssemblySummaryStrip'
import { BomImportDialog } from './BomImportDialog'
import type { BomImportResult } from './BomImportDialog'
import { ComponentAvailabilityPanel } from './ComponentAvailabilityPanel'
import { ComponentLinesCard } from './ComponentLinesCard'
import { FinishedGoodCard } from './FinishedGoodCard'
import { MultiItemPickerDialog } from './MultiItemPickerDialog'
import { RecentAssemblies } from './RecentAssemblies'
import { assemblyInsights } from './assemblyInsights'
import type { AssemblyInsight } from './assemblyInsights'
import {
  assemblyCost,
  canSaveDraft,
  filledComponents,
  hasErrors,
  joinAssemblyLines,
  mergeComponents,
  modeFromMetadata,
  newAssemblySplit,
  newComponentLine,
  newFinishedLine,
  splitAssemblyLines,
  validateAssembly,
  withEstimatedValuationRate,
} from './assemblyModel'
import type { AssemblyErrors, AssemblyMode, AssemblySplit } from './assemblyModel'
import { COST_PERMISSION, useAssemblyUnitCosts } from './useAssemblyUnitCosts'
import { useRecentAssemblies } from './useRecentAssemblies'

export interface AssemblyPageProps {
  spec: DocumentTypeSpec
  /** Editing an existing draft. */
  documentId?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  /** Version / status line for an existing document. */
  statusBadge?: ReactNode
  onSaved: (doc: InventoryDocument, posted: boolean) => void
}

const ERROR_SUMMARY_ID = 'assembly-error-summary'
const AVAILABILITY_ID = 'assembly-availability'

/** Nothing marked, nothing listed — what the form shows before it has been asked to save. */
const NO_ERRORS: AssemblyErrors = { header: {}, components: {}, finished: {}, summary: [] }

/**
 * `/documents/new/assembly` and the edit form of an existing one.
 *
 * The screen's whole idea is the split: what is consumed on the left, what is built on the right,
 * and what it costs underneath. Everything below that is the same machinery every other document
 * editor uses — the same `LineDraft`, the same `toPayload`, the same create-then-post order, the
 * same negative-stock handling — so a draft raised here opens in the generic editor and back.
 */
export function AssemblyPage({ spec, documentId, initial, statusBadge, onSaved }: AssemblyPageProps) {
  const navigate = useNavigate()
  const { can } = useAccess()
  const { companyName } = useCompany()
  const scopeLabel = useScopeLabel()
  const currency = useBaseCurrency()
  const { warehouses, defaultWarehouseId, warehouseName, loading: refLoading, error: refError } = useReferenceData()

  const [header, setHeader] = useState<HeaderDraft>(() => initial?.header ?? newHeader(spec, todayIso()))
  const [split, setSplit] = useState<AssemblySplit>(() => {
    if (!initial) return newAssemblySplit(spec, null)
    const stored = splitAssemblyLines(initial.lines)
    // A stored assembly always has an output; one that somehow does not gets an empty slot rather
    // than a card with nothing behind it.
    return stored.finished ? stored : { ...stored, finished: newFinishedLine(spec, null) }
  })
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [dirty, setDirty] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [negative, setNegative] = useState<NegativeStockDetail[] | null>(null)
  const [override, setOverride] = useState(false)
  const [warnings, setWarnings] = useState<PostingWarning[]>([])
  const [busy, setBusy] = useState<'save' | 'post' | null>(null)
  const inFlight = useRef(false)

  const [bomOpen, setBomOpen] = useState(false)
  const [multiOpen, setMultiOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [leaveTo, setLeaveTo] = useState<{ to: string; proceed: () => void } | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)

  const mode = modeFromMetadata(header.metadata)
  const canOverride = can('stock.negative_override')
  const canPost = can(permissionKeysFor('post', spec.code))
  const canEditDoc = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)
  const costHidden = !can(COST_PERMISSION)
  const disabled = busy !== null

  // --- pre-fill the default warehouse once reference data lands (new documents only) -------------
  useEffect(() => {
    if (documentId || header.default_warehouse_id !== null || defaultWarehouseId === null) return
    setHeader((h) => ({ ...h, default_warehouse_id: defaultWarehouseId }))
    setSplit((s) => ({
      components: s.components.map((l) => (l.warehouse_id === null && l.origin === 'manual' ? { ...l, warehouse_id: defaultWarehouseId } : l)),
      finished: s.finished && s.finished.warehouse_id === null ? { ...s.finished, warehouse_id: defaultWarehouseId } : s.finished,
      extraOutputs: s.extraOutputs,
    }))
  }, [defaultWarehouseId, documentId, header.default_warehouse_id])

  // --- editing: stored lines know only their own unit, so fetch the items once ------------------
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
        const hydrate = (line: LineDraft): LineDraft => {
          const item = line.item_id !== null ? byId.get(line.item_id) : undefined
          if (!item) return line
          const units = unitOptionsFrom(item)
          return {
            ...line,
            item_sku: line.item_sku ?? item.item_sku,
            track_batch: line.track_batch || Number(item.track_batch) === 1,
            track_serial: line.track_serial || Number(item.track_serial) === 1,
            units: units.length > line.units.length ? units : line.units,
          }
        }
        setSplit((s) => ({
          components: s.components.map(hydrate),
          finished: s.finished ? hydrate(s.finished) : null,
          extraOutputs: s.extraOutputs.map(hydrate),
        }))
      })
      .catch(() => {
        /* the stored unit still works; the pickers just stay minimal */
      })
    return () => controller.abort()
  }, [initial])

  // --- derived -----------------------------------------------------------------------------------
  const finished = split.finished ?? newFinishedLine(spec, header.default_warehouse_id)
  const componentItemIds = useMemo(
    () => filledComponents(split.components).map((l) => l.item_id).filter((id): id is number => id !== null),
    [split.components],
  )
  const unitCosts = useAssemblyUnitCosts(componentItemIds, {
    asOf: header.document_date,
    warehouseId: header.default_warehouse_id,
  })
  const cost = useMemo(
    () => assemblyCost(split.components, split.finished, unitCosts.costOf),
    [split.components, split.finished, unitCosts.costOf],
  )

  const availabilityEntries = useMemo<AvailabilityEntry[]>(
    () =>
      filledComponents(split.components)
        .filter((l) => l.item_id !== null && lineBaseQty(l) > 0)
        .map((l) => {
          const line: AvailabilityCheckLine = {
            item_id: l.item_id as number,
            warehouse_id: l.warehouse_id ?? header.default_warehouse_id ?? null,
            batch_id: l.batch_id,
            qty: lineBaseQty(l),
          }
          return { key: l.key, line }
        }),
    [split.components, header.default_warehouse_id],
  )
  const availability = useAvailability(availabilityEntries, true)

  const errors = useMemo(
    () => validateAssembly(header, split, { posting: true }),
    [header, split],
  )
  const visibleErrors = showErrors ? errors : NO_ERRORS

  const offending = useMemo(
    () => new Set(negative ? offendingDraftKeys(joinAssemblyLines(split), negative) : []),
    [negative, split],
  )

  const recent = useRecentAssemblies(5)

  // --- the finished item's current stock, for the post-assembly KPI ------------------------------
  const [postStock, setPostStock] = useState<PostAssemblyStock | null>(null)
  const [postStockLoading, setPostStockLoading] = useState(false)
  const finishedItemId = split.finished?.item_id ?? null
  const finishedWarehouseId = split.finished?.warehouse_id ?? header.default_warehouse_id ?? null
  useEffect(() => {
    if (finishedItemId === null) {
      setPostStock(null)
      return undefined
    }
    const controller = new AbortController()
    setPostStockLoading(true)
    availabilityApi
      .forItems([finishedItemId], finishedWarehouseId, false, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return
        const row = rows[0]
        setPostStock(
          row
            ? { onHand: Number(row.on_hand) || 0, warehouseName: warehouseName(finishedWarehouseId) || 'all warehouses' }
            : null,
        )
        setPostStockLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        // A profile that may not read stock summaries still gets the rest of the strip.
        setPostStock(null)
        setPostStockLoading(false)
      })
    return () => controller.abort()
  }, [finishedItemId, finishedWarehouseId, warehouseName])

  // --- a bill of materials for the chosen finished item, for the assistant ------------------------
  const [bomForFinished, setBomForFinished] = useState<{ bom_id: number; bom_name: string } | null>(null)
  const finishedItemName = split.finished?.item_name ?? ''
  useEffect(() => {
    if (finishedItemId === null || finishedItemName.trim() === '') {
      setBomForFinished(null)
      return undefined
    }
    const controller = new AbortController()
    lookupApi
      .boms(finishedItemName.trim(), controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return
        const match = res.data.find((b) => b.finished_item_id === finishedItemId)
        setBomForFinished(match ? { bom_id: match.bom_id, bom_name: match.bom_name } : null)
      })
      .catch(() => setBomForFinished(null))
    return () => controller.abort()
  }, [finishedItemId, finishedItemName])

  const insights = useMemo(
    () =>
      assemblyInsights({
        components: split.components,
        finished: split.finished,
        availability: availability.results,
        cost,
        bomForFinished,
        mode,
        lastAssembly: recent.rows[0]
          ? {
              document_id: recent.rows[0].document_id,
              document_no: recent.rows[0].document_no,
              finished_item: recent.rows[0].finishedItem,
            }
          : null,
      }),
    [split.components, split.finished, availability.results, cost, bomForFinished, mode, recent.rows],
  )

  // --- mutation ----------------------------------------------------------------------------------
  const patchHeader = useCallback((patch: Partial<HeaderDraft>) => {
    setDirty(true)
    setHeader((h) => ({ ...h, ...patch }))
  }, [])

  const setComponents = useCallback((components: LineDraft[]) => {
    setDirty(true)
    setSplit((s) => ({ ...s, components }))
  }, [])

  const patchFinished = useCallback(
    (patch: Partial<LineDraft>) => {
      setDirty(true)
      setSplit((s) => ({
        ...s,
        finished: { ...(s.finished ?? newFinishedLine(spec, header.default_warehouse_id)), ...patch },
      }))
    },
    [spec, header.default_warehouse_id],
  )

  const addComponentRow = useCallback(() => {
    setDirty(true)
    setSplit((s) => ({ ...s, components: [...s.components, newComponentLine(spec, header.default_warehouse_id)] }))
  }, [spec, header.default_warehouse_id])

  const setMode = (next: AssemblyMode) => {
    patchHeader({ metadata: { ...header.metadata, assembly_mode: next } })
    if (next === 'bom') setBomOpen(true)
  }

  const applyBomImport = (result: BomImportResult) => {
    setDirty(true)
    setSplit((s) => ({
      components: mergeComponents(s.components, result.components, result.strategy),
      finished:
        result.finished && (result.strategy === 'replace' || s.finished === null || s.finished.item_id === null)
          ? { ...result.finished, warehouse_id: result.finished.warehouse_id ?? header.default_warehouse_id }
          : s.finished,
      extraOutputs: s.extraOutputs,
    }))
    patchHeader({
      metadata: { ...header.metadata, assembly_mode: 'bom', bom_id: result.bomId, production_qty: result.outputQty },
    })
    setBomOpen(false)
    notify.success(
      `${result.components.length} component${result.components.length === 1 ? '' : 's'} imported from ${result.bomName}.`,
    )
  }

  const copyLastAssembly = async () => {
    const last = recent.rows[0]
    if (!last) return
    try {
      const doc = await documentsApi.get(last.document_id)
      // The shared stored → draft conversion, not a second reading of the same rows.
      const draft = draftFromDocument(doc, spec)
      // A copy takes the RECIPE, not the record. The serial numbers that document consumed are
      // gone from stock, its batch allocations were chosen against balances that have since moved,
      // and its valuation rate was the cost of that run — carrying any of them forward would post
      // a second document claiming stock the first one already took.
      const fresh = (line: LineDraft): LineDraft => ({
        ...line,
        batch_id: null,
        batch_no: null,
        serials: [],
        valuation_rate: '',
        rate: '',
        amount: '',
      })
      const copied = splitAssemblyLines(draft.lines.map(fresh))
      setDirty(true)
      setSplit({
        ...copied,
        finished: copied.finished ?? newFinishedLine(spec, header.default_warehouse_id),
      })
      // A copy is a NEW document: it keeps the recipe and takes today's date and its own number.
      patchHeader({
        narration: draft.header.narration,
        metadata: { ...draft.header.metadata, assembly_mode: modeFromMetadata(draft.header.metadata) },
      })
      notify.success(`Copied ${last.document_no ?? `#${last.document_id}`}. Check the quantities before posting.`)
    } catch (err) {
      notify.error(errorMessage(err, 'That assembly could not be copied.'))
    }
  }

  const onInsightAction = (insight: AssemblyInsight) => {
    switch (insight.kind) {
      case 'bom_available':
        setBomOpen(true)
        break
      case 'repeat_last':
        void copyLastAssembly()
        break
      case 'shortage':
        document.getElementById(AVAILABILITY_ID)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        break
      default:
        break
    }
  }

  // --- save / post --------------------------------------------------------------------------------
  const submit = useCallback(
    async (post: boolean) => {
      if (inFlight.current) return
      setApiError(null)
      setWarnings([])
      if (!post) setNegative(null)

      const validation = validateAssembly(header, split, { posting: post })
      if (hasErrors(validation)) {
        setShowErrors(true)
        // Announce where the trouble is rather than only marking it below the fold.
        document.getElementById(ERROR_SUMMARY_ID)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
      setShowErrors(false)

      const finishedLine = split.finished ? withEstimatedValuationRate(split.finished, cost) : null
      // The mode is stamped on every save, not only when it is changed: reopening a document
      // should say how it was raised, and a default that is never written cannot.
      const stamped: HeaderDraft = { ...header, metadata: { ...header.metadata, assembly_mode: mode } }
      const payload = toPayload(stamped, joinAssemblyLines({ ...split, finished: finishedLine }), spec)

      inFlight.current = true
      setBusy(post ? 'post' : 'save')
      let id = savedId
      try {
        let doc: InventoryDocument
        if (id) {
          doc = await documentsApi.update(id, payload)
        } else {
          doc = await documentsApi.create(payload)
          id = doc.document_id
          setSavedId(id)
        }
        if (post) {
          doc = await documentsApi.post(doc.document_id, { negativeOverride: override && canOverride })
          setWarnings(doc.warnings ?? [])
          setDirty(false)
          notify.success(`Assembly ${doc.document_no ?? `#${doc.document_id}`} posted.`)
          onSaved(doc, true)
          return
        }
        setDirty(false)
        recent.reload()
        notify.success(`Draft ${doc.document_no ?? `#${doc.document_id}`} saved.`)
      } catch (err) {
        const neg = parseNegativeStock(err)
        if (neg) {
          setNegative(neg)
          setApiError(id ? `Draft #${id} is saved but could not be posted: ${errorMessage(err)}` : errorMessage(err))
        } else if (isApiError(err)) {
          setApiError(err.field ? `${err.message} (${err.field})` : err.message)
        } else {
          setApiError(errorMessage(err, post ? 'Assembly could not be posted.' : 'Assembly could not be saved.'))
        }
      } finally {
        inFlight.current = false
        setBusy(null)
      }
    },
    [header, mode, split, spec, cost, savedId, override, canOverride, onSaved, recent],
  )

  // --- keyboard -----------------------------------------------------------------------------------
  const bindings = useMemo(
    () => ({
      'ctrl+s': (e: KeyboardEvent) => {
        e.preventDefault()
        if (!disabled && canEditDoc) void submit(false)
      },
      'ctrl+enter': (e: KeyboardEvent) => {
        e.preventDefault()
        if (!disabled && canPost) void submit(true)
      },
    }),
    [disabled, canEditDoc, canPost, submit],
  )
  useKeyboardScope('form', bindings, { allowInInput: true })

  // --- unsaved changes ------------------------------------------------------------------------------
  useUnsavedChanges({
    when: dirty && !disabled,
    onBlocked: (to, proceed) => setLeaveTo({ to, proceed }),
  })

  const draftSavable = canSaveDraft(header, split)
  const outputUnit = finished.units.find((u) => u.unit_id === finished.unit_id)?.unit_symbol ?? ''

  const initialLoading = refLoading && warehouses.length === 0

  return (
    <PageShell paddingBottom>
      <AssemblyPageHeader
        breadcrumbs={[
          { label: 'Documents', to: '/documents' },
          { label: 'Assembly', to: '/documents?document_type=ASSEMBLY' },
          { label: savedId ? `Draft #${savedId}` : 'New assembly' },
        ]}
        title={documentId ? 'Edit assembly' : 'New assembly'}
        description="Assemble a kit: consume components and create the finished item."
        badge={statusBadge}
        insights={insights}
        onInsightAction={onInsightAction}
        onImportBom={() => setBomOpen(true)}
        importDisabled={disabled}
      />

      {refError ? <Notice kind="warning">{refError}</Notice> : null}

      {initialLoading ? (
        <div className={cx(AIC, 'space-y-3')} aria-busy>
          <Skeleton height="h-40" rounded="xl" />
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,0.95fr)]">
            <Skeleton height="h-72" rounded="xl" />
            <Skeleton height="h-72" rounded="xl" />
          </div>
          <Skeleton height="h-24" rounded="xl" />
          <span className="sr-only">Loading the assembly form…</span>
        </div>
      ) : (
        <>
          <AssemblyDetailsCard
            header={header}
            mode={mode}
            warehouses={warehouses}
            warehousesLoading={refLoading}
            errors={visibleErrors}
            disabled={disabled}
            onPatch={patchHeader}
            onModeChange={setMode}
          />

          <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,0.95fr)]">
            <ComponentLinesCard
              components={split.components}
              warehouses={warehouses}
              defaultWarehouseId={header.default_warehouse_id}
              availability={availability.results}
              checkingAvailability={availability.checking}
              cost={cost}
              costHidden={costHidden}
              currencySymbol={currency.symbol}
              errors={visibleErrors}
              offendingKeys={offending}
              disabled={disabled}
              loading={refLoading}
              onChange={setComponents}
              onAddRow={addComponentRow}
              onImportBom={() => setBomOpen(true)}
              onAddMultiple={() => setMultiOpen(true)}
              footer={
                <div id={AVAILABILITY_ID}>
                  <ComponentAvailabilityPanel
                    components={split.components}
                    results={availability.results}
                    checking={availability.checking}
                    error={availability.error}
                    checkedAt={availability.checkedAt}
                    onRefresh={availability.refresh}
                    disabled={disabled}
                  />
                </div>
              }
            />

            <FinishedGoodCard
              finished={finished}
              warehouses={warehouses}
              defaultWarehouseId={header.default_warehouse_id}
              cost={cost}
              costHidden={costHidden}
              costLoading={unitCosts.loading}
              currencySymbol={currency.symbol}
              errors={visibleErrors}
              disabled={disabled}
              onChange={patchFinished}
            />
          </div>

          {unitCosts.error ? <Notice kind="warning">{unitCosts.error}</Notice> : null}

          {split.extraOutputs.length > 0 ? (
            <Notice kind="info" title="This document has more than one output.">
              {split.extraOutputs.length} further inward line
              {split.extraOutputs.length === 1 ? '' : 's'} on this document are not edited here, and are kept exactly as
              they are when you save. Open it in the generic document editor to change them.
            </Notice>
          ) : null}

          <AssemblySummaryStrip
            cost={cost}
            costHidden={costHidden}
            currencySymbol={currency.symbol}
            outputQty={Number(finished.qty) || 0}
            outputUnit={outputUnit}
            postStock={postStock}
            postStockLoading={postStockLoading}
          />

          <div id={ERROR_SUMMARY_ID}>
            {showErrors && errors.summary.length > 0 ? (
              <Notice kind="error" title="Fix these before posting">
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {errors.summary.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            {apiError && !negative ? <Notice kind="error">{apiError}</Notice> : null}
            {negative ? (
              <Notice kind="error" title="Insufficient stock">
                {apiError ? <div>{apiError}</div> : null}
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {negative.map((d, i) => (
                    <li key={`${d.item_id}-${d.warehouse_id}-${i}`}>
                      {d.item_name ?? `Item #${d.item_id}`}
                      {d.warehouse_id ? ` · ${warehouseName(d.warehouse_id)}` : ''}: on hand {formatQty(d.on_hand)},
                      required {formatQty(d.required)}, short by <strong>{formatQty(d.short_by)}</strong>
                    </li>
                  ))}
                </ul>
                {canOverride ? (
                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                    Post anyway and let stock go negative (override)
                  </label>
                ) : (
                  <p className="mt-1 text-xs">
                    Reduce the quantities or receive stock first. Posting into negative stock needs the
                    &ldquo;override negative-stock block&rdquo; permission.
                  </p>
                )}
              </Notice>
            ) : null}
            {warnings.length > 0 ? (
              <Notice kind="warning" title="Posted with warnings">
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {warnings.map((w, i) => (
                    <li key={`${w.code}-${i}`}>{w.message}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
          </div>

          <RecentAssemblies
            rows={recent.rows}
            loading={recent.loading}
            error={recent.error}
            onReload={recent.reload}
            costHidden={costHidden}
            currencySymbol={currency.symbol}
          />
        </>
      )}

      <StickyActionBar
        totals={
          <>
            <span className="text-xs text-gray-500">
              {cost.rows.length} component{cost.rows.length === 1 ? '' : 's'}
              {!costHidden ? (
                <>
                  {' · '}
                  <strong className="font-semibold tabular-nums text-gray-800">
                    {currency.symbol} {formatMoney(cost.componentCost)}
                  </strong>
                </>
              ) : null}
            </span>
            {savedId ? (
              <span className="text-xs text-gray-500">
                <StatusBadge value="draft" size="xs" />{' '}
                <Link to={`/documents/${savedId}`} className="font-semibold text-primary hover:underline">
                  #{savedId}
                </Link>
              </span>
            ) : null}
          </>
        }
      >
        <Button
          variant="ghost"
          onClick={() => (dirty ? setDiscardOpen(true) : navigate(savedId ? `/documents/${savedId}` : '/documents'))}
          disabled={disabled}
        >
          Cancel
        </Button>
        <Button variant="secondary" icon={Eye} onClick={() => setPreviewOpen(true)} disabled={disabled}>
          Preview
        </Button>
        <Button
          variant="secondary"
          icon={Printer}
          onClick={() => savedId && navigate(`/documents/${savedId}/print`)}
          disabled={disabled || savedId === null}
          title={savedId === null ? 'Save the assembly first — the printed document comes from the saved record.' : undefined}
        >
          Print
        </Button>
        <Button
          variant="secondary"
          icon={Save}
          onClick={() => void submit(false)}
          loading={busy === 'save'}
          disabled={disabled || !canEditDoc || !draftSavable}
          kbd="Ctrl S"
        >
          {savedId ? 'Save changes' : 'Save as draft'}
        </Button>
        {canPost ? (
          <Button
            onClick={() => void submit(true)}
            loading={busy === 'post'}
            disabled={disabled || !canEditDoc}
            kbd="Ctrl ⏎"
          >
            {busy === 'post' ? 'Posting…' : negative && override ? 'Post with override' : 'Save & post'}
          </Button>
        ) : null}
      </StickyActionBar>

      <BomImportDialog
        open={bomOpen}
        spec={spec}
        warehouseId={header.default_warehouse_id}
        preselectBomId={bomForFinished?.bom_id ?? null}
        hasComponents={filledComponents(split.components).length > 0}
        onClose={() => setBomOpen(false)}
        onImport={applyBomImport}
      />

      <MultiItemPickerDialog
        open={multiOpen}
        spec={spec}
        warehouses={warehouses}
        defaultWarehouseId={header.default_warehouse_id}
        onClose={() => setMultiOpen(false)}
        onAdd={(lines) => {
          setComponents(mergeComponents(split.components, lines, 'merge'))
          setMultiOpen(false)
          notify.success(`${lines.length} component${lines.length === 1 ? '' : 's'} added.`)
        }}
      />

      <AssemblyPreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        header={header}
        split={split}
        cost={cost}
        costHidden={costHidden}
        currencySymbol={currency.symbol}
        warehouseName={warehouseName}
        companyName={companyName}
        scopeLabel={scopeLabel}
        savedDocumentId={savedId}
        canPrint={can(['documents.read'])}
        onPrint={() => savedId && navigate(`/documents/${savedId}/print`)}
      />

      <ConfirmDialog
        open={leaveTo !== null}
        title="Leave without saving?"
        message="This assembly has changes that have not been saved. Leaving now discards them."
        confirmLabel="Discard and leave"
        danger
        onCancel={() => setLeaveTo(null)}
        onConfirm={() => {
          const pending = leaveTo
          setLeaveTo(null)
          setDirty(false)
          pending?.proceed()
        }}
      />

      <ConfirmDialog
        open={discardOpen}
        title="Discard unsaved changes?"
        message="The components and the assembled item entered here will be lost."
        confirmLabel="Discard"
        danger
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false)
          setDirty(false)
          navigate(savedId ? `/documents/${savedId}` : '/documents')
        }}
      />
    </PageShell>
  )
}

export default AssemblyPage
