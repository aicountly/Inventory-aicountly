import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, BarChart3, ChevronDown, CircleCheck, PackageMinus, ShieldCheck, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { Notice } from '../../components/Notice'
import { errorMessage, isApiError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { lookupApi } from '../../services/lookupApi'
import { Button } from '../../ui/Button'
import { ActionBarTotal, StickyActionBar } from '../../ui/shell/StickyActionBar'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { useToast } from '../../ui/ToastContext'
import { formatQty, todayIso } from '../../utils/format'
import { unitOptionsFrom } from '../LineEditor'
import { canCreate, permissionKeysFor, STATUS_LABELS } from '../actions'
import { draftTotals, isBlankLine, lineBaseQty, newHeader, newLine, toPayload, validateDraft } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { offendingDraftKeys, parseNegativeStock } from '../negativeStock'
import type { NegativeStockDetail } from '../negativeStock'
import type { DocumentTypeSpec } from '../registry'
import type { DocumentStatus, InventoryDocument, PostingWarning } from '../types'
import { useAvailability } from '../useAvailability'
import type { AvailabilityEntry } from '../useAvailability'
import { useReferenceData } from '../useReferenceData'
import { BomExplodeModal } from './BomExplodeModal'
import { ConsumptionAiPanel } from './ConsumptionAiPanel'
import { ConsumptionHeaderCard } from './ConsumptionHeaderCard'
import type { ConsumptionMode } from './ConsumptionHeaderCard'
import { ConsumptionInsights } from './ConsumptionInsights'
import { ConsumptionLinesPanel } from './ConsumptionLinesPanel'
import { ConsumptionPrintView } from './ConsumptionPrintView'
import { useConsumptionKeyboard } from './useConsumptionKeyboard'
import './consumption.css'

export interface ConsumptionFormProps {
  spec: DocumentTypeSpec
  documentId?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  /** Editing only: the stored document's status/version, for the same "returns to draft" notice DocumentForm shows. */
  existingStatus?: DocumentStatus
  existingVersion?: number
  onSaved: (doc: InventoryDocument, posted: boolean) => void
}

type Busy = 'draft' | 'post' | 'postAndNew' | 'postAndPrint' | null

function describeError(err: unknown): string {
  if (isApiError(err)) {
    const field = err.field
    return field ? `${err.message} (${field})` : err.message
  }
  return errorMessage(err)
}

function IntelligencePill({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) {
  return (
    <div className="flex min-w-[9rem] items-center gap-2 rounded-xl border border-gray-200 bg-white/90 px-2.5 py-1.5 shadow-card">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-bold text-gray-800">{title}</span>
        <span className="block truncate text-[10px] text-gray-500">{hint}</span>
      </span>
    </div>
  )
}

/**
 * Premium "New Consumption" / "Edit consumption" screen — the only spot in `documents/` that
 * departs from the shared `DocumentForm` used by every other native document type. It stays on
 * the exact same route, permissions, pure form-model helpers (`formModel.ts`) and APIs
 * (`documentsApi`, `lookupApi`, `stockApi`) as the generic form; only the layout, the toolbar
 * (barcode / BOM / import), the AI suggestions panel and the impact/summary cards are new.
 */
export function ConsumptionForm({ spec, documentId, initial, existingStatus, existingVersion, onSaved }: ConsumptionFormProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const { warehouses, defaultWarehouseId, loading: refLoading, error: refError, warehouseName } = useReferenceData()
  const { can } = useAccess()

  const [header, setHeader] = useState<HeaderDraft>(() => initial?.header ?? newHeader(spec, todayIso()))
  const [lines, setLines] = useState<LineDraft[]>(() => initial?.lines ?? [newLine(spec)])
  const [mode, setMode] = useState<ConsumptionMode>('consumption')
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [dirty, setDirty] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [apiError, setApiError] = useState<string | null>(null)
  const [negative, setNegative] = useState<NegativeStockDetail[] | null>(null)
  const [override, setOverride] = useState(false)
  const [warnings, setWarnings] = useState<PostingWarning[]>([])
  const [busy, setBusy] = useState<Busy>(null)
  const [bomOpen, setBomOpen] = useState(false)
  const [postMenuOpen, setPostMenuOpen] = useState(false)
  const postMenuRef = useRef<HTMLDivElement>(null)
  const [printDocId, setPrintDocId] = useState<number | null>(null)
  const pendingAfterPrint = useRef<{ doc: InventoryDocument; posted: boolean } | null>(null)

  useEffect(() => {
    if (!postMenuOpen) return undefined
    const onDoc = (e: MouseEvent) => {
      if (postMenuRef.current && e.target instanceof Node && !postMenuRef.current.contains(e.target)) setPostMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [postMenuOpen])

  const canOverride = can('stock.negative_override')
  const canPost = can(permissionKeysFor('post', spec.code))
  const canSave = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)
  const disabled = busy !== null

  const patchHeader = (patch: Partial<HeaderDraft>) => {
    setHeader((h) => ({ ...h, ...patch }))
    setDirty(true)
  }
  const handleLinesChange = (next: LineDraft[]) => {
    setLines(next)
    setDirty(true)
  }

  // Pre-fill the default warehouse once reference data is known (new documents only).
  useEffect(() => {
    if (!documentId && header.default_warehouse_id === null && defaultWarehouseId !== null) {
      setHeader((h) => ({ ...h, default_warehouse_id: defaultWarehouseId }))
      setLines((ls) => ls.map((l) => (l.warehouse_id === null && l.origin === 'manual' ? { ...l, warehouse_id: defaultWarehouseId } : l)))
    }
  }, [defaultWarehouseId, documentId, header.default_warehouse_id])

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
            return { ...l, item_sku: l.item_sku ?? it.item_sku, track_batch: l.track_batch || Number(it.track_batch) === 1, track_serial: l.track_serial || Number(it.track_serial) === 1, units: units.length > l.units.length ? units : l.units }
          }),
        )
      })
      .catch(() => {
        /* the stored unit still works; pickers just stay minimal */
      })
    return () => controller.abort()
  }, [initial])

  // Every Consumption line is an outward movement (lineMode: 'fixed_out'), so availability is
  // simpler here than the generic DocumentForm: no direction branch, no transfer pairing.
  const entries = useMemo<AvailabilityEntry[]>(() => {
    const out: AvailabilityEntry[] = []
    for (const l of lines) {
      if (!l.item_id) continue
      const qty = lineBaseQty(l)
      if (qty <= 0) continue
      out.push({ key: l.key, line: { item_id: l.item_id, warehouse_id: (l.warehouse_id ?? header.default_warehouse_id) || null, batch_id: l.batch_id, qty } })
    }
    return out
  }, [lines, header.default_warehouse_id])
  const { results: availability, checking } = useAvailability(entries, true)

  const offending = useMemo(() => new Set(negative ? offendingDraftKeys(lines, negative) : []), [negative, lines])
  const totals = draftTotals(lines, spec)

  // Unsaved-edits protection: a real tab close/refresh (client-side route changes are covered by
  // the Cancel button's confirm and BreadcrumbHeader's escDirty).
  useEffect(() => {
    if (!dirty) return undefined
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const resetForNew = () => {
    const next = newHeader(spec, todayIso())
    next.default_warehouse_id = header.default_warehouse_id
    setHeader(next)
    setLines([newLine(spec, { warehouse_id: header.default_warehouse_id })])
    setSavedId(null)
    setErrors([])
    setApiError(null)
    setNegative(null)
    setOverride(false)
    setWarnings([])
    setDirty(false)
    hydrated.current = true
  }

  const submit = async (kind: Exclude<Busy, null>) => {
    setErrors([])
    setApiError(null)
    setWarnings([])
    if (kind === 'draft') setNegative(null)
    const errs = validateDraft(header, lines, spec)
    // validateDraft only flags a serial mismatch once some serials are picked; it does not
    // require batch/serial selection in the first place — the backend does not enforce this
    // either (a confirmed gap), so it is worth catching here before a batch/serial-tracked line
    // silently posts against no specific batch or serial at all.
    lines.filter((l) => !isBlankLine(l)).forEach((l, i) => {
      const n = i + 1
      if (l.item_id && l.track_batch && !l.batch_id) errs.push(`Line ${n}: this item is batch-tracked — pick a batch.`)
      if (l.item_id && l.track_serial) {
        const required = lineBaseQty(l)
        if (l.serials.length !== required) errs.push(`Line ${n}: this item is serial-tracked — pick ${formatQty(required)} serial number(s) (${l.serials.length} selected).`)
      }
    })
    if (errs.length) {
      setErrors(errs)
      return
    }
    const payload = toPayload(header, lines, spec)
    setBusy(kind)
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
      const posting = kind !== 'draft'
      if (posting) {
        doc = await documentsApi.post(doc.document_id, { negativeOverride: override && canOverride })
        setWarnings(doc.warnings ?? [])
      }
      setDirty(false)
      toast.success(posting ? 'Consumption posted successfully.' : 'Draft saved successfully.')
      if (kind === 'postAndNew') {
        resetForNew()
        return
      }
      if (kind === 'postAndPrint') {
        pendingAfterPrint.current = { doc, posted: posting }
        setPrintDocId(doc.document_id)
        return
      }
      onSaved(doc, posting)
    } catch (err) {
      const neg = parseNegativeStock(err)
      if (neg) {
        setNegative(neg)
        setApiError(id ? `Draft #${id} is saved but could not be posted: ${errorMessage(err)}` : errorMessage(err))
      } else {
        setApiError(describeError(err))
        toast.error(kind === 'draft' ? 'Unable to save draft — see the errors above.' : 'Unable to post — see the errors above.')
      }
    } finally {
      setBusy(null)
    }
  }

  const handlePrintDone = () => {
    setPrintDocId(null)
    const pending = pendingAfterPrint.current
    pendingAfterPrint.current = null
    if (pending) onSaved(pending.doc, pending.posted)
  }

  const handleCancel = () => {
    if (dirty && !window.confirm('Discard unsaved changes to this consumption?')) return
    navigate(savedId ? `/documents/${savedId}` : '/documents')
  }

  const handleAiAddLines = (drafts: LineDraft[]) => {
    if (drafts.length === 0) return
    setLines((ls) => [...ls.filter((l) => !isBlankLine(l)), ...drafts])
    setDirty(true)
  }

  const addBlankLine = () => {
    setLines((ls) => [...ls, newLine(spec, { warehouse_id: header.default_warehouse_id })])
    setDirty(true)
  }

  const [scanOpen, setScanOpen] = useState(false)
  useEffect(() => {
    if (mode === 'quick') setScanOpen(true)
  }, [mode])
  useConsumptionKeyboard({
    enabled: !disabled,
    onSavePost: canPost ? () => void submit('post') : undefined,
    onAddLine: addBlankLine,
    onToggleBarcode: () => setScanOpen((v) => !v),
  })

  const statusLabel = errors.length > 0 ? 'Needs attention' : negative ? 'Insufficient stock' : 'All checks passed'
  const statusTone: 'success' | 'danger' = errors.length > 0 || negative ? 'danger' : 'success'
  const editing = savedId !== null

  return (
    <PageShell paddingBottom className="consumption-premium">
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Documents', to: '/documents' }, { label: 'Consumption', to: '/documents?document_type=CONSUMPTION' }, { label: editing ? 'Edit' : 'New' }]}
        title={editing ? `Edit consumption ${header.document_no || `#${savedId}`}` : 'New Consumption'}
        icon={PackageMinus}
        description="Consume stock internally (COGS) for production, samples, damage, maintenance or other internal use."
        meta={editing && existingStatus ? <span className="text-xs text-gray-500">Version {existingVersion ?? 1} · {STATUS_LABELS[existingStatus] ?? existingStatus}</span> : undefined}
        escDirty={dirty}
        backTo="/documents"
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <IntelligencePill icon={Sparkles} title="Auto Suggestions" hint="Get item suggestions" />
            <IntelligencePill icon={Activity} title="Real-time Stock" hint="Live availability check" />
            <IntelligencePill icon={ShieldCheck} title="Audit Ready" hint="Complete trail" />
          </div>
        }
        actions={
          <Button variant="secondary" icon={BarChart3} onClick={() => navigate('/registers/movement-register?document_type=CONSUMPTION')}>
            View Consumption Report
          </Button>
        }
      />

      {refError ? <Notice kind="warning">{refError}</Notice> : null}
      {editing && (existingStatus === 'APPROVED' || existingStatus === 'PENDING_APPROVAL') ? (
        <Notice kind="info">Saving changes returns the document to draft; it will need approval again.</Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <ConsumptionHeaderCard mode={mode} onModeChange={setMode} header={header} onPatch={patchHeader} warehouses={warehouses} disabled={disabled} />
        <ConsumptionAiPanel spec={spec} reasonCode={header.reason_code} lines={lines} defaultWarehouseId={header.default_warehouse_id} disabled={disabled} onAddLines={handleAiAddLines} onOpenBom={() => setBomOpen(true)} />
      </div>

      {refLoading && warehouses.length === 0 ? <p className="text-xs text-gray-500">Loading warehouses…</p> : null}

      <ConsumptionLinesPanel
        spec={spec}
        lines={lines}
        onChange={handleLinesChange}
        warehouses={warehouses}
        defaultWarehouseId={header.default_warehouse_id}
        availability={availability}
        checking={checking}
        offendingKeys={offending}
        disabled={disabled}
        scanOpen={scanOpen}
        onToggleScan={() => setScanOpen((v) => !v)}
        onOpenBom={() => setBomOpen(true)}
      />

      <ConsumptionInsights spec={spec} lines={lines} availability={availability} warehouseName={warehouseName} />

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
        <Notice kind="error" title="Insufficient stock">
          {apiError ? <div className="mb-1">{apiError}</div> : null}
          <ul className="list-disc space-y-0.5 pl-4">
            {negative.map((d, i) => (
              <li key={`${d.item_id}-${d.warehouse_id}-${i}`}>
                {d.item_name ?? `Item #${d.item_id}`}
                {d.warehouse_id ? ` · warehouse #${d.warehouse_id}` : ''}: on hand {formatQty(d.on_hand)}, required {formatQty(d.required)}, short by <strong>{formatQty(d.short_by)}</strong>
              </li>
            ))}
          </ul>
          {canOverride ? (
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
              Post anyway and let stock go negative (override)
            </label>
          ) : (
            <div className="mt-1 text-xs text-gray-500">Reduce the quantities or receive stock first. Posting into negative stock needs the &ldquo;override negative-stock block&rdquo; permission.</div>
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
        status={
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${statusTone === 'danger' ? 'text-red-600' : 'text-emerald-700'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${statusTone === 'danger' ? 'bg-red-500' : 'bg-emerald-500'}`} aria-hidden />
            {statusLabel}
          </span>
        }
        totals={
          <>
            <ActionBarTotal label="Lines" value={totals.lines} />
            <ActionBarTotal label="Total Qty" value={formatQty(totals.qtyOut)} />
            {dirty ? <ActionBarTotal label="" value="Unsaved changes" tone="warning" /> : null}
          </>
        }
      >
        <Button variant="ghost" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="secondary" onClick={() => void submit('draft')} loading={busy === 'draft'} disabled={disabled || !canSave}>
          Save Draft
        </Button>
        {canPost ? (
          <div className="relative flex items-center gap-1" ref={postMenuRef}>
            <Button variant="primary" icon={CircleCheck} onClick={() => void submit('post')} loading={busy === 'post'} disabled={disabled || (!canSave && !savedId)}>
              {negative && override ? 'Post with override' : 'Save & Post'}
            </Button>
            <Button variant="primary" aria-label="More Save & Post options" className="px-2" onClick={() => setPostMenuOpen((v) => !v)} disabled={disabled || (!canSave && !savedId)}>
              <ChevronDown className="h-4 w-4" aria-hidden />
            </Button>
            {postMenuOpen ? (
              <div className="menu-panel" style={{ bottom: 'calc(100% + 0.5rem)', top: 'auto', width: '15rem' }}>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setPostMenuOpen(false)
                    void submit('postAndNew')
                  }}
                >
                  <strong>Save &amp; Post + New</strong>
                  <span>Post this one, then start a fresh consumption</span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setPostMenuOpen(false)
                    void submit('postAndPrint')
                  }}
                >
                  <strong>Save &amp; Post + Print</strong>
                  <span>Post, then open the print view</span>
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </StickyActionBar>

      <BomExplodeModal open={bomOpen} onClose={() => setBomOpen(false)} spec={spec} warehouses={warehouses} defaultWarehouseId={header.default_warehouse_id} onInsert={handleAiAddLines} />
      <ConsumptionPrintView documentId={printDocId} onDone={handlePrintDone} />
    </PageShell>
  )
}

export default ConsumptionForm
