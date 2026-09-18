import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, Eye, Info, Maximize2, Minimize2, PlayCircle, Save, Send } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Notice } from '../../components/Notice'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { errorMessage, isApiError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { lookupApi } from '../../services/lookupApi'
import type { BatchRow, ItemSearchRow } from '../../services/lookupApi'
import { Button } from '../../ui/Button'
import { Kbd } from '../../ui/Kbd'
import { Tooltip } from '../../ui/Tooltip'
import { useToast } from '../../ui/ToastContext'
import { cx } from '../../ui/cx'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { StickyActionBar } from '../../ui/shell/StickyActionBar'
import { csvFilename, downloadCsv, toCsv } from '../../utils/csv'
import { formatQty, todayIso } from '../../utils/format'
import { canCreate, permissionKeysFor } from '../actions'
import { isBlankLine, newHeader, newLine } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { unitOptionsFrom } from '../LineEditor'
import { offendingDraftKeys, parseNegativeStock } from '../negativeStock'
import type { NegativeStockDetail } from '../negativeStock'
import { SOURCED_DOCUMENT_TYPES, labelForCode } from '../registry'
import type { DocumentTypeSpec } from '../registry'
import type { InventoryDocument, PostingWarning } from '../types'
import { useReferenceData } from '../useReferenceData'
import { AddItemsDrawer } from './AddItemsDrawer'
import { ImportLinesDrawer } from './ImportLinesDrawer'
import {
  CLEARED_ITEM,
  appendItems,
  duplicateLineAt,
  importIntoLines,
  itemPatch,
  scanIntoLines,
  swapHeader,
  swapLines,
  swapWouldClearAllocations,
} from './transferLines'
import type { ImportedLine } from './transferLines'
import { ScanToAddDrawer } from './ScanToAddDrawer'
import { TransferAssistantCard } from './TransferAssistantCard'
import { TransferAssistantDrawer } from './TransferAssistantDrawer'
import { TransferDetailsCard } from './TransferDetailsCard'
import type { TransferMode } from './TransferDetailsCard'
import { TransferGuideDrawer } from './TransferGuideDrawer'
import { TransferItemsCard } from './TransferItemsCard'
import { TransferPreviewDrawer } from './TransferPreviewDrawer'
import { TransferSummaryCard } from './TransferSummaryCard'
import { useSourceAvailability } from './useSourceAvailability'
import { useTransferPolicy } from './useTransferPolicy'
import { useTransferValuation } from './useTransferValuation'
import {
  blockingIssues,
  computeLineStock,
  readRefs,
  transferPayload,
  transferTotals,
  validateTransfer,
  writeRefs,
} from './transferModel'
import type { TransferIssue, TransferRefs } from './transferModel'
import '../documents.css'
import './transfer.css'

export interface StockTransferWorkspaceProps {
  spec: DocumentTypeSpec
  /** Editing an existing draft. */
  documentId?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  /** Status / number of the stored document, when editing. */
  existing?: Pick<InventoryDocument, 'document_no' | 'status' | 'version'> | null
  onSaved: (doc: InventoryDocument, posted: boolean) => void
}

type Drawer = 'guide' | 'preview' | 'assistant' | 'add' | 'scan' | 'import' | null

function describeError(err: unknown): string {
  if (isApiError(err)) return err.field ? `${err.message} (${err.field})` : err.message
  return errorMessage(err)
}

/**
 * `/documents/new/stock_transfer` and the edit screen for one.
 *
 * Stock Transfer has its own workspace rather than the shared `DocumentForm`
 * because it is the only native type with two warehouses on the header and a
 * route per line, and because the things that make a transfer go wrong — stock
 * that is not there, a batch that expired, serials that do not add up — are
 * worth showing while it is being typed rather than after it is refused. Every
 * other document type keeps the shared editor untouched.
 *
 * Everything it saves goes through the same API, the same payload builder and
 * the same permissions as before; nothing about posting, valuation or the audit
 * trail is re-implemented here.
 */
export function StockTransferWorkspace({ spec, documentId, initial, existing, onSaved }: StockTransferWorkspaceProps) {
  const { warehouses, defaultWarehouseId, warehouseName, loading: refLoading, error: refError } = useReferenceData()
  const { can } = useAccess()
  const { fyRange, branches } = useCompany()
  const toast = useToast()

  const [header, setHeader] = useState<HeaderDraft>(() => initial?.header ?? newHeader(spec, todayIso()))
  const [lines, setLines] = useState<LineDraft[]>(() => initial?.lines ?? [newLine(spec)])
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [savedNo, setSavedNo] = useState<string | null>(existing?.document_no ?? null)
  const [busy, setBusy] = useState<'save' | 'post' | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [negative, setNegative] = useState<NegativeStockDetail[] | null>(null)
  const [override, setOverride] = useState(false)
  const [warnings, setWarnings] = useState<PostingWarning[]>([])
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [mode, setMode] = useState<TransferMode>('single')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set<string>())
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [batchExpiry, setBatchExpiry] = useState<ReadonlyMap<string, string | null>>(new Map())
  const [swapAsk, setSwapAsk] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [referenceTypes, setReferenceTypes] = useState<{ code: string; label: string }[]>([])
  const shellRef = useRef<HTMLDivElement>(null)
  const busyRef = useRef(false)

  const canOverride = can('stock.negative_override')
  const canPost = can(permissionKeysFor('post', spec.code))
  const canSave = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)
  const disabled = busy !== null

  const refs = useMemo(() => readRefs(header.metadata), [header.metadata])
  const policy = useTransferPolicy()

  // ---- reference data -------------------------------------------------------------------

  // Reference Type offers the real document-type catalogue rather than a list
  // typed here; the registry's own labels are the fallback while it loads.
  useEffect(() => {
    const controller = new AbortController()
    documentsApi
      .documentTypes(controller.signal)
      .then((types) => {
        if (controller.signal.aborted) return
        setReferenceTypes(types.map((t) => ({ code: t.code, label: t.label })).sort((a, b) => a.label.localeCompare(b.label)))
      })
      .catch(() => {
        setReferenceTypes(SOURCED_DOCUMENT_TYPES.map((t) => ({ code: t.code, label: t.label })))
      })
    return () => controller.abort()
  }, [])

  // A new transfer starts at the default warehouse; the destination stays for
  // the operator, because there is no such thing as a default destination.
  useEffect(() => {
    if (documentId || header.from_warehouse_id !== null || defaultWarehouseId === null) return
    setHeader((h) => (h.from_warehouse_id === null ? { ...h, from_warehouse_id: defaultWarehouseId } : h))
  }, [defaultWarehouseId, documentId, header.from_warehouse_id])

  // Editing: stored lines know only their own unit, so fetch the items once and
  // the unit dropdown, batch picker and serial picker work as on a new document.
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

  // ---- live figures ---------------------------------------------------------------------

  const availability = useSourceAvailability(lines, header, spec.movesStock)
  const valuation = useTransferValuation(lines, { asOf: header.document_date, warehouseId: header.from_warehouse_id })
  const stock = useMemo(
    () => computeLineStock(lines, header, availability.index, availability.pending),
    [lines, header, availability.index, availability.pending],
  )
  const totals = useMemo(() => transferTotals(lines, valuation.rates), [lines, valuation.rates])

  const draftIssues = useMemo(
    () =>
      validateTransfer({
        header,
        lines,
        stock,
        negativeStockPolicy: policy.negativeStockPolicy,
        fyRange,
        batchExpiry,
        posting: false,
      }),
    [header, lines, stock, policy.negativeStockPolicy, fyRange, batchExpiry],
  )
  const postIssues = useMemo(
    () =>
      validateTransfer({
        header,
        lines,
        stock,
        negativeStockPolicy: policy.negativeStockPolicy,
        fyRange,
        batchExpiry,
        posting: true,
      }),
    [header, lines, stock, policy.negativeStockPolicy, fyRange, batchExpiry],
  )
  /** What the screen shows: everything once they have tried, news always. */
  const visibleIssues = useMemo<TransferIssue[]>(
    () => (attempted ? postIssues : postIssues.filter((i) => i.always)),
    [attempted, postIssues],
  )
  const postBlockers = useMemo(() => blockingIssues(postIssues), [postIssues])
  const offending = useMemo(() => new Set(negative ? offendingDraftKeys(lines, negative) : []), [negative, lines])

  const dirty = useMemo(() => lines.some((l) => !isBlankLine(l)) || header.narration.trim() !== '' || header.reason_code !== '', [lines, header])

  // ---- line editing ---------------------------------------------------------------------

  const patchHeader = useCallback((patch: Partial<HeaderDraft>) => setHeader((h) => ({ ...h, ...patch })), [])
  const patchRefs = useCallback(
    (patch: Partial<TransferRefs>) => setHeader((h) => ({ ...h, metadata: writeRefs(h.metadata, { ...readRefs(h.metadata), ...patch }) })),
    [],
  )
  const changeLine = useCallback(
    (key: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l))),
    [],
  )
  const removeLine = useCallback((key: string) => {
    setLines((ls) => ls.filter((l) => l.key !== key))
    setExpanded((set) => {
      if (!set.has(key)) return set
      const next = new Set(set)
      next.delete(key)
      return next
    })
  }, [])

  const pickItem = useCallback((key: string, row: ItemSearchRow) => changeLine(key, itemPatch(row)), [changeLine])

  const addLine = useCallback(() => {
    const line = newLine(spec)
    setLines((ls) => [...ls, line])
    setFocusKey(line.key)
  }, [spec])

  const duplicateLine = useCallback((key: string) => setLines((ls) => duplicateLineAt(ls, key)), [])
  const addItems = useCallback((rows: ItemSearchRow[]) => setLines((ls) => appendItems(spec, ls, rows)), [spec])
  const scanItem = useCallback((row: ItemSearchRow) => setLines((ls) => scanIntoLines(spec, ls, row)), [spec])
  const importLines = useCallback((imported: ImportedLine[]) => setLines((ls) => importIntoLines(spec, ls, imported)), [spec])

  const exportLines = useCallback(() => {
    const rows = lines.filter((l) => !isBlankLine(l))
    if (rows.length === 0) return
    const csv = toCsv(rows, [
      { header: 'item_code', value: (l: LineDraft) => l.item_sku ?? '' },
      { header: 'quantity', value: (l: LineDraft) => l.qty },
      { header: 'batch_no', value: (l: LineDraft) => l.batch_no ?? '' },
      { header: 'item_name', value: (l: LineDraft) => l.item_name },
    ])
    downloadCsv(csvFilename('stock-transfer-lines'), csv)
  }, [lines])

  const onBatchPicked = useCallback((key: string, batch: BatchRow | null) => {
    setBatchExpiry((map) => {
      const next = new Map(map)
      if (batch) next.set(key, batch.expiry_date ?? null)
      else next.delete(key)
      return next
    })
  }, [])

  const useWarehouseForLine = useCallback(
    (key: string, warehouseId: number) => {
      changeLine(key, { from_warehouse_id: warehouseId, batch_id: null, batch_no: null, serials: [] })
      setExpanded((set) => new Set(set).add(key))
      setDrawer(null)
      toast.info(`Line now draws from ${warehouseName(warehouseId)}.`)
    },
    [changeLine, toast, warehouseName],
  )

  // ---- swap -----------------------------------------------------------------------------

  const applySwap = useCallback(() => {
    setHeader(swapHeader)
    setLines(swapLines)
    setBatchExpiry(new Map())
    setSwapAsk(false)
  }, [])

  const requestSwap = useCallback(() => {
    if (swapWouldClearAllocations(lines)) setSwapAsk(true)
    else applySwap()
  }, [lines, applySwap])

  // ---- fullscreen -----------------------------------------------------------------------

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === shellRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const el = shellRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void el.requestFullscreen?.().catch(() => toast.info('This browser would not open the workspace full screen.'))
  }, [toast])

  // ---- saving ---------------------------------------------------------------------------

  const submit = useCallback(
    async (post: boolean) => {
      // Belt and braces against a double submit: the buttons disable on `busy`,
      // and a shortcut pressed in the same tick reads the ref instead.
      if (busyRef.current) return
      setAttempted(true)
      setApiError(null)
      setWarnings([])
      if (!post) setNegative(null)

      const blocking = blockingIssues(post ? postIssues : draftIssues)
      if (blocking.length > 0) {
        toast.error(blocking.length === 1 ? blocking[0].message : `${blocking.length} things need fixing before this can be ${post ? 'posted' : 'saved'}.`)
        return
      }

      busyRef.current = true
      setBusy(post ? 'post' : 'save')
      const payload = transferPayload(header, lines, spec)
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
        setSavedNo(doc.document_no ?? null)
        if (post) {
          doc = await documentsApi.post(doc.document_id, { negativeOverride: override && canOverride })
          setWarnings(doc.warnings ?? [])
          toast.success(`Stock transfer ${doc.document_no ?? `#${doc.document_id}`} posted.`)
        } else {
          toast.success(`Draft ${doc.document_no ?? `#${doc.document_id}`} saved.`)
        }
        onSaved(doc, post)
      } catch (err) {
        const neg = parseNegativeStock(err)
        if (neg) {
          setNegative(neg)
          setApiError(id ? `Draft #${id} is saved but could not be posted: ${errorMessage(err)}` : errorMessage(err))
        } else {
          setApiError(describeError(err))
        }
      } finally {
        busyRef.current = false
        setBusy(null)
      }
    },
    [postIssues, draftIssues, header, lines, spec, savedId, override, canOverride, onSaved, toast],
  )

  // ---- shortcuts ------------------------------------------------------------------------

  // Two scopes because they answer different questions. Ctrl+S is the app's
  // save-anywhere binding and must work mid-sentence; Alt+S / Alt+P are the
  // hints printed in the header and must stay out of the way while typing —
  // including inside an open combobox, which `isTypingTarget` already knows
  // about through `data-combo-open`.
  const saveBindings = useMemo(
    () => ({
      'ctrl+s': (e: KeyboardEvent) => {
        e.preventDefault()
        if (canSave) void submit(false)
      },
    }),
    [canSave, submit],
  )
  useKeyboardScope('form', saveBindings, { allowInInput: true })

  const altBindings = useMemo(
    () => ({
      'alt+s': (e: KeyboardEvent) => {
        e.preventDefault()
        if (canSave) void submit(false)
      },
      'alt+p': (e: KeyboardEvent) => {
        e.preventDefault()
        if (canPost) void submit(true)
      },
    }),
    [canSave, canPost, submit],
  )
  useKeyboardScope('form', altBindings)

  // ---- render ---------------------------------------------------------------------------

  const branchFor = useCallback(
    (w: { bo_id: number }) => {
      if (!w.bo_id) return null
      return branches.find((b) => b.boId === w.bo_id)?.name ?? null
    },
    [branches],
  )
  const referenceTypeLabel = useCallback((code: string) => referenceTypes.find((t) => t.code === code)?.label ?? labelForCode(code), [referenceTypes])

  const statusLine =
    postBlockers.length > 0 && attempted
      ? `${postBlockers.length} issue${postBlockers.length === 1 ? '' : 's'} require attention`
      : totals.items === 0
        ? 'Add the items being moved'
        : `${totals.items} item${totals.items === 1 ? '' : 's'} · ${formatQty(totals.quantity)} total quantity · ${
            postBlockers.length === 0 ? 'ready to post' : 'not ready yet'
          }`

  return (
    <div ref={shellRef} className={cx('st-workspace', fullscreen && 'overflow-y-auto bg-workspace-bg p-4')}>
      <PageShell paddingBottom>
        <BreadcrumbHeader
          breadcrumbs={[{ label: 'Documents', to: '/documents' }, { label: 'Stock Transfer', to: '/documents?document_type=STOCK_TRANSFER' }, { label: savedId ? (savedNo ?? `#${savedId}`) : 'New' }]}
          title={savedId ? `Edit stock transfer ${savedNo ?? `#${savedId}`}` : 'New Stock Transfer'}
          description="Move stock between warehouses, locations or branches with complete traceability."
          icon={ArrowLeftRight}
          escDirty={dirty}
          backTo="/documents"
          backLabel="Back to documents"
          actions={
            <>
              <Button variant="secondary" size="md" icon={PlayCircle} onClick={() => setDrawer('guide')}>
                Guide
              </Button>
              <span className="hidden items-center gap-1.5 rounded-lg border border-gray-200 bg-white/70 px-2.5 py-1.5 text-[11px] text-gray-500 xl:inline-flex print:hidden">
                <span className="font-medium">Shortcuts</span>
                <Kbd>Alt</Kbd>
                <span aria-hidden>+</span>
                <Kbd>S</Kbd>
                <span>Save</span>
                <Kbd>Alt</Kbd>
                <span aria-hidden>+</span>
                <Kbd>P</Kbd>
                <span>Post</span>
              </span>
              <Tooltip label={fullscreen ? 'Leave full screen' : 'Expand the workspace to full screen'}>
                <Button
                  variant="secondary"
                  size="md"
                  icon={fullscreen ? Minimize2 : Maximize2}
                  onClick={toggleFullscreen}
                  aria-label={fullscreen ? 'Leave full screen' : 'Expand workspace'}
                />
              </Tooltip>
            </>
          }
        />

        {refError ? <Notice kind="warning">{refError}</Notice> : null}
        {existing && (existing.status === 'APPROVED' || existing.status === 'PENDING_APPROVAL') ? (
          <Notice kind="info">Saving changes returns this transfer to draft; it will need approval again.</Notice>
        ) : null}

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
          <div className="min-w-0 space-y-3">
            <TransferDetailsCard
              header={header}
              refs={refs}
              warehouses={warehouses}
              warehousesLoading={refLoading}
              referenceTypes={referenceTypes}
              mode={mode}
              onModeChange={setMode}
              issues={visibleIssues}
              disabled={disabled}
              onPatchHeader={patchHeader}
              onPatchRefs={patchRefs}
              onSwap={requestSwap}
              branchFor={branchFor}
            />

            <TransferItemsCard
              lines={lines}
              header={header}
              warehouses={warehouses}
              warehousesLoading={refLoading && warehouses.length === 0}
              stock={stock}
              rates={valuation.rates}
              currencyCode={policy.currencyCode}
              issues={visibleIssues}
              disabled={disabled}
              expandedKeys={expanded}
              focusKey={focusKey}
              warehouseName={warehouseName}
              onToggleExpand={(key) =>
                setExpanded((set) => {
                  const next = new Set(set)
                  if (next.has(key)) next.delete(key)
                  else next.add(key)
                  return next
                })
              }
              onChangeLine={changeLine}
              onPickItem={pickItem}
              onClearItem={(key) => changeLine(key, CLEARED_ITEM)}
              onDuplicate={duplicateLine}
              onRemove={removeLine}
              onBatchPicked={onBatchPicked}
              onAddLine={addLine}
              onAddFromItems={() => setDrawer('add')}
              onScan={() => setDrawer('scan')}
              onImport={() => setDrawer('import')}
              onRemoveEmpty={() => setLines((ls) => ls.filter((l) => !isBlankLine(l)))}
              onClearAll={() => {
                setLines([newLine(spec)])
                setBatchExpiry(new Map())
              }}
              onExport={exportLines}
            />

            <div className="flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2.5 text-[11px] leading-relaxed text-sky-800">
              <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                Live stock is what the selected source warehouse holds free right now. Quantities move out of it when this
                transfer is <strong>posted</strong> — saving a draft reserves nothing and changes no balance.
                {availability.error ? (
                  <>
                    {' '}
                    <button type="button" className="font-semibold underline" onClick={availability.reload}>
                      {availability.error} Try again
                    </button>
                  </>
                ) : null}
              </span>
            </div>

            {apiError && !negative ? <Notice kind="error">{apiError}</Notice> : null}

            {negative ? (
              <Notice kind="error" title="Insufficient stock">
                {apiError ? <div>{apiError}</div> : null}
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                  {negative.map((d, i) => (
                    <li key={`${d.item_id}-${d.warehouse_id}-${i}`}>
                      {d.item_name ?? `Item #${d.item_id}`}
                      {d.warehouse_id ? ` · ${warehouseName(d.warehouse_id)}` : ''}: on hand {formatQty(d.on_hand)}, required{' '}
                      {formatQty(d.required)}, short by <strong>{formatQty(d.short_by)}</strong>
                    </li>
                  ))}
                </ul>
                {offending.size > 0 ? (
                  <p className="mt-1 text-xs">
                    The {offending.size === 1 ? 'line' : `${offending.size} lines`} concerned {offending.size === 1 ? 'is' : 'are'}{' '}
                    highlighted above.
                  </p>
                ) : null}
                {canOverride ? (
                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                    Post anyway and let stock go negative (override)
                  </label>
                ) : (
                  <p className="mt-1 text-xs">
                    Reduce the quantities or receive stock first. Posting into negative stock needs the “override
                    negative-stock block” permission.
                  </p>
                )}
              </Notice>
            ) : null}

            {warnings.length > 0 ? (
              <Notice kind="warning" title="Posted with warnings">
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                  {warnings.map((w, i) => (
                    <li key={`${w.code}-${i}`}>{w.message}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
          </div>

          <div className="min-w-0 space-y-3 xl:sticky xl:top-2">
            <TransferSummaryCard
              totals={totals}
              currencyCode={policy.currencyCode}
              valuationPermitted={valuation.permitted}
              valuationLoading={valuation.loading}
              issues={visibleIssues}
              fromWarehouseName={warehouseName(header.from_warehouse_id)}
              toWarehouseName={warehouseName(header.to_warehouse_id)}
              loading={refLoading && warehouses.length === 0}
            />
            <TransferAssistantCard
              onOpen={() => setDrawer('assistant')}
              findings={visibleIssues.filter((i) => i.always).length}
              disabled={disabled}
            />
          </div>
        </div>

        <StickyActionBar
          status={
            <span className={cx('text-xs', postBlockers.length > 0 && attempted ? 'font-semibold text-red-600' : 'text-gray-500')}>
              {statusLine}
            </span>
          }
          totals={
            savedId ? (
              <Link to={`/documents/${savedId}`} className="text-xs text-primary hover:underline">
                Draft {savedNo ?? `#${savedId}`}
              </Link>
            ) : null
          }
        >
          <Button variant="secondary" size="md" onClick={() => setDrawer('preview')} icon={Eye}>
            Preview
          </Button>
          <Link
            to={savedId ? `/documents/${savedId}` : '/documents'}
            data-unsaved-allow
            className="aic inline-flex h-9 items-center rounded-lg border border-gray-200 bg-white px-3.5 text-sm font-medium text-gray-700 no-underline transition-colors hover:border-primary/40 hover:bg-primary-light hover:text-primary"
          >
            Cancel
          </Link>
          <Button
            variant="secondary"
            size="md"
            icon={Save}
            onClick={() => void submit(false)}
            loading={busy === 'save'}
            disabled={disabled || !canSave}
          >
            {savedId ? 'Save changes' : 'Save as draft'}
          </Button>
          {canPost ? (
            <Button
              variant="primary"
              size="md"
              icon={Send}
              onClick={() => void submit(true)}
              loading={busy === 'post'}
              disabled={disabled || (!canSave && !savedId)}
            >
              {negative && override ? 'Post with override' : 'Save & post'}
            </Button>
          ) : null}
        </StickyActionBar>
      </PageShell>

      <TransferGuideDrawer open={drawer === 'guide'} onClose={() => setDrawer(null)} />

      <TransferPreviewDrawer
        open={drawer === 'preview'}
        onClose={() => setDrawer(null)}
        header={header}
        refs={refs}
        lines={lines}
        totals={totals}
        rates={valuation.rates}
        currencyCode={policy.currencyCode}
        documentNo={savedNo ?? (header.document_no.trim() || null)}
        status={existing?.status ?? (savedId ? 'DRAFT' : null)}
        warehouseName={warehouseName}
        referenceTypeLabel={referenceTypeLabel}
        onPost={
          canPost
            ? () => {
                // Close first: a backend refusal lands as a banner on the form,
                // and a banner behind an open drawer is a banner nobody reads.
                setDrawer(null)
                void submit(true)
              }
            : undefined
        }
        posting={busy === 'post'}
        postDisabled={disabled || (!canSave && !savedId)}
      />

      <TransferAssistantDrawer
        open={drawer === 'assistant'}
        onClose={() => setDrawer(null)}
        header={header}
        lines={lines}
        stock={stock}
        availability={availability.index}
        totals={totals}
        warehouseName={warehouseName}
        onUseWarehouse={useWarehouseForLine}
      />

      <AddItemsDrawer
        open={drawer === 'add'}
        onClose={() => setDrawer(null)}
        warehouseId={header.from_warehouse_id}
        warehouseLabel={warehouseName(header.from_warehouse_id) || 'the source warehouse'}
        onAdd={addItems}
      />

      <ScanToAddDrawer
        open={drawer === 'scan'}
        onClose={() => setDrawer(null)}
        warehouseId={header.from_warehouse_id}
        onScanned={scanItem}
      />

      <ImportLinesDrawer
        open={drawer === 'import'}
        onClose={() => setDrawer(null)}
        warehouseId={header.from_warehouse_id}
        onImport={importLines}
      />

      <ConfirmDialog
        open={swapAsk}
        title="Swap source and destination?"
        message={
          <>
            <p>
              The batches and serial numbers already chosen belong to{' '}
              <strong>{warehouseName(header.from_warehouse_id) || 'the current source'}</strong>. Swapping means the stock is
              drawn from <strong>{warehouseName(header.to_warehouse_id) || 'the other warehouse'}</strong> instead, so those
              allocations no longer apply and will be cleared.
            </p>
            <p className="text-xs text-gray-500">Items, quantities and units stay exactly as they are.</p>
          </>
        }
        confirmLabel="Swap and clear allocations"
        onConfirm={applySwap}
        onCancel={() => setSwapAsk(false)}
      />
    </div>
  )
}
