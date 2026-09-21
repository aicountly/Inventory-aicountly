/**
 * `/documents/new/serial_adjustment` and the edit screen for a SERIAL_ADJUSTMENT draft.
 *
 * ## Why this type has a screen of its own
 *
 * Every other native type is entered through `DocumentForm` + `LineEditor`, which are
 * item-first: pick an item, type a quantity, then tick serials off a modal list. That order is
 * exactly backwards for this document. The operator raising a serial adjustment is holding the
 * unit, or standing in front of a rack; what they have is the number on the label, and the
 * item, warehouse, batch and current status are the things they are asking Inventory to tell
 * them. The old screen made them supply all four before it would let them name the serial.
 *
 * So the workspace here is one row per serial, filled in from `GET /v1/serials`, with scan,
 * paste and file intake on top. The document it saves is identical: `model.toPayloadLines`
 * folds the rows back into the `by_line` shape DocumentService::create expects, and the same
 * `documentsApi` create / update / post calls carry it. Nothing about the server contract, the
 * permission keys or the lifecycle changes — only the order the operator works in.
 *
 * Every other document type still renders through DocumentForm, untouched.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronDown,
  ClipboardList,
  CircleHelp,
  FileUp,
  History,
  Keyboard,
  ScanLine,
  Sparkles,
  Barcode,
} from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Notice } from '../../components/Notice'
import { Modal } from '../../components/Modal'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { errorMessage, isApiError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import type { ItemSearchRow, SerialLookupRow } from '../../services/lookupApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Kbd } from '../../ui/Kbd'
import { MenuButton } from '../../ui/MenuButton'
import { Select } from '../../ui/Select'
import { Textarea } from '../../ui/Textarea'
import { useToast } from '../../ui/ToastContext'
import { AIC, cx } from '../../ui/cx'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { FormField, FormSectionCard } from '../../ui/shell/FormSectionCard'
import { PageShell } from '../../ui/shell/PageShell'
import { StickyActionBar } from '../../ui/shell/StickyActionBar'
import { todayIso } from '../../utils/format'
import { canCreate, permissionKeysFor, STATUS_LABELS, statusTone } from '../actions'
import type { DocumentStatus, InventoryDocument, PostingWarning } from '../types'
import { useReferenceData } from '../useReferenceData'
import { aiAssist } from './aiAssist'
import { SerialGrid } from './SerialGrid'
import { SerialIntakeDrawer } from './SerialIntakeDrawer'
import type { IntakeMode, IntakeResult } from './SerialIntakeDrawer'
import { AdjustmentSummaryCard, GuidelinesCard, LiveSerialInfoCard } from './SidePanels'
import { fetchBaseUnits, resolveSerial } from './resolver'
import {
  applyLookup,
  baseUnitOf,
  duplicateRowNumber,
  isBlankRow,
  markDuplicates,
  newHeader,
  newRow,
  summarise,
  toPayload,
  validateDraft,
} from './model'
import type { SerialAdjustmentHeaderDraft, SerialRowDraft } from './model'

const DOCUMENT_TYPE = 'SERIAL_ADJUSTMENT'

export interface SerialAdjustmentPageProps {
  /** Editing an existing draft. */
  documentId?: number
  initial?: { header: SerialAdjustmentHeaderDraft; rows: SerialRowDraft[] }
  status?: DocumentStatus
  documentNo?: string | null
  onSaved: (doc: InventoryDocument, posted: boolean) => void
}

const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: 'Alt + A', what: 'Add another line' },
  { keys: 'Alt + S', what: 'Open the scanner' },
  { keys: 'Alt + V', what: 'Paste a list of serial numbers' },
  { keys: 'Ctrl / ⌘ + S', what: 'Save as draft' },
  { keys: 'Esc', what: 'Close the panel or dialog' },
]

