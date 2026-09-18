import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, ClipboardList, Eye, FileUp, ListPlus, RefreshCw, ScanBarcode, TriangleAlert } from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Notice } from '../components/Notice'
import { useFormKeyboard } from '../keyboard/usePageKeyboard'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import { errorMessage, isApiError } from '../services/api'
import { documentsApi } from '../services/documentsApi'
import { lookupApi } from '../services/lookupApi'
import type { AvailabilityCheckLine } from '../services/stockApi'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { Textarea } from '../ui/Textarea'
import { FormField, FormGrid, FormSectionCard } from '../ui/shell/FormSectionCard'
import { ActionBarTotal, StickyActionBar } from '../ui/shell/StickyActionBar'
import { cx } from '../ui/cx'
import { notify } from '../ui/notify'
import { formatQty, todayIso, toNumber } from '../utils/format'
import { AIReasonAssistant } from './AIReasonAssistant'
import { AddMultipleItemsModal } from './AddMultipleItemsModal'
import type { PickedLine } from './AddMultipleItemsModal'
import { AttachmentUploader } from './AttachmentUploader'
import type { StagedAttachment } from './AttachmentUploader'
import { ImportLinesModal } from './ImportLinesModal'
import { LineEditor } from './LineEditor'
import { PartyFields } from './PartyFields'
import { ScanBarcodeModal } from './ScanBarcodeModal'
import { WarehouseSelect } from './WarehouseSelect'
import { canCreate, permissionKeysFor } from './actions'
import { countDifference, draftTotals, isBlankLine, lineBaseQty, mergePickedItems, newHeader, newLine, toPayload, unitOptionsFrom, validateDraft } from './formModel'
import type { HeaderDraft, LineDraft, LineOrigin } from './formModel'
import { offendingDraftKeys, parseNegativeStock } from './negativeStock'
import type { NegativeStockDetail } from './negativeStock'
import { DeferredPurchasePanel } from './panels/DeferredPurchasePanel'
import { LandedCostPanel } from './panels/LandedCostPanel'
import { PhysicalCountPanel } from './panels/PhysicalCountPanel'
import { ProductionPanel } from './panels/ProductionPanel'
import { SettlementsPanel } from './panels/SettlementsPanel'
import type { DocumentTypeSpec } from './registry'
import type { InventoryDocument, JobWorkSettlement, PostingWarning } from './types'
import { useAvailability } from './useAvailability'
import type { AvailabilityEntry } from './useAvailability'
import { useReferenceData } from './useReferenceData'

export interface DocumentFormProps {
  spec: DocumentTypeSpec
  /** Editing an existing draft. */
  documentId?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  onSaved: (doc: InventoryDocument, posted: boolean) => void
}

function describeError(err: unknown): string {
  if (isApiError(err)) {
    const field = err.field
    return field ? `${err.message} (${field})` : err.message
  }
  return errorMessage(err)
}

/** Client-side suggestions only — reason_code has no backend master, free text still posts verbatim. */
const WRITE_OFF_REASON_SUGGESTIONS = ['Damage', 'Expiry', 'Loss', 'Theft', 'Obsolete', 'Quality Rejection', 'Breakage', 'Shrinkage', 'Internal Use', 'Other']

const BULK_TOOLBAR_EXCLUDED: DocumentTypeSpec['formKind'][] = ['production', 'job_work_in', 'physical_count', 'landed_cost']

function linesSubtitle(spec: DocumentTypeSpec): string {
  if (spec.code === 'WRITE_OFF') return 'Add items to be written off from stock.'
  switch (spec.lineMode) {
    case 'fixed_in':
      return 'Add items being received into stock.'
    case 'fixed_out':
      return 'Add items being issued out of stock.'
    case 'transfer':
      return 'Add items being moved between warehouses.'
    default:
      return 'Add items to this document.'
  }
}

/**
 * Create / edit any native document. The header and line columns follow the type spec; the
 * production, job-work, deferred-purchase and count panels generate lines that stay editable.
 *
 * Saving always creates or updates the draft first and posts second, so a negative-stock block
 * on posting leaves a saved draft (status FAILED) that can be posted with an override.
 */
