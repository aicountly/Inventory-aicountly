import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, ExternalLink, FileDown, FilePlus2, Info, Layers, MoreVertical, Ship } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { Notice } from '../../components/Notice'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useQuery } from '../../hooks/useQuery'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { errorMessage, isApiError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { settingsApi } from '../../services/settingsApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Input } from '../../ui/Input'
import { MenuButton } from '../../ui/MenuButton'
import { Textarea } from '../../ui/Textarea'
import { Tooltip } from '../../ui/Tooltip'
import { useToast } from '../../ui/ToastContext'
import { AIC, cx } from '../../ui/cx'
import { BreadcrumbHeader, FormField, FormGrid, FormSectionCard, PageShell, StickyActionBar } from '../../ui/shell'
import { currencySymbol, formatMoney, todayIso } from '../../utils/format'
import { canCreate, permissionKeysFor } from '../actions'
import { newHeader, toPayload } from '../formModel'
import type { HeaderDraft } from '../formModel'
import { COST_TYPE_LABELS, chargesFromMetadata, chargesToPayload, newCharge, previewAllocation, validateCharges } from '../landedCost'
import type { AllocationBasis, ChargeDraft } from '../landedCost'
import type { DocumentTypeSpec } from '../registry'
import type { InventoryDocument, PostingWarning } from '../types'
import { useReferenceData } from '../useReferenceData'
import { WarehouseSelect } from '../WarehouseSelect'
import { AICostInsights } from './AICostInsights'
import { AdditionalChargesCard } from './AdditionalChargesCard'
import { AllocationPreviewChart } from './AllocationPreviewChart'
import { AllocationReview } from './AllocationReview'
import { ChargeEditorDrawer } from './ChargeEditorDrawer'
import { ImpactSummary } from './ImpactSummary'
import { LandedCostStepper } from './LandedCostStepper'
import { PostAllocationDialog } from './PostAllocationDialog'
import { PostingReadiness } from './PostingReadiness'
import { ReceiptPickerDrawer } from './ReceiptPickerDrawer'
import { ReceiptSelectionCard } from './ReceiptSelectionCard'
import type { SelectedReceiptRow } from './ReceiptSelectionCard'
import { ReceiptSummary } from './ReceiptSummary'
import { analyse } from './insights'
import { chargeSlices, derive, eligibilityOf, isSelectable, lockedUptoFor } from './model'
import { presetCharges } from './chargePresets'
import type { ChargePreset } from './chargePresets'
import { blockingIssues, isReadyToPost, readinessChecks } from './readiness'
import type { StepId } from './LandedCostStepper'
import { useSelectedReceipts } from './useReceipts'
import './landedCost.css'

export interface LandedCostAllocationPageProps {
  spec: DocumentTypeSpec
  /** Editing an existing draft. */
  documentId?: number
  initial?: { header: HeaderDraft }
}

type Section = 'details' | 'receipts' | 'charges' | 'review'

/** The receipt ids a stored document names, in either metadata shape. */
function targetIdsFrom(metadata: Record<string, unknown>): number[] {
  const out: number[] = []
  const list = metadata.target_document_ids
  if (Array.isArray(list)) {
    for (const entry of list) {
      const id = Number(entry)
      if (Number.isFinite(id) && id > 0 && !out.includes(id)) out.push(id)
    }
  }
  const single = Number(metadata.target_document_id ?? 0)
  if (Number.isFinite(single) && single > 0 && !out.includes(single)) out.push(single)
  return out
}

/**
 * Landed Cost Allocation — the whole screen.
 *
 * A freight bill arrives days after the goods and has to be turned into stock value. The shape of
 * that job is fixed and this page follows it end to end: which receipts the consignment arrived on,
 * what was billed, how each charge should be spread, what that does to every item's unit cost, and
 * only then, posting.
 *
 * Three things it is careful about, all of them accounting rather than layout:
 *
 *   1. The preview is the SERVER's arithmetic, mirrored (see ../landedCost). A screen that rounds
 *      differently from the engine teaches the operator a number that is not the one in closing
 *      stock, which is worse than showing nothing.
 *   2. It changes what the goods COST and nothing else. The invoice value, the GST on it and the
 *      supplier's ledger belong to the purchase and stay in Books; the page says so in three
 *      places, because an operator who expects a GST effect will go looking for one.
 *   3. Nothing here is authoritative. Every check mirrors a refusal the server makes, so the user
 *      learns it before committing rather than from a 422 afterwards — but the server refuses
 *      again on the way in, and its answer is the one that counts.
 */
export function LandedCostAllocationPage({ spec, documentId, initial }: LandedCostAllocationPageProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useAccess()
  const { scope } = useCompany()
  const { warehouses, defaultWarehouseId, warehouseName, error: refError } = useReferenceData()

  const [header, setHeader] = useState<HeaderDraft>(() => initial?.header ?? newHeader(spec, todayIso()))
  const [charges, setCharges] = useState<ChargeDraft[]>(() => chargesFromMetadata(initial?.header.metadata.charges))
  const [selectedIds, setSelectedIds] = useState<number[]>(() => (initial ? targetIdsFrom(initial.header.metadata) : []))
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [removingKey, setRemovingKey] = useState<string | null>(null)
  const [postOpen, setPostOpen] = useState(false)
  const [busy, setBusy] = useState<'save' | 'post' | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [staleIds, setStaleIds] = useState<number[]>([])
  const [warnings, setWarnings] = useState<PostingWarning[]>([])
  const [posted, setPosted] = useState<InventoryDocument | null>(null)
  const [step, setStep] = useState<StepId | null>(null)

  // Declared one by one and gathered once: a `{ details: useRef(...) }` literal rebuilt every render
  // makes the object a new identity each time, which is a trap for anything that closes over it.
  const detailsRef = useRef<HTMLDivElement>(null)
  const receiptsRef = useRef<HTMLDivElement>(null)
  const chargesRef = useRef<HTMLDivElement>(null)
  const reviewRef = useRef<HTMLDivElement>(null)
  const sections = useMemo(
    () => ({ details: detailsRef, receipts: receiptsRef, charges: chargesRef, review: reviewRef }),
    [],
  )

  const canPost = can(permissionKeysFor('post', spec.code))
  const canSave = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)

  // ---------------------------------------------------------------- server reads
  const policy = useQuery((signal) => settingsApi.landedCostPolicy(signal), [])
  // Currency and period locks are both nice-to-have: a profile without settings.read still enters a
  // bill. Both degrade quietly rather than putting a permission error on a data-entry screen.
  const settings = useQuery((signal) => settingsApi.get(signal), [], { enabled: can('settings.read') })
  const locks = useQuery((signal) => settingsApi.periodLocks(signal), [], { enabled: can('settings.read') })
  const { receipts, loading: receiptsLoading, failures, reload: reloadReceipts, checkForChanges } = useSelectedReceipts(selectedIds, warehouseName)

  const currency = currencySymbol(settings.data?.base_currency_code ?? 'INR')
  const lockedUpto = useMemo(() => lockedUptoFor(locks.data, scope?.bo_id ?? 0), [locks.data, scope?.bo_id])

  // ---------------------------------------------------------------- derived
  const receiptRows = useMemo<SelectedReceiptRow[]>(
    () =>
      receipts.map((receipt) => ({
        receipt,
        eligibility: eligibilityOf({
          status: receipt.document.status,
          documentDate: receipt.document.document_date,
          lines: receipt.lines,
          documentId: receipt.document_id,
          ownDocumentId: savedId,
          lockedUptoDate: lockedUpto,
        }),
        stale: staleIds.includes(receipt.document_id),
      })),
    [receipts, savedId, lockedUpto, staleIds],
  )

  const usableLines = useMemo(() => receiptRows.filter((r) => isSelectable(r.eligibility)).flatMap((r) => r.receipt.lines), [receiptRows])
  const { preview, summary, rows } = useMemo(() => derive(usableLines, charges), [usableLines, charges])
  const chargeErrors = useMemo(() => validateCharges(selectedIds[0] ?? null, charges, usableLines), [selectedIds, charges, usableLines])
  const slices = useMemo(() => chargeSlices(charges, COST_TYPE_LABELS), [charges])

  const checks = useMemo(
    () =>
      readinessChecks({
        documentDate: header.document_date,
        warehouseId: header.default_warehouse_id,
        selected: receiptRows.map((r) => ({
          document_id: r.receipt.document_id,
          document_no: r.receipt.document.document_no ?? `#${r.receipt.document_id}`,
          eligibility: r.eligibility,
          stale: r.stale,
        })),
        charges,
        lines: usableLines,
        summary,
        chargeErrors: chargeErrors.filter((e) => !e.startsWith('Pick the receipt')),
        lockedUptoDate: lockedUpto,
        linesLoaded: !receiptsLoading,
        canPost,
      }),
    [header.document_date, header.default_warehouse_id, receiptRows, charges, usableLines, summary, chargeErrors, lockedUpto, receiptsLoading, canPost],
  )

  const insights = useMemo(
    () =>
      analyse({
        charges,
        lines: usableLines,
        summary,
        receipts: receipts.map((r) => ({
          document_id: r.document_id,
          document_no: r.document.document_no ?? `#${r.document_id}`,
          party_ref: r.document.party_ref,
          party_name: r.document.party_name,
        })),
      }),
    [charges, usableLines, summary, receipts],
  )

  const blocking = blockingIssues(checks)
  const ready = isReadyToPost(checks)

  // The tracker's ticks. Each step is "done" when its own section has what posting needs — not when
  // the user has visited it.
  const steps = useMemo(
    () => [
      { id: 'details' as const, title: 'Document details', caption: 'Date, supplier, warehouse', complete: /^\d{4}-\d{2}-\d{2}$/.test(header.document_date) && header.default_warehouse_id !== null },
      { id: 'receipts' as const, title: 'Select receipts', caption: 'Choose GRN / receipts', complete: receiptRows.length > 0 && receiptRows.every((r) => isSelectable(r.eligibility)) },
      { id: 'charges' as const, title: 'Add charges', caption: 'Freight, duty, insurance', complete: charges.length > 0 && chargeErrors.length === 0 },
      { id: 'review' as const, title: 'Allocate & review', caption: 'Distributed costs', complete: rows.length > 0 && Math.abs(summary.unallocated) <= 0.005 && summary.landedCost > 0 },
      { id: 'post' as const, title: 'Post', caption: 'Update stock value', complete: posted !== null },
    ],
    [header.document_date, header.default_warehouse_id, receiptRows, charges, chargeErrors, rows, summary, posted],
  )

  const currentStep: StepId = step ?? (steps.find((s) => !s.complete)?.id ?? 'post')

  // ---------------------------------------------------------------- pre-fill
  // The default warehouse once reference data lands, exactly as the generic form does it.
  useEffect(() => {
    if (!documentId && header.default_warehouse_id === null && defaultWarehouseId !== null) {
      setHeader((h) => ({ ...h, default_warehouse_id: defaultWarehouseId }))
    }
  }, [defaultWarehouseId, documentId, header.default_warehouse_id])

  // The supplier, taken from the receipts themselves rather than asked for twice. Inventory holds
  // the Books ledger id the receipt was raised against; that is the live figure, and copying it
  // here is reading Inventory's own line, not a second copy of a Books master.
  useEffect(() => {
    if (header.party_ref !== '' || receipts.length === 0) return
    const first = receipts.find((r) => r.document.party_ref)
    if (!first) return
    setHeader((h) => (h.party_ref === '' ? { ...h, party_ref: String(first.document.party_ref), party_name: h.party_name || (first.document.party_name ?? '') } : h))
  }, [receipts, header.party_ref])

  // A receipt whose figures were re-read is no longer stale.
  useEffect(() => {
    setStaleIds((ids) => ids.filter((id) => selectedIds.includes(id)))
  }, [selectedIds])

  // ---------------------------------------------------------------- editing
  const focusSection = useCallback(
    (section: Section) => {
      setStep(section)
      // Optional-called: jsdom-family test environments do not implement it, and a checklist row
      // that throws is worse than one that does not scroll.
      sections[section].current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    },
    [sections],
  )

  const patchCharge = useCallback((key: string, patch: Partial<ChargeDraft>) => {
    setCharges((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)))
  }, [])

  const addCharge = useCallback(() => {
    setCharges((cs) => [...cs, newCharge({}, policy.data ?? null)])
    focusSection('charges')
  }, [policy.data, focusSection])

  const addPreset = useCallback(
    (preset: ChargePreset) => {
      const added = presetCharges(preset, policy.data ?? null)
      if (added.length === 0) {
        toast.info('Every cost type in that preset is one this company does not capitalise into stock.')
        return
      }
      setCharges((cs) => [...cs, ...added])
      focusSection('charges')
    },
    [policy.data, toast, focusSection],
  )

  const duplicateCharge = useCallback((key: string) => {
    setCharges((cs) => {
      const i = cs.findIndex((c) => c.key === key)
      if (i < 0) return cs
      // The per-line shares are deliberately NOT copied: they belong to the amounts of the charge
      // they were typed against, and carrying them onto a copy would silently mis-state the split.
      const copy = newCharge({ ...cs[i], lines: {} }, policy.data ?? null)
      return [...cs.slice(0, i + 1), copy, ...cs.slice(i + 1)]
    })
  }, [policy.data])

  const removeCharge = useCallback((key: string) => setCharges((cs) => cs.filter((c) => c.key !== key)), [])

  const toggleReceipt = useCallback((id: number) => {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }, [])

  /** Typing over one line's share turns a pro-rata charge into an entered-per-line one. */
  const overrideLine = useCallback(
    (charge: ChargeDraft, lineId: number, value: string) => {
      const basis: AllocationBasis = charge.allocation_basis === 'direct' ? 'direct' : 'manual'
      const seeded: Record<number, string> = { ...charge.lines }
      if (charge.allocation_basis === 'value' || charge.allocation_basis === 'qty' || charge.allocation_basis === 'equal') {
        // Keep what the pro-rata split had worked out for every other line, so overriding one share
        // does not silently blank the rest.
        const current = previewAllocation([charge], usableLines)
        for (const l of usableLines) {
          const share = current.byCharge[charge.key]?.[l.line_id]
          if (share !== undefined && seeded[l.line_id] === undefined) seeded[l.line_id] = String(share)
        }
      }
      if (value.trim() === '') delete seeded[lineId]
      else seeded[lineId] = value
      patchCharge(charge.key, { allocation_basis: basis, lines: seeded })
    },
    [usableLines, patchCharge],
  )

  // ---------------------------------------------------------------- save / post
  const buildPayload = useCallback(() => {
    const usableIds = receiptRows.filter((r) => isSelectable(r.eligibility)).map((r) => r.receipt.document_id)
    const ids = usableIds.length > 0 ? usableIds : selectedIds
    const metadata = {
      ...header.metadata,
      // Both shapes. The list is what a multi-receipt allocation means; the singular key keeps every
      // reader written against the one-receipt document working, and the server folds them together.
      target_document_ids: ids,
      target_document_id: ids[0],
      charges: chargesToPayload(charges, usableLines),
    }
    return toPayload({ ...header, metadata }, [], spec)
  }, [header, charges, usableLines, receiptRows, selectedIds, spec])

  const persist = useCallback(async (): Promise<InventoryDocument> => {
    const payload = buildPayload()
    if (savedId) return documentsApi.update(savedId, payload)
    const created = await documentsApi.create(payload)
    setSavedId(created.document_id)
    return created
  }, [buildPayload, savedId])

  const describe = (err: unknown): string => {
    if (isApiError(err)) return err.field ? `${err.message} (${err.field})` : err.message
    return errorMessage(err)
  }

  const saveDraft = useCallback(async () => {
    if (busy || !canSave) return
    setApiError(null)
    setBusy('save')
    try {
      const doc = await persist()
      toast.success(`Draft ${doc.document_no ?? `#${doc.document_id}`} saved.`)
    } catch (err) {
      // Nothing is cleared: the whole point of a failed save is that the work survives it.
      setApiError(describe(err))
    } finally {
      setBusy(null)
    }
  }, [busy, canSave, persist, toast])

  /** The optimistic-lock check, run at the last possible moment before committing. */
  const openPostDialog = useCallback(async () => {
    setApiError(null)
    setBusy('post')
    try {
      const changed = await checkForChanges()
      if (changed.length > 0) {
        setStaleIds(changed)
        setApiError(
          'Receipt data changed after this landed cost allocation was prepared. Refresh the allocation before posting, so the charges are spread over the figures that are actually there.',
        )
        focusSection('receipts')
        return
      }
      setPostOpen(true)
    } finally {
      setBusy(null)
    }
  }, [checkForChanges, focusSection])

  const confirmPost = useCallback(async () => {
    setApiError(null)
    setBusy('post')
    try {
      const draft = await persist()
      const done = await documentsApi.post(draft.document_id)
      setWarnings(done.warnings ?? [])
      setPosted(done)
      setPostOpen(false)
      setStep('post')
      toast.success(`Landed cost allocation ${done.document_no ?? `#${done.document_id}`} posted.`)
    } catch (err) {
      setApiError(describe(err))
    } finally {
      setBusy(null)
    }
  }, [persist, toast])

  // ---------------------------------------------------------------- keyboard
  const bindings = useMemo(
    () => ({
      'alt+a': (e: KeyboardEvent) => {
        if (busy || posted) return
        e.preventDefault()
        addCharge()
      },
      'alt+r': (e: KeyboardEvent) => {
        if (busy || posted) return
        e.preventDefault()
        setPickerOpen(true)
      },
      'ctrl+s': (e: KeyboardEvent) => {
        if (busy || posted) return
        e.preventDefault()
        void saveDraft()
      },
    }),
    [busy, posted, addCharge, saveDraft],
  )
  useKeyboardScope('form', bindings, { allowInInput: true })

  // ---------------------------------------------------------------- render
  const crumbs = [
    { label: 'Documents', to: '/documents' },
    { label: 'Landed cost allocation' },
  ]
  const disabled = busy !== null || posted !== null
  const editingCharge = charges.find((c) => c.key === editingKey) ?? null
  const removingCharge = charges.find((c) => c.key === removingKey) ?? null
  const dirty = charges.length > 0 || selectedIds.length > 0 || header.narration.trim() !== ''

  if (posted) {
    return (
      <PageShell>
        <BreadcrumbHeader breadcrumbs={crumbs} title="Landed cost allocation" escBack={false} />
        <Card padding="lg" className={cx(AIC, 'text-center')}>
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50">
            <CheckCircle2 className="h-7 w-7 text-emerald-600" aria-hidden />
          </span>
          <h2 className="text-lg font-semibold text-gray-900">Landed cost allocation {posted.document_no ?? `#${posted.document_id}`} posted</h2>
          <p className="mx-auto mt-1.5 max-w-xl text-sm leading-relaxed text-gray-600">
            {currency} {formatMoney(summary.allocated)} was added to the cost of {summary.itemLines} item line
            {summary.itemLines === 1 ? '' : 's'} across {summary.receipts} receipt{summary.receipts === 1 ? '' : 's'}. Closing stock and future
            COGS now carry it; the purchase invoice and its GST are unchanged.
          </p>

          {warnings.length > 0 ? (
            <Notice kind="warning" title="Posted with warnings" className="mx-auto mt-4 max-w-2xl text-left">
              <ul className="m-0 list-disc space-y-1 pl-4">
                {warnings.map((w, i) => (
                  <li key={`${w.code}-${i}`}>{w.message}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => navigate(`/documents/${posted.document_id}`)} icon={ExternalLink}>
              View allocation
            </Button>
            <Button variant="secondary" onClick={() => navigate('/registers/valuation')} icon={Layers}>
              View stock valuation
            </Button>
            <Button
              variant="secondary"
              icon={FilePlus2}
              onClick={() => {
                // A fresh document, not a reload: the operator is usually keying the next bill of
                // the same consignment and the receipts are the slow part to pick again.
                setPosted(null)
                setWarnings([])
                setSavedId(null)
                setCharges([])
                setStep(null)
                setHeader((h) => ({ ...newHeader(spec, todayIso()), default_warehouse_id: h.default_warehouse_id }))
                setSelectedIds([])
              }}
            >
              Create another
            </Button>
          </div>
        </Card>
      </PageShell>
    )
  }

  return (
    <PageShell paddingBottom>
      <BreadcrumbHeader
        breadcrumbs={crumbs}
        icon={Ship}
        title="Landed cost allocation"
        description="Allocate freight, duty and other landing costs to received stock. These costs become part of item value and future COGS."
        badge={savedId ? <Badge tone="warning" size="sm">Draft</Badge> : undefined}
        escBack={false}
        escDirty={dirty}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip label="Charges are entered here from the bill. Inventory holds no copy of the supplier's invoice — that document lives in Books.">
              <span tabIndex={0} className="inline-flex rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <Button variant="secondary" size="sm" icon={FileDown} disabled>
                  Import from invoice
                </Button>
              </span>
            </Tooltip>
            <Link
              to="/documents?document_type=MATERIAL_RECEIPT,PURCHASE_RECEIPT"
              className="aic inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 no-underline transition-colors hover:bg-gray-50"
            >
              View receipts
            </Link>
            <MenuButton
              label="More actions"
              variant="secondary"
              size="sm"
              icon={MoreVertical}
              actions={[
                { key: 'reload', label: 'Refresh receipt figures', onSelect: reloadReceipts },
                { key: 'settings', label: 'Landed cost policy', onSelect: () => navigate('/settings') },
                { key: 'docs', label: 'All documents', onSelect: () => navigate('/documents'), separated: true },
              ]}
            />
            <div className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-right shadow-card">
              <span className="block text-[10px] uppercase tracking-wide text-gray-500">Total landed cost</span>
              <span className="block text-base font-bold tabular-nums text-gray-900">
                {currency} {formatMoney(summary.landedCost)}
              </span>
            </div>
          </div>
        }
      />

      <LandedCostStepper steps={steps} current={currentStep} onSelect={(id) => (id === 'post' ? setStep('post') : focusSection(id))} />

      {refError ? <Notice kind="warning">{refError}</Notice> : null}
      {apiError ? <Notice kind="error">{apiError}</Notice> : null}

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-3">
          <div ref={detailsRef} className="scroll-mt-4">
            <FormSectionCard
              title="Document details"
              description="Basic information about this allocation."
              icon={Info}
            >
              <FormGrid cols={4}>
                <FormField label="Document date" htmlFor="lca-date" required>
                  <Input id="lca-date" size="md" type="date" value={header.document_date} disabled={disabled} onChange={(e) => setHeader((h) => ({ ...h, document_date: e.target.value }))} />
                </FormField>

                <FormField label="Document no." htmlFor="lca-no" hint="Leave empty to number automatically.">
                  <Input id="lca-no" size="md" value={header.document_no} disabled={disabled} placeholder="Auto" onChange={(e) => setHeader((h) => ({ ...h, document_no: e.target.value }))} />
                </FormField>

                <FormField label="Supplier" htmlFor="lca-party-name" hint="As printed on the bill. Filled from the selected receipts where they name one.">
                  <Input
                    id="lca-party-name"
                    size="md"
                    value={header.party_name}
                    disabled={disabled}
                    placeholder="Supplier as printed"
                    onChange={(e) => setHeader((h) => ({ ...h, party_name: e.target.value }))}
                  />
                </FormField>

                <FormField label="Supplier ledger id" htmlFor="lca-party-ref" hint="The Books account id (acc_id) this bill belongs to. Taken from the receipt; Books remains the owner of the ledger itself.">
                  <Input
                    id="lca-party-ref"
                    size="md"
                    inputMode="numeric"
                    value={header.party_ref}
                    disabled={disabled}
                    placeholder="e.g. 1042"
                    onChange={(e) => setHeader((h) => ({ ...h, party_ref: e.target.value.replace(/[^\d]/g, '') }))}
                  />
                </FormField>
              </FormGrid>

              <FormGrid cols={2} className="mt-3">
                <FormField label="Default warehouse" htmlFor="lca-warehouse" required hint="The warehouse this allocation is raised in.">
                  <WarehouseSelect
                    id="lca-warehouse"
                    value={header.default_warehouse_id}
                    onChange={(id) => setHeader((h) => ({ ...h, default_warehouse_id: id }))}
                    warehouses={warehouses}
                    disabled={disabled}
                    invalid={header.default_warehouse_id === null}
                  />
                </FormField>
              </FormGrid>

              <FormField label="Narration" htmlFor="lca-narration" className="mt-3">
                <Textarea
                  id="lca-narration"
                  rows={3}
                  value={header.narration}
                  disabled={disabled}
                  placeholder="e.g. Allocation of freight, insurance and customs duty for the import consignment received on 15 Sep 2026."
                  onChange={(e) => setHeader((h) => ({ ...h, narration: e.target.value }))}
                />
              </FormField>
            </FormSectionCard>
          </div>

          <div ref={receiptsRef} className="scroll-mt-4">
            <ReceiptSelectionCard
              rows={receiptRows}
              failures={failures}
              loading={receiptsLoading}
              currency={currency}
              disabled={disabled}
              onRemove={toggleReceipt}
              onAdd={() => setPickerOpen(true)}
              onReload={reloadReceipts}
            />
          </div>

          <div ref={chargesRef} className="scroll-mt-4">
            <AdditionalChargesCard
              charges={charges}
              policy={policy.data ?? null}
              currency={currency}
              disabled={disabled}
              total={summary.landedCost}
              unallocated={summary.unallocated}
              onPatch={patchCharge}
              onAdd={addCharge}
              onPreset={addPreset}
              onDuplicate={duplicateCharge}
              onRemove={setRemovingKey}
              onEdit={setEditingKey}
            />
          </div>

          <div ref={reviewRef} className="scroll-mt-4">
            <AllocationReview rows={rows} charges={charges} preview={preview} currency={currency} disabled={disabled} onOverride={overrideLine} />
          </div>

          {summary.landedCost > 0 && rows.length > 0 ? <ImpactSummary summary={summary} currency={currency} /> : null}
        </div>

        <aside className="min-w-0 space-y-3 xl:sticky xl:top-4">
          <AICostInsights insights={insights} idle={charges.length === 0 && receipts.length === 0} onFocus={focusSection} />
          <ReceiptSummary summary={summary} currency={currency} loading={receiptsLoading && receipts.length === 0} />
          <Card padding="sm" className={AIC}>
            <h3 className="mb-2 text-sm font-semibold text-gray-900">Allocation preview</h3>
            <AllocationPreviewChart slices={slices} total={summary.landedCost} currency={currency} />
            <p className="mt-2.5 text-[10px] leading-relaxed text-gray-500">
              These charges are allocated to the selected receipt lines on each charge&rsquo;s own basis — value, quantity, equal or entered by hand.
            </p>
          </Card>
          <PostingReadiness checks={checks} onFocus={focusSection} />
        </aside>
      </div>

      <StickyActionBar
        totals={
          <>
            <span className="text-xs text-gray-500">
              {summary.itemLines} line{summary.itemLines === 1 ? '' : 's'}
              {savedId ? ` · draft #${savedId}` : ''}
            </span>
            <span className="flex flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Landed cost</span>
              <span className="text-sm font-bold tabular-nums text-gray-900">
                {currency} {formatMoney(summary.landedCost)}
              </span>
            </span>
            <span className="flex flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Revised stock value</span>
              <span className="text-sm font-bold tabular-nums text-emerald-700">
                {currency} {formatMoney(summary.revisedValue)}
              </span>
            </span>
          </>
        }
      >
        <Link
          to={savedId ? `/documents/${savedId}` : '/documents'}
          className="aic inline-flex h-8 items-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 no-underline transition-colors hover:bg-gray-50"
        >
          Cancel
        </Link>
        <Button variant="secondary" onClick={() => void saveDraft()} loading={busy === 'save'} disabled={disabled || !canSave} kbd="Ctrl S">
          Save as draft
        </Button>
        {canPost ? (
          <Tooltip label={ready ? '' : `${blocking.length} issue${blocking.length === 1 ? '' : 's'} to fix first — see posting readiness`}>
            <span className="inline-flex">
              <Button onClick={() => void openPostDialog()} loading={busy === 'post'} disabled={disabled || !ready}>
                Allocate &amp; post
              </Button>
            </span>
          </Tooltip>
        ) : null}
      </StickyActionBar>

      <ReceiptPickerDrawer
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        selectedIds={selectedIds}
        onToggle={toggleReceipt}
        ownDocumentId={savedId}
        currency={currency}
      />

      <ChargeEditorDrawer
        charge={editingCharge}
        index={charges.findIndex((c) => c.key === editingKey)}
        policy={policy.data ?? null}
        onSave={(patch) => editingKey && patchCharge(editingKey, patch)}
        onClose={() => setEditingKey(null)}
      />

      <ConfirmDialog
        open={removingCharge !== null}
        title="Remove this charge?"
        message={
          removingCharge
            ? `${COST_TYPE_LABELS[removingCharge.cost_type]}${removingCharge.description ? ` — ${removingCharge.description}` : ''} will be removed from this allocation and its share taken off every line.`
            : ''
        }
        confirmLabel="Remove charge"
        danger
        onConfirm={() => {
          if (removingKey) removeCharge(removingKey)
          setRemovingKey(null)
        }}
        onCancel={() => setRemovingKey(null)}
      />

      <PostAllocationDialog
        open={postOpen}
        summary={summary}
        currency={currency}
        busy={busy === 'post'}
        error={apiError}
        onConfirm={() => void confirmPost()}
        onCancel={() => setPostOpen(false)}
      />
    </PageShell>
  )
}