export function SerialAdjustmentPage({ documentId, initial, status, documentNo, onSaved }: SerialAdjustmentPageProps) {
  const toast = useToast()
  const { can } = useAccess()
  const { warehouses, defaultWarehouseId, loading: refLoading, error: refError } = useReferenceData()

  const [header, setHeader] = useState<SerialAdjustmentHeaderDraft>(() => initial?.header ?? newHeader(todayIso()))
  const [rows, setRows] = useState<SerialRowDraft[]>(() => (initial?.rows?.length ? initial.rows : [newRow()]))
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<'save' | 'post' | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [warnings, setWarnings] = useState<PostingWarning[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [printAfterSave, setPrintAfterSave] = useState(false)

  const [intake, setIntake] = useState<{ open: boolean; mode: IntakeMode }>({ open: false, mode: 'scan' })
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [leaving, setLeaving] = useState<{ to: string; proceed: () => void } | null>(null)

  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const [context, setContext] = useState<{ serial: SerialLookupRow | null; loading: boolean; notFound: string | null }>({ serial: null, loading: false, notFound: null })

  const serialInputs = useRef(new Map<string, HTMLInputElement | null>())
  const lookupRuns = useRef(new Map<string, AbortController>())
  const unitCache = useRef(new Map<number, { unit_id: number | null; conversion_factor: number }>())
  /**
   * Row key → the serial number that row is already resolved to.
   *
   * Held in a ref rather than read off `rows`, because the guard has to answer "have we
   * already looked this up?" synchronously and a `setRows` updater does not run until React
   * re-renders. Reading it there made every scan fire the lookup twice: once on Enter and
   * again on the blur that Enter causes.
   */
  const resolvedSerials = useRef(new Map<string, string>())

  const canPost = can(permissionKeysFor('post', DOCUMENT_TYPE))
  const canSave = savedId ? can(permissionKeysFor('edit', DOCUMENT_TYPE)) : canCreate(DOCUMENT_TYPE, can)
  const disabled = busy !== null

  // Pre-fill the default warehouse once reference data arrives (new documents only), the same
  // rule DocumentForm applies: it seeds the header field and never overwrites a chosen one.
  useEffect(() => {
    if (documentId || header.default_warehouse_id !== null || defaultWarehouseId === null) return
    setHeader((h) => (h.default_warehouse_id === null ? { ...h, default_warehouse_id: defaultWarehouseId } : h))
  }, [defaultWarehouseId, documentId, header.default_warehouse_id])

  // Abort every in-flight serial lookup when the screen goes away.
  useEffect(() => {
    const runs = lookupRuns.current
    return () => {
      runs.forEach((c) => c.abort())
      runs.clear()
    }
  }, [])

  const patchHeader = useCallback((patch: Partial<SerialAdjustmentHeaderDraft>) => {
    setHeader((h) => ({ ...h, ...patch }))
    setDirty(true)
  }, [])

  const patchRow = useCallback((key: string, patch: Partial<SerialRowDraft>) => {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    setDirty(true)
  }, [])

  /**
   * The item's base unit, cached per item for the life of the screen.
   *
   * A serial is one piece. Sending `qty: 1` on a line whose unit is "Box of 12" would record a
   * twelfth of the stock the operator scanned, so the unit is never taken from the item's
   * default — it is looked up and pinned to the base.
   */
  const ensureBaseUnit = useCallback(async (itemId: number) => {
    const hit = unitCache.current.get(itemId)
    if (hit) return hit
    try {
      const found = await fetchBaseUnits([itemId])
      const unit = found.get(itemId) ?? { unit_id: null, conversion_factor: 1 }
      unitCache.current.set(itemId, unit)
      return unit
    } catch {
      return { unit_id: null, conversion_factor: 1 }
    }
  }, [])

  // -------------------------------------------------------------------------
  // Live serial lookup
  // -------------------------------------------------------------------------

  const commitSerial = useCallback(
    async (key: string, rawValue: string) => {
      const value = rawValue.trim()
      const previous = lookupRuns.current.get(key)
      if (previous) previous.abort()

      if (value === '') {
        resolvedSerials.current.delete(key)
        setRows((list) => markDuplicates(list.map((r) => (r.key === key ? { ...r, serial_no: '', serial_id: null, check: 'idle', message: null } : r))))
        return
      }

      // Re-committing the same value — the blur Enter itself causes — must not fire a second
      // request, or every scan costs two round trips.
      if (resolvedSerials.current.get(key)?.toLowerCase() === value.toLowerCase()) return

      setRows((list) => list.map((r) => (r.key === key ? { ...r, serial_no: value, check: 'checking', message: null } : r)))

      const controller = new AbortController()
      lookupRuns.current.set(key, controller)
      setContext({ serial: null, loading: true, notFound: null })
      try {
        const { row: found, error } = await resolveSerial(value, controller.signal)
        if (controller.signal.aborted) return
        if (error) {
          resolvedSerials.current.delete(key)
          setRows((list) => list.map((r) => (r.key === key ? { ...r, check: 'error', message: error } : r)))
          setContext({ serial: null, loading: false, notFound: error })
          return
        }
        if (!found) {
          resolvedSerials.current.delete(key)
          setRows((list) =>
            list.map((r) =>
              r.key === key ? { ...r, serial_id: null, current_status: null, check: 'error', message: `No serial number “${value}” is registered.` } : r,
            ),
          )
          setContext({ serial: null, loading: false, notFound: `No serial number “${value}” is registered in this company.` })
          return
        }
        const unit = await ensureBaseUnit(found.item_id)
        if (controller.signal.aborted) return
        resolvedSerials.current.set(key, found.serial_no.trim())
        setRows((list) => {
          const duplicateOf = duplicateRowNumber(list, key, found.serial_no)
          return markDuplicates(
            list.map((r) => (r.key === key ? { ...applyLookup(r, found, duplicateOf), unit_id: unit.unit_id, conversion_factor: unit.conversion_factor } : r)),
          )
        })
        setContext({ serial: found, loading: false, notFound: null })
        setDirty(true)
      } catch (err) {
        if (controller.signal.aborted) return
        resolvedSerials.current.delete(key)
        const message = errorMessage(err, 'Could not check this serial number.')
        setRows((list) => list.map((r) => (r.key === key ? { ...r, check: 'error', message } : r)))
        setContext({ serial: null, loading: false, notFound: message })
      } finally {
        if (lookupRuns.current.get(key) === controller) lookupRuns.current.delete(key)
      }
    },
    [ensureBaseUnit],
  )

  // -------------------------------------------------------------------------
  // Rows
  // -------------------------------------------------------------------------

  const addRow = useCallback(
    (focus = true) => {
      const row = newRow({ warehouse_id: null })
      setRows((list) => [...list, row])
      setDirty(true)
      if (focus) {
        // After paint: the input does not exist until the new row renders.
        requestAnimationFrame(() => serialInputs.current.get(row.key)?.focus())
      }
      return row
    },
    [],
  )

  const removeRow = useCallback((key: string) => {
    lookupRuns.current.get(key)?.abort()
    lookupRuns.current.delete(key)
    serialInputs.current.delete(key)
    resolvedSerials.current.delete(key)
    setRows((list) => {
      const next = list.filter((r) => r.key !== key)
      return markDuplicates(next.length ? next : [newRow()])
    })
    setDirty(true)
  }, [])

  const pickItem = useCallback(
    async (key: string, picked: ItemSearchRow) => {
      const unit = baseUnitOf(picked)
      unitCache.current.set(picked.item_id, unit)
      patchRow(key, {
        item_id: picked.item_id,
        item_name: picked.print_name || picked.item_name,
        item_sku: picked.item_sku,
        unit_id: unit.unit_id,
        conversion_factor: unit.conversion_factor,
        warehouse_id: picked.default_warehouse_id ?? null,
      })
      requestAnimationFrame(() => serialInputs.current.get(key)?.focus())
    },
    [patchRow],
  )

  const clearItem = useCallback(
    (key: string) => {
      resolvedSerials.current.delete(key)
      patchRow(key, {
        item_id: null,
        item_name: '',
        item_sku: null,
        serial_id: null,
        serial_no: '',
        batch_id: null,
        batch_no: null,
        current_status: null,
        unit_id: null,
        conversion_factor: 1,
        qty: 1,
        check: 'idle',
        message: null,
      })
    },
    [patchRow],
  )

  const registerSerialInput = useCallback((key: string, el: HTMLInputElement | null) => {
    if (el) serialInputs.current.set(key, el)
    else serialInputs.current.delete(key)
  }, [])

  const focusRow = useCallback((key: string) => {
    setFocusedKey(key)
  }, [])

  // The contextual panel follows the caret: focusing a resolved row shows that serial.
  useEffect(() => {
    if (!focusedKey) return
    const row = rows.find((r) => r.key === focusedKey)
    if (!row || row.serial_id === null) return
    setContext((c) => (c.serial?.serial_id === row.serial_id ? c : { serial: null, loading: false, notFound: null }))
  }, [focusedKey, rows])

  const taken = useMemo(() => new Set(rows.map((r) => r.serial_no.trim().toLowerCase()).filter(Boolean)), [rows])

  /** Rows added by the scanner / paste / import drawer, already resolved against the API. */
  const acceptIntake = useCallback(
    async (results: IntakeResult[]) => {
      const usable = results.filter((r) => r.row !== null)
      if (usable.length === 0) return
      const itemIds = [...new Set(usable.map((r) => r.row!.item_id))].filter((id) => !unitCache.current.has(id))
      if (itemIds.length > 0) {
        try {
          const units = await fetchBaseUnits(itemIds)
          units.forEach((unit, id) => unitCache.current.set(id, unit))
        } catch {
          /* a missing unit falls back to the item's base below */
        }
      }
      setRows((list) => {
        // Fill the trailing blank row first, so scanning into a fresh document does not leave
        // an empty line above everything the operator scanned.
        const base = list.length > 0 && isBlankRow(list[list.length - 1]) ? list.slice(0, -1) : list
        const next = [...base]
        for (const result of usable) {
          const found = result.row!
          const unit = unitCache.current.get(found.item_id) ?? { unit_id: null, conversion_factor: 1 }
          const fresh = newRow({ unit_id: unit.unit_id, conversion_factor: unit.conversion_factor })
          const duplicateOf = duplicateRowNumber(next, fresh.key, found.serial_no)
          resolvedSerials.current.set(fresh.key, found.serial_no.trim())
          next.push(applyLookup(fresh, found, duplicateOf))
        }
        return markDuplicates(next)
      })
      setContext({ serial: usable[usable.length - 1].row, loading: false, notFound: null })
      setDirty(true)
    },
    [],
  )

  const openIntake = useCallback((mode: IntakeMode) => setIntake({ open: true, mode }), [])

  // -------------------------------------------------------------------------
  // Validation & save
  // -------------------------------------------------------------------------

  const validation = useMemo(() => validateDraft(header, rows), [header, rows])
  const summary = useMemo(() => summarise(rows, header.default_warehouse_id), [rows, header.default_warehouse_id])
  const rowIssues = useMemo(() => {
    const map = new Map<string, string>()
    // Only after a save attempt: a half-typed grid must not be red before anyone asked.
    if (!submitted) return map
    for (const issue of validation.rowIssues) if (!map.has(issue.key)) map.set(issue.key, issue.message)
    return map
  }, [validation.rowIssues, submitted])

  const describeError = useCallback((err: unknown): string => {
    if (isApiError(err)) {
      if (err.status === 401) return 'Your session has expired. Sign in again and the draft can be saved.'
      if (err.status === 403) return err.message || 'You do not have permission to do that.'
      if (err.status === 409) return `${err.message} Reload the document before saving again — someone else changed it.`
      return err.field ? `${err.message} (${err.field})` : err.message
    }
    return errorMessage(err, 'The document could not be saved. Check your connection and try again.')
  }, [])

  const submit = useCallback(
    async (post: boolean) => {
      setSubmitted(true)
      setApiError(null)
      setWarnings([])
      const result = validateDraft(header, rows)
      const messages = [...result.errors, ...result.rowIssues.map((i) => `Line ${i.row}: ${i.message}`)]
      if (messages.length > 0) {
        setErrors(messages)
        return
      }
      setErrors([])
      setBusy(post ? 'post' : 'save')
      let id = savedId
      try {
        const payload = toPayload(header, rows)
        let doc: InventoryDocument
        if (id) doc = await documentsApi.update(id, payload)
        else {
          doc = await documentsApi.create(payload)
          id = doc.document_id
          setSavedId(id)
        }
        if (post) {
          doc = await documentsApi.post(doc.document_id, {})
          setWarnings(doc.warnings ?? [])
        }
        setDirty(false)
        toast.success(post ? `Serial adjustment ${doc.document_no ?? `#${doc.document_id}`} posted.` : `Serial adjustment saved as draft ${doc.document_no ?? `#${doc.document_id}`}.`)
        if (printAfterSave) window.open(`/documents/${doc.document_id}/print`, '_blank', 'noopener')
        onSaved(doc, post)
      } catch (err) {
        const message = describeError(err)
        setApiError(id && post ? `Draft #${id} is saved but could not be posted: ${message}` : message)
        toast.error(message)
      } finally {
        setBusy(null)
      }
    },
    [describeError, header, onSaved, printAfterSave, rows, savedId, toast],
  )

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (canSave) void submit(false)
        return
      }
      // Alt combinations only: a bare letter belongs to whatever input has focus.
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      const key = e.key.toLowerCase()
      if (key === 'a') {
        e.preventDefault()
        addRow()
      } else if (key === 's') {
        e.preventDefault()
        openIntake('scan')
      } else if (key === 'v') {
        e.preventDefault()
        openIntake('paste')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addRow, canSave, disabled, openIntake, submit])

  useUnsavedChanges({
    when: dirty && !disabled,
    onBlocked: (to, proceed) => setLeaving({ to, proceed }),
  })

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const editing = savedId !== null && documentId !== undefined
  const title = editing ? `Edit serial adjustment ${documentNo ?? `#${savedId}`}` : 'New serial adjustment'

  /*
   * Labels collapse below `lg`.
   *
   * PageHeader wraps `actions` in a `shrink-0` flex row, so a row of five labelled buttons
   * sets its own width to max-content and pushes the page sideways on a phone — the header
   * cannot wrap them and this screen must not scroll horizontally. The icons carry the
   * meaning at that width; `aria-label` and `title` carry it for everyone else.
   */
  const headerActions = (
    <>
      <Button variant="secondary" size="sm" icon={Keyboard} onClick={() => setShortcutsOpen(true)} aria-label="Shortcuts" title="Shortcuts">
        <span className="hidden lg:inline">Shortcuts</span>
      </Button>
      <Button variant="secondary" size="sm" icon={FileUp} onClick={() => openIntake('import')} disabled={disabled} aria-label="Import serial numbers from a file" title="Import from a file">
        <span className="hidden lg:inline">Import</span>
      </Button>
      <Button variant="secondary" size="sm" icon={ScanLine} onClick={() => openIntake('scan')} disabled={disabled} aria-label="Open the scanner" title="Open the scanner">
        <span className="hidden lg:inline">Scan</span>
      </Button>
      <Button variant="secondary" size="sm" icon={CircleHelp} onClick={() => setHelpOpen(true)} aria-label="Help" title="About serial adjustments">
        <span className="hidden lg:inline">Help</span>
      </Button>
      {savedId ? (
        <Link
          to={`/documents/${savedId}`}
          aria-label="View history"
          title="View history"
          className="inline-flex items-center gap-1.5 h-8 px-3 text-sm font-medium rounded-lg bg-white text-gray-700 border border-gray-200 hover:border-primary/40 hover:bg-primary-light hover:text-primary no-underline"
        >
          <History className="w-4 h-4" aria-hidden />
          <span className="hidden lg:inline">View history</span>
        </Link>
      ) : (
        <Button variant="secondary" size="sm" icon={History} disabled aria-label="View history" title="Available once the document is saved">
          <span className="hidden lg:inline">View history</span>
        </Button>
      )}
    </>
  )

  return (
    <PageShell paddingBottom>
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Documents', to: '/documents' }, { label: 'Serial adjustment' }]}
        title={title}
        icon={Barcode}
        description="Record a correction against serial numbers — without changing what the stock is worth."
        badge={status ? <Badge tone={toneFor(status)}>{STATUS_LABELS[status] ?? status}</Badge> : null}
        backTo="/documents"
        backLabel="Back to documents"
        escDirty={dirty}
        actions={headerActions}
      />

      {/* Smart intake strip. The heading is honest about what runs: the intake below reads the
          live serial master, and the AI pass is an extra step that is not configured here. */}
      <section
        className={cx(
          AIC,
          // A flat tint, not a gradient: the dark-mode retrofit layer works by out-specifying
          // background utilities, and nothing in it can reach a gradient stop custom property,
          // so a gradient strip would stay pale green on a dark card. See darkAccents.test.tsx.
          'rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 flex flex-wrap items-center justify-between gap-3',
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-10 h-10 rounded-full bg-emerald-100 grid place-items-center shrink-0">
            <Sparkles className="w-5 h-5 text-emerald-600" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Add serials faster</p>
            <p className="text-xs text-gray-600">
              Scan, paste or upload serial numbers — each one is matched to its item, warehouse and status from the live serial master.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={ClipboardList} onClick={() => openIntake('paste')} disabled={disabled}>
            Paste list
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={Sparkles}
            className="border-emerald-200 text-emerald-700"
            onClick={() => (aiAssist.isConfigured() ? openIntake('paste') : setAiOpen(true))}
          >
            Try with AI
          </Button>
        </div>
      </section>

      {refError ? <Notice kind="warning">{refError}</Notice> : null}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_17rem] gap-3 items-start">
        <div className="min-w-0 space-y-3">
          <FormSectionCard
            title={<StepTitle step={1}>Document details</StepTitle>}
            description="Date, reference and the reason this correction is being recorded."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              <FormField label="Document date" htmlFor="sa-date" required>
                <Input
                  id="sa-date"
                  type="date"
                  value={header.document_date}
                  disabled={disabled}
                  invalid={submitted && !/^\d{4}-\d{2}-\d{2}$/.test(header.document_date)}
                  onChange={(e) => patchHeader({ document_date: e.target.value })}
                />
              </FormField>
              <FormField label="Document no." htmlFor="sa-no" hint="Leave empty to number automatically.">
                <Input id="sa-no" value={header.document_no} disabled={disabled} placeholder="Auto-generate" onChange={(e) => patchHeader({ document_no: e.target.value })} />
              </FormField>
              <FormField label="Default warehouse" htmlFor="sa-wh" hint="Used for lines whose warehouse is left as Default.">
                <Select id="sa-wh" value={header.default_warehouse_id ?? ''} disabled={disabled || refLoading} onChange={(e) => patchHeader({ default_warehouse_id: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">None</option>
                  {warehouses.map((w) => (
                    <option key={w.warehouse_id} value={w.warehouse_id}>
                      {w.warehouse_name}
                      {w.warehouse_code ? ` (${w.warehouse_code})` : ''}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Reason code" htmlFor="sa-reason">
                <Input id="sa-reason" value={header.reason_code} disabled={disabled} maxLength={32} placeholder="e.g. DAMAGE" onChange={(e) => patchHeader({ reason_code: e.target.value })} />
              </FormField>
              <FormField label="Movement reason" htmlFor="sa-movement">
                <Input id="sa-movement" value={header.movement_reason} disabled={disabled} maxLength={64} placeholder="e.g. Relabelled after audit" onChange={(e) => patchHeader({ movement_reason: e.target.value })} />
              </FormField>
              <FormField label="Narration" htmlFor="sa-narration" className="sm:col-span-2 lg:col-span-3 xl:col-span-5">
                <Textarea id="sa-narration" rows={2} value={header.narration} disabled={disabled} placeholder="Notes, reference or the reason for this adjustment…" onChange={(e) => patchHeader({ narration: e.target.value })} />
              </FormField>
            </div>
          </FormSectionCard>

          <FormSectionCard
            title={<StepTitle step={2}>Serial details</StepTitle>}
            description="One row per serial number. Scan, paste or import in bulk — the item, warehouse and status come from the serial master."
          >
            {/* In the body, not the card's `action` slot: that slot is shrink-0, and a
                three-button toolbar there squeezes the description to one word per line
                on a phone. */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Button variant="outline" size="sm" icon={ScanLine} onClick={() => openIntake('scan')} disabled={disabled} kbd="Alt+S">
                Scan serial
              </Button>
              <Button variant="secondary" size="sm" icon={ClipboardList} onClick={() => openIntake('paste')} disabled={disabled}>
                Paste list
              </Button>
              <Button variant="secondary" size="sm" icon={FileUp} onClick={() => openIntake('import')} disabled={disabled}>
                Import
              </Button>
            </div>
            <SerialGrid
              rows={rows}
              warehouses={warehouses}
              issues={rowIssues}
              disabled={disabled}
              onPatch={patchRow}
              onRemove={removeRow}
              onCommitSerial={(key, value) => void commitSerial(key, value)}
              onPickItem={(key, picked) => void pickItem(key, picked)}
              onClearItem={clearItem}
              onAddRow={() => addRow()}
              onScanRow={() => openIntake('scan')}
              onFocusRow={focusRow}
              registerSerialInput={registerSerialInput}
            />
          </FormSectionCard>

          {errors.length > 0 ? (
            <Notice kind="error" title="Fix these before saving">
              <ul className="warning-list">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {validation.warnings.length > 0 && errors.length === 0 ? (
            <Notice kind="warning">
              <ul className="warning-list">
                {validation.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {apiError ? <Notice kind="error">{apiError}</Notice> : null}
          {warnings.length > 0 ? (
            <Notice kind="warning" title="Posted with warnings">
              <ul className="warning-list">
                {warnings.map((w, i) => (
                  <li key={`${w.code}-${i}`}>{w.message}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </div>

        <aside className="space-y-3 xl:sticky xl:top-3">
          <LiveSerialInfoCard serial={context.serial} loading={context.loading} notFound={context.notFound} />
          <AdjustmentSummaryCard summary={summary} />
          <GuidelinesCard recordsOnly />
        </aside>
      </div>

      <StickyActionBar
        totals={
          <>
            <span className="text-[11px] text-gray-500">
              <strong className="text-gray-900 tabular-nums">{summary.serialLines}</strong> serial
              {summary.serialLines === 1 ? '' : 's'} · <strong className="text-gray-900 tabular-nums">{summary.documentLines}</strong> line
              {summary.documentLines === 1 ? '' : 's'}
            </span>
            {savedId ? <span className="text-[11px] text-gray-500">Draft #{savedId}</span> : null}
            {summary.needsAttention > 0 ? (
              <Badge tone="warning" size="xs">
                {summary.needsAttention} need{summary.needsAttention === 1 ? 's' : ''} attention
              </Badge>
            ) : null}
          </>
        }
      >
        <label className="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer mr-2">
          <input type="checkbox" className="w-4 h-4" checked={printAfterSave} onChange={(e) => setPrintAfterSave(e.target.checked)} />
          Print after save
        </label>
        <Link
          to={savedId ? `/documents/${savedId}` : '/documents'}
          className="inline-flex items-center justify-center h-8 px-3 text-sm font-medium rounded-lg bg-white text-gray-700 border border-gray-200 hover:border-primary/40 no-underline"
        >
          Cancel
        </Link>
        <Button variant="secondary" onClick={() => void submit(false)} loading={busy === 'save'} disabled={disabled || !canSave}>
          {savedId ? 'Save changes' : 'Save as draft'}
        </Button>
        {canPost ? (
          <span className="inline-flex">
            <Button
              variant="primary"
              className="rounded-r-none bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-300"
              onClick={() => void submit(true)}
              loading={busy === 'post'}
              disabled={disabled || (!canSave && !savedId)}
            >
              Save &amp; post
            </Button>
            <MenuButton
              label="More save options"
              icon={ChevronDown}
              variant="primary"
              size="sm"
              className="rounded-l-none border-l border-white/25 bg-emerald-600 hover:bg-emerald-700 px-2"
              buttonProps={{ disabled }}
              actions={[
                { key: 'draft', label: savedId ? 'Save changes' : 'Save as draft', onSelect: () => void submit(false), disabled: !canSave },
                { key: 'post', label: 'Save & post', onSelect: () => void submit(true), disabled: !canSave && !savedId },
              ]}
            />
          </span>
        ) : null}
      </StickyActionBar>

      <SerialIntakeDrawer
        open={intake.open}
        mode={intake.mode}
        onModeChange={(mode) => setIntake({ open: true, mode })}
        onClose={() => setIntake((i) => ({ ...i, open: false }))}
        taken={taken}
        onAccept={(results) => void acceptIntake(results)}
      />

      <Modal open={shortcutsOpen} title="Keyboard shortcuts" onClose={() => setShortcutsOpen(false)} size="sm">
        <ul className="list-none p-0 m-0 divide-y divide-gray-100">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-4 py-2">
              <span className="text-sm text-gray-700">{s.what}</span>
              <Kbd>{s.keys}</Kbd>
            </li>
          ))}
        </ul>
      </Modal>

      <Modal open={helpOpen} title="About serial adjustments" onClose={() => setHelpOpen(false)} size="md">
        <div className="space-y-3 text-sm text-gray-700">
          <p>
            A serial adjustment records a correction raised against serial numbers. It carries no valuation and raises no
            accounting effect, so nothing it posts changes what the stock is worth or what Books reports.
          </p>
          <p>
            Start from the serial: scan or type the number and Inventory fills in the item, warehouse, batch and current
            status from the serial master. Use <strong>Paste list</strong> or <strong>Import</strong> for a whole rack at once.
          </p>
          <p>
            Every save and post is recorded in the{' '}
            <Link to="/audit" className="text-primary hover:underline">
              audit log
            </Link>{' '}
            with a before and after snapshot. To change a serial&rsquo;s own warehouse or status, edit it in the{' '}
            <Link to="/masters/serials" className="text-primary hover:underline">
              serial master
            </Link>
            .
          </p>
        </div>
      </Modal>

      <Modal open={aiOpen} title="AI assistance" onClose={() => setAiOpen(false)} size="sm">
        <p className="text-sm text-gray-700">{aiAssist.unavailableReason()}</p>
        <div className="mt-4 flex gap-2">
          <Button
            variant="primary"
            onClick={() => {
              setAiOpen(false)
              openIntake('paste')
            }}
          >
            Paste a list instead
          </Button>
          <Button variant="secondary" onClick={() => setAiOpen(false)}>
            Close
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={leaving !== null}
        title="Leave without saving?"
        message="This serial adjustment has changes that have not been saved. Leaving now discards them."
        confirmLabel="Discard and leave"
        danger
        onConfirm={() => {
          const go = leaving?.proceed
          setDirty(false)
          setLeaving(null)
          go?.()
        }}
        onCancel={() => setLeaving(null)}
      />
    </PageShell>
  )
}

function StepTitle({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-5 h-5 rounded-full bg-primary text-white text-[11px] font-bold grid place-items-center shrink-0" aria-hidden>
        {step}
      </span>
      {children}
    </span>
  )
}

function toneFor(status: DocumentStatus) {
  const tone = statusTone(status)
  return tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : tone === 'info' ? 'info' : 'neutral'
}

export default SerialAdjustmentPage
