import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  Activity,
  ClipboardList,
  Copy,
  History,
  Paperclip,
  Printer,
  Power,
  ScrollText,
  Trash2,
  Zap,
} from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Notice } from '../../components/Notice'
import { useBaseCurrencySymbol } from '../../hooks/useBaseCurrency'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { invalidateFormOptions, useFormOptions } from '../../hooks/useFormOptions'
import { useQuery } from '../../hooks/useQuery'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { useFormKeyboard } from '../../keyboard/usePageKeyboard'
import { P } from '../../services/access'
import { errorMessage, isApiError } from '../../services/api'
import { auditApi } from '../../services/auditApi'
import { inventoryAiService } from '../../services/inventoryAiService'
import type { ItemInsightInput, ItemInsightsResult, ItemSuggestion } from '../../services/inventoryAiService'
import { itemsApi } from '../../services/items'
import type { Item, ItemOpeningsResponse } from '../../services/items'
import { ErrorState } from '../../ui/ErrorState'
import type { MenuAction } from '../../ui/MenuButton'
import { PageShell } from '../../ui/shell/PageShell'
import { useToast } from '../../ui/ToastContext'
import { AIC, cx } from '../../ui/cx'
import { formatDateTime, toNumber } from '../../utils/format'
import { ItemAccountingCard } from './ItemAccountingCard'
import { ItemAdditionalCard } from './ItemAdditionalCard'
import { BarcodeScanDialog, barcodeScanSupported } from './BarcodeScanDialog'
import { ItemAiInsightsCard } from './ItemAiInsightsCard'
import { ItemAiSuggestDrawer } from './ItemAiSuggestDrawer'
import { ItemBasicDetailsCard } from './ItemBasicDetailsCard'
import { ItemClassificationCard } from './ItemClassificationCard'
import { ItemDuplicateNotice } from './ItemDuplicateNotice'
import { ItemEditHeader } from './ItemEditHeader'
import { ItemEditSkeleton } from './ItemEditSkeleton'
import { ItemMediaDocumentsCard } from './ItemMediaDocumentsCard'
import { ItemPreviewCard } from './ItemPreviewCard'
import { ItemPricingValuationCard } from './ItemPricingValuationCard'
import { ItemQuickLinksCard } from './ItemQuickLinksCard'
import type { QuickLink } from './ItemQuickLinksCard'
import { ItemRecentActivityCard } from './ItemRecentActivityCard'
import { ItemSectionNav } from './ItemSectionNav'
import { ItemStockLocationsCard } from './ItemStockLocationsCard'
import { ItemUnitsPackagingCard } from './ItemUnitsPackagingCard'
import { ItemViewDrawer } from './ItemViewDrawer'
import { ItemWizardBar } from './ItemWizardBar'
import { fieldId } from './ItemWorkspaceKit'
import {
  emptyItemForm,
  itemPayload,
  itemToForm,
  openingsPayload,
  validateItemForm,
} from './itemForm'
import type { ItemFormState, OpeningDraft } from './itemForm'
import type { InsightSection } from '../../services/inventoryAiService'
import { ITEM_SECTIONS, sectionDomId, sectionFromDomId, sectionOfField } from './itemSections'
import { useSectionSpy } from './useSectionSpy'
import { useDuplicateCheck } from './useDuplicateCheck'

const LIST = '/items'

interface Loaded {
  item: Item
  openings: ItemOpeningsResponse
}

/** Duplicating an item hands the next page a draft through router state. */
interface ItemRouteState {
  duplicate?: ItemFormState
}

const SECTION_DOM_IDS = ITEM_SECTIONS.map((s) => sectionDomId(s.id))

/**
 * Create / edit one item — identity, classification, units, valuation, tracking, stock levels,
 * opening stock, accounting and attributes — as one anchored workspace.
 *
 * ## What changed and what did not
 *
 * The business logic is the one this screen already had: the same `GET /v1/items/{id}` and
 * `/openings`, the same `validateItemForm`, the same `itemPayload`, the same re-cost confirmation
 * when a valuation method changes under posted movements, the same soft delete behind the same
 * permission, and the same `PUT /items/{id}/openings` issued only when an opening row was touched.
 * No endpoint was invented, no column was added and nothing about the Books boundary moved.
 *
 * What is new is the shape of the work: eight anchored sections under a sticky nav instead of one
 * long scroll, a contextual column that reads the draft (preview, deterministic insights, real
 * audit activity, links to the registers this item appears in), dirty tracking with a guard on the
 * way out, Ctrl+S, and validation that takes the reader to the field it is complaining about.
 *
 * Delete moved out of the header into More Actions. Two same-sized buttons, one of which soft
 * deletes a master that documents point at, is how an item gets deleted by somebody aiming at Save.
 */
