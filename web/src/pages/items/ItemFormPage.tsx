import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Building2, Loader2, Save, Trash2 } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { useScopeLabel } from '../../company/useScopeLabel'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Notice } from '../../components/Notice'
import { useBaseCurrency } from '../../hooks/useBaseCurrency'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { invalidateFormOptions, useFormOptions } from '../../hooks/useFormOptions'
import { useQuery } from '../../hooks/useQuery'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { P } from '../../services/access'
import { errorMessage, isApiError } from '../../services/api'
import { itemsApi } from '../../services/items'
import type { FormOptionUnit, Item, ItemOpeningsResponse } from '../../services/items'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { AIC, cx } from '../../ui/cx'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { StickyActionBar } from '../../ui/shell/StickyActionBar'
import { PageShell } from '../../ui/shell/PageShell'
import { useToast } from '../../ui/ToastContext'
import { formatQty } from '../../utils/format'
import {
  emptyItemForm,
  itemPayload,
  itemToForm,
  openingsPayload,
  validateItemForm,
} from './itemForm'
import type { ItemFormState, OpeningDraft } from './itemForm'
import { AiAssistDrawer } from './form/AiAssistDrawer'
import { IntelligenceBanner } from './form/IntelligenceBanner'
import { ItemClassificationSection } from './form/ItemClassificationSection'
import { ItemFormStepper } from './form/ItemFormStepper'
import { ItemIdentitySection } from './form/ItemIdentitySection'
import { ItemOpeningStockSection } from './form/ItemOpeningStockSection'
import { ItemUnitsSection } from './form/ItemUnitsSection'
import { ItemStockLevelsSection, ItemValuationSection } from './form/ItemValuationSection'
import { ItemCompletenessCard, InventoryIntelligencePanel, ItemPreviewCard } from './form/ItemSidePanels'
import {
  ITEM_FORM_STEPS,
  buildSuggestions,
  computeCompleteness,
  deriveInsights,
  generateSku,
  stepOfFieldKey,
  stepsWithErrors,
} from './form/itemIntelligence'
import type { StepId, Suggestion } from './form/itemIntelligence'
import { useDuplicateCheck } from './form/useDuplicateCheck'

const LIST = '/items'

interface Loaded {
  item: Item
  openings: ItemOpeningsResponse
}

/**
 * `smooth`, unless the reader has asked the OS for less movement.
 *
 * Every jump on this page is a scroll the user asked for, so it still happens —
 * it just happens instantly rather than gliding.
 */
