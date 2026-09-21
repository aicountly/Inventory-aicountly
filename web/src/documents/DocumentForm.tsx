import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Barcode, Download, Keyboard, ListPlus, Upload } from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { FormField } from '../components/FormField'
import { Notice } from '../components/Notice'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import { useKeyboardScope } from '../keyboard/useKeyboardScope'
import { errorMessage, isApiError } from '../services/api'
import { documentsApi } from '../services/documentsApi'
import { lookupApi } from '../services/lookupApi'
import type { AvailabilityCheckLine } from '../services/stockApi'
import { Button } from '../ui/Button'
import { useToast } from '../ui/ToastContext'
import { FormGrid, FormSectionCard } from '../ui/shell/FormSectionCard'
import { StickyActionBar } from '../ui/shell/StickyActionBar'
import { csvFilename, downloadCsv } from '../utils/csv'
import { formatQty, todayIso, toNumber } from '../utils/format'
import { InventoryAssistantPanel } from './InventoryAssistantPanel'
import { LineEditor, unitOptionsFrom } from './LineEditor'
import { AddMultipleItemsModal } from './AddMultipleItemsModal'
import { ImportLinesModal } from './ImportLinesModal'
import { computeCostConfidence } from './lineFormInsights'
import { CopyStockModal } from './openingStock/CopyStockModal'
import { OpeningStockHeaderExtras } from './openingStock/OpeningStockHeaderExtras'
import { OpeningStockQuickActions } from './openingStock/OpeningStockQuickActions'
import { ValidationDrawer } from './openingStock/ValidationDrawer'
import { buildImportTemplateCsv, buildValidationReport, findDuplicateLineKeys } from './openingStock/openingStockHelpers'
import type { CopySource, ValidationReport } from './openingStock/openingStockHelpers'
import { PartyFields } from './PartyFields'
import { ShortcutsDialog } from './ShortcutsDialog'
import { StockFormMetrics } from './StockFormMetrics'
import { WarehouseSelect } from './WarehouseSelect'
import { canCreate, permissionKeysFor } from './actions'
import { countDifference, draftTotals, isBlankLine, lineAmount, lineBaseQty, newHeader, newLine, toPayload, validateDraft } from './formModel'
import type { HeaderDraft, LineDraft, LineOrigin } from './formModel'
import { offendingDraftKeys, parseNegativeStock } from './negativeStock'
import type { NegativeStockDetail } from './negativeStock'
import { PackingFormView } from './packing/PackingFormView'
import { DeferredPurchasePanel } from './panels/DeferredPurchasePanel'
import { LandedCostPanel } from './panels/LandedCostPanel'
import { PhysicalCountPanel } from './panels/PhysicalCountPanel'
import { SettlementsPanel } from './panels/SettlementsPanel'
import type { DocumentTypeSpec } from './registry'
import type { InventoryDocument, JobWorkSettlement, PostingWarning } from './types'
import { useAvailability } from './useAvailability'
import type { AvailabilityEntry } from './useAvailability'
import { useReferenceCosts } from './useReferenceCosts'
import { useReferenceData } from './useReferenceData'

export interface DocumentFormProps {
  spec: DocumentTypeSpec
  /** Editing an existing draft. */
  documentId?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  onSaved: (doc: InventoryDocument, posted: boolean) => void
}

const EMPTY_REPORT: ValidationReport = { errors: [], warnings: [], suggestions: [] }

function describeError(err: unknown): string {
  if (isApiError(err)) {
    const field = err.field
    return field ? `${err.message} (${field})` : err.message
  }
  return errorMessage(err)
}

/** What the unsaved-changes guard diffs against — deliberately excludes derived / UI-only fields (units hydrated after load, the default-warehouse prefill) so those never trip a false "leave this page?" prompt. */
function headerSignature(h: HeaderDraft): string {
  return [h.document_date, h.document_no, h.party_ref, h.party_name, h.from_warehouse_id, h.to_warehouse_id, h.stock_effect, h.returnable, h.expected_return_date, h.reason_code, h.movement_reason, h.narration].join('|')
}
function lineSignature(l: LineDraft): string {
  return [l.item_id, l.warehouse_id, l.from_warehouse_id, l.batch_id, l.direction, l.qty, l.rate, l.amount, l.valuation_rate, l.book_qty, l.physical_qty, l.serials.map((s) => s.serial_id).join(','), l.description].join('|')
}
function activeLinesSignature(lines: LineDraft[]): string {
  return lines
    .filter((l) => !isBlankLine(l))
    .map(lineSignature)
    .join(';')
}