export function ItemFormPage() {
  const { id } = useParams()
  const itemId = id && /^\d+$/.test(id) ? Number(id) : null
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const { scope, fy } = useCompany()
  const { can, loading: accessLoading } = useAccess()
  const canWrite = can(P.masters('items', 'write'))
  const canDelete = can(P.masters('items', 'delete'))
  const canReadAudit = can(P.auditRead)
  const { options, loading: optionsLoading, error: optionsError } = useFormOptions()
  const currency = useBaseCurrencySymbol()

  const resetKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${itemId ?? 'new'}` : null

  const loaded = useQuery(
    async (signal): Promise<Loaded | null> => {
      if (!itemId) return null
      const [item, openings] = await Promise.all([itemsApi.get(itemId, signal), itemsApi.openings(itemId, signal)])
      return { item, openings }
    },
    [itemId, scope?.cmp_id, scope?.fy_id],
    // `keepData` so a reload after a save does not blank the header while the fresh row is in
    // flight; `resetKey` so a company switch still drops the previous tenant's item immediately.
    { enabled: !!scope && itemId !== null, keepData: true, resetKey },
  )

  const [form, setForm] = useState<ItemFormState>(() => emptyItemForm())
  const [baseline, setBaseline] = useState<string | null>(null)
  const [initialised, setInitialised] = useState(false)
  const [openingsDirty, setOpeningsDirty] = useState(false)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [serverField, setServerField] = useState<string | null>(null)
  const [recostPrompt, setRecostPrompt] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [manageConversions, setManageConversions] = useState(false)
  const [viewOpen, setViewOpen] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<ItemSuggestion[]>([])
  const [suggestBusy, setSuggestBusy] = useState(false)
  const [insights, setInsights] = useState<ItemInsightsResult | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insightsTick, setInsightsTick] = useState(0)
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [duplicatesDismissed, setDuplicatesDismissed] = useState(false)
  /* Which section the phone is on. Ignored entirely on a wide screen, where every section
     is on the page at once and the nav is an anchor. */
  const [wizardSection, setWizardSection] = useState<InsightSection>('basic')

  /*
   * Which record is on screen.
   *
   * `/items/1` → `/items/2` and a company switch both keep this component mounted, so without a
   * reset the second item's data would arrive behind a form still holding the first one's values
   * and an `initialised` flag saying the job was done. Compared during render, like useQuery's own
   * reset, so the stale draft never reaches the screen.
   */
  const identity = `${scope?.cmp_id ?? 0}:${itemId ?? 'new'}`
  const lastIdentity = useRef(identity)
  if (lastIdentity.current !== identity) {
    lastIdentity.current = identity
    setInitialised(false)
    setBaseline(null)
    setTouched(false)
    setOpeningsDirty(false)
    setSaveError(null)
    setServerField(null)
    setInsights(null)
  }

  const effectiveFyId = loaded.data?.openings.effective_fy_id ?? 0

  useEffect(() => {
    if (initialised) return
    if (itemId === null) {
      if (!options) return
      // A duplicate arrives as a draft on the router state; anything else starts empty.
      const duplicate = (location.state as ItemRouteState | null)?.duplicate
      const next = duplicate ?? emptyItemForm(options.default_valuation_method)
      setForm(next)
      setBaseline(JSON.stringify(next))
      setManageConversions(next.unitLines.length > 0)
      setInitialised(true)
      return
    }
    if (loaded.data) {
      const next = itemToForm(loaded.data.item, loaded.data.openings.rows, loaded.data.openings.effective_fy_id)
      setForm(next)
      setBaseline(JSON.stringify(next))
      setManageConversions(next.unitLines.length > 0)
      setInitialised(true)
    }
  }, [itemId, loaded.data, options, initialised, location.state])

  const formJson = useMemo(() => JSON.stringify(form), [form])
  const dirty = initialised && baseline !== null && formJson !== baseline
  const readOnly = !canWrite
  const isStock = form.item_type === 'stock'

  const set = useCallback(<K extends keyof ItemFormState>(key: K, value: ItemFormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
  }, [])

  const setOpenings = useCallback((rows: OpeningDraft[]) => {
    setOpeningsDirty(true)
    setForm((f) => ({ ...f, openings: rows }))
  }, [])

  const errors = useMemo(() => (touched ? validateItemForm(form) : {}), [form, touched])
  const err = useCallback(
    (key: string): string | undefined => errors[key] ?? (serverField === key ? (saveError ?? undefined) : undefined),
    [errors, serverField, saveError],
  )

  const units = options?.units ?? []
  const baseUnit = units.find((u) => String(u.unit_id) === form.unit_id) ?? null
  const itemUnits = useMemo(() => {
    const ids = new Set<string>([form.unit_id, ...form.unitLines.map((l) => l.unit_id)].filter(Boolean))
    return units.filter((u) => ids.has(String(u.unit_id)))
  }, [units, form.unit_id, form.unitLines])
  const unitLabel = useCallback(
    (unitIdValue: number | null): string => {
      const unit = units.find((u) => u.unit_id === unitIdValue)
      return unit ? `${unit.unit_name}${unit.unit_symbol ? ` (${unit.unit_symbol})` : ''}` : '—'
    },
    [units],
  )

  const spy = useSectionSpy(SECTION_DOM_IDS, initialised)
  const { scrollTo, register: registerSection } = spy

  /*
   * Below 1024px the workspace walks its sections one at a time instead of stacking all eight.
   * `true` by default so a DOM without matchMedia — the test environment — renders the whole page
   * rather than one section and seven hidden ones.
   */
  const wideLayout = useMediaQuery('(min-width: 1024px)', true)
  const showSection = useCallback(
    (id: InsightSection): boolean => wideLayout || wizardSection === id,
    [wideLayout, wizardSection],
  )
  /* Hidden rather than unmounted: the card keeps its own state across steps, and the section
     elements stay registered with the spy for the moment the viewport widens again. */
  const sectionClass = useCallback((id: InsightSection) => (showSection(id) ? undefined : 'hidden'), [showSection])

  /** Bring a section forward on a narrow screen, where only one is on show. */
  const revealSection = useCallback(
    (id: InsightSection) => {
      if (wideLayout) {
        scrollTo(sectionDomId(id))
        return
      }
      setWizardSection(id)
      document.querySelector('.app-main')?.scrollTo({ top: 0, behavior: 'auto' })
    },
    [wideLayout, scrollTo],
  )

  /*
   * Items this company already has that look like the one being typed.
   *
   * Read-only and advisory: the API refuses a repeated name or SKU with a 409 of its own, so this
   * never gates the Save button — it just says so while the name is still cheap to change.
   */
  const { matches: duplicates } = useDuplicateCheck({ form, excludeItemId: itemId, enabled: !readOnly && initialised })

  // "Continue anyway" answers the duplicates on screen, not every duplicate this item will ever
  // have: a new name is a new question and has to be asked again.
  useEffect(() => {
    setDuplicatesDismissed(false)
  }, [form.item_name, form.item_sku, form.item_upc])

  /* ---------------------------------------------------------------------- */
  /* Insights                                                               */
  /* ---------------------------------------------------------------------- */

  const insightInput = useMemo<ItemInsightInput>(
    () => ({
      itemId,
      itemName: form.item_name,
      itemType: form.item_type,
      sku: form.item_sku,
      barcode: form.item_upc,
      hsnSac: form.hsn_sac,
      mrp: toNumber(form.mrp),
      standardCost: toNumber(form.standard_cost),
      itemGroupId: form.item_grp_id,
      stockCategoryId: form.stock_cat_id,
      brandId: form.brand_id,
      baseUnitId: form.unit_id,
      alternateUnits: form.unitLines.map((l) => ({ unitId: l.unit_id, factor: toNumber(l.conversion_factor) })),
      valuationMethod: form.valuation_method,
      trackBatch: form.track_batch,
      trackSerial: form.track_serial,
      trackExpiry: form.track_expiry,
      shelfLifeDays: toNumber(form.shelf_life_days),
      negativeStockPolicy: form.negative_stock_policy,
      minStockQty: toNumber(form.min_stock_qty),
      maxStockQty: toNumber(form.max_stock_qty),
      reorderPointQty: toNumber(form.reorder_point_qty),
      defaultWarehouseId: form.default_warehouse_id,
      activeWarehouseIds: (options?.warehouses ?? []).map((w) => w.warehouse_id),
      openings: form.openings.map((o) => ({
        unitId: o.unit_id,
        qty: toNumber(o.opening_qty),
        rate: toNumber(o.opening_valuation_rate),
      })),
      hasDescription: form.attributes.description.trim() !== '',
    }),
    [form, options, itemId],
  )

  // Debounced: the rules are cheap, but running and re-rendering them on every keystroke is work
  // nobody asked for, and an insight that changes under the cursor mid-word reads as a flicker.
  useEffect(() => {
    if (!initialised) return undefined
    const controller = new AbortController()
    let active = true
    const timer = setTimeout(() => {
      setInsightsLoading(true)
      inventoryAiService
        .getItemInsights(insightInput, controller.signal)
        .then((result) => {
          if (!active) return
          setInsights(result)
          setInsightsLoading(false)
        })
        .catch(() => {
          if (active) setInsightsLoading(false)
        })
    }, 350)
    return () => {
      active = false
      controller.abort()
      clearTimeout(timer)
    }
  }, [insightInput, initialised, insightsTick])

  /* ---------------------------------------------------------------------- */
  /* Recent activity — the real audit trail, deferred behind the item itself */
  /* ---------------------------------------------------------------------- */

  const activity = useQuery(
    (signal) => auditApi.entity('item', itemId as number, { limit: 5, sort: 'created_at', order: 'desc' }, signal),
    [itemId, scope?.cmp_id],
    { enabled: Boolean(scope && itemId && canReadAudit && initialised), keepData: true, resetKey },
  )

  /* ---------------------------------------------------------------------- */
  /* Save                                                                   */
  /* ---------------------------------------------------------------------- */

  /** Take the reader to the first thing that is wrong, rather than to a red banner about it. */
  const revealFirstError = useCallback(
    (found: Record<string, string>) => {
      for (const key of Object.keys(found)) {
        // On a narrow screen the field may be in a section that is not on show. Bring its section
        // forward first, then focus on the next frame — the element is display:none until then.
        const section = sectionOfField(key)
        if (section && !showSection(section)) {
          revealSection(section)
          setTimeout(() => {
            const later = document.getElementById(fieldId(key))
            later?.scrollIntoView({ block: 'center' })
            later?.focus({ preventScroll: true })
          }, 0)
          return
        }
        if (key.startsWith('unitLines.')) {
          scrollTo(sectionDomId('units'))
          return
        }
        if (key.startsWith('openings.')) {
          scrollTo(sectionDomId('stock'))
          return
        }
        const el = document.getElementById(fieldId(key))
        if (el) {
          const reduced =
            typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
          el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
          el.focus({ preventScroll: true })
          return
        }
      }
    },
    [scrollTo, showSection, revealSection],
  )

  const doSave = useCallback(
    async (recost: boolean) => {
      setTouched(true)
      const found = validateItemForm(form)
      if (Object.keys(found).length > 0) {
        setSaveError('Fix the highlighted fields.')
        setServerField(null)
        revealFirstError(found)
        return
      }
      setSaving(true)
      setSaveError(null)
      setServerField(null)
      try {
        const body = itemPayload(form, loaded.data?.item.attributes ?? null)
        if (recost) body.valuation_method_recost = true
        let savedId = itemId
        if (itemId) {
          await itemsApi.update(itemId, body)
        } else {
          const created = await itemsApi.create(body)
          savedId = created.item_id
        }
        if (savedId && isStock && (openingsDirty || itemId === null) && (form.openings.length > 0 || openingsDirty)) {
          const fyForOpenings = itemId ? effectiveFyId : (await itemsApi.openings(savedId)).effective_fy_id
          await itemsApi.saveOpenings(savedId, fyForOpenings, openingsPayload(form.openings))
        }
        invalidateFormOptions()
        // The draft that was saved becomes the new clean state, so the guard lets the user leave.
        setBaseline(JSON.stringify(form))
        setOpeningsDirty(false)
        setTouched(false)
        if (itemId) {
          toast.success('Item updated successfully')
          // Refresh the record behind the form — `updated_at`, the version, the audit trail — and
          // leave the form alone: `initialised` stays true, so nothing the user typed is replaced.
          loaded.reload()
          activity.reload()
          setInsightsTick((t) => t + 1)
        } else {
          toast.success('Item created')
          // Into the workspace for the item that now exists, rather than back to the list.
          navigate(`/items/${savedId}`, { replace: true })
        }
      } catch (error) {
        if (isApiError(error) && error.details?.requires === 'valuation_method_recost') {
          setRecostPrompt(true)
        } else {
          // The edits stay exactly where they are; only the message is new.
          setSaveError(errorMessage(error))
          const field = isApiError(error) ? error.field : null
          setServerField(field)
          if (field) {
            setTouched(true)
            revealFirstError({ [field]: '' })
          }
        }
      } finally {
        setSaving(false)
      }
    },
    [form, itemId, isStock, openingsDirty, effectiveFyId, loaded, activity, navigate, toast, revealFirstError],
  )

  /*
   * The camera scanner, where the browser has one.
   *
   * `BarcodeDetector` is Chrome and Edge; Safari and Firefox have nothing equivalent and no
   * library was added for this. So the button stays exactly where it was and says so honestly on
   * a device that cannot scan — the field is a plain text input either way, which is what a USB
   * scanner types into anyway.
   */
  const openScanner = useCallback(() => {
    if (barcodeScanSupported()) {
      setScanOpen(true)
      return
    }
    toast.info('This browser cannot scan with the camera — type or paste the barcode, or use a USB scanner.')
  }, [toast])

  useFormKeyboard({
    onSave: () => void doSave(false),
    saving,
    enabled: !readOnly && initialised && !viewOpen && !suggestOpen && !scanOpen,
  })

  useUnsavedChanges({
    when: dirty && !saving,
    onBlocked: useCallback((_to: string, proceed: () => void) => setPendingNav(() => proceed), []),
  })

  /* ---------------------------------------------------------------------- */
  /* Actions                                                                */
  /* ---------------------------------------------------------------------- */

  const remove = async () => {
    if (!itemId) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await itemsApi.remove(itemId)
      invalidateFormOptions()
      setBaseline(formJson) // nothing left to guard on the way out
      toast.success('Item deleted')
      navigate(LIST)
    } catch (error) {
      // The server refuses an item that documents or BOMs point at, and says why. That reason is
      // the useful part, so it is shown in the dialog rather than replaced with a generic line.
      setDeleteError(errorMessage(error))
    } finally {
      setDeleteBusy(false)
    }
  }

  const openSuggestions = async () => {
    setSuggestBusy(true)
    setSuggestOpen(true)
    try {
      const found = await inventoryAiService.getItemSuggestions({
        itemName: form.item_name,
        printName: form.print_name,
        alias: form.item_alias,
        sku: form.item_sku,
        description: form.attributes.description,
        tags: form.attributes.tags,
        groupName: options?.item_groups.find((g) => String(g.item_grp_id) === form.item_grp_id)?.grp_name ?? null,
        categoryName: options?.stock_categories.find((c) => String(c.stock_cat_id) === form.stock_cat_id)?.cat_name ?? null,
        brandName: options?.brands.find((b) => String(b.brand_id) === form.brand_id)?.brand_name ?? null,
        unitName: baseUnit?.unit_name ?? null,
        itemType: form.item_type,
        minStockQty: toNumber(form.min_stock_qty),
        safetyStockQty: toNumber(form.safety_stock_qty),
        reorderPointQty: toNumber(form.reorder_point_qty),
      })
      setSuggestions(found)
    } catch {
      setSuggestions([])
    } finally {
      setSuggestBusy(false)
    }
  }

  /** Applying fills the form in and nothing more — the user still has to save it. */
  const applySuggestions = (chosen: ItemSuggestion[]) => {
    setForm((f) => {
      let next = { ...f }
      for (const s of chosen) {
        if (s.field === 'description') next = { ...next, attributes: { ...next.attributes, description: s.suggested } }
        else if (s.field === 'tags')
          next = {
            ...next,
            attributes: { ...next.attributes, tags: s.suggested.split(',').map((t) => t.trim()).filter(Boolean) },
          }
        else next = { ...next, [s.field]: s.suggested }
      }
      return next
    })
    toast.info(`${chosen.length} ${chosen.length === 1 ? 'suggestion' : 'suggestions'} applied — review and save.`)
  }

  const duplicate = () => {
    const draft: ItemFormState = {
      ...form,
      item_name: `${form.item_name} (copy)`.trim(),
      // Both are unique per company; carrying them over guarantees a conflict on the first save.
      item_sku: '',
      item_upc: '',
      // Opening stock belongs to the item it was counted for, not to a copy of its settings.
      openings: [],
      unitLines: form.unitLines.map((l) => ({ ...l })),
    }
    setBaseline(formJson)
    navigate('/items/new', { state: { duplicate: draft } satisfies ItemRouteState })
  }

  const item = loaded.data?.item ?? null
  const onHand = item?.stock ? Number(item.stock.on_hand ?? 0) : null

  const moreActions = useMemo<MenuAction[]>(() => {
    if (!itemId) return []
    const actions: MenuAction[] = []
    if (canWrite) {
      actions.push({ key: 'duplicate', label: 'Duplicate item', icon: Copy, onSelect: duplicate })
      actions.push({
        key: 'toggle-active',
        label: form.is_active ? 'Mark inactive' : 'Mark active',
        icon: Power,
        onSelect: () => {
          set('is_active', !form.is_active)
          // Honest about what just happened: the switch moved, the record has not.
          toast.info(form.is_active ? 'Marked inactive — save to apply.' : 'Marked active — save to apply.')
        },
      })
    }
    if (can(P.report('stock_ledger'))) {
      actions.push({
        key: 'ledger',
        label: 'View stock ledger',
        icon: ScrollText,
        separated: actions.length > 0,
        onSelect: () => navigate(`/registers/stock-ledger?item_id=${itemId}`),
      })
      actions.push({
        key: 'movements',
        label: 'View transactions',
        icon: Activity,
        onSelect: () => navigate(`/registers/movement-register?item_id=${itemId}`),
      })
    }
    if (canReadAudit) {
      actions.push({
        key: 'audit',
        label: 'View audit trail',
        icon: ClipboardList,
        onSelect: () => navigate(`/audit?entity_type=item&entity_id=${itemId}`),
      })
    }
    actions.push({
      key: 'print',
      label: 'Print this item',
      icon: Printer,
      separated: true,
      onSelect: () => window.print(),
    })
    if (canDelete) {
      actions.push({
        key: 'delete',
        label: 'Delete item',
        icon: Trash2,
        danger: true,
        separated: true,
        onSelect: () => setConfirmDelete(true),
      })
    }
    return actions
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `duplicate` closes over the live form on purpose
  }, [itemId, canWrite, canDelete, canReadAudit, can, form.is_active, navigate, toast, formJson])

  const quickLinks = useMemo<QuickLink[]>(() => {
    if (!itemId) return []
    const links: QuickLink[] = []
    if (can(P.report('stock_ledger'))) {
      links.push({
        key: 'ledger',
        label: 'Stock ledger',
        icon: ScrollText,
        tone: 'sky',
        to: `/registers/stock-ledger?item_id=${itemId}`,
        hint: 'Every movement of this item with its running balance',
      })
      links.push({
        key: 'transactions',
        label: 'Transactions',
        icon: Activity,
        tone: 'primary',
        to: `/registers/movement-register?item_id=${itemId}`,
        hint: 'The movement register filtered to this item',
      })
    }
    if (can(P.report('valuation'))) {
      links.push({
        key: 'cost-history',
        label: 'Cost history',
        icon: History,
        tone: 'amber',
        to: `/valuation/cost-layers?item_id=${itemId}`,
        hint: 'Cost layers — what each receipt of this item cost',
      })
    }
    links.push({
      key: 'files',
      label: 'Attached files',
      icon: Paperclip,
      tone: 'violet',
      onClick: () => scrollTo(sectionDomId('media')),
      hint: 'Media and documents for this item',
    })
    return links
  }, [itemId, can, scrollTo])

  /* ---------------------------------------------------------------------- */
  /* Render                                                                 */
  /* ---------------------------------------------------------------------- */

  if (!accessLoading && !can(P.masters('items', 'read'))) {
    return (
      <PageShell>
        <ErrorState
          title="No access to items"
          description="Your Inventory access profile does not include the item master in this company. Ask an administrator to add it."
          onRetry={() => navigate('/dashboard')}
          retryLabel="Back to dashboard"
        />
      </PageShell>
    )
  }

  const notFound = itemId !== null && isApiError(loaded.error) && loaded.error.status === 404
  if (notFound) {
    return (
      <PageShell>
        <ErrorState
          title="Item not found"
          description={`No item #${itemId} in ${scope ? 'this company' : 'the selected company'}. It may have been deleted, or it may belong to another company.`}
          onRetry={() => navigate(LIST)}
          retryLabel="Back to items"
        />
      </PageShell>
    )
  }

  const booting = !initialised && (itemId !== null ? loaded.loading || !loaded.data : optionsLoading)
  if (booting && !loaded.error) {
    return (
      <PageShell>
        <ItemEditSkeleton />
      </PageShell>
    )
  }

  if (itemId !== null && loaded.error && !loaded.data) {
    return (
      <PageShell>
        <ErrorState
          title="Could not load this item"
          description={errorMessage(loaded.error)}
          onRetry={loaded.reload}
          retryLabel="Try again"
        />
      </PageShell>
    )
  }

  const meta = item ? (
    <>
      #{item.item_id}
      {item.item_sku ? ` · ${item.item_sku}` : ''}
      {item.updated_at ? ` · Last updated on ${formatDateTime(item.updated_at)}` : ''}
      {item.updated_by ? ` by ${item.updated_by}` : ''}
    </>
  ) : (
    'Items are shared by every branch of the company.'
  )

  const openingScopeNote =
    effectiveFyId > 0
      ? `Carried forward into ${fy?.label ?? `FY #${effectiveFyId}`} — the year-end close has run, so it opens only on these rows.`
      : 'Inception opening — applies to every financial year the year-end close has not run into.'

  const cardProps = { form, set, err, readOnly, registerSection }

  return (
    <PageShell className="pb-8">
      <ItemEditHeader
        itemName={form.item_name}
        isNew={itemId === null}
        active={form.is_active}
        meta={meta}
        backTo={LIST}
        moreActions={moreActions}
        onViewItem={itemId ? () => setViewOpen(true) : undefined}
        onSave={() => void doSave(false)}
        saving={saving}
        canSave={initialised && !saving}
        dirty={dirty}
        readOnly={readOnly}
      />

      {/*
        Said carefully. Every Aicountly product reads this item over the live API the moment it is
        saved — there is no copy of it anywhere else and nothing is synchronised on a schedule.
      */}
      <p
        className={cx(
          AIC,
          'flex w-fit items-center gap-1.5 rounded-lg bg-sky-50 px-2.5 py-1 text-[11px] text-sky-700 lg:ml-auto print:hidden',
        )}
      >
        <Zap className="h-3 w-3 shrink-0" aria-hidden />
        Saved changes are read by every connected Aicountly module over live APIs — nothing is copied or
        synchronised on a schedule.
      </p>

      {/* Anchors on a wide screen, steps on a phone — same strip, same eight labels. */}
      <ItemSectionNav
        sections={ITEM_SECTIONS}
        active={wideLayout ? spy.active : sectionDomId(wizardSection)}
        onSelect={(domId) => {
          const id = sectionFromDomId(domId)
          if (id) revealSection(id)
          else scrollTo(domId)
        }}
      />

      {optionsError ? <Notice kind="warning">{optionsError}</Notice> : null}
      {loaded.error && loaded.data ? (
        <Notice kind="warning">Could not refresh this item — {errorMessage(loaded.error)}</Notice>
      ) : null}
      {saveError && !serverField ? (
        <Notice kind="error" title="Not saved">
          {saveError}
        </Notice>
      ) : null}
      {readOnly ? (
        <Notice kind="info">You can read this item but not change it. Ask an administrator for write access.</Notice>
      ) : null}

      <div
        className={cx(
          AIC,
          'grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_20rem] wide:grid-cols-[minmax(0,1fr)_21.5rem]',
        )}
      >
        <div className="flex min-w-0 flex-col gap-3">
          <div className={sectionClass('basic')}>
            <ItemBasicDetailsCard
              {...cardProps}
              onSuggest={() => void openSuggestions()}
              suggestBusy={suggestBusy}
              currencySymbol={currency}
              onScanBarcode={openScanner}
              duplicates={
                duplicates.length > 0 && !duplicatesDismissed ? (
                  <ItemDuplicateNotice matches={duplicates} onDismiss={() => setDuplicatesDismissed(true)} />
                ) : null
              }
            />
          </div>

          <div className={sectionClass('classification')}>
            <ItemClassificationCard
              {...cardProps}
              options={options}
              masterLinks={{
                groups: can(P.masters('item_groups', 'write')) ? '/masters/item-groups' : null,
                categories: can(P.masters('stock_categories', 'write')) ? '/masters/stock-categories' : null,
                brands: can(P.masters('brands', 'write')) ? '/masters/brands' : null,
              }}
            />
          </div>

          <div className={sectionClass('units')}>
            <ItemUnitsPackagingCard
              {...cardProps}
              units={units}
              manageConversions={manageConversions}
              onManageConversions={setManageConversions}
            />
          </div>

          <div className={sectionClass('pricing')}>
            <ItemPricingValuationCard
              {...cardProps}
              options={options}
              currencySymbol={currency}
              hasHistory={onHand !== null && onHand !== 0}
            />
          </div>

          <div className={sectionClass('stock')}>
            <ItemStockLocationsCard
              {...cardProps}
              options={options}
              itemUnits={itemUnits}
              openings={form.openings}
              onOpeningsChange={setOpenings}
              openingScopeNote={openingScopeNote}
              currencySymbol={currency}
            />
          </div>

          <div className={sectionClass('accounting')}>
            <ItemAccountingCard {...cardProps} options={options} item={item} />
          </div>

          <div className={sectionClass('additional')}>
            <ItemAdditionalCard {...cardProps} />
          </div>

          <div className={sectionClass('media')}>
            <ItemMediaDocumentsCard registerSection={registerSection} />
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-14">
          <ItemPreviewCard
            form={form}
            baseUnitSymbol={baseUnit?.unit_symbol ?? baseUnit?.unit_name ?? null}
            onHand={onHand}
            onChangeImage={() => scrollTo(sectionDomId('media'))}
          />
          <ItemAiInsightsCard
            result={insights}
            loading={insightsLoading}
            onRefresh={() => setInsightsTick((t) => t + 1)}
            onJump={scrollTo}
          />
          <ItemQuickLinksCard links={quickLinks} />
          <ItemRecentActivityCard
            rows={activity.data?.data ?? null}
            loading={activity.loading}
            error={activity.error ? errorMessage(activity.error) : null}
            permitted={canReadAudit}
            isNew={itemId === null}
            viewAllTo={itemId ? `/audit?entity_type=item&entity_id=${itemId}` : null}
          />
        </aside>
      </div>

      {wideLayout ? null : (
        <ItemWizardBar
          sections={ITEM_SECTIONS}
          active={wizardSection}
          onSelect={revealSection}
          onSave={() => void doSave(false)}
          saving={saving}
          canSave={initialised && !saving}
          readOnly={readOnly}
          dirty={dirty}
          isNew={itemId === null}
        />
      )}

      <BarcodeScanDialog
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetected={(value) => set('item_upc', value)}
      />

      <ItemAiSuggestDrawer
        open={suggestOpen}
        loading={suggestBusy}
        suggestions={suggestions}
        onClose={() => setSuggestOpen(false)}
        onApply={applySuggestions}
      />

      <ItemViewDrawer
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        item={item}
        dirty={dirty}
        unitLabel={unitLabel}
        currencySymbol={currency}
      />

      <ConfirmDialog
        open={recostPrompt}
        title="Re-cost this item's history?"
        message="This item already has posted movements. Changing its valuation method re-costs every movement and queues a recalculation. Continue?"
        confirmLabel="Change method and re-cost"
        busy={saving}
        onConfirm={() => {
          setRecostPrompt(false)
          void doSave(true)
        }}
        onCancel={() => setRecostPrompt(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete item?"
        danger
        message={
          <>
            You are about to delete <strong>{form.item_name || 'this item'}</strong>. It will disappear from every
            list and dropdown, and historical references to it may be affected. Items used on documents or bills of
            materials cannot be deleted — deactivate them instead.
          </>
        }
        confirmLabel="Delete item"
        busy={deleteBusy}
        error={deleteError}
        onConfirm={remove}
        onCancel={() => !deleteBusy && setConfirmDelete(false)}
      />

      <ConfirmDialog
        open={pendingNav !== null}
        title="You have unsaved changes"
        message="Leaving now discards the edits on this item. Save them first, or discard and go."
        confirmLabel="Discard changes"
        danger
        onConfirm={() => {
          const proceed = pendingNav
          setPendingNav(null)
          // The guard reads `dirty`, so the draft has to stop being dirty before the navigation is
          // replayed — otherwise the replayed click is caught by this same dialog.
          setBaseline(formJson)
          // One tick, so the state above is committed before the router is asked to move.
          setTimeout(() => proceed?.(), 0)
        }}
        onCancel={() => setPendingNav(null)}
      />
    </PageShell>
  )
}

export default ItemFormPage
