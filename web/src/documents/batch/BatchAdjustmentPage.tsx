import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Boxes, Printer, Save, Send, ShieldCheck, X } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Notice } from '../../components/Notice'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { errorMessage, isApiError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { lookupApi } from '../../services/lookupApi'
import type { BatchRow, ItemSearchRow } from '../../services/lookupApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { KeyboardShortcutHint } from '../../ui/Kbd'
import { notify } from '../../ui/notify'
import { BreadcrumbBar } from '../../ui/shell/BreadcrumbBar'
import { PageShell } from '../../ui/shell/PageShell'
import { StickyActionBar } from '../../ui/shell/StickyActionBar'
import { formatQty, todayIso } from '../../utils/format'
import { unitOptionsFrom } from '../LineEditor'
import { canCreate, permissionKeysFor } from '../actions'
import { isBlankLine, newHeader, newLine, nextLineKey, toPayload, validateDraft } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { parseNegativeStock } from '../negativeStock'
import type { NegativeStockDetail } from '../negativeStock'
import type { DocumentTypeSpec } from '../registry'
import type { InventoryDocument, LineSerial, PostingWarning } from '../types'
import { useReferenceData } from '../useReferenceData'
import { BatchAdjustmentDetails, FIELD_IDS } from './BatchAdjustmentDetails'
import { BatchAdjustmentHeader, BatchAssistStrip } from './BatchAdjustmentHeader'
import { BatchAdjustmentKpis } from './BatchAdjustmentKpis'
import { BatchAdjustmentSidebar } from './BatchAdjustmentSidebar'
import { BatchAdjustmentWorkspace } from './BatchAdjustmentWorkspace'
import { BATCH_ROW_ID_PREFIX } from './BatchAdjustmentRow'
import { BatchAssistDrawer } from './BatchAssistDrawer'
import { ImportLinesDialog, ScanAddDialog } from './BatchLineIntake'
import type { IntakeLine } from './BatchLineIntake'
import { PostConfirmationModal } from './PostConfirmationModal'
import { SerialMappingDrawer } from './SerialMappingDrawer'
import {
  applyBatchMapping,
  batchAdjustmentMetrics,
  clearBatchMapping,
  issuesByLine,
  populatedLines,
  tabCounts,
  tabLines,
  validateBatchAdjustment,
  validationChecks,
} from './batchAdjustmentModel'
import type { BatchIssue, IssueField, LineTab } from './batchAdjustmentModel'
import { buildAssistReport, matchingInLine, unpairedOutLines } from './batchAssist'
import type { AssistItem } from './batchAssist'
import { useBatchCatalog } from './useBatchCatalog'

export interface BatchAdjustmentPageProps {
  spec: DocumentTypeSpec
  /** Editing an existing draft. */
  documentId?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  /** A posted or cancelled document: the same workspace, nothing editable. */
  readOnly?: boolean
  statusLabel?: string
  documentNo?: string | null
  onSaved?: (doc: InventoryDocument, posted: boolean) => void
}

/** Which control in a row a validation message points at. */
const FIELD_SELECTOR: Record<Exclude<IssueField, null | 'document_date' | 'default_warehouse'>, string> = {
  item: 'input,button',
  warehouse: '[aria-label^="Warehouse on line"]',
  from_batch: '[aria-label^="Current batch on line"]',
  to_batch: '[aria-label^="Revised batch on line"]',
  direction: '[aria-label^="Direction on line"]',
  qty: '[aria-label^="Quantity on line"]',
  serials: 'button',
}

function describeError(err: unknown): string {
  if (isApiError(err)) return err.field ? `${err.message} (${err.field})` : err.message
  return errorMessage(err)
}

/**
 * Documents → Batch Adjustment.
 *
 * A batch adjustment moves quantity off one batch and onto another without changing what the
 * stock is worth — the server declares the type `valuation => false` and `movesStockNow()` false
 * for it — so the screen is built around the one question that matters: does what leaves the
 * batches equal what arrives, and is every line something the server will accept.
 *
 * The draft, the payload and the save / post calls are the shared ones (`documents/formModel`,
 * `services/documentsApi`); only the editor around them is new.
 */
export function BatchAdjustmentPage({ spec, documentId, initial, readOnly = false, statusLabel, documentNo, onSaved }: BatchAdjustmentPageProps) {
  const navigate = useNavigate()
  const { can } = useAccess()
  const { warehouses, defaultWarehouseId, warehouseName, error: refError } = useReferenceData()

  const [header, setHeader] = useState<HeaderDraft>(() => initial?.header ?? newHeader(spec, todayIso()))
  const [lines, setLines] = useState<LineDraft[]>(() => initial?.lines ?? [newLine(spec)])
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState<LineTab>('all')
  const [busy, setBusy] = useState<'save' | 'validate' | 'post' | null>(null)
  const [draftErrors, setDraftErrors] = useState<string[]>([])
  const [apiError, setApiError] = useState<string | null>(null)
  const [negative, setNegative] = useState<NegativeStockDetail[] | null>(null)
  const [override, setOverride] = useState(false)
  const [warnings, setWarnings] = useState<PostingWarning[]>([])
  const [assistOpen, setAssistOpen] = useState(false)
  const [assistDismissed, setAssistDismissed] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [confirmPost, setConfirmPost] = useState(false)
  const [serialKey, setSerialKey] = useState<string | null>(null)
  const [pendingFocus, setPendingFocus] = useState<{ key: string; field: IssueField } | null>(null)
  const [blockedNav, setBlockedNav] = useState<(() => void) | null>(null)

  const canOverride = can('stock.negative_override')
  const canPost = can(permissionKeysFor('post', spec.code))
  const canSave = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)
  const disabled = busy !== null

  // Pre-fill the default warehouse once reference data is known — new documents only, and only
  // onto lines the user has not given one.
  const seeded = useRef(false)
  useEffect(() => {
    if (documentId || seeded.current || defaultWarehouseId === null || header.default_warehouse_id !== null) return
    seeded.current = true
    setHeader((h) => ({ ...h, default_warehouse_id: defaultWarehouseId }))
  }, [defaultWarehouseId, documentId, header.default_warehouse_id])

  /**
   * Editing a stored draft: the lines come back knowing only their own unit, so the items are read
   * once (`POST /v1/items/bulk-lookup`) to restore the unit list and the batch / serial flags the
   * pickers and the rules depend on. Without it a reopened draft looks untracked.
   */
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
            const item = l.item_id !== null ? byId.get(l.item_id) : undefined
            if (!item) return l
            const units = unitOptionsFrom(item)
            return {
              ...l,
              item_sku: l.item_sku ?? item.item_sku,
              track_batch: l.track_batch || Number(item.track_batch) === 1,
              track_serial: l.track_serial || Number(item.track_serial) === 1,
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

  const catalogRequests = useMemo(
    () =>
      lines
        .filter((l) => l.item_id !== null && l.track_batch)
        .map((l) => ({ itemId: l.item_id as number, warehouseId: l.warehouse_id ?? header.default_warehouse_id })),
    [lines, header.default_warehouse_id],
  )
  const catalog = useBatchCatalog(catalogRequests)

  const issues = useMemo(() => validateBatchAdjustment({ header, lines, batchIndex: catalog.index }), [header, lines, catalog.index])
  const issueMap = useMemo(() => issuesByLine(issues), [issues])
  const metrics = useMemo(() => batchAdjustmentMetrics(lines, issues), [lines, issues])
  const checks = useMemo(() => validationChecks(issues), [issues])
  const report = useMemo(() => buildAssistReport(header, lines, issues), [header, lines, issues])
  const unpaired = useMemo(() => unpairedOutLines(lines, header.default_warehouse_id), [lines, header.default_warehouse_id])

  // "Resolved" is a session fact: a line that carried an issue and carries none now.
  const everFlagged = useRef(new Set<string>())
  const [flaggedTick, setFlaggedTick] = useState(0)
  useEffect(() => {
    let changed = false
    for (const key of issueMap.keys()) {
      if (!everFlagged.current.has(key)) {
        everFlagged.current.add(key)
        changed = true
      }
    }
    if (changed) setFlaggedTick((t) => t + 1)
  }, [issueMap])

  const counts = useMemo(() => tabCounts(lines, issues, everFlagged.current), [lines, issues, flaggedTick])
  const visibleLines = useMemo(() => tabLines(lines, issues, everFlagged.current)[tab], [lines, issues, tab, flaggedTick])
  const numbering = useMemo(() => new Map(lines.map((l, i) => [l.key, i + 1])), [lines])

  const patchHeader = useCallback((patch: Partial<HeaderDraft>) => {
    setDirty(true)
    setHeader((h) => ({ ...h, ...patch }))
  }, [])

  const patchLine = useCallback((key: string, patch: Partial<LineDraft>) => {
    setDirty(true)
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }, [])

  const focusLine = useCallback((key: string, field: IssueField = null) => {
    setTab('all')
    setPendingFocus({ key, field })
  }, [])

  useEffect(() => {
    if (!pendingFocus) return
    const row = document.getElementById(`${BATCH_ROW_ID_PREFIX}${pendingFocus.key}`)
    setPendingFocus(null)
    if (!row) return
    row.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const selector = pendingFocus.field && pendingFocus.field in FIELD_SELECTOR ? FIELD_SELECTOR[pendingFocus.field as keyof typeof FIELD_SELECTOR] : 'input,select,button'
    const target = row.querySelector<HTMLElement>(selector) ?? row.querySelector<HTMLElement>('input,select,button')
    target?.focus()
  }, [pendingFocus, visibleLines])

  const focusIssue = useCallback(
    (issue: BatchIssue) => {
      if (issue.lineKey) {
        focusLine(issue.lineKey, issue.field)
        return
      }
      const id = issue.field === 'document_date' ? FIELD_IDS.document_date : issue.field === 'default_warehouse' ? FIELD_IDS.default_warehouse : null
      if (!id) return
      const el = document.getElementById(id)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el?.focus()
    },
    [focusLine],
  )

  const addLine = useCallback(() => {
    const line = newLine(spec, { warehouse_id: header.default_warehouse_id })
    setDirty(true)
    setLines((ls) => [...ls, line])
    setTab('all')
    setPendingFocus({ key: line.key, field: 'item' })
  }, [spec, header.default_warehouse_id])

  const pickItem = useCallback(
    (key: string, row: ItemSearchRow) => {
      const units = unitOptionsFrom(row)
      const def = units.find((u) => u.is_default) ?? units[0]
      setDirty(true)
      setLines((ls) => {
        const next = ls.map((l) =>
          l.key === key
            ? {
                ...l,
                ...clearBatchMapping(l),
                item_id: row.item_id,
                item_name: row.print_name || row.item_name,
                item_sku: row.item_sku,
                track_batch: Number(row.track_batch) === 1,
                track_serial: Number(row.track_serial) === 1,
                units,
                unit_id: def?.unit_id ?? row.unit_id ?? null,
                warehouse_id: l.warehouse_id ?? row.default_warehouse_id ?? header.default_warehouse_id ?? null,
              }
            : l,
        )
        // Picking an item on the last row opens the next one, so entry never stops to click.
        const last = next[next.length - 1]
        return last && last.key === key ? [...next, newLine(spec, { warehouse_id: header.default_warehouse_id })] : next
      })
    },
    [header.default_warehouse_id, spec],
  )

  const clearItem = useCallback(
    (key: string) => {
      setDirty(true)
      setLines((ls) =>
        ls.map((l) =>
          l.key === key ? { ...l, ...clearBatchMapping(l), item_id: null, item_name: '', item_sku: null, track_batch: false, track_serial: false, units: [], unit_id: null } : l,
        ),
      )
    },
    [],
  )

  const removeLine = useCallback((key: string) => {
    setDirty(true)
    setLines((ls) => {
      const next = ls.filter((l) => l.key !== key)
      return next.length > 0 ? next : [newLine(spec)]
    })
  }, [spec])

  const duplicateLine = useCallback((key: string) => {
    setDirty(true)
    setLines((ls) => {
      const at = ls.findIndex((l) => l.key === key)
      if (at < 0) return ls
      // A copy is a new local row, never a second reference to the stored line: its serials are
      // dropped because the same serial number cannot be on two lines.
      const copy: LineDraft = { ...ls[at], key: nextLineKey(), serials: [] }
      return [...ls.slice(0, at + 1), copy, ...ls.slice(at + 1)]
    })
  }, [])

  const clearMapping = useCallback(
    (key: string) => {
      setDirty(true)
      setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...clearBatchMapping(l) } : l)))
    },
    [],
  )

  const createBatch = useCallback(
    async (key: string, body: { batch_no: string; expiry_date: string | null }): Promise<BatchRow> => {
      const line = lines.find((l) => l.key === key)
      if (!line || line.item_id === null) throw new Error('Pick an item on the line first.')
      return catalog.create({ itemId: line.item_id, warehouseId: line.warehouse_id ?? header.default_warehouse_id }, body)
    },
    [lines, catalog, header.default_warehouse_id],
  )

  const applySerials = useCallback(
    (key: string, serials: LineSerial[]) => {
      patchLine(key, { serials })
      setSerialKey(null)
    },
    [patchLine],
  )

  const pairLine = useCallback(
    (key: string) => {
      setDirty(true)
      setLines((ls) => {
        const at = ls.findIndex((l) => l.key === key)
        if (at < 0) return ls
        return [...ls.slice(0, at + 1), matchingInLine(ls[at], spec), ...ls.slice(at + 1)]
      })
      setAssistOpen(false)
    },
    [spec],
  )

  const pairAll = useCallback(() => {
    setDirty(true)
    setLines((ls) => {
      const pending = unpairedOutLines(ls, header.default_warehouse_id)
      if (pending.length === 0) return ls
      const keys = new Set(pending.map((l) => l.key))
      const out: LineDraft[] = []
      for (const line of ls) {
        out.push(line)
        if (keys.has(line.key)) out.push(matchingInLine(line, spec))
      }
      return out
    })
  }, [header.default_warehouse_id, spec])

  const addIntakeLines = useCallback(
    (intake: IntakeLine[]) => {
      if (intake.length === 0) return
      setDirty(true)
      setLines((ls) => {
        const built = intake.map((entry) => {
          const units = unitOptionsFrom(entry.item)
          const def = units.find((u) => u.is_default) ?? units[0]
          const base = newLine(spec, {
            item_id: entry.item.item_id,
            item_name: entry.item.print_name || entry.item.item_name,
            item_sku: entry.item.item_sku,
            track_batch: Number(entry.item.track_batch) === 1,
            track_serial: Number(entry.item.track_serial) === 1,
            units,
            unit_id: def?.unit_id ?? entry.item.unit_id ?? null,
            warehouse_id: entry.item.default_warehouse_id ?? header.default_warehouse_id ?? null,
            direction: entry.direction ?? 'out',
            qty: entry.qty ?? '',
            description: entry.note ?? '',
          })
          const withFrom = { ...base, ...applyBatchMapping(base, 'from', entry.fromBatch ?? null) }
          return { ...withFrom, ...applyBatchMapping(withFrom, 'to', entry.toBatch ?? null) }
        })
        return [...ls.filter((l) => !isBlankLine(l)), ...built, newLine(spec, { warehouse_id: header.default_warehouse_id })]
      })
      setTab('all')
    },
    [header.default_warehouse_id, spec],
  )

  const removeEmpty = useCallback(() => {
    setLines((ls) => {
      const kept = ls.filter((l) => !isBlankLine(l))
      return kept.length > 0 ? [...kept, newLine(spec, { warehouse_id: header.default_warehouse_id })] : [newLine(spec, { warehouse_id: header.default_warehouse_id })]
    })
  }, [spec, header.default_warehouse_id])

  const clearAll = useCallback(() => {
    setDirty(true)
    setLines([newLine(spec, { warehouse_id: header.default_warehouse_id })])
    setTab('all')
  }, [spec, header.default_warehouse_id])

  const runChecks = useCallback(() => {
    // Re-read batch stock, status and expiry from the server; the rules re-run off the new index.
    void catalog.refresh()
  }, [catalog])

  const submit = useCallback(
    async (post: boolean) => {
      setDraftErrors([])
      setApiError(null)
      setWarnings([])
      if (!post) setNegative(null)
      const errs = validateDraft(header, lines, spec)
      if (errs.length) {
        setDraftErrors(errs)
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
        notify.success(post ? `Batch adjustment posted — ${doc.document_no ?? `#${doc.document_id}`}` : `Draft saved — ${doc.document_no ?? `#${doc.document_id}`}`)
        onSaved?.(doc, post)
      } catch (err) {
        const neg = parseNegativeStock(err)
        if (neg) {
          setNegative(neg)
          setApiError(id ? `Draft #${id} is saved but could not be posted: ${errorMessage(err)}` : errorMessage(err))
        } else {
          setApiError(describeError(err))
        }
      } finally {
        setBusy(null)
      }
    },
    [header, lines, spec, savedId, override, canOverride, onSaved],
  )

  /**
   * Validate re-reads batch stock, status and expiry from the server and re-runs every rule
   * against what came back — not against the numbers the page happened to be holding. There is no
   * server-side dry run for a document, so the report is this screen's; the server validates the
   * document again, and authoritatively, when it posts.
   */
  const validateNow = useCallback(async () => {
    setBusy('validate')
    setApiError(null)
    setDraftErrors(validateDraft(header, lines, spec))
    try {
      const batchIndex = await catalog.refresh()
      const fresh = validateBatchAdjustment({ header, lines, batchIndex })
      const blocking = fresh.filter((i) => i.severity === 'error').length
      const flagged = fresh.length - blocking
      notify.emit(
        blocking > 0 ? 'error' : flagged > 0 ? 'info' : 'success',
        blocking > 0
          ? `${blocking} issue${blocking === 1 ? '' : 's'} to fix before posting.`
          : flagged > 0
            ? `No blocking issues. ${flagged} warning${flagged === 1 ? '' : 's'} to review.`
            : 'Every check passed. The server validates again on post.',
      )
    } finally {
      setBusy(null)
    }
  }, [header, lines, spec, catalog])

  const requestNavigate = useCallback(
    (to: string) => {
      if (dirty) {
        setBlockedNav(() => () => navigate(to))
        return
      }
      navigate(to)
    },
    [dirty, navigate],
  )

  useUnsavedChanges({
    when: dirty && !readOnly,
    onBlocked: useCallback((_to: string, proceed: () => void) => setBlockedNav(() => proceed), []),
  })

  const shortcuts = useMemo(
    () => ({
      'ctrl+s': (e: KeyboardEvent) => {
        if (readOnly || disabled || !canSave) return
        e.preventDefault()
        void submit(false)
      },
      'ctrl+enter': (e: KeyboardEvent) => {
        if (readOnly || disabled || !canPost) return
        e.preventDefault()
        setConfirmPost(true)
      },
      'alt+n': (e: KeyboardEvent) => {
        if (readOnly || disabled) return
        e.preventDefault()
        addLine()
      },
    }),
    [readOnly, disabled, canSave, canPost, submit, addLine],
  )
  useKeyboardScope('form', shortcuts, { allowInInput: true })

  const serialLine = useMemo(() => lines.find((l) => l.key === serialKey) ?? null, [lines, serialKey])
  const serialWarehouseId = serialLine ? (serialLine.warehouse_id ?? header.default_warehouse_id) : null
  const blockingErrors = issues.filter((i) => i.severity === 'error')
  const title = readOnly ? `Batch adjustment ${documentNo ?? (savedId ? `#${savedId}` : '')}`.trim() : savedId ? `Edit batch adjustment ${documentNo ?? `#${savedId}`}` : 'New batch adjustment'

  return (
    <PageShell fullBleed paddingBottom={!readOnly}>
      <BreadcrumbBar items={[{ label: 'Documents', to: '/documents' }, { label: 'Batch Adjustment' }]} />

      <BatchAdjustmentHeader
        icon={Boxes}
        title={title}
        description="Correct batch allocations without changing inventory value."
        badge={statusLabel ? <Badge tone={readOnly ? 'success' : 'neutral'} size="sm">{statusLabel}</Badge> : null}
        actions={
          readOnly && savedId ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => requestNavigate(`/documents/${savedId}`)}>
                Open document
              </Button>
              <Button variant="secondary" size="sm" icon={Printer} onClick={() => requestNavigate(`/documents/${savedId}/print`)}>
                Print
              </Button>
            </>
          ) : null
        }
        assist={
          assistDismissed ? (
            <Button variant="ghost" size="sm" onClick={() => setAssistDismissed(false)}>
              Show Batch Assist
            </Button>
          ) : (
            <BatchAssistStrip report={report} onOpen={() => setAssistOpen(true)} onDismiss={() => setAssistDismissed(true)} />
          )
        }
      />

      {refError ? <Notice kind="warning">{refError}</Notice> : null}

      <BatchAdjustmentKpis metrics={metrics} warehouseName={warehouseName(header.default_warehouse_id)} />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-3">
          <BatchAdjustmentDetails header={header} onChange={patchHeader} warehouses={warehouses} issues={issues} disabled={disabled} readOnly={readOnly} />

          <BatchAdjustmentWorkspace
            lines={lines}
            visibleLines={visibleLines}
            numbering={numbering}
            tab={tab}
            counts={counts}
            onTabChange={setTab}
            metrics={metrics}
            issues={issueMap}
            warehouses={warehouses}
            defaultWarehouseId={header.default_warehouse_id}
            batchesFor={catalog.rows}
            batchesLoading={catalog.loading}
            disabled={disabled}
            readOnly={readOnly}
            unpairedCount={unpaired.length}
            onAddLine={addLine}
            onImport={() => setImportOpen(true)}
            onScan={() => setScanOpen(true)}
            onPairAll={pairAll}
            onRemoveEmpty={removeEmpty}
            onClearAll={clearAll}
            onPatch={patchLine}
            onPickItem={pickItem}
            onClearItem={clearItem}
            onRemove={removeLine}
            onDuplicate={duplicateLine}
            onClearMapping={clearMapping}
            onOpenItem={(itemId) => requestNavigate(`/items/${itemId}`)}
            onOpenSerials={setSerialKey}
            onCreateBatch={createBatch}
          />

          {draftErrors.length > 0 ? (
            <Notice kind="error" title="Fix before saving">
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {draftErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          {apiError && !negative ? (
            <Notice kind="error" actions={<Button variant="secondary" size="xs" onClick={runChecks}>Refresh availability</Button>}>
              {apiError}
            </Notice>
          ) : null}

          {negative ? (
            <Notice
              kind="error"
              title="Insufficient stock"
              actions={
                <Button variant="secondary" size="xs" onClick={runChecks}>
                  Refresh availability
                </Button>
              }
            >
              {apiError ? <div>{apiError}</div> : null}
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {negative.map((d, i) => (
                  <li key={`${d.item_id}-${d.warehouse_id}-${i}`}>
                    {d.item_name ?? `Item #${d.item_id}`}
                    {d.warehouse_id ? ` · warehouse #${d.warehouse_id}` : ''}: on hand {formatQty(d.on_hand)}, required {formatQty(d.required)}, short by <strong>{formatQty(d.short_by)}</strong>
                  </li>
                ))}
              </ul>
              {canOverride ? (
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                  Post anyway and let stock go negative (override)
                </label>
              ) : (
                <p className="mt-1 text-xs">Reduce the quantities or receive stock first. Posting into negative stock needs the &ldquo;override negative-stock block&rdquo; permission.</p>
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

        <BatchAdjustmentSidebar
          className="xl:sticky xl:top-2 xl:self-start"
          metrics={metrics}
          checks={checks}
          running={catalog.refreshing}
          onRun={runChecks}
          onFocusIssue={focusIssue}
        />
      </div>

      {readOnly ? null : (
        <StickyActionBar
          totals={
            <div className="hidden flex-wrap items-center gap-3 md:flex">
              <KeyboardShortcutHint keys="ctrl+s" label="Save draft" />
              <KeyboardShortcutHint keys="ctrl+enter" label="Save & post" />
              <KeyboardShortcutHint keys="alt+n" label="Add line" />
              <KeyboardShortcutHint keys="ctrl+k" label="Search" />
            </div>
          }
          status={
            <span className="text-xs text-gray-500">
              {populatedLines(lines).length} line{populatedLines(lines).length === 1 ? '' : 's'}
              {savedId ? ` · draft #${savedId}` : ''}
            </span>
          }
        >
          <Button variant="ghost" icon={X} onClick={() => requestNavigate(savedId ? `/documents/${savedId}` : '/documents')} disabled={disabled}>
            Cancel
          </Button>
          <Button variant="secondary" icon={Save} onClick={() => void submit(false)} loading={busy === 'save'} disabled={disabled || !canSave}>
            {savedId ? 'Save changes' : 'Save draft'}
          </Button>
          <Button variant="secondary" icon={ShieldCheck} onClick={() => void validateNow()} loading={busy === 'validate'} disabled={disabled}>
            Validate
          </Button>
          {canPost ? (
            <Button icon={Send} onClick={() => setConfirmPost(true)} loading={busy === 'post'} disabled={disabled || (!canSave && !savedId)}>
              {negative && override ? 'Post with override' : 'Save & post'}
            </Button>
          ) : null}
        </StickyActionBar>
      )}

      <BatchAssistDrawer
        open={assistOpen}
        report={report}
        onClose={() => setAssistOpen(false)}
        onFocus={(item: AssistItem) => {
          setAssistOpen(false)
          if (item.lineKey) focusLine(item.lineKey, item.field ?? null)
        }}
        onPair={readOnly ? undefined : pairLine}
      />

      <SerialMappingDrawer
        open={serialKey !== null}
        line={serialLine}
        warehouseId={serialWarehouseId}
        warehouseName={warehouseName(serialWarehouseId)}
        onClose={() => setSerialKey(null)}
        onApply={applySerials}
      />

      <ScanAddDialog open={scanOpen} warehouseId={header.default_warehouse_id} onClose={() => setScanOpen(false)} onAdd={addIntakeLines} />
      <ImportLinesDialog open={importOpen} warehouseId={header.default_warehouse_id} onClose={() => setImportOpen(false)} onAdd={addIntakeLines} />

      <PostConfirmationModal
        open={confirmPost}
        busy={busy === 'post'}
        documentDate={header.document_date}
        warehouseName={warehouseName(header.default_warehouse_id)}
        metrics={metrics}
        issues={issues}
        onCancel={() => setConfirmPost(false)}
        onConfirm={() => {
          if (blockingErrors.length > 0) return
          setConfirmPost(false)
          void submit(true)
        }}
      />

      <ConfirmDialog
        open={blockedNav !== null}
        title="Unsaved batch adjustment"
        message="You have unsaved changes. Leaving this page will discard them."
        confirmLabel="Discard changes"
        danger
        onCancel={() => setBlockedNav(null)}
        onConfirm={() => {
          const proceed = blockedNav
          setBlockedNav(null)
          setDirty(false)
          proceed?.()
        }}
      />
    </PageShell>
  )
}

export default BatchAdjustmentPage