/**
 * Create / edit any native document. The header and line columns follow the type spec; the
 * production, job-work, deferred-purchase and count panels generate lines that stay editable.
 *
 * Saving always creates or updates the draft first and posts second, so a negative-stock block
 * on posting leaves a saved draft (status FAILED) that can be posted with an override.
 */
export function DocumentForm({ spec, documentId, initial, onSaved }: DocumentFormProps) {
  const navigate = useNavigate()
  const { warehouses, defaultWarehouseId, warehouseName, unitSymbol, loading: refLoading, error: refError } = useReferenceData()
  const { can } = useAccess()
  const toast = useToast()
  const [header, setHeader] = useState<HeaderDraft>(() => initial?.header ?? newHeader(spec, todayIso()))
  const [lines, setLines] = useState<LineDraft[]>(() => initial?.lines ?? (['physical_count', 'production', 'landed_cost'].includes(spec.formKind) ? [] : [newLine(spec)]))
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [errors, setErrors] = useState<string[]>([])
  const [apiError, setApiError] = useState<string | null>(null)
  const [negative, setNegative] = useState<NegativeStockDetail[] | null>(null)
  const [override, setOverride] = useState(false)
  const [warnings, setWarnings] = useState<PostingWarning[]>([])
  const [busy, setBusy] = useState<'save' | 'post' | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null)
  const linesWrapRef = useRef<HTMLDivElement>(null)

  const canOverride = can('stock.negative_override')
  const canPost = can(permissionKeysFor('post', spec.code))
  const canSave = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)
  const disabled = busy !== null
  const isTransfer = spec.lineMode === 'transfer'
  const showItemsToolbar = spec.formKind !== 'landed_cost'
  /** Native "lines" types (write-in, write-off, stock journal, opening stock, assembly, serial adjustment) get the metrics row and AI assistant panel; every type with its own workspace never reaches this component. */
  const isLinesForm = spec.formKind === 'lines'

  // Pre-fill the default warehouse once reference data is known (new documents only).
  useEffect(() => {
    if (!documentId && header.default_warehouse_id === null && defaultWarehouseId !== null && spec.lineMode !== 'transfer') {
      setHeader((h) => ({ ...h, default_warehouse_id: defaultWarehouseId }))
      setLines((ls) => ls.map((l) => (l.warehouse_id === null && l.origin === 'manual' ? { ...l, warehouse_id: defaultWarehouseId } : l)))
    }
  }, [defaultWarehouseId, documentId, header.default_warehouse_id, spec.lineMode])

  // Editing: stored lines only know their own unit; fetch the items once so the unit dropdown,
  // batch picker and serial picker work exactly as they do on a new document.
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
      })
      .catch(() => {
        /* the stored unit still works; pickers just stay minimal */
      })
    return () => controller.abort()
  }, [initial])

  const patchHeader = (patch: Partial<HeaderDraft>) => setHeader((h) => ({ ...h, ...patch }))
  const replaceOrigin = (origins: LineOrigin[], generated: LineDraft[], keepManual = true) =>
    setLines((ls) => [...(keepManual ? ls.filter((l) => !origins.includes(l.origin) && !isBlankLine(l)) : []), ...generated])

  const partyRef = toNumber(header.party_ref)
  const partyRefNum = partyRef !== null && partyRef > 0 ? Math.floor(partyRef) : null

  const entries = useMemo<AvailabilityEntry[]>(() => {
    const out: AvailabilityEntry[] = []
    for (const l of lines) {
      if (!l.item_id) continue
      let qty = lineBaseQty(l)
      let dir: 'in' | 'out' | null = l.direction
      let warehouse = l.warehouse_id ?? header.default_warehouse_id
      if (spec.formKind === 'physical_count') {
        const d = countDifference(l.book_qty, l.physical_qty)
        if (d === null || d >= 0) continue
        qty = Math.abs(d)
        dir = 'out'
      } else if (spec.lineMode === 'transfer') {
        dir = 'out'
        warehouse = l.from_warehouse_id ?? header.from_warehouse_id
      } else if (['job_work_out', 'packing', 'delivery_challan'].includes(spec.formKind)) {
        dir = 'out'
      }
      if (dir !== 'out' || qty <= 0) continue
      const line: AvailabilityCheckLine = { item_id: l.item_id, warehouse_id: warehouse ?? null, batch_id: l.batch_id, qty }
      out.push({ key: l.key, line })
    }
    return out
  }, [lines, header.default_warehouse_id, header.from_warehouse_id, spec])
  const { results: availability, checking } = useAvailability(entries, spec.movesStock || ['job_work_out', 'packing', 'delivery_challan'].includes(spec.formKind))

  const offending = useMemo(() => new Set(negative ? offendingDraftKeys(lines, negative) : []), [negative, lines])
  const duplicateKeys = useMemo(() => findDuplicateLineKeys(lines), [lines])
  const existingItemIds = useMemo(() => new Set(lines.map((l) => l.item_id).filter((id): id is number => id !== null)), [lines])
  const validationReport = useMemo(() => (spec.code === 'OPENING_STOCK' ? buildValidationReport(header, lines, spec, warehouses) : EMPTY_REPORT), [header, lines, spec, warehouses])
  const savedSettlements = useMemo(() => (header.metadata.job_work_settlements ?? []) as JobWorkSettlement[], [header.metadata.job_work_settlements])
  const totals = draftTotals(lines, spec)

  // ---- costing (metrics + AI assistant) --------------------------------------------------
  const itemIds = useMemo(() => [...new Set(lines.map((l) => l.item_id).filter((id): id is number => id !== null))], [lines])
  const refCosts = useReferenceCosts(itemIds, header.default_warehouse_id, isLinesForm && spec.valuation)
  const costConfidence = useMemo(() => computeCostConfidence(spec, lines, refCosts.costs), [spec, lines, refCosts.costs])
  const applyReferenceCost = () => {
    setLines((ls) =>
      ls.map((l) => {
        if (!l.item_id || (toNumber(l.rate) ?? 0) > 0) return l
        const ref = refCosts.costs.get(l.item_id)
        if (!ref || ref <= 0) return l
        return { ...l, rate: String(ref), amount: String(lineAmount(l.qty, ref) ?? '') }
      }),
    )
  }

  // ---- unsaved-changes guard --------------------------------------------------------------
  const baselineRef = useRef({ header: headerSignature(header), lines: activeLinesSignature(lines) })
  const isDirty = busy === null && (headerSignature(header) !== baselineRef.current.header || activeLinesSignature(lines) !== baselineRef.current.lines)
  useUnsavedChanges({ when: isDirty, onBlocked: (_to, proceed) => setPendingNav(() => proceed) })

  // ---- Opening Stock workspace: bulk-add flows (scan / add multiple / import / copy) ----------
  const [flashKeys, setFlashKeys] = useState<ReadonlySet<string>>(new Set())
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [scanFocusKey, setScanFocusKey] = useState<string | null>(null)
  const [addMultipleOpen, setAddMultipleOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [copySource, setCopySource] = useState<CopySource | null>(null)
  const [validationOpen, setValidationOpen] = useState(false)

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
  }, [])

  const flashLines = (keys: string[]) => {
    if (keys.length === 0) return
    setFlashKeys(new Set(keys))
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashKeys(new Set()), 900)
  }

  const appendLines = (added: LineDraft[]) => {
    if (added.length === 0) return
    setLines((ls) => [...ls.filter((l) => !isBlankLine(l)), ...added])
    flashLines(added.map((l) => l.key))
  }

  const addBlankLineAndFocus = () => {
    const line = newLine(spec, { warehouse_id: isTransfer ? null : header.default_warehouse_id })
    setLines((ls) => [...ls, line])
    setScanFocusKey(line.key)
    flashLines([line.key])
  }

  const downloadImportTemplate = () => downloadCsv(csvFilename(`${spec.slug}-import-template`), buildImportTemplateCsv())

  // A modal or drawer covers the page; its own inputs should get the keystroke, not the form
  // behind it (Modal / Drawer both mark their overlay this way — see components/Modal.tsx).
  const overlayOpen = () => document.querySelector('[data-keyboard-overlay="true"]') !== null

  const submit = async (post: boolean) => {
    setErrors([])
    setApiError(null)
    setWarnings([])
    if (!post) setNegative(null)
    const errs = validateDraft(header, lines, spec)
    if (errs.length) {
      setErrors(errs)
      return
    }
    const payload = toPayload(header, lines, spec)
    const hadExisting = savedId !== null
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
      }
      toast.success(post ? 'Document posted successfully.' : hadExisting ? 'Changes saved.' : 'Draft saved.')
      onSaved(doc, post)
    } catch (err) {
      const neg = parseNegativeStock(err)
      if (neg) {
        setNegative(neg)
        setApiError(id ? `Draft #${id} is saved but could not be posted: ${errorMessage(err)}` : errorMessage(err))
      } else {
        const message = describeError(err)
        setApiError(message)
        toast.error(message)
      }
    } finally {
      setBusy(null)
    }
  }

  useKeyboardScope(
    'form',
    {
      'ctrl+s': (e) => {
        if (disabled || overlayOpen()) return
        e.preventDefault()
        void submit(false)
      },
      'ctrl+enter': (e) => {
        if (disabled || overlayOpen()) return
        e.preventDefault()
        addBlankLineAndFocus()
      },
      'alt+p': (e) => {
        if (disabled || !canPost || overlayOpen()) return
        e.preventDefault()
        void submit(true)
      },
    },
    { allowInInput: true },
  )

  // `/` carries no modifier, so — unlike the combos above — it must stay off while the user is
  // actually typing somewhere (a narration that mentions a date like "12/04" should not steal
  // focus), hence its own scope rather than folding into the one above.
  useKeyboardScope(
    'page',
    {
      '/': (e) => {
        if (!isLinesForm || overlayOpen()) return
        e.preventDefault()
        linesWrapRef.current?.querySelector<HTMLInputElement>('.typeahead input')?.focus()
      },
    },
    { allowInInput: false },
  )

  const stockEffectHint = spec.stockEffects.find((s) => s.value === header.stock_effect)?.hint

  // Packing gets its own premium, two-column layout (PackingFormView); every other type keeps
  // the form below unchanged. All state, validation and submit logic above is shared either way.
  if (spec.formKind === 'packing') {
    return (
      <PackingFormView
        spec={spec}
        documentId={documentId}
        header={header}
        patchHeader={patchHeader}
        lines={lines}
        setLines={setLines}
        warehouses={warehouses}
        warehouseName={warehouseName}
        unitSymbol={unitSymbol}
        refError={refError}
        availability={availability}
        checking={checking}
        offendingKeys={offending}
        totals={totals}
        errors={errors}
        apiError={apiError}
        negative={negative}
        override={override}
        setOverride={setOverride}
        canOverride={canOverride}
        warnings={warnings}
        savedId={savedId}
        busy={busy}
        canSave={canSave}
        canPost={canPost}
        submit={(post) => void submit(post)}
      />
    )
  }

  const mainSection = (
    <>
      {spec.code === 'OPENING_STOCK' ? (
        <OpeningStockHeaderExtras totals={totals} onOpenImport={() => setImportOpen(true)} onOpenCopy={(source) => setCopySource(source)} />
      ) : null}

      <FormSectionCard title={spec.label} description={spec.description}>
        <FormGrid cols={4}>
          <FormField label="Document date" htmlFor="document_date" required>
            <input id="document_date" type="date" className="input" value={header.document_date} disabled={disabled} onChange={(e) => patchHeader({ document_date: e.target.value })} />
          </FormField>
          <FormField label="Document no." htmlFor="document_no" help="Leave empty to number automatically.">
            <input id="document_no" className="input" value={header.document_no} disabled={disabled} onChange={(e) => patchHeader({ document_no: e.target.value })} />
          </FormField>
          {spec.party ? <PartyFields role={spec.party} partyRef={header.party_ref} partyName={header.party_name} onChange={patchHeader} disabled={disabled} /> : null}
          {isTransfer ? (
            <>
              <FormField label="From warehouse" htmlFor="from_wh" required>
                <WarehouseSelect id="from_wh" value={header.from_warehouse_id} onChange={(id) => patchHeader({ from_warehouse_id: id })} warehouses={warehouses} disabled={disabled} />
              </FormField>
              <FormField label="To warehouse" htmlFor="to_wh" required>
                <WarehouseSelect id="to_wh" value={header.to_warehouse_id} onChange={(id) => patchHeader({ to_warehouse_id: id })} warehouses={warehouses} disabled={disabled} />
              </FormField>
            </>
          ) : spec.formKind !== 'production' ? (
            <FormField label="Default warehouse" htmlFor="default_wh" help="Pre-fills the warehouse on new lines.">
              <WarehouseSelect id="default_wh" value={header.default_warehouse_id} onChange={(id) => patchHeader({ default_warehouse_id: id })} warehouses={warehouses} emptyLabel="None" disabled={disabled} />
            </FormField>
          ) : null}
          {spec.stockEffects.length > 0 ? (
            <FormField label="Stock effect" htmlFor="stock_effect" help={stockEffectHint}>
              <select id="stock_effect" className="select" value={header.stock_effect} disabled={disabled} onChange={(e) => patchHeader({ stock_effect: e.target.value, metadata: { ...header.metadata, linked_source_document_id: undefined } })}>
                {spec.stockEffects.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}
          {spec.returnable ? (
            <>
              <FormField label="Returnable" htmlFor="returnable">
                <label className="checkbox" style={{ minHeight: '2.25rem' }}>
                  <input id="returnable" type="checkbox" checked={header.returnable} disabled={disabled} onChange={(e) => patchHeader({ returnable: e.target.checked })} />
                  Goods are expected back
                </label>
              </FormField>
              {header.returnable ? (
                <FormField label="Expected return" htmlFor="expected_return_date">
                  <input id="expected_return_date" type="date" className="input" value={header.expected_return_date} disabled={disabled} onChange={(e) => patchHeader({ expected_return_date: e.target.value })} />
                </FormField>
              ) : null}
            </>
          ) : null}
          {spec.reason ? (
            <>
              <FormField label="Reason code" htmlFor="reason_code">
                <input id="reason_code" className="input" value={header.reason_code} disabled={disabled} maxLength={32} onChange={(e) => patchHeader({ reason_code: e.target.value })} placeholder="e.g. DAMAGE" />
              </FormField>
              <FormField label="Movement reason" htmlFor="movement_reason">
                <input id="movement_reason" className="input" value={header.movement_reason} disabled={disabled} maxLength={64} onChange={(e) => patchHeader({ movement_reason: e.target.value })} />
              </FormField>
            </>
          ) : null}
          <FormField label="Narration" htmlFor="narration" className="md:col-span-2 lg:col-span-4">
            <textarea id="narration" className="textarea" value={header.narration} disabled={disabled} onChange={(e) => patchHeader({ narration: e.target.value })} placeholder={spec.code === 'OPENING_STOCK' ? `E.g. Opening stock as on ${header.document_date || todayIso()}` : undefined} />
          </FormField>
        </FormGrid>
      </FormSectionCard>

      {spec.formKind === 'job_work_in' ? (
        <SettlementsPanel
          spec={spec}
          partyRef={partyRefNum}
          value={savedSettlements}
          disabled={disabled}
          onChange={(settlements, consumed, detectedParty) => {
            replaceOrigin(['settlement'], consumed)
            patchHeader({ metadata: { ...header.metadata, job_work_settlements: settlements }, ...(header.party_ref === '' && detectedParty ? { party_ref: String(detectedParty) } : {}) })
          }}
        />
      ) : null}
      {spec.formKind === 'inward_challan' && header.stock_effect === 'settle_deferred' ? (
        <DeferredPurchasePanel
          spec={spec}
          partyRef={partyRefNum}
          linkedSourceDocumentId={header.metadata.linked_source_document_id ? Number(header.metadata.linked_source_document_id) : null}
          disabled={disabled}
          onChange={(docId, generated, detectedParty) => {
            replaceOrigin(['deferred'], generated)
            patchHeader({ metadata: { ...header.metadata, linked_source_document_id: docId ?? undefined }, ...(header.party_ref === '' && detectedParty ? { party_ref: String(detectedParty) } : {}) })
          }}
        />
      ) : null}
      {spec.formKind === 'physical_count' ? <PhysicalCountPanel spec={spec} warehouses={warehouses} defaultWarehouseId={defaultWarehouseId} disabled={disabled} onLoad={(generated) => replaceOrigin(['count', 'manual'], generated, false)} /> : null}
      {/* The charges block, embedded in the generic form. The ROUTED landed cost screen is
          documents/landedCost/LandedCostAllocationPage — DocumentFormPage sends the type there,
          because a five-step allocation over several receipts needs its own header, sidebar and
          action bar. This panel stays as the single-receipt editor for any caller that composes
          DocumentForm directly, and it is the one the policy tests exercise. */}
      {spec.formKind === 'landed_cost' ? (
        <LandedCostPanel
          initial={header.metadata}
          disabled={disabled}
          onChange={(targetId, charges, detectedParty) =>
            patchHeader({
              metadata: { ...header.metadata, target_document_id: targetId ?? undefined, charges },
              ...(header.party_ref === '' && detectedParty ? { party_ref: String(detectedParty) } : {}),
            })
          }
        />
      ) : null}

      {/* A landed cost allocation has no item lines: a freight bill names no item and no
          quantity. What it carries is the receipt it loads and the charges, which the panel above collects. */}
      {spec.formKind === 'landed_cost' ? null : (
        <FormSectionCard
          title="Items"
          description={spec.formKind === 'revaluation' ? 'Quantity is informational; the new unit cost re-prices every layer still holding the item in that warehouse.' : spec.code === 'OPENING_STOCK' ? 'Add items with their opening quantity and value.' : 'Add the items this document moves.'}
          action={
            showItemsToolbar ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button type="button" variant="secondary" size="sm" icon={Barcode} onClick={addBlankLineAndFocus} disabled={disabled}>
                  Scan barcode
                </Button>
                <Button type="button" variant="secondary" size="sm" icon={ListPlus} onClick={() => setAddMultipleOpen(true)} disabled={disabled}>
                  Add multiple items
                </Button>
                <Button type="button" variant="secondary" size="sm" icon={Upload} onClick={() => setImportOpen(true)} disabled={disabled}>
                  Import CSV
                </Button>
                <Button type="button" variant="secondary" size="sm" icon={Download} onClick={downloadImportTemplate}>
                  Download template
                </Button>
              </div>
            ) : null
          }
        >
          {refLoading && warehouses.length === 0 ? <span className="hint">Loading warehouses…</span> : null}
          <div ref={linesWrapRef}>
            <LineEditor
              spec={spec}
              header={header}
              lines={lines}
              onChange={setLines}
              warehouses={warehouses}
              availability={availability}
              checking={checking}
              offendingKeys={offending}
              disabled={disabled}
              autoFocusKey={scanFocusKey}
              flashKeys={flashKeys}
              duplicateKeys={duplicateKeys}
            />
          </div>
        </FormSectionCard>
      )}

      {spec.code === 'OPENING_STOCK' ? (
        <OpeningStockQuickActions
          onOpenImport={() => setImportOpen(true)}
          onOpenCopy={(source) => setCopySource(source)}
          onValidate={() => setValidationOpen(true)}
          issueCount={validationReport.errors.length + validationReport.warnings.length}
        />
      ) : null}
    </>
  )

  return (
    <>
      <form
        className="flex flex-1 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(false)
        }}
      >
        {refError ? <Notice kind="warning">{refError}</Notice> : null}

        {isLinesForm ? <StockFormMetrics spec={spec} totals={totals} reasonCode={header.reason_code.trim()} costConfidence={costConfidence} /> : null}

        {isLinesForm ? (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
            <div className="min-w-0 flex flex-col gap-4">{mainSection}</div>
            <InventoryAssistantPanel
              className="xl:sticky xl:top-4"
              spec={spec}
              header={header}
              lines={lines}
              costConfidence={costConfidence}
              referenceCosts={refCosts.costs}
              referenceMethods={refCosts.methods}
              negativeLineKeys={offending}
              onApplyReferenceCost={applyReferenceCost}
              disabled={disabled}
            />
          </div>
        ) : (
          mainSection
        )}

      {errors.length > 0 ? (
        <Notice kind="error" title="Please fix before saving">
          <ul className="warning-list">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {apiError && !negative ? <Notice kind="error">{apiError}</Notice> : null}
      {negative ? (
        <Notice kind="error" title="Insufficient stock">
          {apiError ? <div>{apiError}</div> : null}
          <ul className="warning-list">
            {negative.map((d, i) => (
              <li key={`${d.item_id}-${d.warehouse_id}-${i}`}>
                {d.item_name ?? `Item #${d.item_id}`}
                {d.warehouse_id ? ` · warehouse #${d.warehouse_id}` : ''}: on hand {formatQty(d.on_hand)}, required {formatQty(d.required)}, short by <strong>{formatQty(d.short_by)}</strong>
              </li>
            ))}
          </ul>
          {canOverride ? (
            <label className="checkbox" style={{ marginTop: '0.5rem' }}>
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              Post anyway and let stock go negative (override)
            </label>
          ) : (
            <div className="hint">Reduce the quantities or receive stock first. Posting into negative stock needs the "override negative-stock block" permission.</div>
          )}
        </Notice>
      ) : null}
      {warnings.length > 0 ? (
        <Notice kind="warning" title="Posted with warnings">
          <ul className="warning-list">
            {warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <StickyActionBar
        status={
          <div className="flex items-center gap-3">
            <span>
              {totals.lines} line{totals.lines === 1 ? '' : 's'}
              {savedId ? ` · draft #${savedId}` : ''}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowShortcuts(true)} title="Keyboard shortcuts" aria-label="Keyboard shortcuts">
              <Keyboard className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        }
      >
        <Button type="button" variant="secondary" onClick={() => navigate(savedId ? `/documents/${savedId}` : '/documents')}>
          Cancel
        </Button>
        <Button type="submit" variant="secondary" loading={busy === 'save'} disabled={disabled || !canSave}>
          {savedId ? 'Save changes' : 'Save draft'}
        </Button>
        {canPost ? (
          <Button type="button" variant="primary" loading={busy === 'post'} onClick={() => void submit(true)} disabled={disabled || (!canSave && !savedId)} kbd="Alt+P">
            {negative && override ? 'Post with override' : 'Save & post'}
          </Button>
        ) : null}
      </StickyActionBar>

      {showItemsToolbar ? (
        <>
          <AddMultipleItemsModal open={addMultipleOpen} onClose={() => setAddMultipleOpen(false)} spec={spec} defaultWarehouseId={header.default_warehouse_id} existingItemIds={existingItemIds} onConfirm={appendLines} />
          <ImportLinesModal open={importOpen} onClose={() => setImportOpen(false)} spec={spec} warehouses={warehouses} defaultWarehouseId={header.default_warehouse_id} onConfirm={appendLines} />
        </>
      ) : null}
      {spec.code === 'OPENING_STOCK' ? (
        <>
          <CopyStockModal open={copySource !== null} initialSource={copySource ?? 'previous_document'} onClose={() => setCopySource(null)} spec={spec} warehouses={warehouses} onConfirm={appendLines} />
          <ValidationDrawer open={validationOpen} onClose={() => setValidationOpen(false)} report={validationReport} />
        </>
      ) : null}
      </form>

      <ShortcutsDialog open={showShortcuts} onClose={() => setShowShortcuts(false)} showSearchItems={isLinesForm} />
      <ConfirmDialog
        open={pendingNav !== null}
        title="Unsaved changes"
        message="You have unsaved changes. Leave this page? Changes will be lost."
        confirmLabel="Leave page"
        danger
        onConfirm={() => {
          const proceed = pendingNav
          setPendingNav(null)
          proceed?.()
        }}
        onCancel={() => setPendingNav(null)}
      />
    </>
  )
}
