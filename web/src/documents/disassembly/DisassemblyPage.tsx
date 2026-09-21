import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  ChevronRight,
  TriangleAlert,
  Clock,
  Copy,
  FileUp,
  LayoutTemplate,
  MoreHorizontal,
  PackageOpen,
  Printer,
  RefreshCw,
  Save,
  ScanBarcode,
  Send,
  Sparkles,
  Workflow,
} from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Notice } from '../../components/Notice'
import { useQuery } from '../../hooks/useQuery'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { documentsApi } from '../../services/documentsApi'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { MenuButton } from '../../ui/MenuButton'
import { useToast } from '../../ui/ToastContext'
import { cx } from '../../ui/cx'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { StickyActionBar } from '../../ui/shell/StickyActionBar'
import { formatCurrency, formatQty, todayIso, toNumber } from '../../utils/format'
import { canCreate, permissionKeysFor } from '../actions'
import { newHeader } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { offendingDraftKeys, parseNegativeStock } from '../negativeStock'
import type { NegativeStockDetail } from '../negativeStock'
import type { DocumentTypeSpec } from '../registry'
import type { InventoryDocument, PostingWarning } from '../types'
import { useAvailability } from '../useAvailability'
import type { AvailabilityEntry } from '../useAvailability'
import { useReferenceData } from '../useReferenceData'
import { AssistantDrawer } from './AssistantDrawer'
import { BomDialog } from './BomDialog'
import { ComponentsSection } from './ComponentsSection'
import { DocumentDetailsCard } from './DocumentDetailsCard'
import { FinishedProductSection } from './FinishedProductSection'
import { ImportDialog } from './ImportDialog'
import type { ResolvedImportRow } from './ImportDialog'
import { AiInsightsCard, QuickActionsCard, StockImpactCard, ValueSummaryCard } from './ContextPanel'
import { RecentDialog } from './RecentDialog'
import { ScanDialog } from './ScanDialog'
import { SummaryBar } from './SummaryBar'
import { TemplatesDialog } from './TemplatesDialog'
import type { DisassemblyTemplate } from './templates'
import { getDisassemblyAssistant } from './assistant'
import { planFromBom } from './bomPlan'
import type { BomDisassemblyPlan } from './bomPlan'
import { describeError } from './errors'
import { buildInsights } from './insights'
import {
  activeLines,
  applyCostBasis,
  disassemblyCounts,
  disassemblyPayload,
  duplicateComponentKeys,
  mergeDuplicateComponents,
  newComponentLine,
  newFinishedLine,
  parentValue as parentValueOf,
  splitDraftLines,
  stockImpact,
  summaryText,
  totalBaseQty,
  valueSummary,
} from './model'
import type { DisassemblyRole } from './model'
import { useDisassemblyForm } from './useDisassemblyForm'
import { usePostingPolicy } from '../usePostingPolicy'
import { useUnitCosts } from '../useUnitCosts'
import { errorsOf, fieldErrors, headerErrors, validateDisassembly, warningsOf } from './validation'

export interface DisassemblyPageProps {
  spec: DocumentTypeSpec
  /** Editing a saved draft. */
  documentId?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  /** The stored document, when editing. */
  document?: InventoryDocument | null
}

type PostIntent = 'stay' | 'view' | 'print' | 'new'

const BREADCRUMBS = [
  { label: 'Documents', to: '/documents' },
  { label: 'Disassembly', to: '/documents?document_type=DISASSEMBLY' },
]

/**
 * Break a finished product into its components.
 *
 * ## The shape of the screen, and why
 *
 * A disassembly is not a list of lines with a direction each — it is one operation with two
 * sides: what is consumed and what comes back. The generic editor asked the user to say which
 * was which on every row (the "DIR." dropdown), which is both busywork and a way to enter a
 * document that means nothing. Here the parent section posts `out` and the components section
 * posts `in`, always, and the payload is byte-for-byte what the generic editor produced.
 *
 * Everything on the right is derived from the document plus live reads — availability
 * (`POST /v1/availability/check`), cost (`GET /v1/valuation/unit-costs`), the BOM
 * (`GET /v1/bill-of-materials/{id}`), the company's costing and negative-stock policy
 * (`GET /v1/settings`). Nothing is computed from a constant, and every figure it shows says
 * plainly that the posting engine is what decides the recorded numbers.
 */
export function DisassemblyPage(props: DisassemblyPageProps) {
  // "Create another" has to start from a genuinely empty form. Navigating to the route it is
  // already on would not remount anything, so the reset is a key change instead.
  const [nonce, setNonce] = useState(0)
  return <DisassemblyForm key={nonce} {...props} onCreateAnother={() => setNonce((n) => n + 1)} />
}

