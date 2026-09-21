import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Copy,
  Eye,
  FileText,
  History,
  Info,
  PackageSearch,
  Printer,
  ScanLine,
  Send,
  Trash2,
  Upload,
} from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Notice } from '../../components/Notice'
import { FEATURES } from '../../config/features'
import { useDebounce } from '../../hooks/useDebounce'
import { useQuery } from '../../hooks/useQuery'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { errorMessage, isApiError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { jobWorkApi } from '../../services/jobWorkApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { lookupApi } from '../../services/lookupApi'
import type { AvailabilityCheckLine } from '../../services/stockApi'
import { pendingApi } from '../../services/stockApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { MenuButton } from '../../ui/MenuButton'
import type { MenuAction } from '../../ui/MenuButton'
import { StatusBadge } from '../../ui/StatusBadge'
import { BreadcrumbBar } from '../../ui/shell/BreadcrumbBar'
import { PageShell } from '../../ui/shell/PageShell'
import { ActionBarTotal, StickyActionBar } from '../../ui/shell/StickyActionBar'
import { useToast } from '../../ui/ToastContext'
import { AIC, cx } from '../../ui/cx'
import { formatMoney, formatQty, todayIso, toNumber } from '../../utils/format'
import { STATUS_LABELS, canCreate, permissionKeysFor, statusTone } from '../actions'
import { draftTotals, isBlankLine, lineBaseQty, newHeader, newLine, round4, toPayload } from '../formModel'
import type { HeaderDraft, LineDraft, LineOrigin } from '../formModel'
import { unitOptionsFrom } from '../LineEditor'
import { offendingDraftKeys, parseNegativeStock } from '../negativeStock'
import type { NegativeStockDetail } from '../negativeStock'
import type { DocumentTypeSpec } from '../registry'
import type { DocumentStatus, InventoryDocument, JobWorkSettlement, PostingWarning } from '../types'
import { useAvailability } from '../useAvailability'
import type { AvailabilityEntry } from '../useAvailability'
import { useReferenceData } from '../useReferenceData'
import { JobWorkAssistant } from './JobWorkAssistant'
import { JobWorkDetailsCard } from './JobWorkDetailsCard'
import { JobWorkImportDrawer } from './JobWorkImportDrawer'
import { JobWorkKpiStrip } from './JobWorkKpiStrip'
import { JobWorkLines } from './JobWorkLines'
import { JobWorkTimelineDrawer } from './JobWorkTimelineDrawer'
import { PendingJobWorkDrawer } from './PendingJobWorkDrawer'
import { jobWorkModeSpec } from './jobWorkMode'
import type { AssistantActionKey } from './jobWorkMode'
import {
  JOB_WORK_SLUG,
  groupByDocument,
  jobWorkModeFor,
  lineAdvisories,
  otherMode,
  pendingView,
  settlementProgress,
  smartWarnings,
  stockEffect,
  validateJobWork,
} from './jobWorkModel'
import type { JobWorkMode, PendingView, SmartWarning } from './jobWorkModel'
import './jobwork.css'

export interface JobWorkPageProps {
  spec: DocumentTypeSpec
  /** Set when editing an existing draft. */
  documentId?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  existing?: InventoryDocument
  onSaved: (doc: InventoryDocument, posted: boolean) => void
}

type Busy = 'save' | 'post' | null

/**
 * Job Work Inward and Job Work Outward — one screen, two directions.
 *
 * The two are the same workflow read from opposite ends, and keeping them in
 * one component is what stops them drifting: the same pending quantities, the
 * same job worker, the same batch and serial pickers, the same posting path.
 * What differs is declared in `jobWorkMode` (the wording and the column set)
 * and branched on `mode` here (the settlement panel is a receipt's; the
 * availability check is a dispatch's).
 *
 * Nothing about posting has moved: the draft is created or updated first and
 * posted second, through `documentsApi`, so a negative-stock block still
 * leaves a saved draft that can be posted with an override — and every rule
 * that decides whether it posts is still the server's.
 */
export function JobWorkPage({ spec, documentId, initial, existing, onSaved }: JobWorkPageProps) {
  const mode = (jobWorkModeFor(spec.code) ?? 'in') as JobWorkMode
  const modeSpec = jobWorkModeSpec(mode)
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useAccess()
  const { scope } = useCompany()
  const { warehouses, defaultWarehouseId, loading: refLoading, error: refError } = useReferenceData()

  const [header, setHeader] = useState<HeaderDraft>(() => initial?.header ?? newHeader(spec, todayIso()))
  const [lines, setLines] = useState<LineDraft[]>(() => initial?.lines ?? [newLine(spec)])
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [dirty, setDirty] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [negative, setNegative] = useState<NegativeStockDetail[] | null>(null)
  const [override, setOverride] = useState(false)
  const [postWarnings, setPostWarnings] = useState<PostingWarning[]>([])
  const [busy, setBusy] = useState<Busy>(null)
  const [pendingOpen, setPendingOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [timelineFor, setTimelineFor] = useState<number | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanValue, setScanValue] = useState('')
  const [scanError, setScanError] = useState<string | null>(null)
  const [leaveTo, setLeaveTo] = useState<{ to: string; proceed: () => void } | null>(null)
  const [autoFocusKey, setAutoFocusKey] = useState<string | null>(null)
  const scanRef = useRef<HTMLInputElement>(null)

  const today = todayIso()
  const canPost = can(permissionKeysFor('post', spec.code))
  const canSaveDraft = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)
  const canOverride = can('stock.negative_override')
  const canCancel = can(permissionKeysFor('cancel', spec.code))
  const canSwitchMode = canCreate(mode === 'in' ? 'JOB_WORK_OUT' : 'JOB_WORK_IN', can)

  const patch = useCallback((p: Partial<HeaderDraft>) => {
    setDirty(true)
    setHeader((h) => ({ ...h, ...p }))
  }, [])
  const patchMeta = useCallback((p: Record<string, unknown>) => {
    setDirty(true)
    setHeader((h) => ({ ...h, metadata: { ...h.metadata, ...p } }))
  }, [])
  const changeLines = useCallback((next: LineDraft[]) => {
    setDirty(true)
    setLines(next)
  }, [])

  // Pre-fill the warehouse once reference data lands (new documents only).
  useEffect(() => {
    if (documentId || header.default_warehouse_id !== null || defaultWarehouseId === null) return
    setHeader((h) => ({ ...h, default_warehouse_id: defaultWarehouseId }))
    setLines((ls) => ls.map((l) => (l.warehouse_id === null && l.origin === 'manual' ? { ...l, warehouse_id: defaultWarehouseId } : l)))
  }, [defaultWarehouseId, documentId, header.default_warehouse_id])

  // Editing: stored lines know only their own unit. Fetch the items once so the
  // unit dropdown, the batch picker and the serial picker behave as they do on
  // a new document.
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

  // ---- server state -------------------------------------------------------

  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null
  const summary = useQuery((signal) => jobWorkApi.summary(signal), [scopeKey], { enabled: scope !== null, resetKey: scopeKey })

  const partyRefNum = useMemo(() => {
    const n = toNumber(header.party_ref)
    return n !== null && n > 0 ? Math.floor(n) : null
  }, [header.party_ref])
  const debouncedParty = useDebounce(partyRefNum, 350)

  const pending = useQuery(
    (signal) => pendingApi.list({ kind: 'job_work', direction: 'out', party_ref: debouncedParty ?? undefined }, signal),
    [debouncedParty, scopeKey],
    { enabled: scope !== null, resetKey: scopeKey },
  )

  // `reload` is stable (useQuery memoises it), so depending on this rather than
  // on the query object keeps `submit` — and the shortcut table built from it —
  // from being rebuilt on every keystroke in the grid.
  const reloadPending = pending.reload

  const pendingViews = useMemo<PendingView[]>(() => (pending.data?.data ?? []).map((row) => pendingView(row, today)), [pending.data, today])
  const referenceGroups = useMemo(() => groupByDocument(pendingViews), [pendingViews])
  const referenceId = header.metadata.reference_outward_document_id ? Number(header.metadata.reference_outward_document_id) : null
  const drawerViews = useMemo(
    () => (referenceId ? pendingViews.filter((v) => v.documentId === referenceId) : pendingViews),
    [pendingViews, referenceId],
  )
  const openByItem = useMemo(() => {
    const map = new Map<number, number>()
    for (const view of pendingViews) map.set(view.itemId, round4((map.get(view.itemId) ?? 0) + view.open))
    return map
  }, [pendingViews])

  // ---- settlements --------------------------------------------------------

  const settlements = useMemo<JobWorkSettlement[]>(
    () => (header.metadata.job_work_settlements ?? []) as JobWorkSettlement[],
    [header.metadata.job_work_settlements],
  )
  const settledViews = useMemo(() => {
    const byId = new Map(pendingViews.map((v) => [v.pendingId, v]))
    return settlements.map((s) => byId.get(s.pending_id)).filter((v): v is PendingView => v !== undefined)
  }, [settlements, pendingViews])

  const applySettlements = useCallback(
    (next: JobWorkSettlement[], picked: PendingView[]) => {
      const byId = new Map(picked.map((v) => [v.pendingId, v]))
      const generated: LineDraft[] = next
        .filter((s) => s.settlement_type === 'consumed')
        .map((s) => {
          const view = byId.get(s.pending_id)
          return newLine(spec, {
            key: `settle-${s.pending_id}`,
            item_id: view?.itemId ?? null,
            item_name: view?.itemName ?? '',
            item_sku: view?.itemSku ?? null,
            units: view?.unitId ? [{ unit_id: view.unitId, unit_symbol: view.unitSymbol, conversion_factor: 1, is_default: true }] : [],
            unit_id: view?.unitId ?? null,
            warehouse_id: view?.warehouseId ?? null,
            direction: 'out',
            qty: String(s.qty),
            description: `Consumed at the job worker · ${view?.documentNo ?? ''}`.trim(),
            origin: 'settlement' as LineOrigin,
            metadata: { settlement_pending_id: s.pending_id },
          })
        })
      setDirty(true)
      setLines((current) => [...current.filter((l) => l.origin !== 'settlement' && !isBlankLine(l)), ...generated])
      setHeader((h) => ({ ...h, metadata: { ...h.metadata, job_work_settlements: next } }))
      if (header.party_ref === '' && picked[0]?.partyRef) {
        setHeader((h) => ({ ...h, party_ref: String(picked[0].partyRef), party_name: picked[0].partyName ?? h.party_name }))
      }
    },
    [spec, header.party_ref],
  )

  // ---- availability (dispatch only) ---------------------------------------

  const availabilityEntries = useMemo<AvailabilityEntry[]>(() => {
    if (mode !== 'out') return []
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
  }, [mode, lines, header.default_warehouse_id])
  const { results: availability, checking } = useAvailability(availabilityEntries, mode === 'out')

  // ---- derived ------------------------------------------------------------

  const validation = useMemo(() => validateJobWork(header, lines, mode), [header, lines, mode])
  const totals = draftTotals(lines, spec)
  const effect = useMemo(() => stockEffect(mode, lines, settlements), [mode, lines, settlements])
  const offending = useMemo(() => new Set(negative ? offendingDraftKeys(lines, negative) : []), [negative, lines])

  const warnings = useMemo<SmartWarning[]>(() => {
    if (!FEATURES.jobWorkSmartWarnings) return []
    return [
      ...smartWarnings({ mode, lines, selected: settledViews, settlements, availability, today }),
      ...lineAdvisories(lines),
    ]
  }, [mode, lines, settledViews, settlements, availability, today])

  const inventoryValue = useMemo(() => {
    let total = 0
    for (const l of lines) {
      if (isBlankLine(l) || l.direction !== 'in') continue
      const rate = toNumber(l.valuation_rate)
      if (rate === null) continue
      total = round4(total + lineBaseQty(l) * rate)
    }
    return total
  }, [lines])

  const progress = useMemo(() => settlementProgress(settledViews), [settledViews])
  const workerContext = useMemo(() => {
    if (partyRefNum === null) return null
    const open = pendingViews.reduce((t, v) => round4(t + v.open), 0)
    if (open <= 0) return `${header.party_name || `Ledger #${partyRefNum}`} is holding nothing at the moment.`
    return `${header.party_name || `Ledger #${partyRefNum}`} is holding ${formatQty(open)} across ${referenceGroups.length} open dispatch${referenceGroups.length === 1 ? '' : 'es'}.`
  }, [partyRefNum, pendingViews, referenceGroups.length, header.party_name])

  // ---- navigation guards --------------------------------------------------

  useUnsavedChanges({
    when: dirty && busy === null,
    onBlocked: (to, proceed) => setLeaveTo({ to, proceed }),
  })

  // ---- actions ------------------------------------------------------------

  const addLine = useCallback(() => {
    const line = newLine(spec, { warehouse_id: header.default_warehouse_id })
    setDirty(true)
    setLines((ls) => [...ls, line])
    setAutoFocusKey(line.key)
  }, [spec, header.default_warehouse_id])

  const addFromItem = useCallback(
    (row: ItemSearchRow, qty: number, rate: number | null, batchNo: string, remarks: string) => {
      const units = unitOptionsFrom(row)
      const def = units.find((u) => u.is_default) ?? units[0]
      setDirty(true)
      setLines((current) => {
        const existing = current.find((l) => l.item_id === row.item_id && l.origin === 'manual' && !l.batch_id && !l.serials.length)
        if (existing && batchNo === '') {
          // A second scan of the same label means one more of it, not a second row.
          const next = round4((toNumber(existing.qty) ?? 0) + qty)
          return current.map((l) => (l.key === existing.key ? { ...l, qty: String(next) } : l))
        }
        const line = newLine(spec, {
          item_id: row.item_id,
          item_name: row.print_name || row.item_name,
          item_sku: row.item_sku,
          track_batch: Number(row.track_batch) === 1,
          track_serial: Number(row.track_serial) === 1,
          units,
          unit_id: def?.unit_id ?? row.unit_id ?? null,
          warehouse_id: row.default_warehouse_id ?? header.default_warehouse_id ?? null,
          qty: String(qty),
          rate: rate !== null ? String(rate) : '',
          amount: rate !== null ? String(round4(qty * rate)) : '',
          batch_no: batchNo || null,
          description: remarks,
        })
        return [...current.filter((l) => !isBlankLine(l)), line]
      })
    },
    [spec, header.default_warehouse_id],
  )

  const scan = useCallback(
    async (code: string) => {
      const trimmed = code.trim()
      if (trimmed === '') return
      setScanError(null)
      try {
        // Scoped to the warehouse the line will land in, so the availability
        // the scan reports is the availability where it actually matters.
        const row = await lookupApi.itemByBarcode(trimmed, { warehouseId: header.default_warehouse_id })
        if (!row) {
          setScanError(`Nothing carries the code “${trimmed}”.`)
          return
        }
        addFromItem(row, 1, null, '', '')
        setScanValue('')
      } catch (err) {
        setScanError(errorMessage(err, 'The scan could not be checked against the item master.'))
      }
    },
    [addFromItem, header.default_warehouse_id],
  )

  const submit = useCallback(
    async (post: boolean) => {
      setSubmitted(true)
      setApiError(null)
      setConflict(null)
      setPostWarnings([])
      if (!post) setNegative(null)
      const check = validateJobWork(header, lines, mode)
      if (!check.ok) {
        const firstField = Object.keys(check.fields)[0]
        if (firstField) document.getElementById(firstField)?.focus()
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
        if (post) {
          doc = await documentsApi.post(doc.document_id, { negativeOverride: override && canOverride })
          setPostWarnings(doc.warnings ?? [])
          toast.success(`${spec.label} ${doc.document_no ?? `#${doc.document_id}`} posted.`)
        } else {
          toast.success('Draft saved.')
        }
        setDirty(false)
        onSaved(doc, post)
      } catch (err) {
        const neg = parseNegativeStock(err)
        if (neg) {
          setNegative(neg)
          setApiError(id ? `Draft #${id} is saved but could not be posted.` : errorMessage(err))
        } else if (isApiError(err) && err.details?.pending_id) {
          // Somebody else settled the same dispatch between this form loading
          // and this post. Never silently overwrite — say what changed.
          setConflict(err.message)
          reloadPending()
        } else {
          setApiError(isApiError(err) && err.field ? `${err.message} (${err.field})` : errorMessage(err))
        }
        toast.error(post ? `Unable to post this ${spec.label.toLowerCase()}.` : 'Unable to save the draft.')
      } finally {
        setBusy(null)
      }
    },
    [header, lines, mode, savedId, spec, override, canOverride, onSaved, toast, reloadPending],
  )

  const switchMode = useCallback(
    (next: JobWorkMode) => {
      if (next === mode) return
      navigate(`/documents/new/${JOB_WORK_SLUG[next]}`)
    },
    [mode, navigate],
  )

  const assistantAction = useCallback(
    (action: AssistantActionKey) => {
      switch (action) {
        case 'fetch_pending':
        case 'open_jobs':
          setPendingOpen(true)
          break
        case 'scan':
          setScanOpen(true)
          window.setTimeout(() => scanRef.current?.focus(), 0)
          break
        case 'paste':
          setImportOpen(true)
          break
        case 'availability':
          // Availability is already checked live on every line as it is typed;
          // this brings the operator to the column that shows it rather than
          // firing a second, identical request and calling it a feature.
          document.getElementById('jw-lines-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          break
        case 'valuation':
          document.getElementById('jw-stock-effect')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          break
      }
    },
    [],
  )

  // ---- keyboard -----------------------------------------------------------

  const bindings = useMemo(
    () => ({
      'ctrl+s': (e: KeyboardEvent) => {
        e.preventDefault()
        if (busy === null && canSaveDraft) void submit(false)
      },
      'ctrl+enter': (e: KeyboardEvent) => {
        e.preventDefault()
        if (busy === null && canPost) void submit(true)
      },
      'alt+a': (e: KeyboardEvent) => {
        e.preventDefault()
        addLine()
      },
      'alt+p': (e: KeyboardEvent) => {
        e.preventDefault()
        setPendingOpen(true)
      },
      'alt+i': (e: KeyboardEvent) => {
        e.preventDefault()
        if (canSwitchMode || mode === 'in') switchMode('in')
      },
      'alt+o': (e: KeyboardEvent) => {
        e.preventDefault()
        if (canSwitchMode || mode === 'out') switchMode('out')
      },
    }),
    [busy, canSaveDraft, canPost, canSwitchMode, mode, submit, addLine, switchMode],
  )
  useKeyboardScope('form', bindings, { allowInInput: true })

  // ---- header actions -----------------------------------------------------

  const other = otherMode(mode)
  const otherSpec = jobWorkModeSpec(other)
  const menuActions = useMemo<MenuAction[]>(() => {
    const actions: MenuAction[] = [
      {
        key: 'duplicate',
        label: 'Duplicate as a new draft',
        icon: Copy,
        onSelect: () => {
          setSavedId(null)
          setHeader((h) => ({ ...h, document_no: '', document_date: todayIso(), metadata: { ...h.metadata, job_work_settlements: undefined } }))
          setLines((ls) => ls.filter((l) => l.origin !== 'settlement').map((l) => ({ ...l, key: `${l.key}-copy` })))
          setDirty(true)
          toast.info('Copied into a new draft. Nothing is saved until you save it.')
        },
      },
    ]
    if (savedId) {
      actions.push(
        { key: 'open', label: 'Open the document', icon: FileText, onSelect: () => navigate(`/documents/${savedId}`) },
        { key: 'print', label: 'Print', icon: Printer, onSelect: () => navigate(`/documents/${savedId}/print`) },
        { key: 'audit', label: 'Audit trail', icon: History, separated: true, onSelect: () => navigate(`/audit?entity_type=document&entity_id=${savedId}`) },
      )
      if (canCancel) {
        actions.push({
          key: 'discard',
          label: 'Discard this draft',
          icon: Trash2,
          danger: true,
          separated: true,
          onSelect: () => {
            void documentsApi
              .cancel(savedId, 'Discarded from the job work screen')
              .then(() => {
                setDirty(false)
                toast.success('Draft discarded.')
                navigate('/documents')
              })
              .catch((err: unknown) => toast.error(errorMessage(err, 'The draft could not be discarded.')))
          },
        })
      }
    }
    return actions
  }, [savedId, canCancel, navigate, toast])

  const status = (existing?.status ?? 'DRAFT') as DocumentStatus
  const disabled = busy !== null

  return (
    <PageShell paddingBottom className={cx(AIC, 'jw-page')}>
      <BreadcrumbBar
        homeTo="/dashboard"
        items={[
          { label: 'Documents', to: '/documents' },
          { label: 'Job Work', to: '/documents/new' },
          { label: modeSpec.title },
        ]}
      />

      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
            <modeSpec.icon className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold text-gray-900">
                {savedId && existing ? `${modeSpec.title} ${existing.document_no ?? `#${savedId}`}` : modeSpec.newTitle}
              </h1>
              {existing ? (
                <StatusBadge tone={statusTone(status)} label={STATUS_LABELS[status] ?? status} />
              ) : (
                <Badge tone="neutral" size="xs">
                  New
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-sm text-gray-500">{modeSpec.subtitle}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {canSwitchMode ? (
            <Button
              variant="secondary"
              icon={other === 'out' ? ArrowUpFromLine : ArrowDownToLine}
              onClick={() => switchMode(other)}
              title={`${otherSpec.title} (${other === 'in' ? 'Alt+I' : 'Alt+O'})`}
            >
              {otherSpec.title}
            </Button>
          ) : null}
          {mode === 'in' ? (
            <Button
              variant="secondary"
              icon={BookOpen}
              onClick={() => setPendingOpen(true)}
              title="Material with this job worker (Alt+P)"
            >
              View pending
            </Button>
          ) : (
            <Button variant="secondary" icon={PackageSearch} onClick={() => setPendingOpen(true)} title="Open job orders (Alt+P)">
              Open job orders
            </Button>
          )}
          {FEATURES.jobWorkImport ? (
            <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>
              Import
            </Button>
          ) : null}
          <MenuButton actions={menuActions} label="More actions" variant="secondary" size="sm">
            More
          </MenuButton>
        </div>
      </header>

      <JobWorkKpiStrip
        summary={summary.data}
        loading={summary.loading}
        error={summary.error ? errorMessage(summary.error) : null}
        mode={mode}
        onRetry={summary.reload}
      />

      {refError ? <Notice kind="warning">{refError}</Notice> : null}

      {/* `items-start`: the two columns are different heights by nature — the
          assistant grows with the stock effect, the form does not — and
          stretching the shorter one leaves a band of empty card under its
          chips. */}
      <div className={cx('grid min-w-0 items-start gap-3', FEATURES.jobWorkAssistant ? 'xl:grid-cols-[minmax(0,3fr)_minmax(19rem,1fr)]' : 'grid-cols-1')}>
        <JobWorkDetailsCard
          modeSpec={modeSpec}
          mode={mode}
          header={header}
          patch={patch}
          patchMeta={patchMeta}
          warehouses={warehouses}
          references={referenceGroups}
          referencesLoading={pending.loading}
          fieldErrors={submitted ? validation.fields : {}}
          disabled={disabled}
          onModeChange={switchMode}
          onAutoFill={() => setPendingOpen(true)}
          numberLocked={savedId !== null && Boolean(existing?.document_no)}
        />
        {FEATURES.jobWorkAssistant ? (
          <JobWorkAssistant
            modeSpec={modeSpec}
            onAction={assistantAction}
            onPrimary={() => setPendingOpen(true)}
            effect={effect}
            disabled={disabled}
            context={workerContext}
          />
        ) : null}
      </div>

      {mode === 'in' && settlements.length > 0 ? (
        <Card padding="md" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-900">
                Settling {settlements.length} pending quantit{settlements.length === 1 ? 'y' : 'ies'}
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">
                {formatQty(progress.received)} of {formatQty(progress.sent)} already back on these dispatches
                {progress.sent > 0 ? ` · ${progress.percent}% complete` : ''}.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {FEATURES.jobWorkTimeline && settledViews[0] ? (
                <Button variant="ghost" size="xs" icon={History} onClick={() => setTimelineFor(settledViews[0].pendingId)}>
                  Timeline
                </Button>
              ) : null}
              <Button variant="secondary" size="xs" onClick={() => setPendingOpen(true)}>
                Change
              </Button>
            </div>
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {settledViews.map((view) => {
              const s = settlements.find((x) => x.pending_id === view.pendingId)
              return (
                <li key={view.pendingId}>
                  <button
                    type="button"
                    onClick={() => setTimelineFor(view.pendingId)}
                    disabled={!FEATURES.jobWorkTimeline}
                    className="aic inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-700 hover:border-primary/40 hover:bg-primary-light disabled:cursor-default disabled:hover:border-gray-200 disabled:hover:bg-gray-50"
                  >
                    <span className="font-medium">{view.itemName}</span>
                    <span className="tabular-nums text-gray-500">
                      {formatQty(s?.qty ?? 0)} {s?.settlement_type === 'returned' ? 'returned' : 'consumed'}
                    </span>
                    <span className="text-gray-400">· {view.documentNo}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      ) : null}

      {/* `min-w-0`: the page is a flex column, and a flex item defaults to
          `min-width: auto` — so the grid's own min-width would set the width of
          the whole page and scroll a phone sideways instead of scrolling the
          table inside its own box. */}
      <Card padding="md" id="jw-lines-card" className="min-w-0">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">{modeSpec.linesTitle}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{modeSpec.linesSubtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {FEATURES.jobWorkBarcodeScan ? (
              <Button
                variant={scanOpen ? 'outline' : 'secondary'}
                size="sm"
                icon={ScanLine}
                onClick={() => {
                  setScanOpen((s) => !s)
                  window.setTimeout(() => scanRef.current?.focus(), 0)
                }}
                aria-pressed={scanOpen}
              >
                Scan
              </Button>
            ) : null}
            {FEATURES.jobWorkImport ? (
              <Button variant="secondary" size="sm" icon={Upload} onClick={() => setImportOpen(true)}>
                Paste from Excel
              </Button>
            ) : null}
            {mode === 'in' ? (
              <Button variant="outline" size="sm" icon={PackageSearch} onClick={() => setPendingOpen(true)} kbd="Alt+P">
                Auto fill from pending
              </Button>
            ) : (
              <Button variant="outline" size="sm" icon={PackageSearch} onClick={() => setPendingOpen(true)} kbd="Alt+P">
                What this worker holds
              </Button>
            )}
          </div>
        </div>

        {scanOpen && FEATURES.jobWorkBarcodeScan ? (
          <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50 p-3">
            <label htmlFor="jw-scan" className="text-xs font-semibold text-violet-700">
              Scan or type a barcode
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="jw-scan"
                ref={scanRef}
                value={scanValue}
                autoComplete="off"
                placeholder="Point the scanner here and fire"
                onChange={(e) => setScanValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  void scan(scanValue)
                }}
                className="aic h-8 flex-1 rounded-lg border border-violet-200 bg-white px-3 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-300/40"
              />
              <Button size="sm" onClick={() => void scan(scanValue)}>
                Add
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] text-violet-600" role={scanError ? 'alert' : undefined}>
              {scanError ?? 'Each scan adds one; scanning the same label again increases its quantity.'}
            </p>
          </div>
        ) : null}

        <JobWorkLines
          spec={spec}
          modeSpec={modeSpec}
          mode={mode}
          header={header}
          lines={lines}
          onChange={changeLines}
          warehouses={warehouses}
          availability={availability}
          checking={checking}
          openByItem={openByItem}
          offendingKeys={offending}
          invalidKeys={submitted ? validation.lineKeys : EMPTY_KEYS}
          disabled={disabled}
          autoFocusKey={autoFocusKey}
          footer={
            <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-500">
              <div className="flex items-center gap-1.5">
                <dt>Items</dt>
                <dd className="font-semibold tabular-nums text-gray-900">{totals.lines}</dd>
              </div>
              {mode === 'in' ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <dt>Received</dt>
                    <dd className="font-semibold tabular-nums text-gray-900">{formatQty(totals.qtyIn, '0')}</dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <dt>Consumed</dt>
                    <dd className="font-semibold tabular-nums text-gray-900">{formatQty(totals.qtyOut, '0')}</dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <dt>Inventory value</dt>
                    <dd className="font-semibold tabular-nums text-gray-900">{formatMoney(inventoryValue, '0.00')}</dd>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-1.5">
                  <dt>Total qty</dt>
                  <dd className="font-semibold tabular-nums text-gray-900">{formatQty(totals.qtyOut, '0')}</dd>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <dt>Challan value</dt>
                <dd className="font-semibold tabular-nums text-gray-900">{formatMoney(totals.amount, '0.00')}</dd>
              </div>
            </dl>
          }
        />

        {refLoading && warehouses.length === 0 ? <p className="mt-2 text-xs text-gray-500">Loading warehouses…</p> : null}
      </Card>

      {submitted && !validation.ok ? (
        <Notice kind="error" title="Fix these before saving">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {validation.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {conflict ? (
        <Notice
          kind="error"
          title="The pending quantity changed"
          actions={
            <Button
              variant="secondary"
              size="xs"
              onClick={() => {
                pending.reload()
                setConflict(null)
              }}
            >
              Refresh pending
            </Button>
          }
        >
          {conflict} Nothing was overwritten — refresh and adjust what this receipt settles.
        </Notice>
      ) : null}

      {apiError && !negative ? <Notice kind="error">{apiError}</Notice> : null}

      {negative ? (
        <Notice kind="error" title="Insufficient stock">
          {apiError ? <p>{apiError}</p> : null}
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {negative.map((d, i) => (
              <li key={`${d.item_id}-${d.warehouse_id}-${i}`}>
                {d.item_name ?? `Item #${d.item_id}`}: on hand {formatQty(d.on_hand)}, required {formatQty(d.required)}, short by{' '}
                <strong>{formatQty(d.short_by)}</strong>
              </li>
            ))}
          </ul>
          {canOverride ? (
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              Post anyway and let stock go negative
            </label>
          ) : (
            <p className="mt-1 text-xs">Reduce the quantities or receive stock first — posting into negative stock needs the override permission.</p>
          )}
        </Notice>
      ) : null}

      {postWarnings.length > 0 ? (
        <Notice kind="warning" title="Posted with warnings">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {postWarnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {warnings.length > 0 ? (
        <Card padding="sm">
          <ul className="space-y-1.5">
            {warnings.map((w) => (
              <li key={w.key} className="flex items-start gap-2 text-xs">
                {w.tone === 'danger' ? (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden />
                ) : w.tone === 'warning' ? (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                ) : (
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" aria-hidden />
                )}
                <span className={w.tone === 'danger' ? 'text-red-700' : 'text-gray-600'}>
                  {w.message}
                  {w.blocking ? <span className="ml-1 font-semibold">This will be refused on posting.</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <StickyActionBar
        status={
          <span className={cx('text-xs', validation.ok ? 'text-emerald-700' : 'text-gray-500')}>
            {validation.ok
              ? 'Ready to post'
              : `${validation.messages.length} thing${validation.messages.length === 1 ? '' : 's'} to complete`}
          </span>
        }
        totals={
          <>
            <ActionBarTotal label="Lines" value={totals.lines} />
            <ActionBarTotal label={mode === 'in' ? 'Received' : 'Sent'} value={formatQty(mode === 'in' ? totals.qtyIn : totals.qtyOut, '0')} />
            <ActionBarTotal
              label={mode === 'in' ? 'Inventory value' : 'Challan value'}
              value={formatMoney(mode === 'in' ? inventoryValue : totals.amount, '0.00')}
              tone="primary"
            />
          </>
        }
      >
        <Link
          to={savedId ? `/documents/${savedId}` : '/documents'}
          className="aic inline-flex h-8 items-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 no-underline hover:bg-gray-50"
        >
          Cancel
        </Link>
        <Button variant="secondary" onClick={() => void submit(false)} disabled={disabled || !canSaveDraft} loading={busy === 'save'} kbd="Ctrl+S">
          {savedId ? 'Save changes' : 'Save as draft'}
        </Button>
        {canPost ? (
          <Button icon={Send} onClick={() => void submit(true)} disabled={disabled || (!canSaveDraft && !savedId)} loading={busy === 'post'} kbd="Ctrl+↵">
            {negative && override ? 'Post with override' : 'Save & post'}
          </Button>
        ) : null}
        {savedId ? (
          <Button variant="secondary" icon={Eye} onClick={() => navigate(`/documents/${savedId}`)}>
            Preview
          </Button>
        ) : null}
      </StickyActionBar>

      <PendingJobWorkDrawer
        open={pendingOpen}
        onClose={() => setPendingOpen(false)}
        mode={mode}
        rows={drawerViews}
        loading={pending.loading}
        error={pending.error ? errorMessage(pending.error) : null}
        onRetry={pending.reload}
        value={settlements}
        onApply={applySettlements}
        workerName={header.party_name || (partyRefNum ? `ledger #${partyRefNum}` : null)}
      />

      {FEATURES.jobWorkImport ? (
        <JobWorkImportDrawer
          open={importOpen}
          onClose={() => setImportOpen(false)}
          title={mode === 'in' ? 'Import finished goods' : 'Import material to send'}
          onImport={(rows) => {
            for (const row of rows) addFromItem(row.item, row.qty, row.rate, row.batch, row.remarks)
            toast.success(`${rows.length} line${rows.length === 1 ? '' : 's'} added. Check batches and serials before posting.`)
          }}
        />
      ) : null}

      {FEATURES.jobWorkTimeline ? <JobWorkTimelineDrawer pendingId={timelineFor} onClose={() => setTimelineFor(null)} /> : null}

      <ConfirmDialog
        open={leaveTo !== null}
        title="You have unsaved changes"
        message="Leaving now discards what you have keyed on this document."
        confirmLabel="Discard changes"
        danger
        onConfirm={() => {
          const target = leaveTo
          setLeaveTo(null)
          setDirty(false)
          target?.proceed()
        }}
        onCancel={() => setLeaveTo(null)}
      />
    </PageShell>
  )
}

const EMPTY_KEYS: ReadonlySet<string> = new Set<string>()