export function DocumentForm({ spec, documentId, initial, onSaved }: DocumentFormProps) {
  const { warehouses, defaultWarehouseId, loading: refLoading, error: refError } = useReferenceData()
  const { can } = useAccess()
  const [header, setHeader] = useState<HeaderDraft>(() => initial?.header ?? newHeader(spec, todayIso()))
  const [lines, setLines] = useState<LineDraft[]>(() => initial?.lines ?? (['physical_count', 'production', 'landed_cost'].includes(spec.formKind) ? [] : [newLine(spec)]))
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [errors, setErrors] = useState<string[]>([])
  const [apiError, setApiError] = useState<string | null>(null)
  const [negative, setNegative] = useState<NegativeStockDetail[] | null>(null)
  const [override, setOverride] = useState(false)
  const [warnings, setWarnings] = useState<PostingWarning[]>([])
  const [busy, setBusy] = useState<'save' | 'post' | null>(null)
  const [dirty, setDirty] = useState(false)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [addMultipleOpen, setAddMultipleOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [pendingNav, setPendingNav] = useState<{ to: string; proceed: () => void } | null>(null)

  const canOverride = can('stock.negative_override')
  const canPost = can(permissionKeysFor('post', spec.code))
  const canSave = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)

  const markDirty = () => setDirty(true)

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

  // The just-added row's item search gets focus (Add line click / Alt+L), then releases it so a
  // later "Change" click on an unrelated row is never hijacked.
  useEffect(() => {
    if (focusKey === null) return undefined
    const id = requestAnimationFrame(() => setFocusKey(null))
    return () => cancelAnimationFrame(id)
  }, [focusKey])

  const patchHeader = (patch: Partial<HeaderDraft>) => {
    markDirty()
    setHeader((h) => ({ ...h, ...patch }))
  }
  const updateLines = (next: LineDraft[]) => {
    markDirty()
    setLines(next)
  }
  const replaceOrigin = (origins: LineOrigin[], generated: LineDraft[], keepManual = true) => {
    markDirty()
    setLines((ls) => [...(keepManual ? ls.filter((l) => !origins.includes(l.origin) && !isBlankLine(l)) : []), ...generated])
  }

  const isTransfer = spec.lineMode === 'transfer'
  const bulkWarehouseId = isTransfer ? header.from_warehouse_id : header.default_warehouse_id

  const addLineFromShortcut = () => {
    markDirty()
    const line = newLine(spec, { warehouse_id: isTransfer ? null : header.default_warehouse_id })
    setLines((ls) => [...ls, line])
    setFocusKey(line.key)
  }

  const applyPicked = (picks: { item: PickedLine['row']; qty: string }[]) => {
    if (picks.length === 0) return
    updateLines(mergePickedItems(lines, spec, picks, bulkWarehouseId))
    notify.success(`${picks.length} item${picks.length === 1 ? '' : 's'} added to the lines below.`)
  }

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
  const { results: availability, checking, reload: reloadAvailability } = useAvailability(entries, spec.movesStock || ['job_work_out', 'packing', 'delivery_challan'].includes(spec.formKind))

  const offending = useMemo(() => new Set(negative ? offendingDraftKeys(lines, negative) : []), [negative, lines])
  const savedSettlements = useMemo(() => (header.metadata.job_work_settlements ?? []) as JobWorkSettlement[], [header.metadata.job_work_settlements])
  const totals = draftTotals(lines, spec)
  const impactQtyLabel = spec.lineMode === 'fixed_in' ? 'Quantity in' : spec.lineMode === 'transfer' ? 'Quantity moved' : spec.lineMode === 'fixed_out' ? 'Quantity out' : 'Quantity'
  const impactQtyValue = spec.lineMode === 'fixed_in' ? totals.qtyIn : totals.qtyOut || totals.qtyIn
  const impactVerb = spec.lineMode === 'fixed_in' ? 'increased' : spec.lineMode === 'fixed_out' ? 'reduced' : 'adjusted'

  useFormKeyboard({
    onSave: () => void submit(false),
    onSubmit: canPost ? () => void submit(true) : undefined,
    onAddLine: spec.formKind === 'landed_cost' ? undefined : addLineFromShortcut,
    saving: busy !== null,
  })

  useUnsavedChanges({
    when: dirty && busy === null,
    onBlocked: (to, proceed) => setPendingNav({ to, proceed }),
  })

  const submit = async (post: boolean) => {
    setErrors([])
    setApiError(null)
    setWarnings([])
    if (!post) setNegative(null)
    const errs = validateDraft(header, lines, spec)
    if (errs.length) {
      setErrors(errs)
      notify.error(post ? 'Fix the highlighted issues before posting.' : 'Fix the highlighted issues before saving.')
      return
    }
    const payload = toPayload(header, lines, spec)
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
        notify.success(`${spec.label} ${doc.document_no ?? `#${doc.document_id}`} posted successfully.`)
      } else {
        notify.success(`${spec.label} saved as draft.`)
      }
      setDirty(false)
      onSaved(doc, post)
    } catch (err) {
      const neg = parseNegativeStock(err)
      if (neg) {
        setNegative(neg)
        setApiError(id ? `Draft #${id} is saved but could not be posted: ${errorMessage(err)}` : errorMessage(err))
      } else {
        setApiError(describeError(err))
      }
    } finally {
      setBusy(null)
    }
  }

  const disabled = busy !== null
  const stockEffectHint = spec.stockEffects.find((s) => s.value === header.stock_effect)?.hint
  const showBulkToolbar = !BULK_TOOLBAR_EXCLUDED.includes(spec.formKind)
  const cancelTo = savedId ? `/documents/${savedId}` : '/documents'

  return (
    <form
      className="aic flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(false)
      }}
    >
      {refError ? <Notice kind="warning">{refError}</Notice> : null}

      <FormSectionCard title="Document Details" description={`Enter the basic details for this ${spec.label.toLowerCase()}.`} icon={ClipboardList}>
        <FormGrid cols={4}>
          <FormField label="Document date" htmlFor="document_date" required>
            <Input id="document_date" type="date" value={header.document_date} disabled={disabled} onChange={(e) => patchHeader({ document_date: e.target.value })} />
          </FormField>
          <FormField label="Document no." htmlFor="document_no" hint="Leave empty to auto-generate.">
            <Input id="document_no" placeholder="Auto-generate" value={header.document_no} disabled={disabled} onChange={(e) => patchHeader({ document_no: e.target.value })} />
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
            <FormField label="Default warehouse" htmlFor="default_wh" required hint="Pre-fills the warehouse on new lines.">
              <WarehouseSelect id="default_wh" value={header.default_warehouse_id} onChange={(id) => patchHeader({ default_warehouse_id: id })} warehouses={warehouses} emptyLabel="Select warehouse" disabled={disabled} />
            </FormField>
          ) : null}
          {spec.stockEffects.length > 0 ? (
            <FormField label="Stock effect" htmlFor="stock_effect" hint={stockEffectHint}>
              <Select id="stock_effect" value={header.stock_effect} disabled={disabled} onChange={(e) => patchHeader({ stock_effect: e.target.value, metadata: { ...header.metadata, linked_source_document_id: undefined } })}>
                {spec.stockEffects.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
          {spec.returnable ? (
            <>
              <FormField label="Returnable" htmlFor="returnable">
                <label className="flex h-9 items-center gap-2 text-sm text-gray-700">
                  <input id="returnable" type="checkbox" className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30" checked={header.returnable} disabled={disabled} onChange={(e) => patchHeader({ returnable: e.target.checked })} />
                  Goods are expected back
                </label>
              </FormField>
              {header.returnable ? (
                <FormField label="Expected return" htmlFor="expected_return_date">
                  <Input id="expected_return_date" type="date" value={header.expected_return_date} disabled={disabled} onChange={(e) => patchHeader({ expected_return_date: e.target.value })} />
                </FormField>
              ) : null}
            </>
          ) : null}
          {spec.reason ? (
            <>
              <FormField label="Reason code" htmlFor="reason_code">
                <Input
                  id="reason_code"
                  list={spec.code === 'WRITE_OFF' ? 'reason-code-suggestions' : undefined}
                  value={header.reason_code}
                  disabled={disabled}
                  maxLength={32}
                  onChange={(e) => patchHeader({ reason_code: e.target.value })}
                  placeholder="e.g. Damage"
                />
                {spec.code === 'WRITE_OFF' ? (
                  <datalist id="reason-code-suggestions">
                    {WRITE_OFF_REASON_SUGGESTIONS.map((r) => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                ) : null}
              </FormField>
              <FormField label="Movement reason" htmlFor="movement_reason">
                <Input id="movement_reason" value={header.movement_reason} disabled={disabled} maxLength={64} onChange={(e) => patchHeader({ movement_reason: e.target.value })} placeholder="e.g. Water damage, expired stock, theft…" />
              </FormField>
            </>
          ) : null}
          {spec.formKind === 'packing' ? (
            <FormField label="Box marks" htmlFor="box_marks" hint="One per line." className="col-span-full">
              <Textarea id="box_marks" value={(header.metadata.box_marks ?? []).join('\n')} disabled={disabled} onChange={(e) => patchHeader({ metadata: { ...header.metadata, box_marks: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) } })} />
            </FormField>
          ) : null}
        </FormGrid>

        <div className={cx('mt-4 grid grid-cols-1 gap-4', spec.reason ? 'lg:grid-cols-[1.3fr_0.9fr_1fr]' : 'lg:grid-cols-[1.4fr_1fr]')}>
          <FormField label="Narration / Remarks" htmlFor="narration">
            <Textarea id="narration" rows={4} value={header.narration} disabled={disabled} onChange={(e) => patchHeader({ narration: e.target.value })} placeholder="Enter detailed remarks, reference, incident details etc…" />
          </FormField>
          <AttachmentUploader
            value={attachments}
            onChange={(files) => {
              markDirty()
              setAttachments(files)
            }}
            disabled={disabled}
          />
          {spec.reason ? (
            <AIReasonAssistant
              warehouseId={header.default_warehouse_id}
              disabled={disabled}
              onApply={({ reasonCode, remark }) => {
                patchHeader({
                  reason_code: reasonCode,
                  movement_reason: remark && !header.movement_reason.trim() ? remark : header.movement_reason,
                })
                notify.success(`Applied "${reasonCode}" as the reason code.`)
              }}
            />
          ) : null}
        </div>
      </FormSectionCard>

      {spec.formKind === 'production' ? (
        <FormSectionCard padding="md">
          <ProductionPanel
            spec={spec}
            warehouses={warehouses}
            defaultWarehouseId={defaultWarehouseId}
            initial={header.metadata}
            disabled={disabled}
            onExplode={(generated, meta) => {
              replaceOrigin(['bom'], generated)
              patchHeader({ metadata: { ...header.metadata, ...meta }, default_warehouse_id: meta.warehouse_id })
            }}
          />
        </FormSectionCard>
      ) : null}
      {spec.formKind === 'job_work_in' ? (
        <FormSectionCard padding="md">
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
        </FormSectionCard>
      ) : null}
      {spec.formKind === 'inward_challan' && header.stock_effect === 'settle_deferred' ? (
        <FormSectionCard padding="md">
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
        </FormSectionCard>
      ) : null}
      {spec.formKind === 'physical_count' ? (
        <FormSectionCard padding="md">
          <PhysicalCountPanel spec={spec} warehouses={warehouses} defaultWarehouseId={defaultWarehouseId} disabled={disabled} onLoad={(generated) => replaceOrigin(['count', 'manual'], generated, false)} />
        </FormSectionCard>
      ) : null}
      {spec.formKind === 'landed_cost' ? (
        <FormSectionCard padding="md">
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
        </FormSectionCard>
      ) : null}

      {/* A landed cost allocation has no item lines: a freight bill names no item and no
          quantity. What it carries is the receipt it loads and the charges, which the panel above collects. */}
      {spec.formKind === 'landed_cost' ? null : (
        <FormSectionCard
          icon={Boxes}
          title="Item Lines"
          description={linesSubtitle(spec)}
          action={
            showBulkToolbar ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button variant="secondary" size="sm" icon={ListPlus} className="border-violet-200 bg-violet-50 text-violet-700" onClick={() => setAddMultipleOpen(true)} disabled={disabled}>
                  Add Multiple Items
                </Button>
                <Button variant="secondary" size="sm" icon={FileUp} onClick={() => setImportOpen(true)} disabled={disabled}>
                  Import
                </Button>
                <Button variant="secondary" size="sm" icon={ScanBarcode} onClick={() => setScanOpen(true)} disabled={disabled}>
                  Scan Barcode
                </Button>
              </div>
            ) : undefined
          }
        >
          {spec.formKind === 'revaluation' ? <p className="-mt-2 mb-3 text-xs text-gray-500">Quantity is informational; the new unit cost re-prices every layer still holding the item in that warehouse.</p> : null}
          {refLoading && warehouses.length === 0 ? <p className="mb-2 text-xs text-gray-500">Loading warehouses…</p> : null}
          <LineEditor spec={spec} header={header} lines={lines} onChange={updateLines} warehouses={warehouses} availability={availability} checking={checking} offendingKeys={offending} disabled={disabled} focusKey={focusKey} />

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5">
              <div className="flex items-center gap-2 text-amber-800">
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
                <strong className="text-sm">Important Notes</strong>
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-gray-600">
                <li>Stock quantity will be {impactVerb} for the selected items once this posts.</li>
                <li>Ensure proper approval for high-value transactions before posting.</li>
                <li>Attach supporting documents (photos, reports) wherever possible.</li>
                <li>This transaction is recorded in the audit trail{spec.code === 'WRITE_OFF' ? ' and can be reversed later from the document if it is posted in error' : ''}.</li>
              </ul>
            </div>

            {spec.movesStock ? (
              <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-sky-700">
                      <Boxes className="h-4 w-4 shrink-0" aria-hidden />
                      <strong className="text-sm">Stock Impact Preview</strong>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">The following will happen after posting:</p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-semibold text-sky-700">
                    <Eye className="h-3 w-3" aria-hidden />
                    Live preview
                  </span>
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-gray-600">
                  <li>Stock quantity will be reduced or increased for the selected items</li>
                  <li>Inventory valuation is calculated by the valuation engine when this posts</li>
                  <li>Entries will reflect in the Stock Register and Valuation Reports</li>
                  <li>An audit log will be created for this transaction</li>
                </ul>
                {totals.lines > 0 ? (
                  <div className="mt-3 flex items-center gap-4 border-t border-sky-200 pt-2.5 text-xs">
                    <span className="text-gray-500">
                      Items <strong className="font-semibold text-gray-900">{totals.lines}</strong>
                    </span>
                    <span className="text-gray-500">
                      {impactQtyLabel} <strong className="font-semibold text-gray-900">{formatQty(impactQtyValue)}</strong>
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </FormSectionCard>
      )}

      {errors.length > 0 ? (
        <Notice kind="error" title="Please fix before saving">
          <ul className="list-disc space-y-0.5 pl-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {apiError && !negative ? <Notice kind="error">{apiError}</Notice> : null}
      {negative ? (
        <Notice
          kind="error"
          title="Stock availability changed"
          actions={
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={reloadAvailability}>
              Refresh availability
            </Button>
          }
        >
          {apiError ? <div>{apiError}</div> : null}
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {negative.map((d, i) => (
              <li key={`${d.item_id}-${d.warehouse_id}-${i}`}>
                {d.item_name ?? `Item #${d.item_id}`}
                {d.warehouse_id ? ` · warehouse #${d.warehouse_id}` : ''}: on hand {formatQty(d.on_hand)}, required {formatQty(d.required)}, short by <strong>{formatQty(d.short_by)}</strong>
              </li>
            ))}
          </ul>
          {canOverride ? (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              Post anyway and let stock go negative (override)
            </label>
          ) : (
            <p className="mt-1 text-xs text-gray-500">Reduce the quantities or receive stock first. Posting into negative stock needs the &ldquo;override negative-stock block&rdquo; permission.</p>
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

      <StickyActionBar
        totals={
          <>
            <ActionBarTotal label="Items" value={totals.lines} />
            {totals.qtyIn > 0 || spec.lineMode === 'by_line' ? <ActionBarTotal label="Qty in" value={formatQty(totals.qtyIn)} /> : null}
            {totals.qtyOut > 0 || spec.lineMode === 'by_line' || isTransfer ? <ActionBarTotal label="Qty out" value={formatQty(totals.qtyOut)} /> : null}
            {spec.rate ? <ActionBarTotal label="Amount" value={formatQty(totals.amount)} /> : null}
            {savedId ? <span className="text-xs text-gray-400">Draft #{savedId}</span> : null}
          </>
        }
      >
        <Link to={cancelTo} className="aic inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3.5 text-sm font-medium text-gray-700 transition-colors hover:border-primary/40 hover:bg-primary-light hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30">
          Cancel
        </Link>
        <Button type="submit" variant="secondary" loading={busy === 'save'} disabled={disabled || !canSave} kbd="Ctrl S">
          {savedId ? 'Save changes' : 'Save as draft'}
        </Button>
        {canPost ? (
          <Button type="button" variant="primary" loading={busy === 'post'} disabled={disabled || (!canSave && !savedId)} onClick={() => void submit(true)} kbd="Ctrl ↵">
            {negative && override ? 'Post with override' : 'Save & Post'}
          </Button>
        ) : null}
      </StickyActionBar>

      <AddMultipleItemsModal open={addMultipleOpen} onClose={() => setAddMultipleOpen(false)} warehouseId={bulkWarehouseId} onAdd={(picks) => applyPicked(picks.map((p) => ({ item: p.row, qty: p.qty })))} />
      <ScanBarcodeModal open={scanOpen} onClose={() => setScanOpen(false)} warehouseId={bulkWarehouseId} onResolved={(row) => applyPicked([{ item: row, qty: '1' }])} />
      <ImportLinesModal open={importOpen} onClose={() => setImportOpen(false)} warehouseId={bulkWarehouseId} onImport={(rows) => applyPicked(rows.map((r) => ({ item: r.row, qty: r.qty })))} />

      <ConfirmDialog
        open={pendingNav !== null}
        title={`Discard unsaved ${spec.label.toLowerCase()}?`}
        message="Your changes haven't been saved."
        confirmLabel="Discard changes"
        danger
        onCancel={() => setPendingNav(null)}
        onConfirm={() => {
          const p = pendingNav
          setPendingNav(null)
          setDirty(false)
          p?.proceed()
        }}
      />
    </form>
  )
}
