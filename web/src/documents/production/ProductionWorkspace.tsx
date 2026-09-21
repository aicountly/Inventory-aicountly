import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  Coins,
  Factory,
  History,
  Layers,
  ListTree,
  RefreshCw,
  Search,
  Settings2,
  Warehouse as WarehouseIcon,
} from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { useScopeLabel } from '../../company/useScopeLabel'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Notice } from '../../components/Notice'
import { useQuery } from '../../hooks/useQuery'
import { useDebounce } from '../../hooks/useDebounce'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { usePageKeyboard } from '../../keyboard/usePageKeyboard'
import { errorMessage, isApiError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { lookupApi } from '../../services/lookupApi'
import type { BomListRow, BatchRow, ItemSearchRow } from '../../services/lookupApi'
import { settingsApi } from '../../services/settingsApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { EmptyState } from '../../ui/EmptyState'
import { Input } from '../../ui/Input'
import { MenuButton } from '../../ui/MenuButton'
import type { MenuAction } from '../../ui/MenuButton'
import { Select } from '../../ui/Select'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Skeleton } from '../../ui/Skeleton'
import { Textarea } from '../../ui/Textarea'
import { Tooltip } from '../../ui/Tooltip'
import { cx } from '../../ui/cx'
import { notify } from '../../ui/notify'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { StickyActionBar } from '../../ui/shell/StickyActionBar'
import { currencySymbol, formatQty, todayIso, toNumber } from '../../utils/format'
import { canCreate, permissionKeysFor, STATUS_LABELS, statusTone } from '../actions'
import { draftTotals, isBlankLine, lineBaseQty, newHeader, toPayload, validateDraft } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { offendingDraftKeys, parseNegativeStock } from '../negativeStock'
import type { NegativeStockDetail } from '../negativeStock'
import type { DocumentTypeSpec } from '../registry'
import { scaleBomLines } from '../bom'
import type { DocumentStatus, InventoryDocument, LineSerial, PostingWarning } from '../types'
import { useReferenceData } from '../useReferenceData'
import { AlternateStockDrawer } from './components/AlternateStockDrawer'
import { BatchAllocationDrawer, expiresSoon } from './components/BatchAllocationDrawer'
import { BomComponentsTable } from './components/BomComponentsTable'
import { BomDetailDrawer } from './components/BomDetailDrawer'
import { FinishedItemSelector } from './components/FinishedItemSelector'
import type { FinishedItemValue } from './components/FinishedItemSelector'
import { ProductionHistoryTab } from './components/ProductionHistoryTab'
import { ProductionKpiBar } from './components/ProductionKpiBar'
import { ProductionLinesTable } from './components/ProductionLinesTable'
import { ProductionSidebar } from './components/ProductionSidebar'
import { ProductionStepper } from './components/ProductionStepper'
import type { StepKey, StepSpec } from './components/ProductionStepper'
import { ProductionValidationDialog } from './components/ProductionValidationDialog'
import { SerialAllocationDrawer } from './components/SerialAllocationDrawer'
import { draftsFromExplosion, hydrateDrafts, mergeAllocations } from './productionLines'
import {
  buildComponentRows,
  buildInsights,
  buildSuggestion,
  capacity,
  costSummary,
  findFinishedLine,
  isComponentLine,
  productionIssues,
  readinessFrom,
} from './productionModel'
import type { NegativeStockPolicy, ProductionIssue } from './productionModel'
import { useProductionIntel } from './useProductionIntel'

const PRODUCTION_TYPES = [
  { value: 'standard', label: 'Standard', title: 'A normal production run against this bill of materials.' },
  { value: 'rework', label: 'Rework', title: 'Re-processing goods that have already been produced.' },
  { value: 'pilot', label: 'Pilot', title: 'A trial run — recorded like any other, and it moves stock like any other.' },
] as const

type ProductionType = (typeof PRODUCTION_TYPES)[number]['value']
type TabKey = 'bom' | 'lines' | 'history'

const NARRATION_GUIDE = 500

export interface ProductionWorkspaceProps {
  spec: DocumentTypeSpec
  /** Set when an existing draft is being edited. */
  documentId?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  /** The stored document, when editing — for the status chip. */
  document?: InventoryDocument | null
  onSaved: (doc: InventoryDocument, posted: boolean) => void
  onNew: () => void
}

function describeError(err: unknown): string {
  if (isApiError(err)) {
    const field = err.field
    return field ? `${err.message} (${field})` : err.message
  }
  return errorMessage(err)
}

/**
 * `/documents/new/production` and `/documents/:id/edit` for a production run — the entry screen
 * as a cockpit rather than a form.
 *
 * What it is, structurally: the same draft the generic document editor builds (`HeaderDraft` +
 * `LineDraft[]`), sent through the same `toPayload` / `documentsApi.create|update|post` path, so
 * the payload, the numbering, the permissions, the audit trail and the posting engine are
 * untouched. What changed is what the screen knows while the draft is being built — live
 * availability per warehouse, live inventory cost, live batch and serial stock — and what it
 * therefore dares to say about whether the run can go ahead.
 *
 * Two rules run through it. The server is authoritative: the BOM explosion is
 * `POST /v1/bill-of-materials/{id}/explode`, quantities are only previewed here, and every
 * quantity is re-checked on post. And nothing is done on the user's behalf: no warehouse is
 * switched, no batch allocated, no stock transferred and no quantity adjusted without an explicit
 * click.
 */
