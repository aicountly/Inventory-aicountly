import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronDown, History, RotateCcw, Save, X } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { useQuery } from '../../hooks/useQuery'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { errorMessage, isApiError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { settingsApi } from '../../services/settingsApi'
import type { AvailabilityCheckLine } from '../../services/stockApi'
import { Button } from '../../ui/Button'
import { MenuButton } from '../../ui/MenuButton'
import { PageShell } from '../../ui/shell/PageShell'
import { StickyActionBar, ActionBarTotal } from '../../ui/shell/StickyActionBar'
import { notify } from '../../ui/notify'
import { AIC, cx } from '../../ui/cx'
import { currencySymbol, formatQty, todayIso, toNumber } from '../../utils/format'
import { canCreate, permissionKeysFor } from '../actions'
import { isBlankLine, lineBaseQty, newHeader, newLine, toPayload } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { offendingDraftKeys, parseNegativeStock } from '../negativeStock'
import type { DocumentTypeSpec } from '../registry'
import type { InventoryDocument } from '../types'
import { useAvailability } from '../useAvailability'
import type { AvailabilityEntry } from '../useAvailability'
import { useReferenceData } from '../useReferenceData'
import { BarcodeScanDialog } from './BarcodeScanDialog'
import { ExcelPasteModal } from './ExcelPasteModal'
import { MultiItemPicker } from './MultiItemPicker'
import { PostConfirmDialog } from './PostConfirmDialog'
import { ShortcutsDialog } from './ShortcutsDialog'
import { StockJournalAssistant } from './StockJournalAssistant'
import { StockJournalDetailsCard } from './StockJournalDetailsCard'
import type { EntryMode } from './StockJournalDetailsCard'
import { StockJournalDocumentSummary } from './StockJournalDocumentSummary'
import { StockJournalHeaderBar } from './StockJournalHeaderBar'
import type { JournalTab } from './StockJournalHeaderBar'
import { StockJournalHistory } from './StockJournalHistory'
import { StockJournalLinesCard } from './StockJournalLinesCard'
import { StockJournalPreview } from './StockJournalPreview'
import { StockJournalQuickActions } from './StockJournalQuickActions'
import { StockJournalTemplates } from './StockJournalTemplates'
import { suggest } from './assistant'
import type { AssistResponse } from './assistant'
import { clearDraft, isWorthKeeping, readDraft, saveDraft } from './draftStorage'
import type { ResolvedRow } from './excelPaste'
import {
  DEFAULT_COLUMNS,
  buildWarnings,
  documentWarnings,
  journalTotals,
  reasonLabel,
  rowNeedsDeleteConfirm,
  validateJournal,
} from './model'
import type { ColumnVisibility, JournalError, JournalWarning } from './model'
import { deleteTemplate, listTemplates, saveTemplate, templateFromDraft } from './templates'
import type { JournalTemplate } from './templates'

export interface StockJournalPageProps {
  spec: DocumentTypeSpec
  /** Set when editing a saved draft. */
  documentId?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  existing?: InventoryDocument | null
  onSaved: (doc: InventoryDocument, posted: boolean) => void
}

type PostIntent = 'post' | 'post_new' | 'post_close'

/**
 * Create or edit a stock journal.
 *
 * The document itself is an ordinary `by_line` inventory document: this screen
 * builds the same draft the generic `DocumentForm` builds and sends it through
 * the same `documentsApi.create` / `.update` / `.post`, so nothing about the
 * posting engine, the valuation, the idempotency keys or the audit trail changes
 * because the entry screen did. What is different is the entry experience —
 * availability while you type, batch and serial intelligence, bulk entry, and
 * every message anchored to the row that caused it.
 */
export function StockJournalPage({ spec, documentId, initial, existing, onSaved }: StockJournalPageProps) {
  const navigate = useNavigate()
  const { can } = useAccess()
  const { scope, fyRange } = useCompany()
  const { warehouses, defaultWarehouseId, loading: refLoading, error: refError } = useReferenceData()

  /* ---------------------------------------------------------------- state */

  const [header, setHeader] = useState<HeaderDraft>(() => initial?.header ?? newHeader(spec, todayIso()))
  const [lines, setLines] = useState<LineDraft[]>(() => initial?.lines ?? [newLine(spec, { direction: 'out' }), newLine(spec, { direction: 'in' })])
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [savedDoc, setSavedDoc] = useState<InventoryDocument | null>(existing ?? null)
  const [tab, setTab] = useState<JournalTab>('create')
  const [mode, setMode] = useState<EntryMode>('manual')
  const [columns, setColumns] = useState<ColumnVisibility>(DEFAULT_COLUMNS)
  const [busy, setBusy] = useState<'save' | 'post' | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [override, setOverride] = useState(false)
  const [negativeKeys, setNegativeKeys] = useState<ReadonlySet<string>>(new Set())
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  // Warehouses the user changed by hand; a default-warehouse change must not
  // silently undo them.
  const touchedWarehouses = useRef<Set<string>>(new Set())

  const [excelOpen, setExcelOpen] = useState(false)
  const [multiOpen, setMultiOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [postOpen, setPostOpen] = useState(false)
  const [postIntent, setPostIntent] = useState<PostIntent>('post')
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [leaveTo, setLeaveTo] = useState<{ to: string; proceed: () => void } | null>(null)
  const [recovered, setRecovered] = useState<{ header: HeaderDraft; lines: LineDraft[] } | null>(null)
  const [templates, setTemplates] = useState<JournalTemplate[]>([])

  const dateRef = useRef<HTMLInputElement>(null)

  /* ------------------------------------------------------- permissions */

  const canPost = can(permissionKeysFor('post', spec.code))
  const canSave = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)
  const canOverride = can('stock.negative_override')
  const canSeeCost = can(['documents.stock_journal.view_cost', 'documents.read'])

  /* --------------------------------------------------- company settings */

  const settings = useQuery((signal) => settingsApi.get(signal), [scope?.cmp_id], { enabled: !!scope, keepData: false })
  const locks = useQuery((signal) => settingsApi.periodLocks(signal), [scope?.cmp_id, scope?.bo_id], { enabled: !!scope, keepData: false })

  const currency = currencySymbol(settings.data?.base_currency_code)
  const negativeStockPolicy = settings.data?.negative_stock_policy ?? 'warn'
  const lockedUpto = useMemo(() => {
    const rows = (locks.data ?? []).filter((l) => !l.released_at && (l.bo_id === 0 || l.bo_id === (scope?.bo_id ?? 0)))
    return rows.reduce<string | null>((max, l) => (!max || l.locked_upto_date > max ? l.locked_upto_date : max), null)
  }, [locks.data, scope?.bo_id])

  /* ------------------------------------------------------------ helpers */

  const patchHeader = useCallback((patch: Partial<HeaderDraft>) => {
    setHeader((h) => ({ ...h, ...patch }))
    setDirty(true)
  }, [])

  const patchLine = useCallback((key: string, patch: Partial<LineDraft>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    setDirty(true)
  }, [])

  /* Pre-fill the default warehouse once the masters land (new documents only). */
  useEffect(() => {
    if (documentId || header.default_warehouse_id !== null || defaultWarehouseId === null) return
    setHeader((h) => ({ ...h, default_warehouse_id: defaultWarehouseId }))
    setLines((ls) => ls.map((l) => (l.warehouse_id === null && !touchedWarehouses.current.has(l.key) ? { ...l, warehouse_id: defaultWarehouseId } : l)))
  }, [defaultWarehouseId, documentId, header.default_warehouse_id])

  /* A changed default warehouse reaches untouched rows only. */
  const changeDefaultWarehouse = useCallback((id: number | null) => {
    patchHeader({ default_warehouse_id: id })
    setLines((ls) =>
      ls.map((l) =>
        touchedWarehouses.current.has(l.key)
          ? l
          : { ...l, warehouse_id: id, batch_id: null, batch_no: null, expiry_date: null, serials: [] },
      ),
    )
  }, [patchHeader])

  const changeLineWarehouse = useCallback(
    (key: string, id: number | null) => {
      touchedWarehouses.current.add(key)
      // Batch and serial selections belong to a warehouse; they cannot survive it.
      patchLine(key, { warehouse_id: id, batch_id: null, batch_no: null, expiry_date: null, serials: [] })
    },
    [patchLine],
  )

  const unitsFrom = (row: ItemSearchRow) => {
    const rows = row.units ?? []
    const out = rows.map((u) => ({
      unit_id: u.unit_id,
      unit_symbol: u.unit_symbol,
      unit_name: u.unit_name,
      conversion_factor: Number(u.conversion_factor) || 1,
      is_default: Number(u.is_default) === 1,
    }))
    if (out.length === 0 && row.unit_id) out.push({ unit_id: row.unit_id, unit_symbol: row.unit_symbol ?? null, unit_name: null, conversion_factor: 1, is_default: true })
    return out
  }

  const applyItem = useCallback(
    (key: string, row: ItemSearchRow) => {
      const units = unitsFrom(row)
      const def = units.find((u) => u.is_default) ?? units[0]
      setLines((ls) =>
        ls.map((l) =>
          l.key === key
            ? {
                ...l,
                item_id: row.item_id,
                item_name: row.print_name || row.item_name,
                item_sku: row.item_sku,
                track_batch: Number(row.track_batch) === 1,
                track_serial: Number(row.track_serial) === 1,
                units,
                unit_id: def?.unit_id ?? row.unit_id ?? null,
                warehouse_id: l.warehouse_id ?? row.default_warehouse_id ?? header.default_warehouse_id ?? null,
                // A new item invalidates everything that was chosen for the old one.
                batch_id: null,
                batch_no: null,
                expiry_date: null,
                serials: [],
              }
            : l,
        ),
      )
      setDirty(true)
    },
    [header.default_warehouse_id],
  )

  const clearItem = useCallback((key: string) => {
    patchLine(key, {
      item_id: null,
      item_name: '',
      item_sku: null,
      track_batch: false,
      track_serial: false,
      units: [],
      unit_id: null,
      batch_id: null,
      batch_no: null,
      expiry_date: null,
      serials: [],
    })
  }, [patchLine])

  const addLine = useCallback(
    (partial: Partial<LineDraft> = {}) => {
      const line = newLine(spec, { warehouse_id: header.default_warehouse_id, direction: 'out', ...partial })
      setLines((ls) => [...ls, line])
      setFocusKey(line.key)
      setDirty(true)
      return line
    },
    [spec, header.default_warehouse_id],
  )

  const removeLine = useCallback(
    (key: string) => {
      setLines((ls) => ls.filter((l) => l.key !== key))
      touchedWarehouses.current.delete(key)
      setDirty(true)
    },
    [],
  )

  const requestRemove = useCallback(
    (key: string) => {
      const line = lines.find((l) => l.key === key)
      if (line && rowNeedsDeleteConfirm(line)) setPendingDelete(key)
      else removeLine(key)
    },
    [lines, removeLine],
  )

  /* ------------------------------------------------------- availability */

  const entries = useMemo<AvailabilityEntry[]>(() => {
    const out: AvailabilityEntry[] = []
    for (const l of lines) {
      if (!l.item_id || l.direction !== 'out') continue
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

  /* --------------------------------------------------- derived document */

  const totals = useMemo(() => journalTotals(lines), [lines])

  const errors = useMemo<JournalError[]>(
    () => validateJournal(header, lines, { posting: true, fyRange, lockedUpto }),
    [header, lines, fyRange, lockedUpto],
  )
  const visibleErrors = showErrors ? errors : []

  const warnings = useMemo<JournalWarning[]>(
    () =>
      buildWarnings({
        header,
        lines,
        availability,
        knownWarehouseIds: warehouses.map((w) => w.warehouse_id),
        negativeStockPolicy,
        fyRange,
        lockedUpto,
        today: todayIso(),
      }),
    [header, lines, availability, warehouses, negativeStockPolicy, fyRange, lockedUpto],
  )
  /**
   * A negative-stock rejection from the server names the lines it refused. Those
   * rows are marked blocking alongside the client-side warnings, so the rejection
   * lands on the rows rather than only in the banner above the grid.
   */
  const warningsWithRejections = useMemo<JournalWarning[]>(() => {
    if (negativeKeys.size === 0) return warnings
    const already = new Set(warnings.filter((w) => w.code === 'insufficient_stock').map((w) => w.lineKey))
    const extra: JournalWarning[] = [...negativeKeys]
      .filter((key) => !already.has(key))
      .map((key) => ({
        level: 'blocking' as const,
        code: 'insufficient_stock',
        lineKey: key,
        message: 'The server refused this line for insufficient stock.',
      }))
    return [...warnings, ...extra]
  }, [warnings, negativeKeys])

  const docWarnings = useMemo(() => documentWarnings(warningsWithRejections), [warningsWithRejections])

  /* ------------------------------------------------------ local recovery */

  const draftScope = useMemo(
    () => ({ cmpId: scope?.cmp_id ?? null, boId: scope?.bo_id ?? 0, fyId: scope?.fy_id ?? null, documentId: documentId ?? null }),
    [scope, documentId],
  )

  // Offer an unsaved draft back once, on first mount, for a NEW document only.
  const offered = useRef(false)
  useEffect(() => {
    if (offered.current || documentId || !scope) return
    offered.current = true
    const stored = readDraft(draftScope)
    if (stored && isWorthKeeping(stored.header, stored.lines)) setRecovered({ header: stored.header, lines: stored.lines })
  }, [draftScope, documentId, scope])

  // Keep the local copy current while there are edits worth keeping.
  useEffect(() => {
    if (!dirty || !scope) return undefined
    const t = window.setTimeout(() => {
      if (isWorthKeeping(header, lines)) saveDraft(draftScope, header, lines)
    }, 800)
    return () => window.clearTimeout(t)
  }, [header, lines, dirty, draftScope, scope])

  useEffect(() => {
    setTemplates(listTemplates(scope?.cmp_id ?? null))
  }, [scope?.cmp_id])

  /* ---------------------------------------------------------- submitting */

  const submit = async (post: boolean, intent: PostIntent = 'post') => {
    setApiError(null)
    setShowErrors(true)
    const blocking = validateJournal(header, lines, { posting: post, fyRange, lockedUpto })
    if (blocking.length > 0) {
      setPostOpen(false)
      notify.error(blocking[0].message)
      return
    }

    setBusy(post ? 'post' : 'save')
    let id = savedId
    try {
      const payload = toPayload(header, lines, spec)
      let doc: InventoryDocument
      if (id) {
        doc = await documentsApi.update(id, payload)
      } else {
        doc = await documentsApi.create(payload)
        id = doc.document_id
        setSavedId(id)
      }
      setSavedDoc(doc)

      if (!post) {
        clearDraft(draftScope)
        setDirty(false)
        setNegativeKeys(new Set())
        notify.success(`Draft ${doc.document_no ?? `#${doc.document_id}`} saved.`)
        onSaved(doc, false)
        return
      }

      doc = await documentsApi.post(doc.document_id, { negativeOverride: override && canOverride })
      clearDraft(draftScope)
      setDirty(false)
      setPostOpen(false)
      setSavedDoc(doc)
      notify.success(`Stock Journal ${doc.document_no ?? `#${doc.document_id}`} posted successfully.`)
      for (const w of doc.warnings ?? []) notify.info(w.message)

      if (intent === 'post_new') {
        // A fresh document, same context: the operator is entering a run of them.
        setHeader(newHeader(spec, header.document_date))
        setLines([newLine(spec, { warehouse_id: defaultWarehouseId, direction: 'out' })])
        setSavedId(null)
        setSavedDoc(null)
        setShowErrors(false)
        setOverride(false)
        touchedWarehouses.current.clear()
        setHeader((h) => ({ ...h, default_warehouse_id: defaultWarehouseId }))
        return
      }
      if (intent === 'post_close') {
        navigate('/documents')
        return
      }
      onSaved(doc, true)
    } catch (err) {
      const negative = parseNegativeStock(err)
      if (negative) {
        setNegativeKeys(new Set(offendingDraftKeys(lines, negative)))
        setApiError(
          id
            ? `Draft #${id} is saved but could not be posted: ${errorMessage(err)}`
            : errorMessage(err),
        )
        setPostOpen(false)
        notify.error('Posting was blocked by insufficient stock.')
      } else if (isApiError(err) && err.status === 409) {
        setApiError(`${err.message} Reload the document before saving again — someone else changed it.`)
        notify.error('This document changed elsewhere.')
      } else {
        const field = isApiError(err) ? err.field : null
        setApiError(field ? `${errorMessage(err)} (${field})` : errorMessage(err))
        notify.error(errorMessage(err, 'Could not save the stock journal.'))
      }
    } finally {
      setBusy(null)
    }
  }

  /* --------------------------------------------------------- shortcuts */

  const openPost = useCallback(() => {
    if (!canPost || busy) return
    setShowErrors(true)
    setPostOpen(true)
  }, [canPost, busy])

  useKeyboardScope(
    'form',
    useMemo(
      () => ({
        'alt+n': (e: KeyboardEvent) => {
          e.preventDefault()
          if (tab === 'create' && !busy) addLine()
        },
        'ctrl+s': (e: KeyboardEvent) => {
          e.preventDefault()
          if (!busy && canSave) void submit(false)
        },
        'ctrl+enter': (e: KeyboardEvent) => {
          // Inside the assistant prompt the same combo drafts lines. This
          // listener runs first (window, capture phase), so it is the one that
          // has to yield.
          const target = e.target
          if (target instanceof Element && target.closest('[data-sj-assistant]')) return
          e.preventDefault()
          openPost()
        },
      }),
      // `submit` closes over the whole draft; re-binding on every keystroke is
      // cheaper than the stale closure that not doing so would produce.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [tab, busy, canSave, addLine, openPost, header, lines, override],
    ),
    { allowInInput: true },
  )

  /* ------------------------------------------------- navigation guard */

  useUnsavedChanges({
    when: dirty && !busy,
    onBlocked: (to, proceed) => setLeaveTo({ to, proceed }),
  })

  /* ------------------------------------------------------- assistant */

  const runAssistant = useCallback(
    (prompt: string, signal: AbortSignal): Promise<AssistResponse> =>
      suggest(
        prompt,
        {
          warehouses,
          defaultWarehouseId: header.default_warehouse_id,
          findItem: async (text, s) => {
            const found = await lookupApi.searchItems(text, { limit: 5, signal: s })
            if (found.length === 0) return null
            const exact = found.find((r) => r.item_name.toLowerCase() === text.toLowerCase())
            return exact ?? found[0]
          },
        },
        { prompt, default_warehouse_id: header.default_warehouse_id, document_date: header.document_date },
        signal,
      ),
    [warehouses, header.default_warehouse_id, header.document_date],
  )

  const applySuggestions = useCallback(
    async (response: AssistResponse) => {
      if (response.suggestions.length === 0) return
      const ids = [...new Set(response.suggestions.map((s) => s.item_id).filter((id): id is number => id !== null))]
      let byId = new Map<number, ItemSearchRow>()
      try {
        byId = new Map((await lookupApi.itemsByIds(ids)).map((r) => [r.item_id, r]))
      } catch {
        // Without the lookup the rows still insert; the unit dropdown and the
        // tracking flags simply stay empty until the user reopens the item.
      }
      const generated = response.suggestions.map((s) => {
        const row = s.item_id !== null ? byId.get(s.item_id) : undefined
        const units = row ? unitsFrom(row) : []
        const def = units.find((u) => u.is_default) ?? units[0]
        return newLine(spec, {
          item_id: s.item_id,
          item_name: row?.print_name || row?.item_name || s.item_hint || '',
          item_sku: row?.item_sku ?? null,
          track_batch: row ? Number(row.track_batch) === 1 : false,
          track_serial: row ? Number(row.track_serial) === 1 : false,
          units,
          unit_id: def?.unit_id ?? null,
          warehouse_id: s.warehouse_id ?? header.default_warehouse_id,
          direction: s.direction,
          qty: String(s.quantity),
          rate: s.rate !== null ? String(s.rate) : '',
          description: s.remarks ?? '',
          // Tagged so the grid can mark it "drafted, needs review".
          origin: 'bom',
        })
      })
      // Drop the untouched placeholder rows so the suggestions are not buried.
      setLines((ls) => [...ls.filter((l) => !isBlankLine(l)), ...generated])
      setDirty(true)
      notify.info(`${generated.length} line${generated.length === 1 ? '' : 's'} drafted — review before posting.`)
    },
    [spec, header.default_warehouse_id],
  )

  /* ------------------------------------------------------ bulk helpers */

  const insertExcelRows = (rows: ResolvedRow[]) => {
    const generated = rows.map((r) =>
      newLine(spec, {
        item_id: r.item?.item_id ?? null,
        item_name: r.item ? r.item.print_name || r.item.item_name : '',
        item_sku: r.item?.item_sku ?? null,
        track_batch: r.item ? Number(r.item.track_batch) === 1 : false,
        track_serial: r.item ? Number(r.item.track_serial) === 1 : false,
        units: r.item ? unitsFrom(r.item) : [],
        unit_id: r.item ? (unitsFrom(r.item).find((u) => u.is_default) ?? unitsFrom(r.item)[0])?.unit_id ?? null : null,
        warehouse_id: r.warehouseId,
        direction: r.direction,
        qty: r.qty,
        rate: r.rate,
        description: r.remarks,
      }),
    )
    setLines((ls) => [...ls.filter((l) => !isBlankLine(l)), ...generated])
    setDirty(true)
    notify.success(`${generated.length} line${generated.length === 1 ? '' : 's'} imported.`)
  }

  const addManyItems = (items: ItemSearchRow[], warehouseId: number | null, direction: 'in' | 'out') => {
    const generated = items.map((row) => {
      const units = unitsFrom(row)
      const def = units.find((u) => u.is_default) ?? units[0]
      return newLine(spec, {
        item_id: row.item_id,
        item_name: row.print_name || row.item_name,
        item_sku: row.item_sku,
        track_batch: Number(row.track_batch) === 1,
        track_serial: Number(row.track_serial) === 1,
        units,
        unit_id: def?.unit_id ?? null,
        warehouse_id: warehouseId,
        direction,
      })
    })
    for (const l of generated) if (warehouseId !== header.default_warehouse_id) touchedWarehouses.current.add(l.key)
    setLines((ls) => [...ls.filter((l) => !isBlankLine(l)), ...generated])
    setDirty(true)
    notify.success(`${generated.length} item${generated.length === 1 ? '' : 's'} added.`)
  }

  const addScanned = (row: ItemSearchRow) => {
    const units = unitsFrom(row)
    const def = units.find((u) => u.is_default) ?? units[0]
    // A second scan of the same item in the same warehouse bumps the quantity
    // rather than opening a duplicate line — that is what scanning a trolley means.
    const existingLine = lines.find(
      (l) => l.item_id === row.item_id && l.warehouse_id === header.default_warehouse_id && l.direction === 'out' && !l.track_serial,
    )
    if (existingLine) {
      patchLine(existingLine.key, { qty: String((toNumber(existingLine.qty) ?? 0) + 1) })
      return
    }
    setLines((ls) => [
      ...ls.filter((l) => !isBlankLine(l)),
      newLine(spec, {
        item_id: row.item_id,
        item_name: row.print_name || row.item_name,
        item_sku: row.item_sku,
        track_batch: Number(row.track_batch) === 1,
        track_serial: Number(row.track_serial) === 1,
        units,
        unit_id: def?.unit_id ?? null,
        warehouse_id: header.default_warehouse_id,
        direction: 'out',
        qty: '1',
      }),
    ])
    setDirty(true)
  }

  const applyTemplate = (t: JournalTemplate) => {
    setHeader((h) => ({
      ...h,
      reason_code: t.reason_code,
      movement_reason: t.movement_reason,
      narration: t.narration,
      default_warehouse_id: t.default_warehouse_id ?? h.default_warehouse_id,
    }))
    setLines(
      t.lines.map((l) =>
        newLine(spec, {
          item_id: l.item_id,
          item_name: l.item_name,
          item_sku: l.item_sku,
          warehouse_id: l.warehouse_id ?? t.default_warehouse_id,
          direction: l.direction,
          description: l.description,
        }),
      ),
    )
    setDirty(true)
    setTab('create')
    notify.info(`Template “${t.name}” applied. Enter the quantities, and re-pick batches or serials.`)
  }

  /* ------------------------------------------------------------ render */

  const activeLines = lines.filter((l) => !isBlankLine(l))
  const postDisabled = busy !== null || (!canSave && !savedId)

  const statusBadge = savedDoc
    ? ({ label: savedDoc.status === 'DRAFT' ? 'Draft' : savedDoc.status, tone: savedDoc.status === 'POSTED' ? ('success' as const) : ('neutral' as const) })
    : null

  return (
    <PageShell paddingBottom>
      <StockJournalHeaderBar
        tab={tab}
        onTabChange={setTab}
        onShortcuts={() => setShortcutsOpen(true)}
        title={savedId ? `Stock Journal ${savedDoc?.document_no ?? `#${savedId}`}` : 'New Stock Journal'}
        statusBadge={statusBadge}
        dirty={dirty}
      />

      {refError ? (
        <div className={cx(AIC, 'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800')}>{refError}</div>
      ) : null}

      {recovered ? (
        <div className={cx(AIC, 'flex flex-wrap items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2')}>
          <RotateCcw className="h-4 w-4 shrink-0 text-sky-600" aria-hidden />
          <p className="min-w-0 flex-1 text-xs text-sky-900">
            An unsaved stock journal from this browser was found. It was never sent to the server and holds no stock.
          </p>
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              setHeader(recovered.header)
              setLines(recovered.lines)
              setRecovered(null)
              setDirty(true)
            }}
          >
            Restore it
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              clearDraft(draftScope)
              setRecovered(null)
            }}
          >
            Discard
          </Button>
        </div>
      ) : null}

      {apiError ? (
        <div className={cx(AIC, 'rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800')} role="alert">
          {apiError}
        </div>
      ) : null}

      {docWarnings.length > 0 ? (
        <div
          className={cx(
            AIC,
            'rounded-lg border px-3 py-2',
            docWarnings.some((w) => w.level === 'blocking') ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50',
          )}
        >
          <ul className="space-y-0.5">
            {docWarnings.map((w, i) => (
              <li
                key={`${w.code}-${i}`}
                className={cx('text-xs', w.level === 'blocking' ? 'text-red-800' : 'text-amber-800')}
              >
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === 'create' ? (
        <>
          <div className={cx(AIC, 'grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1fr)_20rem]')}>
            <StockJournalDetailsCard
              header={header}
              onChange={(patch) =>
                'default_warehouse_id' in patch ? changeDefaultWarehouse(patch.default_warehouse_id ?? null) : patchHeader(patch)
              }
              warehouses={warehouses}
              warehousesLoading={refLoading}
              errors={visibleErrors}
              disabled={busy !== null}
              mode={mode}
              onModeChange={(next) => {
                setMode(next)
                if (next === 'import') setExcelOpen(true)
              }}
              fyRange={fyRange}
              dateRef={dateRef}
            />
            <div className="flex flex-col gap-3 lg:flex-row lg:gap-3 xl:flex-col">
              <div className="flex-1">
                <StockJournalAssistant onGenerate={runAssistant} onSuggestions={(r) => void applySuggestions(r)} disabled={busy !== null} />
              </div>
              <div className="lg:w-72 xl:w-auto">
                <StockJournalQuickActions
                  onScanBarcode={() => setScanOpen(true)}
                  onUploadExcel={() => setExcelOpen(true)}
                  onOpenItemFinder={() => setMultiOpen(true)}
                  disabled={busy !== null}
                />
              </div>
            </div>
          </div>

          <StockJournalLinesCard
            lines={lines}
            warehouses={warehouses}
            availability={availability}
            checking={checking}
            errors={visibleErrors}
            warnings={warningsWithRejections}
            columns={columns}
            onColumnsChange={setColumns}
            disabled={busy !== null}
            focusKey={focusKey}
            onPatch={patchLine}
            onPickItem={applyItem}
            onClearItem={clearItem}
            onWarehouseChange={changeLineWarehouse}
            onRemove={requestRemove}
            onAddLine={() => addLine()}
            onAddMultiple={() => setMultiOpen(true)}
            onPasteExcel={() => setExcelOpen(true)}
            onScanBarcode={() => setScanOpen(true)}
            onBulkDirection={(direction) => {
              setLines((ls) => ls.map((l) => ({ ...l, direction, serials: [] })))
              setDirty(true)
            }}
            onBulkWarehouse={() => {
              touchedWarehouses.current.clear()
              changeDefaultWarehouse(header.default_warehouse_id)
            }}
            onClearEmpty={() => {
              setLines((ls) => ls.filter((l) => !isBlankLine(l)))
              setDirty(true)
            }}
          />

          <StockJournalDocumentSummary totals={totals} currency={currency} showValues={canSeeCost} />
        </>
      ) : null}

      {tab === 'preview' ? <StockJournalPreview header={header} lines={lines} warehouses={warehouses} currency={currency} /> : null}
      {tab === 'history' ? <StockJournalHistory documentId={savedId} document={savedDoc} /> : null}
      {tab === 'templates' ? (
        <StockJournalTemplates
          templates={templates}
          canSave={activeLines.some((l) => l.item_id !== null)}
          onSave={(name) => {
            setTemplates(saveTemplate(scope?.cmp_id ?? null, templateFromDraft(name, header, lines)))
            notify.success('Template saved.')
          }}
          onApply={applyTemplate}
          onDelete={(id) => setTemplates(deleteTemplate(scope?.cmp_id ?? null, id))}
        />
      ) : null}

      <StickyActionBar
        totals={
          <>
            <ActionBarTotal label="Lines" value={totals.lines} />
            <ActionBarTotal label="In" value={formatQty(totals.qtyIn, '0')} tone="success" />
            <ActionBarTotal label="Out" value={formatQty(totals.qtyOut, '0')} tone="danger" />
            <ActionBarTotal label="Net" value={formatQty(totals.netQty, '0')} tone="primary" />
          </>
        }
        status={savedId ? <span className="text-[11px] text-gray-500">Draft #{savedId}</span> : null}
      >
        <Button variant="ghost" icon={X} onClick={() => navigate(savedId ? `/documents/${savedId}` : '/documents')} disabled={busy !== null}>
          Cancel
        </Button>
        {savedId ? (
          <Button variant="secondary" icon={History} onClick={() => setTab('history')}>
            History
          </Button>
        ) : null}
        <Button variant="secondary" icon={Save} loading={busy === 'save'} disabled={busy !== null || !canSave} onClick={() => void submit(false)}>
          {savedId ? 'Save changes' : 'Save as Draft'}
        </Button>
        {canPost ? (
          <div className="flex items-stretch">
            <Button
              icon={Check}
              className="rounded-r-none"
              loading={busy === 'post'}
              disabled={postDisabled}
              onClick={() => {
                setPostIntent('post')
                openPost()
              }}
            >
              Save &amp; Post
            </Button>
            <MenuButton
              variant="primary"
              size="sm"
              label="More posting options"
              icon={ChevronDown}
              className="rounded-l-none border-l border-white/25 px-2"
              actions={[
                {
                  key: 'post',
                  label: 'Save & Post',
                  onSelect: () => {
                    setPostIntent('post')
                    openPost()
                  },
                },
                {
                  key: 'post_new',
                  label: 'Save & Post, then start a new one',
                  onSelect: () => {
                    setPostIntent('post_new')
                    openPost()
                  },
                },
                {
                  key: 'post_close',
                  label: 'Save & Post, then close',
                  onSelect: () => {
                    setPostIntent('post_close')
                    openPost()
                  },
                },
              ]}
            />
          </div>
        ) : null}
      </StickyActionBar>

      {/* ------------------------------------------------------- dialogs */}

      <ExcelPasteModal
        open={excelOpen}
        onClose={() => {
          setExcelOpen(false)
          setMode('manual')
        }}
        warehouses={warehouses}
        defaultWarehouseId={header.default_warehouse_id}
        onInsert={insertExcelRows}
      />

      <MultiItemPicker
        open={multiOpen}
        onClose={() => setMultiOpen(false)}
        warehouses={warehouses}
        defaultWarehouseId={header.default_warehouse_id}
        onAdd={addManyItems}
      />

      <BarcodeScanDialog open={scanOpen} onClose={() => setScanOpen(false)} warehouseId={header.default_warehouse_id} onScanned={addScanned} />

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <PostConfirmDialog
        open={postOpen}
        busy={busy === 'post'}
        totals={totals}
        warnings={warningsWithRejections}
        canOverride={canOverride}
        override={override}
        onOverrideChange={setOverride}
        reasonLabel={reasonLabel(header.reason_code)}
        documentDate={header.document_date}
        onClose={() => setPostOpen(false)}
        onConfirm={() => void submit(true, postIntent)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this line?"
        message="The item, quantity and any batch or serial selection on it are removed."
        confirmLabel="Delete line"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) removeLine(pendingDelete)
          setPendingDelete(null)
        }}
      />

      <ConfirmDialog
        open={leaveTo !== null}
        title="Leave without saving?"
        message="This stock journal has changes that have not been saved. A local copy is kept in this browser, but nothing has been sent to the server."
        confirmLabel="Leave"
        danger
        onCancel={() => setLeaveTo(null)}
        onConfirm={() => {
          const go = leaveTo?.proceed
          setLeaveTo(null)
          setDirty(false)
          go?.()
        }}
      />

    </PageShell>
  )
}
