import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  CalendarDays,
  ClipboardPaste,
  CopyPlus,
  FileText,
  Info,
  Layers,
  ListPlus,
  NotebookPen,
  Paperclip,
  Plus,
  RefreshCw,
  Save,
  ScanBarcode,
  Search,
  Send,
  Settings2,
  Truck,
  Warehouse as WarehouseIcon,
} from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Notice } from '../../components/Notice'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { errorMessage, isApiError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { lookupApi } from '../../services/lookupApi'
import { availabilityApi } from '../../services/stockApi'
import type { AvailabilityCheckLine, AvailabilityCheckResult } from '../../services/stockApi'
import { partyDirectory } from '../../services/partyApi'
import type { PartyContext } from '../../services/partyApi'
import { P } from '../../services/access'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Input } from '../../ui/Input'
import { MenuButton } from '../../ui/MenuButton'
import type { MenuAction } from '../../ui/MenuButton'
import { Select } from '../../ui/Select'
import { Textarea } from '../../ui/Textarea'
import { useToast } from '../../ui/ToastContext'
import { cx } from '../../ui/cx'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { FormField } from '../../ui/shell/FormSectionCard'
import { PageShell } from '../../ui/shell/PageShell'
import { StickyActionBar } from '../../ui/shell/StickyActionBar'
import { formatQty, todayIso, toNumber } from '../../utils/format'
import { canCreate, permissionKeysFor, STATUS_LABELS, statusTone } from '../actions'
import { isBlankLine, lineBaseQty, newHeader, newLine, toPayload, validateDraft } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { unitOptionsFrom } from '../LineEditor'
import { offendingDraftKeys, parseNegativeStock } from '../negativeStock'
import type { NegativeStockDetail } from '../negativeStock'
import type { DocumentTypeSpec } from '../registry'
import type { DocumentStatus, InventoryDocument, PostingWarning } from '../types'
import { useAvailability } from '../useAvailability'
import type { AvailabilityEntry } from '../useAvailability'
import { useReferenceData } from '../useReferenceData'
import { ChallanLines } from './ChallanLines'
import { AdditionalDetailsPanel, AttachmentsPanel, NotesPanel, ReferencesPanel, TransportPanel } from './ChallanTabPanels'
import { AssistCardButton, ChallanHeaderActions } from './ChallanHeaderActions'
import { CopyFromChallanDrawer } from './CopyFromChallanDrawer'
import { CustomerContextCard, CustomerField } from './CustomerField'
import { ChallanWarehouseSelect } from './fields'
import { ItemEntryBar } from './ItemEntryBar'
import type { EntryAdd } from './ItemEntryBar'
import { MultiItemDrawer } from './MultiItemDrawer'
import { PasteImportDialog } from './PasteImportDialog'
import type { PasteMode } from './PasteImportDialog'
import { QuickSummary } from './QuickSummary'
import type { StockVerdict } from './QuickSummary'
import { SmartAssistDrawer } from './SmartAssistDrawer'
import { SmartInsights } from './SmartInsights'
import { StockAcrossWarehousesDrawer } from './StockAcrossWarehousesDrawer'
import { buildInsights } from './insights'
import type { LineBatchFact } from './insights'
import { EMPTY_DISPATCH, EMPTY_TRANSPORT, dispatchFrom, filledCount, transportFrom, withHeaderDetails } from './challanMeta'
import type { DispatchDetails, TransportDetails } from './challanMeta'
import { deleteTemplate, linesFromTemplate, listTemplates, saveTemplate, templateFromDraft } from './templates'
import type { ChallanTemplate } from './templates'

type TabKey = 'items' | 'additional' | 'transport' | 'references' | 'attachments' | 'notes'

/** How many characters of narration print comfortably on the challan sheet. Never enforced. */
const NARRATION_SOFT_LIMIT = 500

export interface DeliveryChallanFormProps {
  spec: DocumentTypeSpec
  /** Editing an existing draft. */
  documentId?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  /** The stored document's status and number, when editing. */
  status?: DocumentStatus
  documentNo?: string | null
  version?: number
  onSaved: (doc: InventoryDocument, posted: boolean) => void
}

interface StockConflict {
  item: string
  requested: number
  available: number
}

function describeError(err: unknown): string {
  if (isApiError(err)) return err.field ? `${err.message} (${err.field})` : err.message
  return errorMessage(err)
}

/**
 * Delivery Challan / Dispatch — create and edit.
 *
 * It is a different SCREEN from the shared `DocumentForm`, not a different
 * document: the draft it holds is the same `HeaderDraft` / `LineDraft[]`, it
 * validates with the same `validateDraft`, and it sends the same
 * `toPayload(...)` to the same create / update / post endpoints. Everything
 * this file adds is above that line — faster entry, live stock beside every
 * line, and the checks a dispatch clerk would otherwise run in their head.
 *
 * What it deliberately does not add: any commercial figure. A challan moves
 * goods, not money, and price, discount, tax and invoice value belong to the
 * Books voucher that later settles it.
 */