export function ProductionWorkspace({ spec, documentId, initial, document: stored, onSaved, onNew }: ProductionWorkspaceProps) {
  const { warehouses, defaultWarehouseId, warehouseName, loading: refLoading, error: refError } = useReferenceData()
  const { can } = useAccess()
  const { scope } = useCompany()
  const scopeLabel = useScopeLabel()
  const navigate = useNavigate()

  // ---- draft state (identical shape to the generic editor) -------------------------------
  const [header, setHeader] = useState<HeaderDraft>(() => {
    if (!initial) return newHeader(spec, todayIso())
    /*
     * A stored production run keeps its warehouse in metadata (BomService::productionPayload);
     * `draftFromDocument` has no column to read it from, so the reopened draft would otherwise
     * come back with no warehouse and write that null straight back over the stored value.
     */
    const stored = initial.header.metadata.warehouse_id
    return {
      ...initial.header,
      default_warehouse_id: initial.header.default_warehouse_id ?? (stored ? Number(stored) : null),
    }
  })
  const [lines, setLines] = useState<LineDraft[]>(() => initial?.lines ?? [])
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)

  // ---- production-specific inputs --------------------------------------------------------
  const [bomId, setBomId] = useState<number | null>(initial?.header.metadata.bom_id ? Number(initial.header.metadata.bom_id) : null)
  const [qtyInput, setQtyInput] = useState(() => {
    const fromMeta = initial?.header.metadata.production_qty
    if (fromMeta !== undefined && fromMeta !== null) return String(fromMeta)
    const line = initial ? findFinishedLine(initial.lines) : null
    return line?.qty ?? ''
  })
  const [rateInput, setRateInput] = useState(() => {
    const fromMeta = initial?.header.metadata.finished_rate
    if (fromMeta !== undefined && fromMeta !== null && Number(fromMeta) > 0) return String(fromMeta)
    const line = initial ? findFinishedLine(initial.lines) : null
    return line && toNumber(line.rate) ? String(line.rate) : ''
  })
  const [finishedItem, setFinishedItem] = useState<FinishedItemValue | null>(null)

  // ---- screen state ----------------------------------------------------------------------
  const [tab, setTab] = useState<TabKey>('bom')
  const [search, setSearch] = useState('')
  const [exploding, setExploding] = useState(false)
  const [explodeError, setExplodeError] = useState<string | null>(null)
  const [clientScaled, setClientScaled] = useState(false)
  const [editedKeys, setEditedKeys] = useState<ReadonlySet<string>>(new Set())
  const [flashKeys, setFlashKeys] = useState<ReadonlySet<string>>(new Set())
  const [batchFor, setBatchFor] = useState<string | null>(null)
  const [serialsFor, setSerialsFor] = useState<string | null>(null)
  const [alternatesFor, setAlternatesFor] = useState<string | null>(null)
  const [bomDetailOpen, setBomDetailOpen] = useState(false)
  const [validationOpen, setValidationOpen] = useState(false)
  const [pendingBom, setPendingBom] = useState<number | null>(null)
  /** Wrapped so that "clear the finished item" is distinguishable from "no pending change". */
  const [pendingItem, setPendingItem] = useState<{ row: ItemSearchRow | null } | null>(null)
  const [batchInfo, setBatchInfo] = useState<Record<string, BatchRow>>({})

  // ---- save / post state ------------------------------------------------------------------
  const [busy, setBusy] = useState<'save' | 'post' | null>(null)
  const [draftErrors, setDraftErrors] = useState<string[]>([])
  const [apiError, setApiError] = useState<string | null>(null)
  const [negative, setNegative] = useState<NegativeStockDetail[] | null>(null)
  const [override, setOverride] = useState(false)
  const [warnings, setWarnings] = useState<PostingWarning[]>([])
  const inFlight = useRef(false)

  const detailsRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const reviewRef = useRef<HTMLDivElement>(null)
  /** The live draft, so a re-explosion can merge against it without an impure state updater. */
  const linesRef = useRef<LineDraft[]>(lines)
  linesRef.current = lines
  const searchRef = useRef<HTMLInputElement>(null)
  const qtyRef = useRef<HTMLInputElement>(null)
  const warehouseRef = useRef<HTMLSelectElement>(null)
  const bomRef = useRef<HTMLSelectElement>(null)
  const itemRef = useRef<HTMLInputElement>(null)

  const canOverride = can('stock.negative_override')
  const canPost = can(permissionKeysFor('post', spec.code))
  const canSave = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)
  const disabled = busy !== null

  // ---- company settings: currency, negative-stock policy, FEFO ---------------------------
  const settings = useQuery((signal) => settingsApi.get(signal), [scope?.cmp_id], { enabled: scope !== null })
  const currency = currencySymbol(settings.data?.base_currency_code ?? stored?.currency_code ?? null)
  const negativeStockPolicy = ((settings.data?.negative_stock_policy as NegativeStockPolicy | undefined) ?? 'warn') as NegativeStockPolicy
  const fefoEnabled = settings.data ? [1, '1', true, 'true'].includes(settings.data.fefo_enabled as never) : false

  // ---- warehouse default -------------------------------------------------------------------
  useEffect(() => {
    if (!documentId && header.default_warehouse_id === null && defaultWarehouseId !== null) {
      setHeader((h) => ({ ...h, default_warehouse_id: defaultWarehouseId }))
    }
  }, [defaultWarehouseId, documentId, header.default_warehouse_id])

  // ---- BOM lookups -------------------------------------------------------------------------
  // The finished item is the filter that matters: BomController::index narrows the list to the
  // BOMs that actually produce it, so the dropdown never offers one that cannot be used here.
  const boms = useQuery((signal) => lookupApi.boms('', { finishedItemId: finishedItem?.itemId ?? null, signal }), [finishedItem?.itemId])
  const bom = useQuery((signal) => (bomId ? lookupApi.bom(bomId, signal) : Promise.resolve(null)), [bomId], { enabled: bomId !== null })

  // The BOM knows its own finished item; adopt it so the preview and the item field agree.
  useEffect(() => {
    const data = bom.data
    if (!data) return
    setFinishedItem((current) =>
      current && current.itemId === data.finished_item_id
        ? current
        : { itemId: data.finished_item_id, name: data.finished_item_name ?? `Item #${data.finished_item_id}`, sku: data.finished_item_sku ?? null },
    )
    setQtyInput((q) => (q.trim() === '' ? String(data.yield_qty || 1) : q))
  }, [bom.data])

  // ---- header metadata mirrors what produced the lines ------------------------------------
  const productionQty = toNumber(qtyInput) ?? 0
  const finishedRate = toNumber(rateInput) ?? 0
  const productionType = ((header.metadata.production_type as string | undefined) ?? 'standard') as ProductionType

  useEffect(() => {
    setHeader((h) => {
      const next = {
        ...h.metadata,
        bom_id: bomId ?? undefined,
        production_qty: productionQty > 0 ? productionQty : undefined,
        finished_rate: finishedRate > 0 ? finishedRate : undefined,
        warehouse_id: h.default_warehouse_id,
      }
      return JSON.stringify(next) === JSON.stringify(h.metadata) ? h : { ...h, metadata: next }
    })
  }, [bomId, productionQty, finishedRate, header.default_warehouse_id])

  const patchHeader = useCallback((patch: Partial<HeaderDraft>) => setHeader((h) => ({ ...h, ...patch })), [])
  const patchMeta = useCallback((patch: Record<string, unknown>) => setHeader((h) => ({ ...h, metadata: { ...h.metadata, ...patch } })), [])

  const patchLine = useCallback(
    (key: string, patch: Partial<LineDraft>) => {
      setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
      if (patch.qty !== undefined) setEditedKeys((keys) => new Set(keys).add(key))
      if (patch.warehouse_id !== undefined) {
        setBatchInfo((info) => {
          if (!info[key]) return info
          const next = { ...info }
          delete next[key]
          return next
        })
      }
    },
    [],
  )

  // ---- BOM explosion -----------------------------------------------------------------------
  const explode = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const target = bom.data
      if (!target || bomId === null || productionQty <= 0) return
      setExploding(true)
      setExplodeError(null)
      setClientScaled(false)
      try {
        let payloadLines
        try {
          const payload = await lookupApi.explodeBom(bomId, {
            production_qty: productionQty,
            warehouse_id: header.default_warehouse_id,
            finished_rate: finishedRate,
            document_date: header.document_date,
          })
          payloadLines = payload.lines
        } catch (err) {
          // The published API may predate the explode route; the client mirror of BomService
          // produces the identical payload, and the server re-scales it on post either way.
          if (isApiError(err) && err.status === 404) {
            payloadLines = scaleBomLines(target, productionQty, header.default_warehouse_id, finishedRate)
            setClientScaled(true)
          } else {
            throw err
          }
        }
        const fresh = draftsFromExplosion(payloadLines, target, spec)
        const merged = mergeAllocations(linesRef.current, fresh)
        setLines(merged)
        setFlashKeys(new Set(merged.map((l) => l.key)))
        setEditedKeys(new Set())
        // Units, SKU and batch / serial control come from the item master, not the explosion.
        const ids = [...new Set(payloadLines.map((l) => l.item_id).filter((id): id is number => !!id))]
        if (ids.length > 0) {
          try {
            const items = await lookupApi.itemsByIds(ids)
            setLines((ls) => hydrateDrafts(ls, items))
          } catch {
            /* the stored unit still works; the batch and serial pickers just stay hidden */
          }
        }
      } catch (err) {
        if (!options.silent) setExplodeError(errorMessage(err, 'The bill of materials could not be exploded.'))
      } finally {
        setExploding(false)
      }
    },
    [bom.data, bomId, productionQty, finishedRate, header.default_warehouse_id, header.document_date, spec],
  )

  // Re-scale as the run quantity is typed — debounced, and never over quantities edited by hand.
  const debouncedQty = useDebounce(qtyInput, 500)
  const debouncedRate = useDebounce(rateInput, 500)
  const explodeRef = useRef(explode)
  explodeRef.current = explode
  const explosionSignature = useRef<string | null>(null)
  /*
   * A draft reopened for editing already carries its lines, and those lines may have been
   * adjusted by hand before it was saved. Re-scaling them from the BOM on mount would silently
   * undo that, so the first pass only records where the run stands.
   */
  const skipFirstExplosion = useRef((initial?.lines.length ?? 0) > 0)
  useEffect(() => {
    if (!bom.data || bomId === null) return
    const qty = toNumber(debouncedQty) ?? 0
    if (qty <= 0) return
    const signature = `${bomId}:${qty}:${toNumber(debouncedRate) ?? 0}:${header.default_warehouse_id ?? 0}`
    if (explosionSignature.current === signature) return
    if (skipFirstExplosion.current) {
      skipFirstExplosion.current = false
      explosionSignature.current = signature
      return
    }
    if (editedKeys.size > 0) return
    explosionSignature.current = signature
    void explodeRef.current({ silent: true })
  }, [bom.data, bomId, debouncedQty, debouncedRate, header.default_warehouse_id, editedKeys.size])

  // The tint that marks re-scaled rows is a cue, not an animation loop.
  useEffect(() => {
    if (flashKeys.size === 0) return undefined
    const id = setTimeout(() => setFlashKeys(new Set()), 450)
    return () => clearTimeout(id)
  }, [flashKeys])

  // ---- live intel --------------------------------------------------------------------------
  const componentItemIds = useMemo(
    () => lines.filter(isComponentLine).map((l) => l.item_id).filter((id): id is number => id !== null),
    [lines],
  )
  const intel = useProductionIntel(componentItemIds, header.document_date, header.default_warehouse_id)

  const rows = useMemo(
    () =>
      buildComponentRows({
        lines,
        availability: intel.availability,
        unitCosts: intel.unitCosts,
        productionQty,
        fallbackWarehouseId: header.default_warehouse_id,
      }),
    [lines, intel.availability, intel.unitCosts, productionQty, header.default_warehouse_id],
  )
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => (r.line.item_name ?? '').toLowerCase().includes(q) || (r.line.item_sku ?? '').toLowerCase().includes(q))
  }, [rows, search])

  const finishedLine = useMemo(() => findFinishedLine(lines), [lines])
  const cost = useMemo(() => costSummary(rows, finishedLine, productionQty), [rows, finishedLine, productionQty])
  const cap = useMemo(() => capacity(rows), [rows])
  const exploded = lines.length > 0

  const issues = useMemo(
    () =>
      productionIssues({
        rows,
        hasBom: bomId !== null,
        hasFinishedItem: finishedItem !== null,
        productionQty,
        warehouseId: header.default_warehouse_id,
        exploded,
        negativeStockPolicy,
        warehouseName,
      }),
    [rows, bomId, finishedItem, productionQty, header.default_warehouse_id, exploded, negativeStockPolicy, warehouseName],
  )
  const readiness = useMemo(
    () => readinessFrom(issues, { hasBom: bomId !== null, productionQty, exploded, checking: intel.loading }),
    [issues, bomId, productionQty, exploded, intel.loading],
  )

  const expiringBatches = useMemo(
    () =>
      Object.entries(batchInfo)
        .filter(([, batch]) => expiresSoon(batch.expiry_date))
        .map(([key, batch]) => ({
          itemName: lines.find((l) => l.key === key)?.item_name ?? '',
          batchNo: batch.batch_no,
          expiry: batch.expiry_date ?? '',
        })),
    [batchInfo, lines],
  )

  const finishedUnitLabel = useMemo(() => {
    const unit = finishedLine?.units.find((u) => u.unit_id === finishedLine.unit_id)
    return unit?.unit_symbol ?? unit?.unit_name ?? bom.data?.yield_unit_symbol ?? ''
  }, [finishedLine, bom.data])

  const insights = useMemo(
    () =>
      buildInsights({
        rows,
        capacity: cap,
        productionQty,
        warehouseName,
        unitLabel: (line) => line.units.find((u) => u.unit_id === line.unit_id)?.unit_symbol ?? '',
        expiringBatches,
        availabilityKnown: intel.availability !== null,
      }),
    [rows, cap, productionQty, warehouseName, expiringBatches, intel.availability],
  )
  const suggestion = useMemo(
    () => buildSuggestion({ rows, capacity: cap, productionQty, fefoEnabled, warehouseName, hasBom: bomId !== null }),
    [rows, cap, productionQty, fefoEnabled, warehouseName, bomId],
  )

  const consumedCount = useMemo(() => rows.filter((r) => r.line.direction === 'out').length, [rows])
  const costByKey = useMemo(() => new Map(rows.map((r) => [r.key, r.totalCost])), [rows])
  const offendingKeys = useMemo(() => new Set(negative ? offendingDraftKeys(lines, negative) : []), [negative, lines])
  const totals = draftTotals(lines, spec)

  // ---- BOM / finished item changes need consent ----------------------------------------------
  const applyBom = (id: number | null) => {
    setBomId(id)
    setLines([])
    setEditedKeys(new Set())
    setBatchInfo({})
    explosionSignature.current = null
    setExplodeError(null)
  }

  const requestBomChange = (id: number | null) => {
    if (id === bomId) return
    if (lines.length > 0) {
      setPendingBom(id)
      return
    }
    applyBom(id)
  }

  const applyFinishedItem = (row: ItemSearchRow | null) => {
    setFinishedItem(row ? { itemId: row.item_id, name: row.print_name || row.item_name, sku: row.item_sku } : null)
    setBomId(null)
    setLines([])
    setEditedKeys(new Set())
    setBatchInfo({})
    setQtyInput('')
    explosionSignature.current = null
  }

  const requestFinishedItemChange = (row: ItemSearchRow | null) => {
    if (bomId !== null || lines.length > 0) {
      setPendingItem({ row })
      return
    }
    applyFinishedItem(row)
  }

  // ---- warehouse change re-points the lines that still follow the header --------------------
  const changeWarehouse = (next: number | null) => {
    const previous = header.default_warehouse_id
    patchHeader({ default_warehouse_id: next })
    setLines((ls) =>
      ls.map((l) => (l.warehouse_id === previous || l.warehouse_id === null ? { ...l, warehouse_id: next, batch_id: null, batch_no: null, serials: [] } : l)),
    )
    setBatchInfo({})
    explosionSignature.current = null
  }

  // ---- save / post ---------------------------------------------------------------------------
  const scrollTo = <T extends HTMLElement>(ref: RefObject<T | null>) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const goToStep = (key: StepKey) => {
    if (key === 'details') scrollTo(detailsRef)
    else if (key === 'bom') {
      setTab('bom')
      scrollTo(workspaceRef)
    } else if (key === 'lines') {
      setTab('lines')
      scrollTo(workspaceRef)
    } else scrollTo(reviewRef)
  }

  const resolveIssue = (issue: ProductionIssue) => {
    setValidationOpen(false)
    const action = issue.action
    if (!action) return
    if (action.kind === 'alternates') setAlternatesFor(action.lineKey)
    else if (action.kind === 'serials') setSerialsFor(action.lineKey)
    else if (action.kind === 'batch') setBatchFor(action.lineKey)
    else if (action.kind === 'warehouse') {
      setTab('bom')
      scrollTo(workspaceRef)
    } else if (action.kind === 'field') {
      scrollTo(detailsRef)
      const focus = { bom: bomRef, quantity: qtyRef, warehouse: warehouseRef, finished_item: itemRef } as const
      window.setTimeout(() => focus[action.field].current?.focus(), 250)
    }
  }

  const submit = async (post: boolean, after: 'stay' | 'new' | 'print' = 'stay') => {
    if (inFlight.current) return
    setDraftErrors([])
    setApiError(null)
    setWarnings([])
    if (!post) setNegative(null)

    const errs = validateDraft(header, lines, spec)
    const blocking = issues.filter((i) => i.severity === 'blocking')
    if (post && (errs.length > 0 || blocking.length > 0)) {
      setDraftErrors(errs)
      setValidationOpen(true)
      return
    }
    if (!post && errs.length > 0) {
      setDraftErrors(errs)
      return
    }

    inFlight.current = true
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
      if (post) {
        doc = await documentsApi.post(doc.document_id, { negativeOverride: override && canOverride })
        setWarnings(doc.warnings ?? [])
        notify.success(`Production ${doc.document_no ?? `#${doc.document_id}`} posted successfully`)
        if (after === 'print') window.open(`/documents/${doc.document_id}/print`, '_blank', 'noopener')
        if (after === 'new') {
          onNew()
          return
        }
      } else {
        notify.success(`Production draft ${doc.document_no ?? `#${doc.document_id}`} saved`)
      }
      onSaved(doc, post)
    } catch (err) {
      const neg = parseNegativeStock(err)
      if (neg) {
        setNegative(neg)
        setApiError(id ? `Draft #${id} is saved but could not be posted: ${errorMessage(err)}` : errorMessage(err))
        // Stock changed under the document; re-read what is actually there now.
        intel.reload()
      } else {
        setApiError(describeError(err))
      }
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  useKeyboardScope(
    'form',
    useMemo(
      () => ({
        'ctrl+s': (e: KeyboardEvent) => {
          if (disabled || !canSave) return
          e.preventDefault()
          void submit(false)
        },
        'ctrl+enter': (e: KeyboardEvent) => {
          if (disabled || !canPost) return
          e.preventDefault()
          void submit(true)
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- submit closes over the live draft
      [disabled, canSave, canPost, header, lines, issues, override],
    ),
    { allowInInput: true },
  )
  usePageKeyboard({ searchInputRef: searchRef })

  // ---- header actions --------------------------------------------------------------------------
  const recent = useQuery(
    (signal) => documentsApi.list({ document_type: 'PRODUCTION', status: 'POSTED,COMPLETED', limit: 8, sort: 'document_date', order: 'desc' }, signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    { enabled: scope !== null && can('documents.read') },
  )

  const copyFrom = async (id: number) => {
    try {
      const doc = await documentsApi.get(id)
      const meta = (doc.metadata ?? {}) as Record<string, unknown>
      const sourceBom = meta.bom_id ? Number(meta.bom_id) : null
      if (!sourceBom) {
        notify.error('That run was not raised from a bill of materials, so there is nothing to copy.')
        return
      }
      applyBom(sourceBom)
      setQtyInput(meta.production_qty ? String(meta.production_qty) : '')
      setRateInput(meta.finished_rate && Number(meta.finished_rate) > 0 ? String(meta.finished_rate) : '')
      if (meta.warehouse_id) patchHeader({ default_warehouse_id: Number(meta.warehouse_id) })
      if (meta.production_type) patchMeta({ production_type: meta.production_type })
      notify.info(`Settings copied from ${doc.document_no ?? `#${doc.document_id}`}. Nothing is posted until you say so.`)
    } catch (err) {
      notify.error(errorMessage(err, 'That production run could not be read.'))
    }
  }

  const repeatActions: MenuAction[] = (recent.data?.data ?? []).map((row) => ({
    key: String(row.document_id),
    label: `${row.document_no ?? `#${row.document_id}`} · ${row.narration?.slice(0, 28) ?? 'Production run'}`,
    icon: RefreshCw,
    onSelect: () => void copyFrom(row.document_id),
  }))

  // Routed, not reloaded: window.open('_self') would drop the company scope and re-boot the shell.
  const moreActions: MenuAction[] = [
    { key: 'boms', label: 'Bills of materials', icon: Layers, onSelect: () => navigate('/masters/bill-of-materials') },
    { key: 'register', label: 'Production register', icon: ListTree, onSelect: () => navigate('/documents?document_type=PRODUCTION') },
    { key: 'warehouses', label: 'Warehouses', icon: WarehouseIcon, onSelect: () => navigate('/masters/warehouses') },
    { key: 'valuation', label: 'Valuation & stock settings', icon: Coins, separated: true, onSelect: () => navigate('/settings') },
  ]

  const steps: StepSpec[] = [
    {
      key: 'details',
      label: 'Production details',
      hint: 'Date, numbering, type and reference.',
      state: header.document_date ? (bomId !== null ? 'done' : 'active') : 'active',
    },
    {
      key: 'bom',
      label: 'Bill of materials',
      hint: 'Finished item, BOM, run quantity and warehouse.',
      state: exploded ? 'done' : bomId !== null ? 'active' : 'todo',
    },
    { key: 'lines', label: 'Production lines', hint: 'The stock movements this document will make.', state: exploded ? (readiness.readiness === 'ready' ? 'done' : 'active') : 'todo' },
    { key: 'review', label: 'Review & post', hint: 'Resolve anything outstanding, then post.', state: readiness.readiness === 'ready' ? 'active' : 'todo' },
  ]

  const activeRow = (key: string | null) => (key === null ? null : rows.find((r) => r.key === key) ?? null)
  const batchRow = activeRow(batchFor)
  const serialRow = activeRow(serialsFor)
  const alternateRow = activeRow(alternatesFor)

  const status = (stored?.status ?? 'DRAFT') as DocumentStatus

  return (
    <PageShell paddingBottom fullBleed>
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Documents', to: '/documents' }, { label: 'Production', to: '/documents?document_type=PRODUCTION' }, { label: savedId ? (stored?.document_no ?? `#${savedId}`) : 'New' }]}
        icon={Factory}
        title={savedId ? `Edit production ${stored?.document_no ?? `#${savedId}`}` : 'New production'}
        description="Consume components from a bill of materials and receive finished goods."
        meta={<span className="text-[11px] text-gray-500">{scopeLabel}</span>}
        escBack={false}
        badge={
          <Badge tone={statusTone(status) === 'neutral' ? 'neutral' : statusTone(status)} size="xs" dot>
            {STATUS_LABELS[status] ?? status}
          </Badge>
        }
        actions={
          <>
            {repeatActions.length > 0 ? (
              <MenuButton
                label="Copy settings from a recent run"
                actions={repeatActions}
                variant="secondary"
                size="md"
                width={280}
                icon={History}
                buttonProps={{ iconRight: ChevronDown }}
              >
                Recent runs
              </MenuButton>
            ) : null}
            <MenuButton label="More production actions" actions={moreActions} variant="secondary" size="md" icon={Settings2} buttonProps={{ iconRight: ChevronDown }}>
              More
            </MenuButton>
          </>
        }
      />

      {refError ? <Notice kind="warning">{refError}</Notice> : null}

      <ProductionKpiBar
        currency={currency}
        cost={cost}
        componentCount={consumedCount}
        finishedUnitLabel={finishedUnitLabel}
        readiness={readiness.readiness}
        blocking={readiness.blocking}
        attention={readiness.attention}
        costForbidden={intel.costForbidden}
        loading={intel.loading && rows.length > 0}
        onReadinessClick={issues.length > 0 ? () => setValidationOpen(true) : undefined}
      />

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(17rem,20rem)]">
        {/* ---------------- main column ---------------- */}
        <div className="flex min-w-0 flex-col gap-3">
          <div ref={detailsRef} className="scroll-mt-20">
          <Card padding="none" as="section">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">Production details</h2>
            </div>
            <div className="px-4 py-4">
              <ProductionStepper steps={steps} onSelect={goToStep} />

              <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2 xl:grid-cols-4">
                <Field label="Document date" htmlFor="document_date" required>
                  <Input
                    id="document_date"
                    type="date"
                    value={header.document_date}
                    disabled={disabled}
                    onChange={(e) => patchHeader({ document_date: e.target.value })}
                  />
                </Field>

                <Field label="Document no." htmlFor="document_no" hint="Leave empty to use the numbering series.">
                  <div className="relative">
                    <Input
                      id="document_no"
                      value={header.document_no}
                      placeholder="Auto-generate"
                      disabled={disabled}
                      className="pr-14"
                      onChange={(e) => patchHeader({ document_no: e.target.value })}
                    />
                    {header.document_no.trim() === '' ? (
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                        <Badge tone="neutral" size="xs">Auto</Badge>
                      </span>
                    ) : null}
                  </div>
                </Field>

                <Field label="Production type" hint="Recorded on the document; every type moves stock the same way.">
                  <SegmentedControl<ProductionType>
                    value={productionType}
                    onChange={(value) => patchMeta({ production_type: value })}
                    options={PRODUCTION_TYPES.map((t) => ({ value: t.value, label: t.label, title: t.title }))}
                    size="md"
                  />
                </Field>

                <Field label="Reference no." htmlFor="reference_no" hint="Your own works order, job or sales reference.">
                  <Input
                    id="reference_no"
                    value={(header.metadata.reference_no as string | undefined) ?? ''}
                    placeholder="Works order / job / reference"
                    disabled={disabled}
                    onChange={(e) => patchMeta({ reference_no: e.target.value })}
                  />
                </Field>

                <Field label="Finished item" htmlFor="finished_item" required className="sm:col-span-2 xl:col-span-2">
                  <FinishedItemSelector
                    id="finished_item"
                    inputRef={itemRef}
                    value={finishedItem}
                    disabled={disabled}
                    invalid={finishedItem === null && draftErrors.length > 0}
                    onPick={(row) => requestFinishedItemChange(row)}
                    onClear={() => requestFinishedItemChange(null)}
                  />
                </Field>

                <Field
                  label="Bill of materials"
                  htmlFor="bom_id"
                  required
                  hint={finishedItem ? `Active BOMs that produce ${finishedItem.name}.` : 'Pick a finished item to narrow the list.'}
                >
                  <Select
                    id="bom_id"
                    ref={bomRef}
                    value={bomId ?? ''}
                    disabled={disabled}
                    onChange={(e) => requestBomChange(e.target.value === '' ? null : Number(e.target.value))}
                  >
                    <option value="">{boms.loading ? 'Loading…' : 'Select BOM…'}</option>
                    {bomId !== null && !(boms.data?.data ?? []).some((b) => b.bom_id === bomId) ? (
                      <option value={bomId}>{bom.data?.bom_name ?? `BOM #${bomId}`}</option>
                    ) : null}
                    {(boms.data?.data ?? []).map((b: BomListRow) => (
                      <option key={b.bom_id} value={b.bom_id}>
                        {b.bom_name} → {b.finished_item_name ?? `#${b.finished_item_id}`} (yield {formatQty(b.yield_qty)} {b.yield_unit_symbol ?? ''})
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="BOM information">
                  <Button variant="outline" size="md" icon={Layers} disabled={!bom.data} onClick={() => setBomDetailOpen(true)} block>
                    View BOM details
                  </Button>
                </Field>

                <Field label="Production quantity" htmlFor="production_qty" required hint={bom.data ? `BOM yields ${formatQty(bom.data.yield_qty)} ${bom.data.yield_unit_symbol ?? ''} per run.` : undefined}>
                  <Input
                    id="production_qty"
                    ref={qtyRef}
                    inputMode="decimal"
                    value={qtyInput}
                    disabled={disabled}
                    className="text-right tabular-nums"
                    onChange={(e) => setQtyInput(e.target.value)}
                  />
                </Field>

                <Field
                  label={`Finished rate (per ${finishedUnitLabel || 'unit'})`}
                  htmlFor="finished_rate"
                  hint="Cost of one finished unit. Left at zero, the posting engine uses the item's own cost."
                >
                  <Input
                    id="finished_rate"
                    inputMode="decimal"
                    value={rateInput}
                    placeholder="0.00"
                    disabled={disabled}
                    className="text-right tabular-nums"
                    onChange={(e) => setRateInput(e.target.value)}
                  />
                </Field>

                <Field label="Finished warehouse" htmlFor="production_wh" required hint="Components are issued from, and finished goods received into, this warehouse.">
                  <Select
                    id="production_wh"
                    ref={warehouseRef}
                    value={header.default_warehouse_id ?? ''}
                    disabled={disabled || (refLoading && warehouses.length === 0)}
                    invalid={header.default_warehouse_id === null && draftErrors.length > 0}
                    onChange={(e) => changeWarehouse(e.target.value === '' ? null : Number(e.target.value))}
                  >
                    <option value="">{refLoading && warehouses.length === 0 ? 'Loading warehouses…' : 'Select warehouse…'}</option>
                    {warehouses.map((w) => (
                      <option key={w.warehouse_id} value={w.warehouse_id}>
                        {w.warehouse_name}
                        {w.warehouse_code ? ` (${w.warehouse_code})` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label="Narration"
                  htmlFor="narration"
                  className="sm:col-span-2 xl:col-span-4"
                  hint={
                    <span className={cx(header.narration.length > NARRATION_GUIDE && 'text-amber-600')}>
                      {header.narration.length} / {NARRATION_GUIDE} characters
                      {header.narration.length > NARRATION_GUIDE ? ' — stored in full, but long notes crowd the printed document.' : ''}
                    </span>
                  }
                >
                  <Textarea
                    id="narration"
                    rows={3}
                    value={header.narration}
                    placeholder="Add production notes, remarks or instructions…"
                    disabled={disabled}
                    onChange={(e) => patchHeader({ narration: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          </Card>
          </div>

          {/* ---------------- tabs ---------------- */}
          <div ref={workspaceRef} className="scroll-mt-20">
          <Card padding="none" as="section">
            <div className="flex items-center gap-1 border-b border-gray-200 px-2.5 pt-2" role="tablist" aria-label="Production workspace">
              {(
                [
                  { key: 'bom' as const, label: `Bill of materials (${rows.length})` },
                  { key: 'lines' as const, label: `Production lines (${lines.length})` },
                  { key: 'history' as const, label: 'History' },
                ]
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={cx(
                    'relative px-3 py-2.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                    tab === t.key ? 'text-primary' : 'text-gray-500 hover:text-gray-700',
                  )}
                >
                  {t.label}
                  {tab === t.key ? <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded-t bg-primary" /> : null}
                </button>
              ))}
            </div>

            {tab === 'bom' ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2.5">
                  <Input
                    ref={searchRef}
                    value={search}
                    leadingIcon={Search}
                    placeholder="Search component items…"
                    aria-label="Search component items"
                    className="max-w-[16rem]"
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    {clientScaled ? (
                      <Tooltip label="This API build has no explode route, so the lines were scaled in the browser with the same arithmetic. The server re-checks them on post.">
                        <Badge tone="info" size="xs">Scaled locally</Badge>
                      </Tooltip>
                    ) : null}
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={RefreshCw}
                      loading={exploding}
                      disabled={disabled || bomId === null || productionQty <= 0}
                      onClick={() => {
                        explosionSignature.current = null
                        void explode()
                      }}
                    >
                      {exploded ? 'Re-explode' : 'Explode'}
                    </Button>
                    <Button variant="outline" size="sm" icon={WarehouseIcon} disabled={componentItemIds.length === 0 || intel.loading} onClick={intel.reload}>
                      Check availability
                    </Button>
                  </div>
                </div>

                {explodeError ? (
                  <div className="px-2.5 pb-2.5">
                    <Notice kind="error" actions={<Button variant="secondary" size="xs" onClick={() => void explode()}>Retry</Button>}>
                      {explodeError}
                    </Notice>
                  </div>
                ) : null}
                {intel.availabilityError ? (
                  <div className="px-2.5 pb-2.5">
                    <Notice kind="warning" actions={<Button variant="secondary" size="xs" onClick={intel.reload}>Retry</Button>}>
                      {intel.availabilityError} Your entries are untouched; the server still checks every line on post.
                    </Notice>
                  </div>
                ) : null}
                {intel.costError ? (
                  <div className="px-2.5 pb-2.5">
                    <Notice kind="info">{intel.costError}</Notice>
                  </div>
                ) : null}

                {exploding && rows.length === 0 ? (
                  <div className="space-y-2 p-4">
                    {[0, 1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-9 w-full" rounded="md" />
                    ))}
                  </div>
                ) : (
                  <BomComponentsTable
                    rows={visibleRows}
                    warehouses={warehouses}
                    warehouseName={warehouseName}
                    currency={currency}
                    costHidden={intel.costForbidden}
                    loading={intel.loading}
                    disabled={disabled}
                    editedKeys={editedKeys}
                    offendingKeys={offendingKeys}
                    flashKeys={flashKeys}
                    onPatchLine={patchLine}
                    onOpenBatch={setBatchFor}
                    onOpenSerials={setSerialsFor}
                    onOpenAlternates={setAlternatesFor}
                    empty={
                      <EmptyState
                        icon={Layers}
                        title={bomId === null ? 'No components yet' : productionQty <= 0 ? 'Enter a run quantity' : 'Nothing to show'}
                        description={
                          bomId === null
                            ? 'Select a finished item and a bill of materials to preview the components this run will consume.'
                            : productionQty <= 0
                              ? 'Enter the production quantity and the required component quantities are calculated from the BOM.'
                              : search.trim()
                                ? 'No component matches that search.'
                                : 'This bill of materials produced no consumption lines.'
                        }
                      />
                    }
                  />
                )}
              </>
            ) : null}

            {tab === 'lines' ? (
              <ProductionLinesTable
                lines={lines.filter((l) => !isBlankLine(l))}
                warehouseName={warehouseName}
                currency={currency}
                costByKey={costByKey}
                costHidden={intel.costForbidden}
                fallbackWarehouseId={header.default_warehouse_id}
                empty={
                  <EmptyState
                    icon={ListTree}
                    title="No stock movements yet"
                    description="Once the bill of materials is exploded, every movement this document will make — components out, finished goods in — is listed here."
                  />
                }
              />
            ) : null}

            {tab === 'history' ? <ProductionHistoryTab documentId={savedId} /> : null}
          </Card>
          </div>

          {/* ---------------- review ---------------- */}
          <div ref={reviewRef} className="flex scroll-mt-20 flex-col gap-3">
            {draftErrors.length > 0 ? (
              <Notice kind="error" title="Please fix before saving">
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {draftErrors.map((e) => (
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
                      {d.warehouse_id ? ` · ${warehouseName(d.warehouse_id)}` : ''}: on hand {formatQty(d.on_hand)}, required {formatQty(d.required)}, short by{' '}
                      <strong>{formatQty(d.short_by)}</strong>
                    </li>
                  ))}
                </ul>
                {canOverride ? (
                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="h-3.5 w-3.5 accent-[rgb(var(--color-primary))]" />
                    Post anyway and let stock go negative (override)
                  </label>
                ) : (
                  <p className="mt-1 text-[11px]">Reduce the quantities or receive stock first. Posting into negative stock needs the override permission.</p>
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
        </div>

        {/* ---------------- sidebar ---------------- */}
        <aside className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-16">
          <ProductionSidebar
            bom={bom.data ?? null}
            bomLoading={bom.loading}
            bomError={bom.error ? errorMessage(bom.error, 'The bill of materials could not be loaded.') : null}
            onRetryBom={bom.reload}
            onChangeBom={() => {
              scrollTo(detailsRef)
              window.setTimeout(() => bomRef.current?.focus(), 250)
            }}
            onOpenBomDetails={() => setBomDetailOpen(true)}
            currency={currency}
            cost={cost}
            componentCount={consumedCount}
            finishedUnitLabel={finishedUnitLabel}
            insights={insights}
            suggestion={suggestion}
            intelLoading={intel.loading}
            disabled={disabled}
          />
        </aside>
      </div>

      <StickyActionBar
        status={
          <span className="flex items-center gap-2 text-xs text-gray-600">
            <span className={cx('inline-block h-2 w-2 rounded-full', readiness.readiness === 'ready' ? 'bg-emerald-500' : readiness.readiness === 'blocked' ? 'bg-red-500' : readiness.readiness === 'attention' ? 'bg-amber-500' : 'bg-gray-300')} aria-hidden />
            {readiness.readiness === 'ready'
              ? 'Ready to post'
              : readiness.blocking > 0
                ? `${readiness.blocking} issue${readiness.blocking === 1 ? '' : 's'} to resolve`
                : readiness.attention > 0
                  ? `${readiness.attention} item${readiness.attention === 1 ? '' : 's'} to review`
                  : 'Draft in progress'}
          </span>
        }
        totals={
          <>
            <ActionTotal label="Lines" value={String(totals.lines)} />
            <ActionTotal label="Out" value={formatQty(totals.qtyOut, '0')} />
            <ActionTotal label="In" value={formatQty(totals.qtyIn, '0')} />
            {cap.maxProducible !== null ? (
              <ActionTotal label="Max producible" value={`${formatQty(cap.maxProducible)} ${finishedUnitLabel}`.trim()} title="Finished units the stock on hand covers, from the limiting component." />
            ) : null}
            {savedId ? <ActionTotal label="Draft" value={`#${savedId}`} /> : null}
          </>
        }
      >
        <Link
          to={savedId ? `/documents/${savedId}` : '/documents'}
          className="inline-flex h-8 items-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 no-underline transition-colors hover:border-primary/40 hover:bg-primary-light hover:text-primary"
        >
          Cancel
        </Link>
        <Button variant="secondary" size="md" loading={busy === 'save'} disabled={disabled || !canSave} kbd="Ctrl S" onClick={() => void submit(false)}>
          {savedId ? 'Save changes' : 'Save draft'}
        </Button>
        {canPost ? (
          <div className="flex items-stretch">
            <Button
              variant="primary"
              size="md"
              loading={busy === 'post'}
              disabled={disabled || (!canSave && !savedId)}
              kbd="Ctrl ⏎"
              className="rounded-r-none"
              onClick={() => void submit(true)}
            >
              {negative && override ? 'Post with override' : 'Save & post'}
            </Button>
            <MenuButton
              label="Post options"
              variant="primary"
              size="md"
              width={220}
              className="rounded-l-none border-l border-white/25 px-2"
              icon={ChevronDown}
              actions={[
                { key: 'post', label: 'Save & post', onSelect: () => void submit(true) },
                { key: 'new', label: 'Save, post & new', onSelect: () => void submit(true, 'new') },
                { key: 'print', label: 'Save, post & print', onSelect: () => void submit(true, 'print') },
              ]}
            />
          </div>
        ) : null}
      </StickyActionBar>

      {/* ---------------- drawers and dialogs ---------------- */}
      <BomDetailDrawer open={bomDetailOpen} bom={bom.data ?? null} onClose={() => setBomDetailOpen(false)} />

      <AlternateStockDrawer
        open={alternateRow !== null}
        row={alternateRow}
        warehouseName={warehouseName}
        disabled={disabled}
        onClose={() => setAlternatesFor(null)}
        onUseWarehouse={(key, id) => {
          patchLine(key, { warehouse_id: id, batch_id: null, batch_no: null, serials: [] })
          setAlternatesFor(null)
          notify.info(`${rows.find((r) => r.key === key)?.line.item_name ?? 'The line'} will now be issued from ${warehouseName(id)}. No stock has been moved.`)
        }}
      />

      <BatchAllocationDrawer
        open={batchRow !== null}
        itemId={batchRow?.line.item_id ?? null}
        itemName={batchRow?.line.item_name ?? ''}
        warehouseId={batchRow?.warehouseId ?? null}
        warehouseLabel={warehouseName(batchRow?.warehouseId ?? null)}
        requiredBase={batchRow?.requiredBase ?? 0}
        selectedBatchId={batchRow?.line.batch_id ?? null}
        fefoEnabled={fefoEnabled}
        onClose={() => setBatchFor(null)}
        onSelect={(batch) => {
          if (!batchRow) return
          patchLine(batchRow.key, { batch_id: batch?.batch_id ?? null, batch_no: batch?.batch_no ?? null, serials: [] })
          setBatchInfo((info) => {
            const next = { ...info }
            if (batch) next[batchRow.key] = batch
            else delete next[batchRow.key]
            return next
          })
        }}
      />

      <SerialAllocationDrawer
        open={serialRow !== null}
        itemId={serialRow?.line.item_id ?? null}
        itemName={serialRow?.line.item_name ?? ''}
        warehouseId={serialRow?.warehouseId ?? null}
        batchId={serialRow?.line.batch_id ?? null}
        direction={serialRow?.line.direction === 'in' ? 'in' : 'out'}
        requiredBase={serialRow ? lineBaseQty(serialRow.line) : 0}
        value={serialRow?.line.serials ?? ([] as LineSerial[])}
        onClose={() => setSerialsFor(null)}
        onChange={(serials) => serialRow && patchLine(serialRow.key, { serials })}
      />

      <ProductionValidationDialog
        open={validationOpen}
        issues={issues}
        draftErrors={draftErrors}
        onClose={() => setValidationOpen(false)}
        onResolve={resolveIssue}
      />

      <ConfirmDialog
        open={pendingBom !== null}
        title="Change the bill of materials?"
        confirmLabel="Change BOM"
        message="The component lines this run carries were derived from the current BOM. Changing it clears them, along with any batch and serial allocation made against them. Nothing is posted either way."
        onCancel={() => setPendingBom(null)}
        onConfirm={() => {
          applyBom(pendingBom)
          setPendingBom(null)
        }}
      />

      <ConfirmDialog
        open={pendingItem !== null}
        title="Change the finished item?"
        confirmLabel="Change item"
        message="A bill of materials belongs to one finished item. Changing the item clears the selected BOM, its component lines, and any batch and serial allocation on them."
        onCancel={() => setPendingItem(null)}
        onConfirm={() => {
          applyFinishedItem(pendingItem?.row ?? null)
          setPendingItem(null)
        }}
      />
    </PageShell>
  )
}

function Field({
  label,
  htmlFor,
  required,
  hint,
  className,
  children,
}: {
  label: ReactNode
  htmlFor?: string
  required?: boolean
  hint?: ReactNode
  className?: string
  children: ReactNode
}) {
  // A <label> with nothing to point at is a lie to a screen reader; a caption is not.
  const captionClass = 'block text-[11px] font-semibold uppercase tracking-wide text-gray-500'
  const caption = (
    <>
      {label}
      {required ? (
        <span className="ml-0.5 text-red-500" aria-hidden>
          *
        </span>
      ) : null}
    </>
  )
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className={captionClass}>
          {caption}
        </label>
      ) : (
        <span className={captionClass}>{caption}</span>
      )}
      {children}
      {hint ? <p className="text-[11px] leading-snug text-gray-500">{hint}</p> : null}
    </div>
  )
}

function ActionTotal({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex flex-col" title={title}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-sm font-bold tabular-nums text-gray-900">{value}</span>
    </div>
  )
}

export default ProductionWorkspace