function DisassemblyForm({ spec, documentId, initial, document, onCreateAnother }: DisassemblyPageProps & { onCreateAnother: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { can, allowedWarehouses, member } = useAccess()
  const { scope, fyRange } = useCompany()
  const { warehouses, defaultWarehouseId, unitSymbol, loading: refLoading, error: refError } = useReferenceData()
  const policy = usePostingPolicy()
  const assistant = useMemo(() => getDisassemblyAssistant(), [])

  const split = useMemo(() => (initial ? splitDraftLines(initial.lines) : null), [initial])
  const form = useDisassemblyForm({
    spec,
    initialHeader: initial?.header ?? newHeader(spec, todayIso()),
    initialFinished: split && split.finished.length > 0 ? split.finished : [newFinishedLine(spec)],
    initialComponents: split && split.components.length > 0 ? split.components : [newComponentLine(spec)],
    initialBomId: initial?.header.metadata.bom_id ? Number(initial.header.metadata.bom_id) : null,
  })
  const {
    draft,
    costBasis,
    costTouched,
    applyCosts,
    setDefaultWarehouse,
    hydrateItems,
    patchHeader,
    updateLine,
    pickItem,
    clearItem,
    addLine,
    removeLine,
    setLines,
    markCostTouched,
    setCostBasis,
    setBom,
    markClean,
    bomName,
    bomId,
    bomQty,
    dirty,
  } = form

  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [busy, setBusy] = useState<'save' | 'post' | null>(null)
  const [apiError, setApiError] = useState<{ message: string; refreshable?: boolean } | null>(null)
  const [negative, setNegative] = useState<NegativeStockDetail[] | null>(null)
  const [overrideNegative, setOverrideNegative] = useState(false)
  const [warnings, setWarnings] = useState<PostingWarning[]>([])
  const [showIssues, setShowIssues] = useState(false)
  const [posted, setPosted] = useState<InventoryDocument | null>(null)
  const [dialog, setDialog] = useState<'bom' | 'recent' | 'copy' | 'scan' | 'import' | 'templates' | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [leaveTo, setLeaveTo] = useState<{ to: string; proceed: () => void } | null>(null)
  const dateRef = useRef<HTMLInputElement>(null)

  const canOverrideNegative = can('stock.negative_override')
  const canPost = can(permissionKeysFor('post', spec.code))
  const canSave = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)
  const canReadBoms = can(['masters.bill_of_materials.read', 'masters.items.read'])
  const canConfigureNumbering = can('settings.read')
  const readOnly = busy !== null || posted !== null

  // ---- reference data prefill ------------------------------------------------
  useEffect(() => {
    if (documentId || defaultWarehouseId === null) return
    setDefaultWarehouse(defaultWarehouseId)
  }, [defaultWarehouseId, documentId, setDefaultWarehouse])

  // ---- hydrate stored lines --------------------------------------------------
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
        hydrateItems(new Map(items.map((it) => [it.item_id, it])))
      })
      .catch(() => {
        /* the stored unit still works; the pickers just stay minimal */
      })
    return () => controller.abort()
  }, [initial, hydrateItems])

  // ---- live availability -----------------------------------------------------
  const availabilityEntries = useMemo<AvailabilityEntry[]>(() => {
    const out: AvailabilityEntry[] = []
    for (const line of draft.finished) {
      if (!line.item_id) continue
      const qty = toNumber(line.qty)
      if (qty === null || qty <= 0) continue
      out.push({
        key: line.key,
        line: {
          item_id: line.item_id,
          warehouse_id: line.warehouse_id ?? draft.header.default_warehouse_id ?? null,
          batch_id: line.batch_id,
          qty: qty * (line.units.find((u) => u.unit_id === line.unit_id)?.conversion_factor ?? 1),
        },
      })
    }
    return out
  }, [draft.finished, draft.header.default_warehouse_id])
  const { results: availability, checking } = useAvailability(availabilityEntries, true)

  // ---- live costing ----------------------------------------------------------
  const costItemIds = useMemo(
    () =>
      [...draft.finished, ...draft.components]
        .map((l) => l.item_id)
        .filter((id): id is number => id !== null),
    [draft.finished, draft.components],
  )
  const costs = useUnitCosts({
    itemIds: costItemIds,
    asOf: draft.header.document_date,
    method: policy.valuationMethod ?? undefined,
    warehouseId: draft.header.default_warehouse_id,
  })
  const unitCostLookup = useCallback((itemId: number) => costs.costs.get(itemId) ?? null, [costs.costs])
  const parentValue = useMemo(() => parentValueOf(draft.finished, unitCostLookup), [draft.finished, unitCostLookup])

  // Fill in the unit cost of every component the user has not typed one for. Idempotent — each
  // basis computes from quantities and the valuation read, never from the rate it is writing —
  // so this settles after one pass instead of looping.
  useEffect(() => {
    if (costBasis === 'manual' || costs.loading) return
    const next = applyCostBasis(draft.components, costBasis, parentValue, unitCostLookup).map((line, i) =>
      costTouched.has(line.key) ? draft.components[i] : line,
    )
    if (next.some((line, i) => line.valuation_rate !== draft.components[i].valuation_rate)) applyCosts(next)
  }, [draft.components, costBasis, costTouched, applyCosts, parentValue, unitCostLookup, costs.loading])

  // ---- bills of materials for the picked parent ------------------------------
  const parentItemId = draft.finished.find((l) => l.item_id !== null)?.item_id ?? null
  const parentLine = draft.finished.find((l) => l.item_id !== null) ?? null
  const bomQuery = useQuery(
    (signal) => (parentItemId ? lookupApi.boms('', { finishedItemId: parentItemId, signal }) : Promise.resolve(null)),
    [parentItemId, canReadBoms],
    { enabled: parentItemId !== null && canReadBoms },
  )
  const bomCount = parentItemId === null ? null : bomQuery.loading ? null : (bomQuery.data?.data.length ?? 0)

  // The unit a line is expressed in: the item's own unit list first (it is the one the row is
  // using), falling back to the cached form options.
  const unitSymbolForLine = useCallback(
    (unitId: number | null): string => {
      if (unitId === null) return ''
      const fromDraft = [...draft.finished, ...draft.components].flatMap((l) => l.units).find((u) => u.unit_id === unitId)
      return fromDraft?.unit_symbol ?? fromDraft?.unit_name ?? unitSymbol(unitId)
    },
    [draft.finished, draft.components, unitSymbol],
  )

  // ---- derived ---------------------------------------------------------------
  const issues = useMemo(
    () =>
      validateDisassembly({
        draft,
        availability,
        negativeStockPolicy: policy.negativeStockPolicy,
        canOverrideNegative,
        overrideNegative,
        fyRange,
        lockedUpto: policy.lockedUpto,
        allowedWarehouseIds: allowedWarehouses ?? [],
      }),
    [draft, availability, policy.negativeStockPolicy, policy.lockedUpto, canOverrideNegative, overrideNegative, fyRange, allowedWarehouses],
  )
  const errors = useMemo(() => errorsOf(issues), [issues])
  const warningIssues = useMemo(() => warningsOf(issues), [issues])
  const perField = useMemo(() => (showIssues ? fieldErrors(issues) : fieldErrors(warningIssues)), [issues, warningIssues, showIssues])
  const perHeader = useMemo(() => (showIssues ? headerErrors(issues) : new Map()), [issues, showIssues])
  const duplicates = useMemo(() => duplicateComponentKeys(draft.components), [draft.components])
  const counts = useMemo(() => disassemblyCounts(draft), [draft])
  const impact = useMemo(() => stockImpact(draft, unitSymbolForLine), [draft, unitSymbolForLine])
  const summary = useMemo(() => valueSummary(draft, unitCostLookup), [draft, unitCostLookup])
  const insights = useMemo(
    () =>
      buildInsights({
        draft,
        availability,
        checkingAvailability: checking,
        bomName,
        bomsForParent: bomCount,
        costsLoading: costs.loading,
        itemsWithoutCost: costs.unknown.length,
      }),
    [draft, availability, checking, bomName, bomCount, costs.loading, costs.unknown.length],
  )
  const offending = useMemo(
    () => new Set(negative ? offendingDraftKeys(draft.finished, negative) : []),
    [negative, draft.finished],
  )

  // ---- unsaved changes -------------------------------------------------------
  useUnsavedChanges({
    when: dirty && posted === null,
    onBlocked: (to, proceed) => setLeaveTo({ to, proceed }),
  })

  // ---- line helpers ----------------------------------------------------------
  const updateFinished = useCallback((key: string, patch: Partial<LineDraft>) => updateLine('finished', key, patch), [updateLine])
  const updateComponent = useCallback((key: string, patch: Partial<LineDraft>) => updateLine('component', key, patch), [updateLine])
  const pickFinished = useCallback((key: string, row: ItemSearchRow) => pickItem('finished', key, row, draft.header.default_warehouse_id), [pickItem, draft.header.default_warehouse_id])
  const pickComponent = useCallback((key: string, row: ItemSearchRow) => pickItem('component', key, row, draft.header.default_warehouse_id), [pickItem, draft.header.default_warehouse_id])
  const clearFinished = useCallback((key: string) => clearItem('finished', key), [clearItem])
  const clearComponent = useCallback((key: string) => clearItem('component', key), [clearItem])
  const removeFinished = useCallback((key: string) => removeLine('finished', key), [removeLine])
  const removeComponent = useCallback((key: string) => removeLine('component', key), [removeLine])

  const addComponent = useCallback(() => {
    addLine('component', { warehouse_id: draft.header.default_warehouse_id })
  }, [addLine, draft.header.default_warehouse_id])

  const addFinished = useCallback(() => {
    addLine('finished', { warehouse_id: draft.header.default_warehouse_id })
  }, [addLine, draft.header.default_warehouse_id])

  /** Adds a scanned or imported item to the first free row of a side, else to a new one. */
  const addItem = useCallback(
    (role: DisassemblyRole, item: ItemSearchRow, qty?: number) => {
      const lines = role === 'finished' ? draft.finished : draft.components
      const free = lines.find((l) => l.item_id === null)
      const key = free ? free.key : addLine(role, { warehouse_id: draft.header.default_warehouse_id })
      pickItem(role, key, item, draft.header.default_warehouse_id)
      updateLine(role, key, { qty: String(qty ?? 1) })
    },
    [draft.finished, draft.components, draft.header.default_warehouse_id, addLine, pickItem, updateLine],
  )

  // ---- BOM -------------------------------------------------------------------
  const applyBomPlan = useCallback(
    async (plan: BomDisassemblyPlan, options: { setFinished: boolean }) => {
      const warehouse = draft.header.default_warehouse_id
      const ids = [...new Set([...plan.components.map((c) => c.item_id), plan.finished_item_id])]
      // The BOM knows an item id and a unit; only the item master knows the unit list and whether
      // the item is batch or serial controlled, which the pickers below need.
      let byId = new Map<number, ItemSearchRow>()
      try {
        byId = new Map((await lookupApi.itemsByIds(ids)).map((it) => [it.item_id, it]))
      } catch {
        /* fall back to what the BOM itself carries */
      }
      const componentLines = plan.components.map((c) => {
        const item = byId.get(c.item_id)
        const units = item
          ? (item.units ?? []).map((u) => ({
              unit_id: u.unit_id,
              unit_symbol: u.unit_symbol,
              unit_name: u.unit_name,
              conversion_factor: Number(u.conversion_factor) || 1,
              is_default: Number(u.is_default) === 1,
            }))
          : c.unit_id
            ? [{ unit_id: c.unit_id, unit_symbol: c.unit_symbol, conversion_factor: 1, is_default: true }]
            : []
        return newComponentLine(spec, {
          item_id: c.item_id,
          item_name: item?.print_name || item?.item_name || c.item_name || `Item #${c.item_id}`,
          item_sku: item?.item_sku ?? c.item_sku ?? null,
          track_batch: item ? Number(item.track_batch) === 1 : false,
          track_serial: item ? Number(item.track_serial) === 1 : false,
          units,
          unit_id: c.unit_id ?? units.find((u) => u.is_default)?.unit_id ?? units[0]?.unit_id ?? null,
          warehouse_id: warehouse,
          qty: String(c.qty),
          origin: 'bom',
          metadata: { bom_line_id: c.bom_line_id, bom_id: plan.bom_id, line_kind: 'component' },
        })
      })
      setLines('component', componentLines)
      if (options.setFinished) {
        const item = byId.get(plan.finished_item_id)
        const units = item
          ? (item.units ?? []).map((u) => ({
              unit_id: u.unit_id,
              unit_symbol: u.unit_symbol,
              unit_name: u.unit_name,
              conversion_factor: Number(u.conversion_factor) || 1,
              is_default: Number(u.is_default) === 1,
            }))
          : plan.yield_unit_id
            ? [{ unit_id: plan.yield_unit_id, unit_symbol: plan.yield_unit_symbol, conversion_factor: 1, is_default: true }]
            : []
        setLines('finished', [
          newFinishedLine(spec, {
            item_id: plan.finished_item_id,
            item_name: item?.print_name || item?.item_name || plan.finished_item_name || `Item #${plan.finished_item_id}`,
            item_sku: item?.item_sku ?? plan.finished_item_sku ?? null,
            track_batch: item ? Number(item.track_batch) === 1 : false,
            track_serial: item ? Number(item.track_serial) === 1 : false,
            units,
            unit_id: plan.yield_unit_id ?? units.find((u) => u.is_default)?.unit_id ?? units[0]?.unit_id ?? null,
            warehouse_id: warehouse,
            qty: String(Number((plan.yield_qty * plan.scale).toFixed(4))),
          }),
        ])
      }
      setBom({ id: plan.bom_id, name: plan.bom_name, qty: Number((plan.yield_qty * plan.scale).toFixed(4)) })
      toast.success(`${componentLines.length} component${componentLines.length === 1 ? '' : 's'} loaded from ${plan.bom_name}. Review before posting.`)
    },
    [draft.header.default_warehouse_id, setLines, setBom, spec, toast],
  )

  /**
   * "Auto-fill" is the BOM path today. The assistant that would suggest components from history
   * is not connected (see assistant.ts), and a button that fabricates rows is worse than one that
   * says what it can do — so this opens the BOM dialog and the AI copy stays honest about it.
   */
  const autoFillDisabled = parentItemId === null || bomCount === 0 || !canReadBoms
  const autoFillHint = !canReadBoms
    ? 'Filling components from a bill of materials needs the bill-of-materials read permission.'
    : parentItemId === null
      ? 'Pick the finished product first.'
      : bomCount === 0
        ? 'This item has no bill of materials to fill from.'
        : 'Fill the components from this item’s bill of materials.'

  /**
   * The parent quantity changed after a BOM was loaded.
   *
   * Rescaling is offered, never done silently: the components stay editable after a load, so
   * quietly overwriting a quantity somebody typed would lose their correction. The BOM is fetched
   * again rather than multiplied out, so a bill revised in Masters while this document was open
   * is the one that applies — §50's "BOM revised after document load".
   */
  const parentBaseQtyNow = useMemo(() => totalBaseQty(draft.finished), [draft.finished])
  const [rescaling, setRescaling] = useState(false)
  const needsRescale = bomId !== null && bomQty !== null && bomQty > 0 && parentBaseQtyNow > 0 && parentBaseQtyNow !== bomQty

  const rescaleFromBom = useCallback(async () => {
    if (bomId === null) return
    setRescaling(true)
    try {
      const bom = await lookupApi.bom(bomId)
      await applyBomPlan(planFromBom(bom, parentBaseQtyNow), { setFinished: false })
    } catch (err) {
      setApiError(describeError(err, 'save'))
    } finally {
      setRescaling(false)
    }
  }, [bomId, parentBaseQtyNow, applyBomPlan])

  // ---- copy / template -------------------------------------------------------
  /**
   * Copy the LINES of a document that already posted.
   *
   * Never the number, the date or the status — those belong to that document. Never the batches
   * or the serial numbers either: those are specific pieces of stock that this document already
   * consumed, and carrying them into a new draft would post the same serial out twice.
   */
  const copyDocument = useCallback(
    async (id: number) => {
      const doc = await documentsApi.get(id)
      const finished: LineDraft[] = []
      const components: LineDraft[] = []
      for (const l of doc.lines) {
        if (l.item_id === null) continue
        const base: Partial<LineDraft> = {
          item_id: l.item_id,
          item_name: l.item_label ?? l.item_name ?? `Item #${l.item_id}`,
          item_sku: l.item_sku ?? null,
          units: l.unit_id
            ? [{ unit_id: l.unit_id, unit_symbol: l.unit_symbol ?? null, unit_name: l.unit_name ?? null, conversion_factor: Number(l.conversion_factor) || 1, is_default: true }]
            : [],
          unit_id: l.unit_id,
          warehouse_id: l.warehouse_id ?? draft.header.default_warehouse_id,
          qty: String(l.qty ?? ''),
          description: l.description ?? '',
        }
        if (l.direction === 'out') finished.push(newFinishedLine(spec, base))
        else components.push(newComponentLine(spec, base))
      }
      if (finished.length > 0) setLines('finished', finished)
      if (components.length > 0) setLines('component', components)
      try {
        const items = await lookupApi.itemsByIds([...new Set(doc.lines.map((l) => l.item_id))])
        hydrateItems(new Map(items.map((it) => [it.item_id, it])))
      } catch {
        /* pickers stay minimal */
      }
      toast.success(`Lines copied from ${doc.document_no ?? `#${doc.document_id}`}. Check the quantities and batches before posting.`)
    },
    [draft.header.default_warehouse_id, setLines, hydrateItems, spec, toast],
  )

  const applyTemplate = useCallback(
    async (template: DisassemblyTemplate) => {
      const warehouse = draft.header.default_warehouse_id
      const ids = [...new Set([...template.components.map((c) => c.item_id), template.finished_item_id].filter((id): id is number => id !== null))]
      let byId = new Map<number, ItemSearchRow>()
      try {
        byId = new Map((await lookupApi.itemsByIds(ids)).map((it) => [it.item_id, it]))
      } catch {
        /* the template's own names still show */
      }
      const build = (role: DisassemblyRole, itemId: number, name: string, sku: string | null, qty: number, unitId: number | null) => {
        const item = byId.get(itemId)
        const units = item
          ? (item.units ?? []).map((u) => ({
              unit_id: u.unit_id,
              unit_symbol: u.unit_symbol,
              unit_name: u.unit_name,
              conversion_factor: Number(u.conversion_factor) || 1,
              is_default: Number(u.is_default) === 1,
            }))
          : []
        const make = role === 'finished' ? newFinishedLine : newComponentLine
        return make(spec, {
          item_id: itemId,
          item_name: item?.print_name || item?.item_name || name,
          item_sku: item?.item_sku ?? sku,
          track_batch: item ? Number(item.track_batch) === 1 : false,
          track_serial: item ? Number(item.track_serial) === 1 : false,
          units,
          unit_id: unitId ?? units.find((u) => u.is_default)?.unit_id ?? units[0]?.unit_id ?? null,
          warehouse_id: warehouse,
          qty: String(qty),
        })
      }
      if (template.finished_item_id !== null) {
        setLines('finished', [build('finished', template.finished_item_id, template.finished_item_name ?? '', null, template.finished_qty, null)])
      }
      setLines(
        'component',
        template.components.map((c) => build('component', c.item_id, c.item_name, c.item_sku, c.qty, c.unit_id)),
      )
      toast.success(`Template “${template.name}” applied. Review before posting.`)
    },
    [draft.header.default_warehouse_id, setLines, spec, toast],
  )

  const currentTemplate = useMemo(() => {
    const parent = draft.finished.find((l) => l.item_id !== null)
    const comps = activeLines(draft.components).filter((l) => l.item_id !== null)
    if (comps.length === 0) return null
    return {
      name: parent?.item_name ? `${parent.item_name} teardown` : 'Disassembly template',
      finished_item_id: parent?.item_id ?? null,
      finished_item_name: parent?.item_name ?? null,
      finished_qty: toNumber(parent?.qty) ?? 1,
      components: comps.map((l) => ({
        item_id: l.item_id as number,
        item_name: l.item_name,
        item_sku: l.item_sku,
        qty: toNumber(l.qty) ?? 1,
        unit_id: l.unit_id,
      })),
    }
  }, [draft.finished, draft.components])

  const applyImport = useCallback(
    (rows: ResolvedImportRow[]) => {
      for (const row of rows) {
        if (!row.item) continue
        addItem('component', row.item, row.qty ?? 1)
      }
      toast.success(`${rows.length} component${rows.length === 1 ? '' : 's'} imported. Review the quantities before posting.`)
    },
    [addItem, toast],
  )

  // ---- save / post -----------------------------------------------------------
  const focusFirstError = useCallback(() => {
    setShowIssues(true)
    if (errors.some((e) => e.scope === 'header')) dateRef.current?.focus()
  }, [errors])

  const submit = useCallback(
    async (post: boolean, intent: PostIntent = 'stay') => {
      setApiError(null)
      setWarnings([])
      if (!post) setNegative(null)
      // Posting runs every rule. A draft runs only the ones the server would refuse the draft
      // over — the header, an item on every row that carries data, and a quantity above zero
      // (DocumentService::create rejects `qty <= 0` whatever the status). Everything else, a
      // missing batch or a shortfall, is left for later: that is what a draft is for.
      const draftBlocking = ['f-item-', 'c-item-', 'f-qty-', 'c-qty-']
      const blocking = post ? errors : errors.filter((e) => e.scope === 'header' || draftBlocking.some((p) => e.id.startsWith(p)))
      if (blocking.length > 0) {
        focusFirstError()
        return
      }
      if (!post && activeLines(draft.finished).length === 0 && activeLines(draft.components).length === 0) {
        setApiError({ message: 'Add at least one line before saving a draft.' })
        return
      }
      setBusy(post ? 'post' : 'save')
      let id = savedId
      try {
        const payload = disassemblyPayload(draft, spec, { bom_id: bomId ?? undefined, cost_basis: costBasis }, {})
        let doc = id ? await documentsApi.update(id, payload) : await documentsApi.create(payload)
        if (!id) {
          id = doc.document_id
          setSavedId(id)
        }
        if (!post) {
          markClean()
          toast.success(`Draft ${doc.document_no ?? `#${doc.document_id}`} saved. Stock is untouched until it posts.`)
          setBusy(null)
          return
        }
        doc = await documentsApi.post(doc.document_id, { negativeOverride: overrideNegative && canOverrideNegative })
        markClean()
        setWarnings(doc.warnings ?? [])
        setPosted(doc)
        toast.success(`Disassembly ${doc.document_no ?? `#${doc.document_id}`} posted successfully.`)
        setBusy(null)
        if (intent === 'view') navigate(`/documents/${doc.document_id}`)
        else if (intent === 'print') navigate(`/documents/${doc.document_id}/print`)
        else if (intent === 'new') onCreateAnother()
      } catch (err) {
        const neg = parseNegativeStock(err)
        if (neg) {
          setNegative(neg)
          setApiError({ message: id ? `Draft #${id} is saved but could not be posted: not enough stock.` : 'Not enough stock to post this disassembly.' })
        } else {
          const friendly = describeError(err, post ? 'post' : 'save')
          setApiError(friendly)
          // The detail belongs in the console, not on a stores clerk's screen.
          console.error('[disassembly] submit failed', err)
        }
        setBusy(null)
      }
    },
    [errors, focusFirstError, savedId, draft, spec, bomId, costBasis, markClean, overrideNegative, canOverrideNegative, toast, navigate, onCreateAnother],
  )

  // ---- keyboard --------------------------------------------------------------
  const shortcuts = useMemo(
    () => ({
      'ctrl+s': (e: KeyboardEvent) => {
        e.preventDefault()
        if (canSave && !readOnly) void submit(false)
      },
      'ctrl+enter': (e: KeyboardEvent) => {
        e.preventDefault()
        if (canPost && !readOnly) void submit(true)
      },
      'alt+n': (e: KeyboardEvent) => {
        e.preventDefault()
        if (!readOnly) addComponent()
      },
      'alt+b': (e: KeyboardEvent) => {
        e.preventDefault()
        if (!readOnly && canReadBoms) setDialog('bom')
      },
    }),
    [canSave, canPost, canReadBoms, readOnly, submit, addComponent],
  )
  useKeyboardScope('form', shortcuts, { allowInInput: true })

  // ---- render ----------------------------------------------------------------
  const estimatedValue = summary.componentsValue
  const editing = documentId !== undefined
  const title = editing ? `Edit disassembly ${document?.document_no ?? `#${documentId}`}` : 'New disassembly'

  const quickActions = [
    { key: 'bom', label: 'Use BOM', icon: Workflow, onSelect: () => setDialog('bom'), disabled: readOnly || !canReadBoms, title: 'Load components from a bill of materials (Alt+B)' },
    { key: 'scan', label: 'Scan barcode', icon: ScanBarcode, onSelect: () => setDialog('scan'), disabled: readOnly, title: 'Add items with a barcode scanner' },
    { key: 'recent', label: 'Recent', icon: Clock, onSelect: () => setDialog('recent'), title: 'Recent disassemblies' },
    { key: 'copy', label: 'Copy document', icon: Copy, onSelect: () => setDialog('copy'), disabled: readOnly, title: 'Copy the lines of a previous disassembly' },
  ]

  return (
    <PageShell paddingBottom>
      <BreadcrumbHeader
        breadcrumbs={[...BREADCRUMBS, { label: editing ? (document?.document_no ?? 'Edit') : 'New disassembly' }]}
        title={title}
        description="Break a finished product into its components and update stock instantly."
        icon={PackageOpen}
        escDirty={dirty}
        badge={
          editing && document ? <Badge tone="neutral" size="xs">{document.status.replace(/_/g, ' ').toLowerCase()}</Badge> : null
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => setAssistantOpen(true)}
              className="hidden items-center gap-2.5 rounded-xl border border-gray-200 bg-primary-light/60 px-3 py-1.5 text-left transition-colors hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30 xl:flex"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                <Sparkles className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold text-gray-900">Aicountly AI</span>
                <span className="block truncate text-[11px] text-gray-500">Check availability, load a BOM, find the right warehouse…</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
            </button>
            <Button variant="secondary" size="sm" icon={Sparkles} className="xl:hidden" onClick={() => setAssistantOpen(true)}>
              AI
            </Button>
            <Button variant="secondary" size="sm" icon={LayoutTemplate} onClick={() => setDialog('templates')} disabled={readOnly}>
              Templates
            </Button>
            <Button variant="secondary" size="sm" icon={FileUp} onClick={() => setDialog('import')} disabled={readOnly}>
              Import
            </Button>
            <MenuButton
              label="More actions"
              icon={MoreHorizontal}
              variant="secondary"
              size="sm"
              actions={[
                { key: 'recent', label: 'Recent disassemblies', icon: Clock, onSelect: () => setDialog('recent') },
                { key: 'copy', label: 'Copy an existing document', icon: Copy, onSelect: () => setDialog('copy'), disabled: readOnly },
                { key: 'scan', label: 'Scan barcode', icon: ScanBarcode, onSelect: () => setDialog('scan'), disabled: readOnly },
                { key: 'list', label: 'All disassemblies', icon: Workflow, onSelect: () => navigate('/documents?document_type=DISASSEMBLY'), separated: true },
              ]}
            />
          </>
        }
      />

      {refError ? <Notice kind="warning">{refError}</Notice> : null}

      {posted ? (
        <Notice
          kind="success"
          title={`Disassembly ${posted.document_no ?? `#${posted.document_id}`} posted.`}
          actions={
            <>
              <Link className="text-[12px] font-semibold text-primary hover:underline" to={`/documents/${posted.document_id}`} data-unsaved-allow>
                View document
              </Link>
              <Button size="xs" variant="secondary" onClick={onCreateAnother}>
                Create another
              </Button>
            </>
          }
        >
          {counts.componentLines} component{counts.componentLines === 1 ? '' : 's'} were received and {counts.finishedLines} finished product
          {counts.finishedLines === 1 ? ' was' : 's were'} consumed. Stock and valuation are updated.
        </Notice>
      ) : null}

      {showIssues && errors.length > 0 ? (
        <Notice kind="error" title={`${errors.length} thing${errors.length === 1 ? '' : 's'} to fix before posting`}>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {errors.slice(0, 8).map((issue) => (
              <li key={issue.id}>{issue.message}</li>
            ))}
            {errors.length > 8 ? <li>…and {errors.length - 8} more.</li> : null}
          </ul>
        </Notice>
      ) : null}

      {apiError ? (
        <Notice
          kind="error"
          actions={
            apiError.refreshable ? (
              <Button size="xs" variant="secondary" icon={RefreshCw} onClick={() => window.location.reload()}>
                Reload
              </Button>
            ) : null
          }
        >
          {apiError.message}
        </Notice>
      ) : null}

      {negative ? (
        <Notice kind="error" title="Insufficient stock">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {negative.map((d, i) => (
              <li key={`${d.item_id}-${d.warehouse_id}-${i}`}>
                {d.item_name ?? `Item #${d.item_id}`}: on hand {formatQty(d.on_hand)}, required {formatQty(d.required)}, short by{' '}
                <strong>{formatQty(d.short_by)}</strong>
              </li>
            ))}
          </ul>
          {canOverrideNegative ? (
            <label className="mt-2 flex items-center gap-2 text-[12px]">
              <input type="checkbox" checked={overrideNegative} onChange={(e) => setOverrideNegative(e.target.checked)} />
              Post anyway and let stock go negative
            </label>
          ) : (
            <p className="mt-1 text-[12px]">
              Reduce the quantity or receive stock first. Posting into negative stock needs the override permission.
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

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3">
          <DocumentDetailsCard
            header={draft.header}
            warehouses={warehouses}
            errors={perHeader}
            onChange={patchHeader}
            documentNo={document?.document_no ?? null}
            canConfigureNumbering={canConfigureNumbering}
            disabled={readOnly}
            dateRef={dateRef}
          />

          <div className="space-y-3">
            <FinishedProductSection
              lines={draft.finished}
              warehouses={warehouses}
              defaultWarehouseId={draft.header.default_warehouse_id}
              availability={availability}
              checkingAvailability={checking}
              fieldErrors={perField}
              bomCount={bomCount}
              onLoadBom={() => setDialog('bom')}
              onUpdate={updateFinished}
              onPick={pickFinished}
              onClear={clearFinished}
              onAdd={addFinished}
              onRemove={removeFinished}
              disabled={readOnly}
            />

            <ComponentsSection
              lines={draft.components}
              warehouses={warehouses}
              defaultWarehouseId={draft.header.default_warehouse_id}
              fieldErrors={perField}
              duplicateKeys={duplicates}
              currencyCode={policy.currencyCode}
              costBasis={costBasis}
              costsLoading={costs.loading}
              onCostBasisChange={setCostBasis}
              onMergeDuplicates={() => setLines('component', mergeDuplicateComponents(draft.components))}
              onUpdate={updateComponent}
              onCostEdited={markCostTouched}
              onPick={pickComponent}
              onClear={clearComponent}
              onAdd={addComponent}
              onRemove={removeComponent}
              onAutoFill={() => setDialog('bom')}
              autoFillDisabled={autoFillDisabled}
              autoFillLabel={autoFillHint}
              disabled={readOnly}
              notice={
                needsRescale ? (
                  <div className="flex flex-wrap items-center gap-2 border-b border-amber-100 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                    <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>
                      The quantity to disassemble is now {formatQty(parentBaseQtyNow)}; these components were scaled for{' '}
                      {formatQty(bomQty)}.
                    </span>
                    <Button size="xs" variant="secondary" loading={rescaling} disabled={readOnly} onClick={() => void rescaleFromBom()} className="ml-auto">
                      Rescale from {bomName}
                    </Button>
                  </div>
                ) : null
              }
            />
          </div>

          <SummaryBar counts={counts} text={summaryText(draft)} estimatedValue={estimatedValue} currencyCode={policy.currencyCode} />

          {offending.size > 0 ? (
            <p className="text-[12px] text-red-600">The highlighted finished rows are the ones the server refused for want of stock.</p>
          ) : null}
        </div>

        <aside className="space-y-3 xl:sticky xl:top-3">
          <QuickActionsCard actions={quickActions} />
          <AiInsightsCard
            insights={insights}
            assistantAvailable={assistant.available}
            assistantReason={assistant.unavailableReason}
            canAutoFill={!autoFillDisabled && !readOnly}
            autoFillHint={autoFillHint}
            onAutoFill={() => setDialog('bom')}
            onOpenAssistant={() => setAssistantOpen(true)}
          />
          <StockImpactCard groups={impact} posted={posted !== null} />
          <ValueSummaryCard
            summary={summary}
            currencyCode={policy.currencyCode}
            method={policy.valuationMethod}
            loading={costs.loading}
            error={costs.error}
          />
        </aside>
      </div>

      <StickyActionBar
        status={
          <span className="text-[12px] text-gray-500">
            {refLoading && warehouses.length === 0 ? 'Loading warehouses…' : savedId ? `Draft #${savedId}` : 'Not saved yet'}
            {warningIssues.length > 0 && !showIssues ? ` · ${warningIssues.length} note${warningIssues.length === 1 ? '' : 's'}` : ''}
          </span>
        }
        totals={
          <>
            <ActionTotal label="Components" value={String(counts.componentLines)} />
            <ActionTotal label="Qty in" value={formatQty(counts.qtyIn, '0')} />
            <ActionTotal label="Qty out" value={formatQty(counts.qtyOut, '0')} />
            <ActionTotal label="Est. value" value={formatCurrency(estimatedValue, policy.currencyCode ?? undefined)} strong />
          </>
        }
      >
        <Link
          to={savedId ? `/documents/${savedId}` : '/documents'}
          className="inline-flex h-8 items-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 no-underline transition-colors hover:border-primary/40 hover:text-primary"
        >
          Cancel
        </Link>
        <Button
          variant="secondary"
          icon={Save}
          size="md"
          loading={busy === 'save'}
          disabled={readOnly || !canSave}
          onClick={() => void submit(false)}
          title="Save as draft (Ctrl+S)"
        >
          Save as draft
        </Button>
        {canPost ? (
          <div className="flex items-stretch">
            <Button
              size="md"
              icon={Send}
              loading={busy === 'post'}
              disabled={readOnly || (!canSave && !savedId)}
              onClick={() => void submit(true)}
              className="rounded-r-none"
              title="Save and post (Ctrl+Enter)"
            >
              {negative && overrideNegative ? 'Post with override' : 'Save & post'}
            </Button>
            <MenuButton
              label="More posting actions"
              icon={ChevronDown}
              variant="primary"
              size="md"
              className="rounded-l-none border-l border-white/25 px-2"
              actions={[
                { key: 'view', label: 'Post & view document', icon: Send, onSelect: () => void submit(true, 'view') },
                { key: 'print', label: 'Post & print', icon: Printer, onSelect: () => void submit(true, 'print') },
                { key: 'new', label: 'Post & new', icon: Copy, onSelect: () => void submit(true, 'new') },
              ]}
            />
          </div>
        ) : null}
      </StickyActionBar>

      {/* ---- dialogs ---- */}
      <BomDialog
        open={dialog === 'bom'}
        onClose={() => setDialog(null)}
        finishedItemId={parentItemId}
        finishedItemName={parentLine?.item_name ?? null}
        defaultQty={toNumber(parentLine?.qty) ?? 0}
        onApply={applyBomPlan}
      />
      <RecentDialog open={dialog === 'recent' || dialog === 'copy'} mode={dialog === 'copy' ? 'copy' : 'browse'} onClose={() => setDialog(null)} onCopy={copyDocument} />
      <ScanDialog
        open={dialog === 'scan'}
        onClose={() => setDialog(null)}
        warehouseId={draft.header.default_warehouse_id}
        hasFinished={parentItemId !== null}
        onScanned={(role, item) => addItem(role, item)}
      />
      <ImportDialog open={dialog === 'import'} onClose={() => setDialog(null)} warehouseId={draft.header.default_warehouse_id} onApply={applyImport} />
      <TemplatesDialog
        open={dialog === 'templates'}
        onClose={() => setDialog(null)}
        cmpId={scope?.cmp_id ?? null}
        memberUuid={member?.uuid ?? null}
        current={currentTemplate}
        onApply={(t) => void applyTemplate(t)}
      />
      <AssistantDrawer
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        available={assistant.available}
        unavailableReason={assistant.unavailableReason}
        insights={insights}
        summary={summaryText(draft)}
        onLoadBom={() => setDialog('bom')}
        onAutoFill={() => setDialog('bom')}
        onScan={() => setDialog('scan')}
        onCopyDocument={() => setDialog('copy')}
        autoFillDisabled={autoFillDisabled}
        autoFillHint={autoFillHint}
      />
      <ConfirmDialog
        open={leaveTo !== null}
        title="Leave without saving?"
        message="You have unsaved changes on this disassembly. Leaving now discards them."
        confirmLabel="Leave"
        danger
        onConfirm={() => {
          const target = leaveTo
          setLeaveTo(null)
          markClean()
          target?.proceed()
        }}
        onCancel={() => setLeaveTo(null)}
      />
    </PageShell>
  )
}

function ActionTotal({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <span className={cx('tabular-nums', strong ? 'text-sm font-bold text-gray-900' : 'text-sm font-semibold text-gray-800')}>{value}</span>
    </div>
  )
}