function scrollBehavior(): ScrollBehavior {
  if (typeof window === 'undefined' || !window.matchMedia) return 'auto'
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/** The DOM id a validation key points at, so a failed save can focus the field. */
function elementIdForError(key: string): string {
  if (key.startsWith('unitLines.')) return `alt-unit-${key.slice('unitLines.'.length)}`
  if (key.startsWith('openings.')) return `opening-qty-${key.slice('openings.'.length)}`
  return key
}

/**
 * Create / edit one item.
 *
 * One component for both routes, as before: `/items/new` and `/items/:id` differ
 * by `itemId`, not by a second copy of the form. Everything the old screen
 * submitted it still submits — identity, classification, units and conversions,
 * valuation, the three tracking flags, the ITC attribute, stock levels and
 * opening stock — through the same `itemPayload` / `openingsPayload`
 * transforms and the same `itemsApi` calls. The redesign is above that line.
 *
 * Layout: on a wide screen every section is on the page at once with an
 * intelligence rail beside it, and the stepper is anchor navigation. Below
 * 1024px it becomes a wizard — one step at a time with Back / Continue — which
 * is the only shape that fits a phone without a horizontal scrollbar.
 */
export function ItemFormPage() {
  const { id } = useParams()
  const itemId = id && /^\d+$/.test(id) ? Number(id) : null
  const isEdit = itemId !== null
  const navigate = useNavigate()
  const toast = useToast()
  const { scope, fy } = useCompany()
  const scopeLabel = useScopeLabel()
  const { can, loading: accessLoading } = useAccess()
  const canWrite = can(P.masters('items', 'write'))
  const canDelete = can(P.masters('items', 'delete'))
  const canManageMasters = can([P.masters('item_groups', 'write'), P.masters('stock_categories', 'write'), P.masters('brands', 'write')])
  const { options, loading: optionsLoading, error: optionsError, reload: reloadOptions } = useFormOptions()
  const currencyCode = useBaseCurrency()

  // The wizard threshold. `true` by default so a DOM without matchMedia (the
  // test environment) renders the whole form rather than one hidden step.
  const wideLayout = useMediaQuery('(min-width: 1024px)', true)

  const loaded = useQuery(
    async (signal): Promise<Loaded | null> => {
      if (!itemId) return null
      const [item, openings] = await Promise.all([itemsApi.get(itemId, signal), itemsApi.openings(itemId, signal)])
      return { item, openings }
    },
    [itemId, scope?.cmp_id, scope?.fy_id],
    { enabled: !!scope && itemId !== null, keepData: false },
  )

  const [form, setForm] = useState<ItemFormState>(() => emptyItemForm())
  const [baseline, setBaseline] = useState<ItemFormState>(() => emptyItemForm())
  const [initialised, setInitialised] = useState(false)
  const [openingsDirty, setOpeningsDirty] = useState(false)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [serverField, setServerField] = useState<string | null>(null)
  const [recostPrompt, setRecostPrompt] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [activeStep, setActiveStep] = useState<StepId>('identity')
  const [visited, setVisited] = useState<ReadonlySet<StepId>>(() => new Set<StepId>(['identity']))
  const [assistOpen, setAssistOpen] = useState(false)
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [duplicatesAcknowledged, setDuplicatesAcknowledged] = useState(false)
  const [pendingBaseUnit, setPendingBaseUnit] = useState<string | null>(null)
  const [leaveTo, setLeaveTo] = useState<(() => void) | null>(null)

  // A second submit while the first is in flight would create two items. The
  // `saving` flag drives the button; this ref is what actually refuses.
  const inFlight = useRef(false)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const effectiveFyId = loaded.data?.openings.effective_fy_id ?? 0

  useEffect(() => {
    if (itemId === null) {
      if (!initialised && options) {
        const next = emptyItemForm(options.default_valuation_method)
        setForm(next)
        setBaseline(next)
        setInitialised(true)
      }
      return
    }
    if (loaded.data && !initialised) {
      const next = itemToForm(loaded.data.item, loaded.data.openings.rows, loaded.data.openings.effective_fy_id)
      setForm(next)
      setBaseline(next)
      setInitialised(true)
    }
  }, [itemId, loaded.data, options, initialised])

  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
    },
    [],
  )

  // "Continue anyway" answers the duplicates on screen, not every duplicate the
  // item will ever have: a new name is a new question and has to be asked again.
  useEffect(() => {
    setDuplicatesAcknowledged(false)
  }, [form.item_name, form.item_sku, form.item_upc])

  const errors = useMemo(() => (touched ? validateItemForm(form) : {}), [form, touched])
  const readOnly = !canWrite
  const isStock = form.item_type === 'stock'
  const dirty = initialised && !saved && JSON.stringify(form) !== JSON.stringify(baseline)

  // Held in a ref so `set` stays referentially stable across renders while
  // still knowing which field the server last blamed.
  const serverFieldRef = useRef<string | null>(null)
  serverFieldRef.current = serverField

  const set = useCallback(<K extends keyof ItemFormState>(key: K, value: ItemFormState[K]) => {
    // "SKU already exists" is about the SKU that was sent, not the one being
    // typed now — editing the blamed field retires the message with it.
    if (serverFieldRef.current === key) {
      setServerField(null)
      setSaveError(null)
    }
    setForm((f) => ({ ...f, [key]: value }))
  }, [])

  const setOpenings = useCallback((rows: OpeningDraft[]) => {
    setOpeningsDirty(true)
    setForm((f) => ({ ...f, openings: rows }))
  }, [])

  const units = useMemo(() => options?.units ?? [], [options])
  const baseUnit = units.find((u) => String(u.unit_id) === form.unit_id) ?? null
  const itemUnits = useMemo<FormOptionUnit[]>(() => {
    const ids = new Set<string>([form.unit_id, ...form.unitLines.map((l) => l.unit_id)].filter(Boolean))
    return units.filter((u) => ids.has(String(u.unit_id)))
  }, [units, form.unit_id, form.unitLines])

  const unitLabel = useCallback(
    (unitId: string) => {
      const unit = units.find((u) => String(u.unit_id) === unitId)
      return unit ? (unit.unit_symbol ?? unit.unit_name) : `unit #${unitId}`
    },
    [units],
  )

  // ---- intelligence -------------------------------------------------------

  const { matches: duplicates, similar } = useDuplicateCheck({ form, excludeItemId: itemId, enabled: !readOnly })

  const completeness = useMemo(() => computeCompleteness(form, errors), [form, errors])

  const insights = useMemo(
    () =>
      deriveInsights(form, {
        itemUnitIds: new Set(itemUnits.map((u) => String(u.unit_id))),
        defaultValuationMethod: options?.default_valuation_method,
        unitLabel,
      }),
    [form, itemUnits, options?.default_valuation_method, unitLabel],
  )

  const suggestions = useMemo(() => buildSuggestions(form, { options, similar }), [form, options, similar])

  const hsnFromSimilar = useMemo(() => {
    const donor = similar.find((row) => (row.hsn_sac ?? '').trim() !== '')
    return donor ? String(donor.hsn_sac).trim().toUpperCase() : null
  }, [similar])

  const applySuggestions = useCallback((chosen: Suggestion[]) => {
    if (chosen.length === 0) return
    setForm((f) => {
      const next = { ...f }
      for (const s of chosen) {
        // Every suggested field is a string field on the draft; the union is
        // narrowed here rather than at the call site so the drawer stays dumb.
        ;(next as unknown as Record<string, string>)[s.field] = s.value
      }
      return next
    })
    const fields = new Set(chosen.map((s) => s.field as string))
    setHighlighted(fields)
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setHighlighted(new Set<string>()), 1600)
  }, [])

  const generateSkuNow = useCallback(() => {
    setForm((f) => ({ ...f, item_sku: generateSku(f, options) }))
    setHighlighted(new Set(['item_sku']))
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setHighlighted(new Set<string>()), 1600)
  }, [options])

  // ---- navigation ---------------------------------------------------------

  const goToStep = useCallback(
    (step: StepId) => {
      setActiveStep(step)
      setVisited((prev) => new Set(prev).add(step))
      if (!wideLayout) {
        // The wizard swaps the section out; scrolling to an anchor that has not
        // rendered yet does nothing, so go back to the top of the form instead.
        document.querySelector('.app-main')?.scrollTo({ top: 0, behavior: scrollBehavior() })
        return
      }
      const anchor = ITEM_FORM_STEPS.find((s) => s.id === step)?.anchor
      if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
    },
    [wideLayout],
  )

  const stepIndex = ITEM_FORM_STEPS.findIndex((s) => s.id === activeStep)
  const isLastStep = stepIndex === ITEM_FORM_STEPS.length - 1

  const erroredSteps = useMemo(() => stepsWithErrors(errors), [errors])
  const completedSteps = useMemo(() => {
    const done = new Set<StepId>()
    for (const group of completeness.groups) {
      if (group.state === 'complete') done.add(group.id)
    }
    // A step the reader has walked past in the wizard reads as done too, as
    // long as nothing on it is wrong — an optional step is not an unfinished one.
    if (!wideLayout) {
      for (const [index, step] of ITEM_FORM_STEPS.entries()) {
        if (index < stepIndex && visited.has(step.id) && !erroredSteps.has(step.id)) done.add(step.id)
      }
    }
    return done
  }, [completeness.groups, erroredSteps, stepIndex, visited, wideLayout])

  // ---- save ---------------------------------------------------------------

  const doSave = useCallback(
    async (recost: boolean) => {
      if (inFlight.current || readOnly) return
      setTouched(true)
      const found = validateItemForm(form)
      if (Object.keys(found).length > 0) {
        const firstKey = Object.keys(found)[0]
        const step = stepOfFieldKey(firstKey)
        if (step) {
          setActiveStep(step)
          setVisited((prev) => new Set(prev).add(step))
        }
        setSaveError('Fix the highlighted fields.')
        // After the step has rendered, put the cursor on what is wrong.
        setTimeout(() => {
          const el = document.getElementById(elementIdForError(firstKey))
          el?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
          el?.focus({ preventScroll: true })
        }, 0)
        return
      }
      inFlight.current = true
      setSaving(true)
      setSaveError(null)
      setServerField(null)
      try {
        const body = itemPayload(form)
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
        // Set before navigating so the unsaved-changes guard does not fire on
        // the way out of a form that was just saved.
        setSaved(true)
        toast.success(itemId ? 'Item saved' : 'Item created')
        navigate(LIST)
      } catch (err) {
        if (isApiError(err) && err.details?.requires === 'valuation_method_recost') {
          setRecostPrompt(true)
        } else {
          const field = isApiError(err) ? err.field : null
          setSaveError(errorMessage(err, 'We could not save this item. Please try again.'))
          setServerField(field)
          const step = field ? stepOfFieldKey(field) : null
          if (step) {
            setActiveStep(step)
            setVisited((prev) => new Set(prev).add(step))
          }
          if (field) {
            setTimeout(() => {
              const el = document.getElementById(elementIdForError(field))
              el?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
              el?.focus({ preventScroll: true })
            }, 0)
          }
        }
      } finally {
        inFlight.current = false
        setSaving(false)
      }
    },
    [effectiveFyId, form, isStock, itemId, navigate, openingsDirty, readOnly, toast],
  )

  const remove = async () => {
    if (!itemId) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await itemsApi.remove(itemId)
      invalidateFormOptions()
      setSaved(true)
      toast.success('Item deleted')
      navigate(LIST)
    } catch (err) {
      setDeleteError(errorMessage(err))
    } finally {
      setDeleteBusy(false)
    }
  }

  const cancel = useCallback(() => {
    if (dirty) {
      setLeaveTo(() => () => navigate(LIST))
      return
    }
    navigate(LIST)
  }, [dirty, navigate])

  useUnsavedChanges({
    when: dirty,
    onBlocked: (_to, proceed) => setLeaveTo(() => proceed),
  })

  // ---- keyboard -----------------------------------------------------------

  const shortcuts = useMemo(
    () => ({
      'ctrl+s': (e: KeyboardEvent) => {
        if (readOnly || saving) return
        e.preventDefault()
        void doSave(false)
      },
      escape: (e: KeyboardEvent) => {
        if (saving) return
        e.preventDefault()
        cancel()
      },
      'alt+1': (e: KeyboardEvent) => {
        e.preventDefault()
        goToStep('identity')
      },
      'alt+2': (e: KeyboardEvent) => {
        e.preventDefault()
        goToStep('classification')
      },
      'alt+3': (e: KeyboardEvent) => {
        e.preventDefault()
        goToStep('units')
      },
      'alt+4': (e: KeyboardEvent) => {
        e.preventDefault()
        goToStep('valuation')
      },
    }),
    [cancel, doSave, goToStep, readOnly, saving],
  )

  useKeyboardScope('form', shortcuts, { allowInInput: true })

  // ---- render -------------------------------------------------------------

  if (!accessLoading && !can(P.masters('items', 'read'))) {
    return (
      <PageShell>
        <BreadcrumbHeader breadcrumbs={[{ label: 'Items', to: LIST }]} title="Item" escBack={false} />
        <Notice kind="warning">You do not have permission to view items in this company.</Notice>
      </PageShell>
    )
  }

  const err = (key: string): string | undefined => errors[key] ?? (serverField === key ? (saveError ?? undefined) : undefined)
  const stock = loaded.data?.item.stock
  const onHand = stock ? Number(stock.on_hand ?? 0) : null
  const title = isEdit ? (loaded.data?.item.item_name ?? 'Item') : 'New item'
  const groupLabel = options?.item_groups.find((g) => String(g.item_grp_id) === form.item_grp_id)?.grp_name ?? null
  const categoryLabel = options?.stock_categories.find((c) => String(c.stock_cat_id) === form.stock_cat_id)?.cat_name ?? null
  const baseUnitLabel = baseUnit ? (baseUnit.unit_symbol ?? baseUnit.unit_name) : null
  const loadingRecord = (isEdit && loaded.loading) || (!initialised && optionsLoading)

  const showStep = (step: StepId): boolean => wideLayout || activeStep === step

  const sidePanels = (
    <>
      <ItemCompletenessCard completeness={completeness} onSelectStep={goToStep} />
      <InventoryIntelligencePanel insights={insights} onSelectStep={goToStep} />
      <ItemPreviewCard
        form={form}
        baseUnitLabel={baseUnitLabel}
        groupLabel={groupLabel}
        categoryLabel={categoryLabel}
        currencyCode={currencyCode}
      />
    </>
  )

  // A phone's action bar is the one place this design system's 2rem buttons are
  // too small to hit reliably, so the sticky bar asks for the 44px target and
  // the header keeps the standard size.
  const TAP = 'min-h-11 sm:min-h-0'
  const primaryAction = (className?: string) =>
    readOnly ? null : (
      <Button
        variant="primary"
        icon={saving ? undefined : isEdit ? Save : Check}
        loading={saving}
        disabled={!initialised}
        className={className}
        onClick={() => void doSave(false)}
      >
        {saving ? (isEdit ? 'Saving…' : 'Creating item…') : isEdit ? 'Save item' : 'Create item'}
      </Button>
    )

  return (
    <PageShell paddingBottom>
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Items', to: LIST }, { label: isEdit ? title : 'New item' }]}
        title={title}
        escBack={false}
        description={
          isEdit
            ? 'Change this item and everything that uses it follows.'
            : 'Create an inventory item and make it available across your business.'
        }
        meta={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
            <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{scopeLabel}</span>
            <span aria-hidden>·</span>
            <span>Items are shared by every branch of the company.</span>
            {isEdit && loaded.data ? (
              <>
                <span aria-hidden>·</span>
                <span>#{loaded.data.item.item_id}</span>
                {onHand !== null ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>
                      on hand {formatQty(onHand)}
                      {baseUnitLabel ? ` ${baseUnitLabel}` : ''}
                    </span>
                  </>
                ) : null}
              </>
            ) : null}
            {readOnly ? <Badge tone="neutral">Read only</Badge> : null}
          </span>
        }
        actions={
          <div className="hidden items-center gap-2 md:flex">
            {isEdit && canDelete ? (
              <Button variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)} disabled={saving}>
                Delete
              </Button>
            ) : null}
            <Button variant="secondary" onClick={cancel} disabled={saving}>
              {readOnly ? 'Back' : 'Cancel'}
            </Button>
            {primaryAction()}
          </div>
        }
      />

      <ItemFormStepper activeId={activeStep} completed={completedSteps} errored={erroredSteps} onSelect={goToStep} wizard={!wideLayout} />

      {!readOnly ? <IntelligenceBanner onAssist={() => setAssistOpen(true)} count={suggestions.length} /> : null}

      {optionsError ? (
        <Notice
          kind="warning"
          actions={
            <Button variant="secondary" size="xs" onClick={reloadOptions}>
              Retry
            </Button>
          }
        >
          {optionsError}
        </Notice>
      ) : null}
      {loaded.error ? <Notice kind="error">{errorMessage(loaded.error)}</Notice> : null}
      {saveError && !serverField ? <Notice kind="error">{saveError}</Notice> : null}
      {loadingRecord ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </p>
      ) : null}

      <div className={cx(AIC, 'grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]')}>
        <div className="flex min-w-0 flex-col gap-4">
          {showStep('identity') ? (
            <ItemIdentitySection
              form={form}
              set={set}
              err={err}
              readOnly={readOnly}
              highlighted={highlighted}
              onAssist={() => setAssistOpen(true)}
              onGenerateSku={generateSkuNow}
              hsnFromSimilar={hsnFromSimilar}
              duplicates={duplicates}
              duplicatesAcknowledged={duplicatesAcknowledged}
              onAcknowledgeDuplicates={() => setDuplicatesAcknowledged(true)}
              currencyCode={currencyCode}
            />
          ) : null}

          {showStep('classification') ? (
            <ItemClassificationSection
              form={form}
              set={set}
              err={err}
              readOnly={readOnly}
              highlighted={highlighted}
              options={options}
              optionsLoading={optionsLoading}
              optionsError={optionsError}
              onRetryOptions={reloadOptions}
              canManageMasters={canManageMasters}
            />
          ) : null}

          {showStep('units') ? (
            <ItemUnitsSection
              form={form}
              set={set}
              err={err}
              readOnly={readOnly}
              options={options}
              optionsLoading={optionsLoading}
              optionsError={optionsError}
              onRetryOptions={reloadOptions}
              onChangeBaseUnit={(next) => {
                // Conversions are stated against the base unit, and the opening
                // rows are entered in it. Swapping it under them silently would
                // change what every one of those numbers means.
                if (next !== form.unit_id && form.unit_id !== '' && (form.unitLines.length > 0 || form.openings.length > 0)) {
                  setPendingBaseUnit(next)
                  return
                }
                set('unit_id', next)
              }}
            />
          ) : null}

          {showStep('valuation') ? (
            <>
              <ItemValuationSection form={form} set={set} err={err} readOnly={readOnly} options={options} currencyCode={currencyCode} isEdit={isEdit} />
              {isStock ? (
                <ItemStockLevelsSection
                  form={form}
                  set={set}
                  err={err}
                  readOnly={readOnly}
                  options={options}
                  optionsLoading={optionsLoading}
                  optionsError={optionsError}
                  onRetryOptions={reloadOptions}
                />
              ) : null}
              {isStock ? (
                <ItemOpeningStockSection
                  form={form}
                  err={err}
                  readOnly={readOnly}
                  options={options}
                  itemUnits={itemUnits}
                  effectiveFyId={effectiveFyId}
                  fyLabel={fy?.label ?? null}
                  onChange={setOpenings}
                  currencyCode={currencyCode}
                />
              ) : null}
            </>
          ) : null}
        </div>

        <aside className={cx(AIC, 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:sticky xl:top-4 xl:grid-cols-1')}>{sidePanels}</aside>
      </div>

      <StickyActionBar
        status={
          <span className="text-xs text-gray-500">
            {saving ? 'Saving…' : dirty ? 'Unsaved changes' : readOnly ? 'Read only' : 'No changes yet'}
          </span>
        }
      >
        {wideLayout ? (
          <>
            <Button variant="secondary" className={TAP} onClick={cancel} disabled={saving}>
              {readOnly ? 'Back' : 'Cancel'}
            </Button>
            {primaryAction(TAP)}
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              icon={ArrowLeft}
              className={TAP}
              onClick={() => (stepIndex === 0 ? cancel() : goToStep(ITEM_FORM_STEPS[stepIndex - 1].id))}
              disabled={saving}
            >
              {stepIndex === 0 ? 'Cancel' : 'Back'}
            </Button>
            {isLastStep ? (
              primaryAction(TAP)
            ) : (
              <Button variant="primary" className={TAP} iconRight={ArrowRight} onClick={() => goToStep(ITEM_FORM_STEPS[stepIndex + 1].id)}>
                Continue
              </Button>
            )}
          </>
        )}
      </StickyActionBar>

      <AiAssistDrawer
        open={assistOpen}
        onClose={() => setAssistOpen(false)}
        suggestions={suggestions}
        onApply={applySuggestions}
        disabled={readOnly}
      />

      <ConfirmDialog
        open={pendingBaseUnit !== null}
        title="Change the base unit?"
        message={
          <>
            Every alternate-unit conversion and every opening row on this item is stated in{' '}
            <strong>{baseUnitLabel ?? 'the current base unit'}</strong>. Changing the base unit does not convert them — check each
            figure afterwards.
          </>
        }
        confirmLabel="Change base unit"
        onConfirm={() => {
          if (pendingBaseUnit !== null) set('unit_id', pendingBaseUnit)
          setPendingBaseUnit(null)
        }}
        onCancel={() => setPendingBaseUnit(null)}
      />

      <ConfirmDialog
        open={leaveTo !== null}
        title="Discard unsaved changes?"
        message="This item has changes that have not been saved. Leaving now loses them."
        confirmLabel="Discard changes"
        danger
        onConfirm={() => {
          const proceed = leaveTo
          setLeaveTo(null)
          setSaved(true)
          // After the guard has been told to stand down, or the click listener
          // catches the replayed navigation again.
          setTimeout(() => proceed?.(), 0)
        }}
        onCancel={() => setLeaveTo(null)}
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
        message={
          <>
            <strong>{form.item_name}</strong> will be removed from every list and dropdown. Items used on documents or bills of
            materials cannot be deleted — deactivate them instead.
          </>
        }
        confirmLabel="Delete"
        danger
        busy={deleteBusy}
        error={deleteError}
        onConfirm={remove}
        onCancel={() => !deleteBusy && setConfirmDelete(false)}
      />
    </PageShell>
  )
}

export default ItemFormPage