export function DeliveryChallanForm({ spec, documentId, initial, status, documentNo, version, onSaved }: DeliveryChallanFormProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useAccess()
  const { scope } = useCompany()
  const cmpId = scope?.cmp_id ?? null
  const { warehouses, defaultWarehouseId, warehouseName, loading: refLoading, error: refError } = useReferenceData()

  const [header, setHeader] = useState<HeaderDraft>(() => initial?.header ?? newHeader(spec, todayIso()))
  const [lines, setLines] = useState<LineDraft[]>(() => initial?.lines ?? [])
  const [transport, setTransport] = useState<TransportDetails>(() => transportFrom(initial?.header.metadata))
  const [dispatch, setDispatch] = useState<DispatchDetails>(() => dispatchFrom(initial?.header.metadata))
  const [batchFacts, setBatchFacts] = useState<Record<string, LineBatchFact>>({})

  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState<TabKey>('items')
  const [scan, setScan] = useState(false)
  const [busy, setBusy] = useState<'save' | 'post' | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [apiError, setApiError] = useState<string | null>(null)
  const [negative, setNegative] = useState<NegativeStockDetail[] | null>(null)
  const [override, setOverride] = useState(false)
  const [warnings, setWarnings] = useState<PostingWarning[]>([])
  const [highlight, setHighlight] = useState<ReadonlySet<string>>(new Set())
  const [conflicts, setConflicts] = useState<StockConflict[] | null>(null)
  const [pendingLeave, setPendingLeave] = useState<{ to: string; proceed: () => void } | null>(null)
  const [warehouseMove, setWarehouseMove] = useState<{ from: number; to: number | null; count: number } | null>(null)

  const [assistOpen, setAssistOpen] = useState(false)
  const [multiOpen, setMultiOpen] = useState(false)
  const [pasteMode, setPasteMode] = useState<PasteMode | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [stockToolsFor, setStockToolsFor] = useState<{ itemId: number; itemName: string; warehouseId: number | null; lineKey: string | null } | null>(null)
  const [templates, setTemplates] = useState<ChallanTemplate[]>([])

  const [party, setParty] = useState<PartyContext | null>(null)
  const [partyLoading, setPartyLoading] = useState(false)
  const [partyError, setPartyError] = useState<string | null>(null)
  const [partyTick, setPartyTick] = useState(0)

  const itemSearchRef = useRef<HTMLInputElement>(null)
  const customerRef = useRef<HTMLInputElement>(null)
  const narrationRef = useRef<HTMLTextAreaElement>(null)
  const linesRef = useRef<HTMLDivElement>(null)

  const canOverride = can('stock.negative_override')
  const canPost = can(permissionKeysFor('post', spec.code))
  const canSave = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)
  const canReadSettings = can(P.settingsRead)
  const editing = documentId !== undefined

  // --- draft mutation helpers ------------------------------------------------

  const markDirty = () => setDirty(true)

  const patchHeader = useCallback((patch: Partial<HeaderDraft>) => {
    setHeader((h) => ({ ...h, ...patch }))
    setDirty(true)
  }, [])

  const changeLines = useCallback((next: LineDraft[] | ((current: LineDraft[]) => LineDraft[])) => {
    setLines((current) => (typeof next === 'function' ? next(current) : next))
    setDirty(true)
  }, [])

  const setBatchFact = useCallback((key: string, fact: LineBatchFact | null) => {
    setBatchFacts((facts) => {
      if (!fact) {
        if (!(key in facts)) return facts
        const next = { ...facts }
        delete next[key]
        return next
      }
      return { ...facts, [key]: fact }
    })
  }, [])

  // --- reference data --------------------------------------------------------

  useEffect(() => {
    setTemplates(listTemplates(cmpId))
  }, [cmpId])

  // Pre-fill the default warehouse once the warehouse list is known (new documents only).
  useEffect(() => {
    if (!documentId && header.default_warehouse_id === null && defaultWarehouseId !== null) {
      setHeader((h) => ({ ...h, default_warehouse_id: defaultWarehouseId }))
    }
  }, [defaultWarehouseId, documentId, header.default_warehouse_id])

  // Editing: stored lines only know their own unit. Fetch the items once so the
  // unit dropdown, batch select and serial drawer behave as they do on a new document.
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
        /* the stored unit still works; the pickers just stay minimal */
      })
    return () => controller.abort()
  }, [initial])

  // --- party context ---------------------------------------------------------

  const partyRefNum = useMemo(() => {
    const n = toNumber(header.party_ref)
    return n !== null && n > 0 ? Math.floor(n) : null
  }, [header.party_ref])

  useEffect(() => {
    if (partyRefNum === null) {
      setParty(null)
      setPartyError(null)
      return undefined
    }
    const controller = new AbortController()
    setPartyLoading(true)
    setPartyError(null)
    partyDirectory
      .context(partyRefNum, controller.signal)
      .then((ctx) => {
        if (controller.signal.aborted) return
        setParty(ctx)
        setPartyLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setParty(null)
        setPartyError(errorMessage(err, 'Could not read this customer’s open challans.'))
        setPartyLoading(false)
      })
    return () => controller.abort()
  }, [partyRefNum, partyTick])

  // --- live availability -----------------------------------------------------

  const entries = useMemo<AvailabilityEntry[]>(() => {
    const out: AvailabilityEntry[] = []
    for (const l of lines) {
      if (!l.item_id) continue
      const qty = lineBaseQty(l)
      if (qty <= 0) continue
      const line: AvailabilityCheckLine = {
        item_id: l.item_id,
        warehouse_id: l.warehouse_id ?? header.default_warehouse_id ?? null,
        batch_id: l.batch_id,
        qty,
      }
      out.push({ key: l.key, line })
    }
    return out
  }, [lines, header.default_warehouse_id])

  const { results: availability, checking } = useAvailability(entries, true)

  // --- derived ---------------------------------------------------------------

  const activeLines = useMemo(() => lines.filter((l) => !isBlankLine(l)), [lines])
  const totalQty = useMemo(() => activeLines.reduce((sum, l) => sum + (toNumber(l.qty) ?? 0), 0), [activeLines])

  const insights = useMemo(
    () => buildInsights({ header, lines, availability, checking, batchFacts, transport, party, today: todayIso() }),
    [header, lines, availability, checking, batchFacts, transport, party],
  )
  const blockingCount = insights.filter((i) => i.blocking).length

  const verdict: StockVerdict = useMemo(() => {
    const withItems = activeLines.filter((l) => l.item_id !== null && lineBaseQty(l) > 0)
    if (withItems.length === 0) return 'unknown'
    const checked = withItems.filter((l) => availability[l.key])
    if (checked.some((l) => !availability[l.key].ok)) return 'attention'
    if (checking || checked.length < withItems.length) return 'checking'
    return 'sufficient'
  }, [activeLines, availability, checking])

  const offending = useMemo(() => new Set(negative ? offendingDraftKeys(lines, negative) : []), [negative, lines])

  const focusLines = useCallback((keys: string[]) => {
    setHighlight(new Set(keys))
    setTab('items')
    window.setTimeout(() => linesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
    window.setTimeout(() => setHighlight(new Set()), 4000)
  }, [])

  const showAttention = useCallback(() => {
    focusLines(activeLines.filter((l) => availability[l.key] && !availability[l.key].ok).map((l) => l.key))
  }, [activeLines, availability, focusLines])

  // --- adding lines ----------------------------------------------------------

  const appendEntries = useCallback(
    (list: EntryAdd[]) => {
      if (list.length === 0) return
      const created: LineDraft[] = []
      const facts: Record<string, LineBatchFact> = {}
      for (const entry of list) {
        const line = newLine(spec, {
          item_id: entry.item.item_id,
          item_name: entry.item.print_name || entry.item.item_name,
          item_sku: entry.item.item_sku,
          track_batch: Number(entry.item.track_batch) === 1,
          track_serial: Number(entry.item.track_serial) === 1,
          units: entry.units,
          unit_id: entry.unitId,
          warehouse_id: entry.warehouseId ?? header.default_warehouse_id ?? null,
          batch_id: entry.batchId,
          batch_no: entry.batchNo,
          qty: entry.qty,
        })
        created.push(line)
        if (entry.batchId !== null) {
          facts[line.key] = { batch_no: entry.batchNo, expiry_date: entry.batchExpiry, available: entry.batchAvailable }
        }
      }
      changeLines((current) => [...current.filter((l) => !isBlankLine(l)), ...created])
      if (Object.keys(facts).length) setBatchFacts((f) => ({ ...f, ...facts }))
      // One item added from the entry bar needs no toast: the row appearing in
      // the table IS the confirmation, and a clerk adding forty lines would get
      // forty of them. A bulk add lands off-screen, so that one is announced.
      if (created.length > 1) toast.success(`${created.length} items added.`)
    },
    [spec, header.default_warehouse_id, changeLines, toast],
  )

  const addBlankLine = useCallback(() => {
    changeLines((current) => [...current, newLine(spec, { warehouse_id: header.default_warehouse_id })])
  }, [changeLines, spec, header.default_warehouse_id])

  // --- default warehouse change ---------------------------------------------

  const changeDefaultWarehouse = (next: number | null) => {
    const previous = header.default_warehouse_id
    patchHeader({ default_warehouse_id: next })
    if (previous === null || previous === next) return
    const affected = lines.filter((l) => !isBlankLine(l) && l.warehouse_id === previous).length
    if (affected > 0) setWarehouseMove({ from: previous, to: next, count: affected })
  }

  const applyWarehouseMove = () => {
    if (!warehouseMove) return
    changeLines((current) => current.map((l) => (l.warehouse_id === warehouseMove.from ? { ...l, warehouse_id: warehouseMove.to, batch_id: null, batch_no: null, serials: [] } : l)))
    setBatchFacts({})
    setWarehouseMove(null)
    toast.info('Existing lines moved to the new warehouse.')
  }

  // --- templates -------------------------------------------------------------

  const applyTemplate = (template: ChallanTemplate) => {
    const created = linesFromTemplate(template, spec, header.default_warehouse_id ?? defaultWarehouseId)
    setHeader((h) => ({
      ...h,
      party_ref: h.party_ref || template.header.party_ref,
      party_name: h.party_name || template.header.party_name,
      default_warehouse_id: h.default_warehouse_id ?? template.header.default_warehouse_id,
      stock_effect: template.header.stock_effect || h.stock_effect,
      returnable: template.header.returnable,
      narration: h.narration || template.header.narration,
    }))
    setTransport(template.transport)
    setDispatch(template.dispatch)
    changeLines((current) => [...current.filter((l) => !isBlankLine(l)), ...created])
    // Refresh units and tracking flags from the live item master.
    const ids = [...new Set(created.map((l) => l.item_id).filter((id): id is number => id !== null))]
    if (ids.length) {
      lookupApi
        .itemsByIds(ids)
        .then((items) => {
          const byId = new Map(items.map((it) => [it.item_id, it]))
          setLines((ls) =>
            ls.map((l) => {
              const it = l.item_id !== null ? byId.get(l.item_id) : undefined
              if (!it || !created.some((c) => c.key === l.key)) return l
              return { ...l, track_batch: Number(it.track_batch) === 1, track_serial: Number(it.track_serial) === 1, units: unitOptionsFrom(it) }
            }),
          )
        })
        .catch(() => {
          /* the template's stored unit still posts */
        })
    }
    toast.success(`Template “${template.name}” applied.`)
  }

  const storeTemplate = (name: string) => {
    if (cmpId === null) return
    const ok = saveTemplate(templateFromDraft({ name, cmpId, header, lines, transport, dispatch }))
    setTemplates(listTemplates(cmpId))
    if (ok) toast.success('Template saved in this browser.')
    else toast.error('This browser would not store the template.')
  }

  const removeTemplate = (id: string) => {
    deleteTemplate(id)
    setTemplates(listTemplates(cmpId))
    toast.info('Template removed.')
  }

  // --- submit ----------------------------------------------------------------

  const buildPayload = () => {
    const metadata = withHeaderDetails(header.metadata, { transport, dispatch })
    return toPayload({ ...header, metadata }, lines, spec)
  }

  const clientErrors = (): string[] => {
    const errs = validateDraft(header, lines, spec)
    for (const [i, line] of activeLines.entries()) {
      if (!line.track_serial || line.item_id === null) continue
      const required = lineBaseQty(line)
      if (required > 0 && line.serials.length !== required) {
        errs.push(`Line ${i + 1}: pick ${formatQty(required)} serial number(s); ${line.serials.length} selected.`)
      }
    }
    return errs
  }

  const focusFirstInvalid = () => {
    if (!header.document_date) {
      document.getElementById('dc-document-date')?.focus()
      return
    }
    if (activeLines.length === 0) {
      itemSearchRef.current?.focus()
      return
    }
    setTab('items')
    linesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** Re-ask the server what is available right now, so a stale page cannot post blind. */
  const revalidateStock = async (): Promise<StockConflict[]> => {
    const checkable = activeLines.filter((l) => l.item_id !== null && lineBaseQty(l) > 0)
    if (checkable.length === 0) return []
    let results: AvailabilityCheckResult[]
    try {
      const res = await availabilityApi.check(
        checkable.map((l) => ({ item_id: l.item_id as number, warehouse_id: l.warehouse_id ?? header.default_warehouse_id ?? null, batch_id: l.batch_id, qty: lineBaseQty(l) })),
      )
      results = res.lines
    } catch {
      // The posting engine checks again and is the authority; a failed
      // pre-check must not become a second, softer gate that blocks a valid post.
      toast.info('Could not re-check stock before posting — the server will decide.')
      return []
    }
    const out: StockConflict[] = []
    results.forEach((r, i) => {
      const line = checkable[r.index ?? i]
      if (!line || r.ok) return
      out.push({ item: line.item_name || `Item #${line.item_id}`, requested: Number(r.requested) || lineBaseQty(line), available: Number(r.available) || 0 })
    })
    return out
  }

  const persist = async (post: boolean, andNew: boolean, skipStockCheck = false) => {
    setErrors([])
    setApiError(null)
    setWarnings([])
    if (!post) setNegative(null)

    const errs = clientErrors()
    if (errs.length) {
      setErrors(errs)
      toast.error(`Please resolve ${errs.length} validation error${errs.length === 1 ? '' : 's'} first.`)
      focusFirstInvalid()
      return
    }

    if (post && !skipStockCheck) {
      const found = await revalidateStock()
      if (found.length > 0) {
        setConflicts(found)
        return
      }
    }

    setBusy(post ? 'post' : 'save')
    let id = savedId
    try {
      const payload = buildPayload()
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
        toast.success(`Delivery challan ${doc.document_no ?? `#${doc.document_id}`} posted.`)
      } else {
        toast.success(`Draft ${doc.document_no ?? `#${doc.document_id}`} saved.`)
      }
      setDirty(false)
      if (andNew) {
        resetForNew()
        return
      }
      onSaved(doc, post)
    } catch (err) {
      const neg = parseNegativeStock(err)
      if (neg) {
        setNegative(neg)
        setApiError(id ? `Draft #${id} is saved but could not be posted: ${errorMessage(err)}` : errorMessage(err))
      } else {
        setApiError(describeError(err))
        toast.error(post ? 'Could not post the challan.' : 'Could not save the draft.')
      }
    } finally {
      setBusy(null)
    }
  }

  const resetForNew = () => {
    const fresh = newHeader(spec, todayIso())
    setHeader({ ...fresh, default_warehouse_id: header.default_warehouse_id ?? defaultWarehouseId, stock_effect: header.stock_effect || fresh.stock_effect })
    setLines([])
    setTransport(EMPTY_TRANSPORT)
    setDispatch(EMPTY_DISPATCH)
    setBatchFacts({})
    setSavedId(null)
    setErrors([])
    setApiError(null)
    setNegative(null)
    setOverride(false)
    setWarnings([])
    setConflicts(null)
    setParty(null)
    setTab('items')
    setDirty(false)
    toast.info('Ready for the next challan — company, branch, year and default warehouse kept.')
    window.setTimeout(() => customerRef.current?.focus(), 0)
  }

  // --- unsaved changes -------------------------------------------------------

  const meaningful = dirty && (activeLines.length > 0 || header.party_name.trim() !== '' || header.party_ref.trim() !== '' || header.narration.trim() !== '')
  useUnsavedChanges({
    when: meaningful && busy === null,
    onBlocked: (to, proceed) => setPendingLeave({ to, proceed }),
  })

  const cancel = () => {
    if (meaningful) {
      setPendingLeave({ to: savedId ? `/documents/${savedId}` : '/documents', proceed: () => navigate(savedId ? `/documents/${savedId}` : '/documents') })
      return
    }
    navigate(savedId ? `/documents/${savedId}` : '/documents')
  }

  // --- keyboard --------------------------------------------------------------

  const bindings = useMemo(
    () => ({
      'alt+i': (e: KeyboardEvent) => {
        e.preventDefault()
        setTab('items')
        window.setTimeout(() => itemSearchRef.current?.focus(), 0)
      },
      'alt+c': (e: KeyboardEvent) => {
        e.preventDefault()
        customerRef.current?.focus()
      },
      'alt+n': (e: KeyboardEvent) => {
        e.preventDefault()
        narrationRef.current?.focus()
      },
      'alt+b': (e: KeyboardEvent) => {
        e.preventDefault()
        setScan((s) => !s)
        window.setTimeout(() => itemSearchRef.current?.focus(), 0)
      },
      'ctrl+s': (e: KeyboardEvent) => {
        e.preventDefault()
        if (busy === null && canSave) void persist(false, false)
      },
      'ctrl+enter': (e: KeyboardEvent) => {
        e.preventDefault()
        if (busy === null && canPost) void persist(true, false)
      },
    }),
    // `persist` closes over the whole draft; rebuilding the map each render is
    // cheaper than the bug where Ctrl+S saves a draft two keystrokes old.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, canSave, canPost, header, lines, transport, dispatch, savedId, override],
  )
  useKeyboardScope('form', bindings, { allowInInput: true })

  // --- render ----------------------------------------------------------------

  const stockEffectHint = spec.stockEffects.find((s) => s.value === header.stock_effect)?.hint
  const docStatus: DocumentStatus = status ?? 'DRAFT'
  const disabled = busy !== null

  const tabs: { key: TabKey; label: string; icon: typeof FileText; badge?: number }[] = [
    { key: 'items', label: 'Item details', icon: Layers, badge: activeLines.length || undefined },
    { key: 'additional', label: 'Additional details', icon: Info, badge: filledCount(dispatch) || undefined },
    { key: 'transport', label: 'Transport & dispatch', icon: Truck, badge: filledCount(transport) || undefined },
    { key: 'references', label: 'References', icon: FileText },
    { key: 'attachments', label: 'Attachments', icon: Paperclip },
    { key: 'notes', label: 'Notes', icon: NotebookPen, badge: header.narration.trim() ? 1 : undefined },
  ]

  const stockTools: MenuAction[] = [
    {
      key: 'across',
      label: 'Stock across warehouses…',
      icon: WarehouseIcon,
      disabled: activeLines.every((l) => l.item_id === null),
      onSelect: () => {
        const line = activeLines.find((l) => l.item_id !== null)
        if (line) setStockToolsFor({ itemId: line.item_id as number, itemName: line.item_name, warehouseId: line.warehouse_id ?? header.default_warehouse_id, lineKey: line.key })
      },
    },
    {
      key: 'refresh',
      label: 'Re-check availability now',
      icon: RefreshCw,
      onSelect: () => {
        void revalidateStock().then((found) => {
          if (found.length) {
            setConflicts(found)
          } else {
            toast.success('Stock availability refreshed — every line is covered.')
          }
        })
      },
    },
    {
      key: 'balances',
      label: 'Open the stock balances register',
      icon: Layers,
      separated: true,
      onSelect: () => navigate('/registers/stock-balances'),
    },
    {
      key: 'pending',
      label: 'Open pending quantities',
      icon: FileText,
      onSelect: () => navigate(partyRefNum ? `/registers/pending-quantities?party_ref=${partyRefNum}&kind=challan&direction=out` : '/registers/pending-quantities'),
    },
  ]

  return (
    <PageShell paddingBottom>
      <BreadcrumbHeader
        breadcrumbs={[
          { label: 'Documents', to: '/documents' },
          { label: spec.label },
        ]}
        icon={Truck}
        title={editing ? `Edit ${spec.label.toLowerCase()} ${documentNo ?? `#${documentId}`}` : spec.label}
        description={spec.description}
        badge={editing ? <Badge tone={statusTone(docStatus)} size="xs">{STATUS_LABELS[docStatus] ?? docStatus}</Badge> : undefined}
        meta={editing && version ? <span className="text-xs text-gray-500">Version {version}</span> : undefined}
        escBack={false}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ChallanHeaderActions
              disabled={disabled}
              scan={scan}
              onToggleScan={() => {
                setScan((s) => !s)
                setTab('items')
                window.setTimeout(() => itemSearchRef.current?.focus(), 0)
              }}
              onImport={() => setPasteMode('csv')}
              onPaste={() => setPasteMode('paste')}
              onMultiItem={() => setMultiOpen(true)}
              onCopyPrevious={() => setCopyOpen(true)}
              onAddBlankLine={addBlankLine}
              templates={templates}
              onApplyTemplate={applyTemplate}
              onSaveTemplate={storeTemplate}
              onDeleteTemplate={removeTemplate}
              canSaveTemplate={cmpId !== null && activeLines.length > 0}
              settingsTo={canReadSettings ? '/settings/document-types' : null}
            />
            <AssistCardButton onOpen={() => setAssistOpen(true)} blockingCount={blockingCount} />
          </div>
        }
      />

      {refError ? <Notice kind="warning">{refError}</Notice> : null}

      <Card padding="sm" className="overflow-visible">
        <div className="mb-3 flex items-center gap-2 border-b border-gray-100 pb-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-light text-primary">
            <FileText className="h-3.5 w-3.5" aria-hidden />
          </span>
          <h2 className="text-sm font-semibold text-gray-900">Basic details</h2>
        </div>

        <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-12">
          <FormField label="Document date" htmlFor="dc-document-date" required className="lg:col-span-2">
            <Input
              id="dc-document-date"
              type="date"
              value={header.document_date}
              disabled={disabled}
              invalid={!/^\d{4}-\d{2}-\d{2}$/.test(header.document_date)}
              leadingIcon={CalendarDays}
              onChange={(e) => patchHeader({ document_date: e.target.value })}
            />
          </FormField>

          <FormField label="Document no." htmlFor="dc-document-no" hint="Leave empty to number automatically." className="lg:col-span-2">
            <div className="flex items-center gap-1">
              <Input id="dc-document-no" className="flex-1" value={header.document_no} disabled={disabled} placeholder="Auto-generate" onChange={(e) => patchHeader({ document_no: e.target.value })} />
              {canReadSettings ? (
                <Link
                  to="/settings/document-types"
                  title="Document numbering settings"
                  aria-label="Document numbering settings"
                  className="aic inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 no-underline transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <Settings2 className="h-3.5 w-3.5" aria-hidden />
                </Link>
              ) : null}
            </div>
          </FormField>

          <FormField label="Customer" required className="lg:col-span-4">
            <CustomerField
              partyRef={header.party_ref}
              partyName={header.party_name}
              disabled={disabled}
              inputRef={customerRef}
              documentType={spec.code}
              invalid={errors.length > 0 && !header.party_name.trim() && !header.party_ref.trim()}
              onChange={(patch) => patchHeader(patch)}
            />
            <CustomerContextCard
              partyName={header.party_name}
              partyRef={header.party_ref}
              context={party}
              loading={partyLoading}
              error={partyError}
              onRetry={() => setPartyTick((t) => t + 1)}
            />
          </FormField>

          <FormField label="Customer ledger id" htmlFor="dc-party-ref" hint="Books account id. Pending quantities are matched on it." className="lg:col-span-2">
            <Input
              id="dc-party-ref"
              inputMode="numeric"
              value={header.party_ref}
              disabled={disabled}
              placeholder="e.g. 1042"
              leadingIcon={Search}
              onChange={(e) => patchHeader({ party_ref: e.target.value.replace(/[^\d]/g, '') })}
            />
          </FormField>

          <FormField label="Default warehouse" htmlFor="dc-default-wh" hint="Pre-fills the warehouse on new lines." className="lg:col-span-2">
            <ChallanWarehouseSelect id="dc-default-wh" value={header.default_warehouse_id} warehouses={warehouses} disabled={disabled || refLoading} emptyLabel="None" onChange={changeDefaultWarehouse} />
          </FormField>

          {spec.stockEffects.length > 0 ? (
            <FormField label="Stock effect" htmlFor="dc-stock-effect" hint={stockEffectHint} className="sm:col-span-2 lg:col-span-4">
              <Select
                id="dc-stock-effect"
                value={header.stock_effect}
                disabled={disabled}
                onChange={(e) => patchHeader({ stock_effect: e.target.value, metadata: { ...header.metadata, linked_source_document_id: undefined } })}
              >
                {spec.stockEffects.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}

          {spec.returnable ? (
            <FormField label="Returnable" className="sm:col-span-2 lg:col-span-4">
              <div className="flex h-8 items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={header.returnable}
                  aria-label="Goods are expected back"
                  disabled={disabled}
                  onClick={() => patchHeader({ returnable: !header.returnable, expected_return_date: header.returnable ? '' : header.expected_return_date })}
                  className={cx(
                    'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60',
                    header.returnable ? 'bg-primary' : 'bg-gray-300',
                  )}
                >
                  <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform', header.returnable ? 'translate-x-4' : 'translate-x-0.5')} />
                </button>
                <span className="text-sm text-gray-700">Goods are expected back</span>
                {header.returnable ? (
                  <Input
                    type="date"
                    className="ml-auto w-40"
                    value={header.expected_return_date}
                    disabled={disabled}
                    aria-label="Expected return date"
                    onChange={(e) => patchHeader({ expected_return_date: e.target.value })}
                  />
                ) : null}
              </div>
            </FormField>
          ) : null}
        </div>

        {/* Tabs */}
        <div className="mt-4 flex flex-wrap items-center gap-1 border-b border-gray-200" role="tablist" aria-label="Document sections">
          {tabs.map((t) => {
            const selected = tab === t.key
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`dc-tab-${t.key}`}
                aria-selected={selected}
                aria-controls={`dc-panel-${t.key}`}
                onClick={() => setTab(t.key)}
                className={cx(
                  'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2 text-xs transition-colors',
                  selected ? 'border-primary font-semibold text-primary' : 'border-transparent text-gray-500 hover:text-gray-800',
                )}
              >
                <t.icon className="h-3.5 w-3.5" aria-hidden />
                {t.label}
                {t.badge ? (
                  <span className={cx('rounded-full px-1.5 py-px text-[10px] tabular-nums', selected ? 'bg-primary-light text-primary' : 'bg-gray-100 text-gray-500')}>{t.badge}</span>
                ) : null}
              </button>
            )
          })}
          <div className="ml-auto pb-1.5">
            <MenuButton label="Stock tools" variant="secondary" size="xs" icon={Layers} actions={stockTools} width={272}>
              Stock tools
            </MenuButton>
          </div>
        </div>

        <div className="pt-3">
          {tab === 'items' ? (
            <div id="dc-panel-items" role="tabpanel" aria-labelledby="dc-tab-items" className="space-y-2.5">
              <ItemEntryBar
                warehouses={warehouses}
                defaultWarehouseId={header.default_warehouse_id ?? defaultWarehouseId}
                disabled={disabled}
                scan={scan}
                onScanChange={setScan}
                onAdd={(entry) => appendEntries([entry])}
                onScanMiss={(code) => toast.error(`No item matches “${code}”.`)}
                searchRef={itemSearchRef}
                onOpenMultiItem={() => setMultiOpen(true)}
                onOpenPaste={() => setPasteMode('paste')}
                onOpenImport={() => setPasteMode('csv')}
              />
              <div ref={linesRef}>
                <ChallanLines
                  lines={lines}
                  onChange={(next) => changeLines(next)}
                  warehouses={warehouses}
                  warehouseName={warehouseName}
                  defaultWarehouseId={header.default_warehouse_id}
                  availability={availability}
                  checking={checking}
                  highlightKeys={highlight}
                  offendingKeys={offending}
                  onBatchFact={setBatchFact}
                  onOpenStockTools={(line) =>
                    setStockToolsFor({ itemId: line.item_id as number, itemName: line.item_name, warehouseId: line.warehouse_id ?? header.default_warehouse_id, lineKey: line.key })
                  }
                  onAddBlankLine={addBlankLine}
                  disabled={disabled}
                />
              </div>
            </div>
          ) : null}

          {tab === 'additional' ? (
            <div id="dc-panel-additional" role="tabpanel" aria-labelledby="dc-tab-additional">
              <AdditionalDetailsPanel
                dispatch={dispatch}
                disabled={disabled}
                returnable={header.returnable}
                expectedReturnDate={header.expected_return_date}
                onExpectedReturnDate={(value) => patchHeader({ expected_return_date: value })}
                onChange={(patch) => {
                  setDispatch((d) => ({ ...d, ...patch }))
                  markDirty()
                }}
              />
            </div>
          ) : null}

          {tab === 'transport' ? (
            <div id="dc-panel-transport" role="tabpanel" aria-labelledby="dc-tab-transport">
              <TransportPanel
                transport={transport}
                disabled={disabled}
                onChange={(patch) => {
                  setTransport((t) => ({ ...t, ...patch }))
                  markDirty()
                }}
              />
            </div>
          ) : null}

          {tab === 'references' ? (
            <div id="dc-panel-references" role="tabpanel" aria-labelledby="dc-tab-references">
              <ReferencesPanel partyRef={partyRefNum} partyName={header.party_name} documentId={savedId} />
            </div>
          ) : null}

          {tab === 'attachments' ? (
            <div id="dc-panel-attachments" role="tabpanel" aria-labelledby="dc-tab-attachments">
              <AttachmentsPanel />
            </div>
          ) : null}

          {tab === 'notes' ? (
            <div id="dc-panel-notes" role="tabpanel" aria-labelledby="dc-tab-notes">
              <NotesPanel narration={header.narration} softLimit={NARRATION_SOFT_LIMIT} disabled={disabled} onChange={(value) => patchHeader({ narration: value })} />
            </div>
          ) : null}
        </div>
      </Card>

      {errors.length > 0 ? (
        <Notice kind="error" title="Please fix before saving">
          <ul className="ml-4 list-disc space-y-0.5">
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
          <ul className="ml-4 list-disc space-y-0.5">
            {negative.map((d, i) => (
              <li key={`${d.item_id}-${d.warehouse_id}-${i}`}>
                {d.item_name ?? `Item #${d.item_id}`}
                {d.warehouse_id ? ` · ${warehouseName(d.warehouse_id) || `warehouse #${d.warehouse_id}`}` : ''}: on hand {formatQty(d.on_hand)}, required {formatQty(d.required)}, short by{' '}
                <strong>{formatQty(d.short_by)}</strong>
              </li>
            ))}
          </ul>
          {canOverride ? (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="h-3.5 w-3.5 accent-[rgb(var(--color-primary))]" />
              Post anyway and let stock go negative (override)
            </label>
          ) : (
            <div className="mt-1 text-xs">Reduce the quantities or receive stock first. Posting into negative stock needs the “override negative-stock block” permission.</div>
          )}
        </Notice>
      ) : null}
      {warnings.length > 0 ? (
        <Notice kind="warning" title="Posted with warnings">
          <ul className="ml-4 list-disc space-y-0.5">
            {warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {/* Insights · narration · summary */}
      {/* Three-up once there is room for it; on a tablet the checks and the summary
          pair off and the narration takes the full width under them. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-12">
        <div className="md:order-1 md:col-span-1 xl:order-none xl:col-span-3">
          <SmartInsights insights={insights} checking={checking} onFocusLines={focusLines} />
        </div>
        <div className="md:order-3 md:col-span-2 xl:order-none xl:col-span-6">
          <Card padding="sm" className="h-full">
            <label htmlFor="dc-narration" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Narration
            </label>
            <Textarea
              id="dc-narration"
              ref={narrationRef}
              rows={4}
              value={header.narration}
              disabled={disabled}
              placeholder="Add any additional notes for this dispatch…"
              onChange={(e) => patchHeader({ narration: e.target.value })}
            />
            <div className={cx('mt-1 text-right text-[10px] tabular-nums', header.narration.length > NARRATION_SOFT_LIMIT ? 'text-amber-600' : 'text-gray-400')}>
              {header.narration.length}/{NARRATION_SOFT_LIMIT}
              <span className="ml-1 text-gray-400">· no hard limit; {NARRATION_SOFT_LIMIT} fits the printed challan</span>
            </div>
          </Card>
        </div>
        <div className="md:order-2 md:col-span-1 xl:order-none xl:col-span-3">
          <QuickSummary
            totalItems={activeLines.length}
            totalQty={totalQty}
            verdict={verdict}
            status={STATUS_LABELS[docStatus] ?? docStatus}
            statusTone={statusTone(docStatus)}
            onShowAttention={showAttention}
          />
        </div>
      </div>

      <StickyActionBar
        totals={
          <>
            <span className="text-xs text-gray-500">
              {activeLines.length} line{activeLines.length === 1 ? '' : 's'} · {formatQty(totalQty, '0')} units
              {savedId ? ` · draft #${savedId}` : ''}
            </span>
            {blockingCount > 0 ? (
              <Badge tone="warning" size="xs">
                {blockingCount} to fix
              </Badge>
            ) : null}
          </>
        }
      >
        <Button variant="secondary" onClick={cancel} disabled={disabled}>
          Cancel
        </Button>
        <Button variant="outline" icon={Save} loading={busy === 'save'} disabled={disabled || !canSave} onClick={() => void persist(false, false)} title="Ctrl+S">
          {savedId ? 'Save changes' : 'Save as draft'}
        </Button>
        {canPost ? (
          <Button variant="primary" icon={Send} loading={busy === 'post'} disabled={disabled || (!canSave && !savedId)} onClick={() => void persist(true, false)} title="Ctrl+Enter">
            {negative && override ? 'Post with override' : 'Save & post'}
          </Button>
        ) : null}
        <MenuButton
          label="Save and create another"
          variant="outline"
          size="sm"
          icon={Plus}
          width={264}
          buttonProps={{ disabled: disabled || !canSave }}
          actions={[
            { key: 'draft-new', label: 'Save draft & start a new challan', icon: Save, onSelect: () => void persist(false, true) },
            ...(canPost ? [{ key: 'post-new', label: 'Save, post & start a new challan', icon: Send, onSelect: () => void persist(true, true) }] : []),
          ]}
        >
          Save &amp; create new
        </MenuButton>
      </StickyActionBar>

      {/* Drawers and dialogs */}
      <SmartAssistDrawer
        open={assistOpen}
        onClose={() => setAssistOpen(false)}
        insights={insights}
        checking={checking}
        onFocusLines={focusLines}
        actions={[
          { key: 'search', label: 'Search an item', description: 'Alt + I puts the cursor in the item box', icon: Search, onRun: () => itemSearchRef.current?.focus() },
          { key: 'scan', label: scan ? 'Turn scanner mode off' : 'Turn scanner mode on', description: 'Enter adds the scanned code', icon: ScanBarcode, onRun: () => setScan((s) => !s) },
          { key: 'multi', label: 'Add multiple items', description: 'Build a basket and add it in one pass', icon: ListPlus, onRun: () => setMultiOpen(true) },
          { key: 'paste', label: 'Paste a SKU list', description: 'SKU and quantity, one per line', icon: ClipboardPaste, onRun: () => setPasteMode('paste') },
          { key: 'copy', label: 'Copy an earlier challan', description: 'Repeat a dispatch for this customer', icon: CopyPlus, onRun: () => setCopyOpen(true) },
          {
            key: 'recheck',
            label: 'Re-check stock',
            description: 'Ask the server what is available right now',
            icon: RefreshCw,
            onRun: () => {
              void revalidateStock().then((found) => (found.length ? setConflicts(found) : toast.success('Every line is covered by available stock.')))
            },
          },
        ]}
      />

      <MultiItemDrawer
        open={multiOpen}
        onClose={() => setMultiOpen(false)}
        warehouses={warehouses}
        defaultWarehouseId={header.default_warehouse_id ?? defaultWarehouseId}
        onAdd={appendEntries}
      />

      {pasteMode ? (
        <PasteImportDialog
          open
          mode={pasteMode}
          onClose={() => setPasteMode(null)}
          warehouses={warehouses}
          defaultWarehouseId={header.default_warehouse_id ?? defaultWarehouseId}
          onAdd={appendEntries}
        />
      ) : null}

      <CopyFromChallanDrawer
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        spec={spec}
        partyRef={partyRefNum}
        partyName={header.party_name}
        defaultWarehouseId={header.default_warehouse_id ?? defaultWarehouseId}
        onCopy={(copied, source) => {
          changeLines((current) => [...current.filter((l) => !isBlankLine(l)), ...copied])
          toast.success(`${copied.length} line${copied.length === 1 ? '' : 's'} copied from ${source.document_no ?? `#${source.document_id}`}.`)
        }}
      />

      {stockToolsFor ? (
        <StockAcrossWarehousesDrawer
          open
          onClose={() => setStockToolsFor(null)}
          itemId={stockToolsFor.itemId}
          itemName={stockToolsFor.itemName}
          currentWarehouseId={stockToolsFor.warehouseId}
          warehouseName={warehouseName}
          onUseWarehouse={
            stockToolsFor.lineKey
              ? (warehouseIdNext) => {
                  const key = stockToolsFor.lineKey as string
                  setBatchFact(key, null)
                  changeLines((current) => current.map((l) => (l.key === key ? { ...l, warehouse_id: warehouseIdNext, batch_id: null, batch_no: null, serials: [] } : l)))
                  toast.info(`Line moved to ${warehouseName(warehouseIdNext)}.`)
                }
              : null
          }
        />
      ) : null}

      <ConfirmDialog
        open={pendingLeave !== null}
        title="Leave without saving?"
        message="This challan has changes that have not been saved. Leaving now discards them."
        confirmLabel="Discard and leave"
        danger
        onCancel={() => setPendingLeave(null)}
        onConfirm={() => {
          const go = pendingLeave?.proceed
          setDirty(false)
          setPendingLeave(null)
          window.setTimeout(() => go?.(), 0)
        }}
      />

      <ConfirmDialog
        open={warehouseMove !== null}
        title="Move the existing lines too?"
        message={
          warehouseMove
            ? `${warehouseMove.count} line${warehouseMove.count === 1 ? '' : 's'} still dispatch from ${warehouseName(warehouseMove.from)}. Move ${warehouseMove.count === 1 ? 'it' : 'them'} to ${warehouseMove.to ? warehouseName(warehouseMove.to) : 'no warehouse'} as well? Batch and serial selections on those lines are cleared.`
            : ''
        }
        confirmLabel="Move them"
        onCancel={() => setWarehouseMove(null)}
        onConfirm={applyWarehouseMove}
      />

      <ConfirmDialog
        open={conflicts !== null}
        title="Stock changed since this challan was prepared"
        message={
          <div className="space-y-2">
            <p>The warehouse no longer holds enough for every line:</p>
            <ul className="ml-4 list-disc space-y-0.5">
              {(conflicts ?? []).map((c, i) => (
                <li key={`${c.item}-${i}`}>
                  <strong>{c.item}</strong> — requested {formatQty(c.requested)}, currently available {formatQty(c.available)}
                </li>
              ))}
            </ul>
            <p className="text-xs text-gray-500">
              Adjust the quantity or pick another warehouse. Continuing sends the challan to the server, which applies this company’s negative-stock policy and has the final say.
            </p>
          </div>
        }
        confirmLabel="Continue anyway"
        danger
        onCancel={() => {
          setConflicts(null)
          showAttention()
        }}
        onConfirm={() => {
          setConflicts(null)
          void persist(true, false, true)
        }}
      />
    </PageShell>
  )
}
