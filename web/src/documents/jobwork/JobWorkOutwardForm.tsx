import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  FileText,
  Layers,
  Package,
  Plus,
  RefreshCw,
  ScanLine,
  Upload,
} from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Notice } from '../../components/Notice'
import { useQuery } from '../../hooks/useQuery'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { errorMessage, isApiError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { lookupApi } from '../../services/lookupApi'
import { settingsApi } from '../../services/settingsApi'
import type { AvailabilityCheckLine } from '../../services/stockApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Skeleton } from '../../ui/Skeleton'
import { Textarea } from '../../ui/Textarea'
import { Tooltip } from '../../ui/Tooltip'
import { useToast } from '../../ui/ToastContext'
import { cx } from '../../ui/cx'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { FormField, FormSectionCard } from '../../ui/shell/FormSectionCard'
import { ActionBarTotal, StickyActionBar } from '../../ui/shell/StickyActionBar'
import { currencySymbol, formatMoney, formatQty, todayIso } from '../../utils/format'
import { WarehouseSelect } from '../WarehouseSelect'
import { canCreate, permissionKeysFor } from '../actions'
import { draftTotals, isBlankLine, lineBaseQty, newHeader, newLine, toPayload } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { offendingDraftKeys, parseNegativeStock } from '../negativeStock'
import type { NegativeStockDetail } from '../negativeStock'
import type { DocumentTypeSpec } from '../registry'
import type { DocumentStatus, InventoryDocument, PostingWarning } from '../types'
import { useAvailability } from '../useAvailability'
import type { AvailabilityEntry } from '../useAvailability'
import { useReferenceData } from '../useReferenceData'
import { unitOptionsFrom } from '../LineEditor'
import { JobWorkAssistantCard } from './JobWorkAssistantCard'
import type { AssistantSuggestion } from './JobWorkAssistantCard'
import { JobWorkCycleCard, stageFor } from './JobWorkCycleCard'
import { JobWorkInsightsStrip } from './JobWorkInsightsStrip'
import { JobWorkLineTable } from './JobWorkLineTable'
import { JobWorkerPicker } from './JobWorkerPicker'
import { useJobWorkDirectory } from './useJobWorkDirectory'
import { validateJobWorkOutward } from './jobWorkValidation'

export interface JobWorkOutwardFormProps {
  spec: DocumentTypeSpec
  documentId?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  /** Status of the draft being edited, for the cycle card. */
  status?: DocumentStatus | null
  onSaved: (doc: InventoryDocument, posted: boolean) => void
}

function describeError(err: unknown): string {
  if (!isApiError(err)) return errorMessage(err)
  switch (err.status) {
    case 401:
      return 'Your session has expired. Sign in again — the entries on this form are still here.'
    case 403:
      return 'You do not have permission to do this.'
    case 404:
      return 'The draft could not be found. It may have been deleted in another tab.'
    case 409:
      return `Stock availability has changed since this document was prepared. ${err.message}`
    case 429:
      return 'Too many requests. Wait a moment and try again.'
    default:
      return err.details?.field ? `${err.message} (${err.details.field})` : err.message
  }
}

/**
 * Create / edit a job work outward dispatch.
 *
 * It is its own screen rather than a branch of DocumentForm because almost everything a user
 * needs here is about the *job worker* — who still holds what, what went out last time — and
 * none of that belongs in the generic editor the other seventeen types share.
 *
 * What it does NOT change: the payload. `toPayload` builds the same create / update body the
 * generic form does, `party_ref` is still the Books `acc_id`, and the challan rate is still the
 * commercial value Table 4 of ITC-04 declares — not a cost, and not an accounting entry.
 */
export function JobWorkOutwardForm({ spec, documentId, initial, status = null, onSaved }: JobWorkOutwardFormProps) {
  const toast = useToast()
  const { can } = useAccess()
  const { warehouses, defaultWarehouseId, loading: refLoading, error: refError } = useReferenceData()

  const [header, setHeader] = useState<HeaderDraft>(() => {
    if (initial?.header) return initial.header
    // A job work outward dispatch is returnable by definition — the material stays yours and
    // posting always opens a pending quantity against the job worker (DocumentPostingService::
    // applyJobWorkOut runs whatever the flag says). Defaulting it on is what makes the expected
    // return date reachable; the toggle is still there for the rare non-returnable dispatch.
    return { ...newHeader(spec, todayIso()), returnable: true }
  })
  const [lines, setLines] = useState<LineDraft[]>(() => initial?.lines ?? [newLine(spec)])
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [submitted, setSubmitted] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [negative, setNegative] = useState<NegativeStockDetail[] | null>(null)
  const [override, setOverride] = useState(false)
  const [warnings, setWarnings] = useState<PostingWarning[]>([])
  const [busy, setBusy] = useState<'save' | 'post' | null>(null)
  const [dirty, setDirty] = useState(false)
  const [leaveTo, setLeaveTo] = useState<{ to: string; proceed: () => void } | null>(null)

  const documentRef = useRef<HTMLDivElement>(null)
  const linesRef = useRef<HTMLDivElement>(null)
  const jobWorkerRef = useRef<HTMLInputElement>(null)

  const canOverride = can('stock.negative_override')
  const canPost = can(permissionKeysFor('post', spec.code))
  const canSave = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)
  // The challan value the type declares (ITC-04 Table 4). It is part of the document rather
  // than a costing figure, so there is no separate permission to gate it on.
  const showValue = spec.rate

  const directory = useJobWorkDirectory()
  const { scope } = useCompany()
  const scopeKey = scope ? `${scope.cmp_id}` : null
  const settings = useQuery((signal) => settingsApi.get(signal), [scopeKey], {
    enabled: scopeKey !== null,
    resetKey: scopeKey,
  })
  const currency = currencySymbol(settings.data?.base_currency_code)
  const negativeStockPolicy = String(settings.data?.negative_stock_policy ?? 'warn')

  // Pre-fill the default warehouse once reference data lands (new documents only).
  useEffect(() => {
    if (documentId || header.default_warehouse_id !== null || defaultWarehouseId === null) return
    setHeader((h) => ({ ...h, default_warehouse_id: defaultWarehouseId }))
    setLines((ls) => ls.map((l) => (l.warehouse_id === null ? { ...l, warehouse_id: defaultWarehouseId } : l)))
  }, [defaultWarehouseId, documentId, header.default_warehouse_id])

  // Editing: stored lines only know their own unit. Fetch the items so the unit dropdown and
  // the batch / serial pickers behave exactly as they do on a new document.
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

  const patchHeader = useCallback((patch: Partial<HeaderDraft>) => {
    setDirty(true)
    setHeader((h) => ({ ...h, ...patch }))
  }, [])

  const patchLines = useCallback((next: LineDraft[]) => {
    setDirty(true)
    setLines(next)
  }, [])

  const partyRef = useMemo(() => {
    const n = Number(header.party_ref)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
  }, [header.party_ref])

  // ---- live availability ------------------------------------------------------------------

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

  const offending = useMemo(() => new Set(negative ? offendingDraftKeys(lines, negative) : []), [negative, lines])
  const totals = draftTotals(lines, spec)
  const validation = useMemo(() => validateJobWorkOutward(header, lines), [header, lines])
  const showIssues = submitted

  const openPendingForDocument = useMemo(() => {
    if (!savedId) return null
    const rows = directory.pending.filter((p) => p.document_id === savedId)
    return rows.length === 0 ? null : rows.reduce((sum, p) => sum + (Number(p.qty_open) || 0), 0)
  }, [directory.pending, savedId])

  // ---- lines ------------------------------------------------------------------------------

  const addLine = useCallback(() => {
    setDirty(true)
    setLines((ls) => [...ls, newLine(spec, { warehouse_id: header.default_warehouse_id })])
  }, [spec, header.default_warehouse_id])

  const addSuggestions = useCallback(
    (suggestions: AssistantSuggestion[]) => {
      setDirty(true)
      setLines((ls) => {
        const blanks = ls.filter(isBlankLine)
        const kept = ls.filter((l) => !isBlankLine(l))
        const made = suggestions.map((s) =>
          newLine(spec, {
            item_id: s.item_id,
            item_name: s.item_name ?? '',
            unit_id: s.unit_id,
            warehouse_id: s.warehouse_id ?? header.default_warehouse_id,
            qty: String(s.qty),
          }),
        )
        // The first blank row is where the user was about to type; keep one at the end.
        return [...kept, ...made, ...(blanks.length ? [blanks[0]] : [])]
      })
      toast.success(`${suggestions.length} line${suggestions.length === 1 ? '' : 's'} added — check the quantities.`)
    },
    [spec, header.default_warehouse_id, toast],
  )

  // ---- save / post -------------------------------------------------------------------------

  const focusFirstProblem = useCallback(() => {
    const target = validation.firstSection === 'lines' ? linesRef.current : documentRef.current
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (validation.firstSection === 'document' && validation.header.party_ref) jobWorkerRef.current?.focus()
  }, [validation])

  const submit = useCallback(
    async (post: boolean) => {
      setSubmitted(true)
      setApiError(null)
      setWarnings([])
      if (!post) setNegative(null)
      if (!validation.ok) {
        focusFirstProblem()
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
        }
        setDirty(false)
        toast.success(post ? `${doc.document_no ?? `Document #${doc.document_id}`} posted.` : 'Draft saved.')
        onSaved(doc, post)
      } catch (err) {
        const neg = parseNegativeStock(err)
        if (neg) {
          setNegative(neg)
          setApiError(id ? `Draft #${id} is saved but could not be posted: ${errorMessage(err)}` : errorMessage(err))
        } else {
          setApiError(describeError(err))
        }
        // The draft id survives a failed post, so a retry updates rather than duplicates.
      } finally {
        setBusy(null)
      }
    },
    [validation, focusFirstProblem, header, lines, spec, savedId, override, canOverride, onSaved, toast],
  )

  const disabled = busy !== null

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
        'alt+a': (e: KeyboardEvent) => {
          if (disabled) return
          e.preventDefault()
          addLine()
        },
      }),
      [disabled, canSave, canPost, submit, addLine],
    ),
    { allowInInput: true },
  )

  useUnsavedChanges({
    when: dirty && !disabled,
    onBlocked: (to, proceed) => setLeaveTo({ to, proceed }),
  })

  const loadingMasters = refLoading && warehouses.length === 0

  // ---- render ------------------------------------------------------------------------------

  return (
    <div className="flex min-h-full flex-col gap-4">
      <BreadcrumbHeader
        breadcrumbs={[
          { label: 'Documents', to: '/documents' },
          { label: 'Job Work Outward', to: '/documents?document_type=JOB_WORK_OUT' },
          { label: savedId ? `#${savedId}` : 'New' },
        ]}
        title={savedId && documentId ? 'Edit job work outward' : 'New job work outward'}
        description="Send material to a job worker while keeping ownership and tracking the pending quantity."
        badge={
          <Badge tone={status && status !== 'DRAFT' ? 'info' : 'warning'} size="sm">
            {status ?? 'Draft'}
          </Badge>
        }
        escBack={false}
        escDirty={dirty}
        actions={
          <>
            <Tooltip label="Ctrl+S save draft · Ctrl+Enter save & post · Alt+A add line">
              <Button variant="secondary" size="sm">
                Shortcuts
              </Button>
            </Tooltip>
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              onClick={() => {
                directory.reload()
                toast.info('Job worker and pending data refreshed.')
              }}
              disabled={disabled}
            >
              Refresh
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(15rem,17rem)] min-[1500px]:grid-cols-[minmax(0,1fr)_minmax(17rem,20rem)]">
        <div className="flex min-w-0 flex-col gap-4">
          {refError ? <Notice kind="warning">{refError}</Notice> : null}
          {directory.error ? <Notice kind="warning">{directory.error}</Notice> : null}

          {/* ---- document details ---- */}
          <div ref={documentRef}>
            <FormSectionCard
              icon={FileText}
              title="Document details"
              description="Basic information for this job work dispatch"
              action={
                <div className="grid grid-cols-2 gap-2.5 max-[560px]:grid-cols-1 [&_input]:min-w-[8.5rem]">
                  <FormField label="Document date" htmlFor="jw_date" required error={showIssues ? validation.header.document_date : undefined}>
                    <Input
                      id="jw_date"
                      size="md"
                      type="date"
                      value={header.document_date}
                      disabled={disabled}
                      invalid={showIssues && Boolean(validation.header.document_date)}
                      onChange={(e) => patchHeader({ document_date: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Document no." htmlFor="jw_no" hint="Leave empty to number automatically.">
                    <Input
                      id="jw_no"
                      size="md"
                      value={header.document_no}
                      disabled={disabled}
                      placeholder="Auto"
                      onChange={(e) => patchHeader({ document_no: e.target.value })}
                    />
                  </FormField>
                </div>
              }
            >
              {loadingMasters ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="space-y-1.5">
                      <Skeleton height="h-3" className="w-20" />
                      <Skeleton height="h-9" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <FormField
                    label="Job worker"
                    htmlFor="jw_party"
                    required
                    error={showIssues ? validation.header.party_ref : undefined}
                    hint={showIssues && validation.header.party_ref ? undefined : 'A Books ledger. Pending quantities are matched on it.'}
                  >
                    <JobWorkerPicker
                      id="jw_party"
                      inputRef={jobWorkerRef}
                      value={{ partyRef: header.party_ref, partyName: header.party_name }}
                      onChange={patchHeader}
                      options={directory.jobWorkers}
                      loading={directory.loading}
                      directoryUnavailable={directory.forbidden}
                      disabled={disabled}
                      invalid={showIssues && Boolean(validation.header.party_ref)}
                    />
                  </FormField>

                  <FormField
                    label="Default warehouse"
                    htmlFor="jw_wh"
                    required
                    error={showIssues ? validation.header.default_warehouse_id : undefined}
                    hint={showIssues && validation.header.default_warehouse_id ? undefined : 'Source warehouse for the material going out.'}
                  >
                    <WarehouseSelect
                      id="jw_wh"
                      value={header.default_warehouse_id}
                      onChange={(id) => {
                        patchHeader({ default_warehouse_id: id })
                        // Lines that were following the header keep following it, and their
                        // batch / serial picks are re-read against the new warehouse.
                        setLines((ls) =>
                          ls.map((l) => (l.warehouse_id === header.default_warehouse_id ? { ...l, warehouse_id: id, batch_id: null, batch_no: null, serials: [] } : l)),
                        )
                      }}
                      warehouses={warehouses}
                      disabled={disabled}
                      invalid={showIssues && Boolean(validation.header.default_warehouse_id)}
                    />
                  </FormField>

                  <FormField
                    label="Expected return"
                    htmlFor="jw_return"
                    error={showIssues ? validation.header.expected_return_date : undefined}
                    hint={validation.warnings.expected_return_date ?? 'When the goods are due back.'}
                  >
                    <Input
                      id="jw_return"
                      size="md"
                      type="date"
                      value={header.expected_return_date}
                      disabled={disabled || !header.returnable}
                      invalid={showIssues && Boolean(validation.header.expected_return_date)}
                      onChange={(e) => patchHeader({ expected_return_date: e.target.value })}
                    />
                  </FormField>

                  <FormField label="Returnable" htmlFor="jw_returnable" hint="Material and processed goods are expected back.">
                    <label
                      htmlFor="jw_returnable"
                      className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5"
                    >
                      <input
                        id="jw_returnable"
                        type="checkbox"
                        className="h-4 w-4 accent-current text-primary"
                        checked={header.returnable}
                        disabled={disabled}
                        onChange={(e) => patchHeader({ returnable: e.target.checked, expected_return_date: e.target.checked ? header.expected_return_date : '' })}
                      />
                      <span className="text-sm text-gray-700">{header.returnable ? 'Goods expected back' : 'Not returnable'}</span>
                    </label>
                  </FormField>
                </div>
              )}

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr]">
                <FormField label="Narration / remarks" htmlFor="jw_narration">
                  <Textarea
                    id="jw_narration"
                    rows={3}
                    value={header.narration}
                    disabled={disabled}
                    placeholder="Purpose, job order reference, special instructions…"
                    onChange={(e) => patchHeader({ narration: e.target.value })}
                  />
                </FormField>
                <FormField
                  label="Reference"
                  htmlFor="jw_reference"
                  hint="Stored with the document; it is not a Books voucher reference."
                >
                  <Textarea
                    id="jw_reference"
                    rows={3}
                    value={typeof header.metadata.reference === 'string' ? header.metadata.reference : ''}
                    disabled={disabled}
                    placeholder="Job order no., PO no., drawing no."
                    onChange={(e) => patchHeader({ metadata: { ...header.metadata, reference: e.target.value } })}
                  />
                </FormField>
              </div>

              <p className="mt-3 rounded-lg bg-primary-light/50 px-3 py-2 text-[11px] leading-relaxed text-gray-600">
                The material stays yours. Posting moves it out of the warehouse and opens a pending quantity against the
                job worker, which a job work inward settles.
              </p>
            </FormSectionCard>
          </div>

          {/* ---- item lines ---- */}
          <div ref={linesRef}>
            <FormSectionCard
              icon={Package}
              title="Item lines"
              description="Materials being sent for job work"
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <Tooltip label="Bulk import is not available on this screen yet.">
                    <Button variant="secondary" size="sm" icon={Upload} disabled>
                      Import
                    </Button>
                  </Tooltip>
                  <Tooltip label="Scan into the item search on any line — it matches barcodes.">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={ScanLine}
                      disabled={disabled}
                      onClick={() => {
                        addLine()
                        toast.info('Row added — scan or type the barcode in the item box.')
                      }}
                    >
                      Scan
                    </Button>
                  </Tooltip>
                  <Button variant="secondary" size="sm" icon={Layers} disabled={disabled} onClick={() => { addLine(); addLine(); addLine() }}>
                    Add 3 rows
                  </Button>
                </div>
              }
              bodyClassName="space-y-3"
            >
              {loadingMasters ? (
                <Skeleton height="h-40" />
              ) : (
                <JobWorkLineTable
                  header={header}
                  lines={lines}
                  onChange={patchLines}
                  warehouses={warehouses}
                  availability={availability}
                  checking={checking}
                  pending={directory.pending}
                  partyRef={partyRef}
                  offendingKeys={offending}
                  issues={showIssues ? validation.lines : {}}
                  negativeStockPolicy={negativeStockPolicy}
                  currency={currency}
                  showValue={showValue}
                  disabled={disabled}
                />
              )}

              {showIssues && validation.header.lines ? (
                <p className="flex items-center gap-1.5 text-xs text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {validation.header.lines}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button variant="secondary" size="sm" icon={Plus} onClick={addLine} disabled={disabled} kbd="Alt+A">
                  Add item line
                </Button>
                <div className="flex flex-wrap items-center justify-end gap-5 text-[11px] text-gray-500">
                  <span>
                    Total items <strong className="text-gray-900 tabular-nums">{totals.lines}</strong>
                  </span>
                  <span>
                    Total quantity <strong className="text-gray-900 tabular-nums">{formatQty(totals.qtyOut)}</strong>
                  </span>
                  {showValue ? (
                    <span>
                      Challan value{' '}
                      <strong className="text-gray-900 tabular-nums">
                        {currency} {formatMoney(totals.amount, '0.00')}
                      </strong>
                    </span>
                  ) : null}
                </div>
              </div>
            </FormSectionCard>
          </div>

          <JobWorkInsightsStrip />

          {/* ---- problems ---- */}
          {apiError && !negative ? (
            <Notice kind="error" actions={savedId ? <Link className="btn btn-sm" to={`/documents/${savedId}`}>Open draft</Link> : undefined}>
              {apiError}
            </Notice>
          ) : null}

          {negative ? (
            <Notice
              kind="error"
              title="Insufficient stock"
              actions={
                <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => directory.reload()}>
                  Refresh availability
                </Button>
              }
            >
              {apiError ? <div className="mb-1">{apiError}</div> : null}
              <ul className="warning-list">
                {negative.map((d, i) => (
                  <li key={`${d.item_id}-${d.warehouse_id}-${i}`}>
                    {d.item_name ?? `Item #${d.item_id}`}
                    {d.warehouse_id ? ` · warehouse #${d.warehouse_id}` : ''}: on hand {formatQty(d.on_hand)}, required{' '}
                    {formatQty(d.required)}, short by <strong>{formatQty(d.short_by)}</strong>
                  </li>
                ))}
              </ul>
              {canOverride ? (
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs">
                  <input type="checkbox" className="h-4 w-4 accent-current" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                  Post anyway and let stock go negative (override)
                </label>
              ) : (
                <div className="mt-1 text-xs text-gray-600">
                  Reduce the quantities or receive stock first. Posting into negative stock needs the
                  &ldquo;override negative-stock block&rdquo; permission.
                </div>
              )}
            </Notice>
          ) : null}

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

        {/* ---- sidebar ---- */}
        <aside className="grid min-w-0 grid-cols-1 gap-4 max-[1099px]:grid-cols-2 max-[700px]:grid-cols-1">
          <JobWorkCycleCard stage={stageFor(status, openPendingForDocument)} openPendingQty={openPendingForDocument} />
          <JobWorkAssistantCard
            partyRef={partyRef}
            partyName={header.party_name}
            pending={directory.pending}
            documents={directory.documents}
            lines={lines}
            onAdd={addSuggestions}
            disabled={disabled}
          />
        </aside>
      </div>

      <StickyActionBar
        status={
          <span className="text-xs text-gray-500">
            {totals.lines} line{totals.lines === 1 ? '' : 's'}
            {savedId ? ` · draft #${savedId}` : ''}
          </span>
        }
        totals={
          <>
            <ActionBarTotal label="Quantity" value={formatQty(totals.qtyOut)} />
            {showValue ? (
              <ActionBarTotal label="Challan value" value={`${currency} ${formatMoney(totals.amount, '0.00')}`} />
            ) : null}
          </>
        }
      >
        <Link className="btn" to={savedId ? `/documents/${savedId}` : '/documents'}>
          Cancel
        </Link>
        <Button
          variant="secondary"
          onClick={() => void submit(false)}
          loading={busy === 'save'}
          disabled={disabled || !canSave}
          kbd="Ctrl+S"
        >
          {savedId ? 'Save changes' : 'Save as draft'}
        </Button>
        {canPost ? (
          <Button
            onClick={() => void submit(true)}
            loading={busy === 'post'}
            disabled={disabled || (!canSave && !savedId)}
            kbd="Ctrl+↵"
            className={cx('min-w-[7.5rem]')}
          >
            {negative && override ? 'Post with override' : 'Save & post'}
          </Button>
        ) : null}
      </StickyActionBar>

      <ConfirmDialog
        open={leaveTo !== null}
        title="Leave without saving?"
        message="This job work outward has unsaved changes. They will be lost."
        confirmLabel="Leave"
        onCancel={() => setLeaveTo(null)}
        onConfirm={() => {
          const pending = leaveTo
          setLeaveTo(null)
          setDirty(false)
          pending?.proceed()
        }}
      />
    </div>
  )
}

export default JobWorkOutwardForm
