import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Eye,
  FileDown,
  MoreHorizontal,
  PackageCheck,
  PlayCircle,
  Save,
  ScanLine,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { useScopeLabel } from '../../company/useScopeLabel'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { useQuery } from '../../hooks/useQuery'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { errorMessage, isApiError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { lookupApi } from '../../services/lookupApi'
import { settingsApi } from '../../services/settingsApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { GrnExtraction } from '../../services/aiDocumentApi'
import { getAppById, resolveAppOrigin } from '../../services/appLauncher'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { MenuButton } from '../../ui/MenuButton'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { StickyActionBar } from '../../ui/shell/StickyActionBar'
import { useToast } from '../../ui/ToastContext'
import { cx } from '../../ui/cx'
import { currencySymbol, formatMoney, formatQty, todayIso, toNumber } from '../../utils/format'
import { canCreate, permissionKeysFor, STATUS_LABELS } from '../actions'
import { isBlankLine, newHeader, newLine, toPayload } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { offendingDraftKeys, parseNegativeStock } from '../negativeStock'
import type { NegativeStockDetail } from '../negativeStock'
import type { DocumentTypeSpec } from '../registry'
import type { DocumentStatus, InventoryDocument, PostingWarning } from '../types'
import { useReferenceData } from '../useReferenceData'
import { unitOptionsFrom } from '../LineEditor'
import { AiAssistPanel } from './AiAssistPanel'
import { AiExtractionReview } from './AiExtractionReview'
import type { AiExtractionApproval } from './AiExtractionReview'
import { BarcodeScanDialog } from './BarcodeScanDialog'
import { BulkAddDrawer } from './BulkAddDrawer'
import { GrnDetailsCard } from './GrnDetailsCard'
import { GrnLinesCard } from './GrnLinesCard'
import { GrnPreviewDrawer } from './GrnPreviewDrawer'
import { GrnSummaryCard } from './GrnSummaryCard'
import { PostGrnDialog } from './PostGrnDialog'
import { PurchaseOrderDrawer } from './PurchaseOrderDrawer'
import type { PurchaseOrderSelection } from './PurchaseOrderDrawer'
import { lineFromItem, lineFromPurchaseOrder, mergeScannedItem } from './grnLines'
import { grnAlerts, grnTotals, hasBlockingAlert, poLink, stockImpact, validateGrn } from './grnModel'

export interface InwardChallanFormProps {
  spec: DocumentTypeSpec
  /** Editing an existing draft. */
  documentId?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  status?: DocumentStatus
  onSaved: (doc: InventoryDocument, posted: boolean) => void
}

function describeError(err: unknown): string {
  if (isApiError(err)) return err.field ? `${err.message} (${err.field})` : err.message
  return errorMessage(err)
}

/**
 * Inward Challan / GRN — receiving goods from a supplier.
 *
 * This type gets its own screen rather than the shared `DocumentForm` because receiving is not a
 * generic document-entry job: it is a bench task, done against paperwork, often with a scanner in
 * one hand, and it needs the things no other document type needs — a purchase order to receive
 * against, batch and expiry per line, serial capture per unit, and a running statement of what
 * posting will do to stock. Every other native type keeps the shared form, unchanged.
 *
 * What it does NOT own: the document API, the posting rules, the permission model, the item /
 * batch / serial masters or the supplier ledger. All of those are read and written through the
 * services that already exist, so this file is a screen, not a second implementation of receiving.
 */
export function InwardChallanForm({ spec, documentId, initial, status = 'DRAFT', onSaved }: InwardChallanFormProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useAccess()
  const { companyName, fyRange, scope } = useCompany()
  const scopeLabel = useScopeLabel()
  const { warehouses, defaultWarehouseId, warehouseName, unitSymbol, loading: refLoading, error: refError } = useReferenceData()

  const [header, setHeader] = useState<HeaderDraft>(() => initial?.header ?? newHeader(spec, todayIso()))
  const [lines, setLines] = useState<LineDraft[]>(() => initial?.lines ?? [])
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [autoNumber, setAutoNumber] = useState<boolean>(!initial?.header.document_no)
  const [errors, setErrors] = useState<string[]>([])
  const [apiError, setApiError] = useState<string | null>(null)
  const [negative, setNegative] = useState<NegativeStockDetail[] | null>(null)
  const [override, setOverride] = useState(false)
  const [warnings, setWarnings] = useState<PostingWarning[]>([])
  const [busy, setBusy] = useState<'save' | 'post' | null>(null)

  const [poOpen, setPoOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [postOpen, setPostOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [discardTo, setDiscardTo] = useState<string | null>(null)
  const [extraction, setExtraction] = useState<{ data: GrnExtraction; fileName: string } | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)

  const settings = useQuery((signal) => settingsApi.get(signal), [scope?.cmp_id], { enabled: Boolean(scope?.cmp_id) })
  const symbol = currencySymbol(settings.data?.base_currency_code ?? 'INR')

  const canOverride = can('stock.negative_override')
  const canPost = can(permissionKeysFor('post', spec.code))
  const canSave = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)
  const booksOrigin = useMemo(() => {
    const books = getAppById('books')
    return books ? resolveAppOrigin(books) : null
  }, [])

  // ---- defaults ---------------------------------------------------------
  useEffect(() => {
    if (documentId || header.default_warehouse_id !== null || defaultWarehouseId === null) return
    setHeader((h) => ({ ...h, default_warehouse_id: defaultWarehouseId }))
    setLines((ls) => ls.map((l) => (l.warehouse_id === null ? { ...l, warehouse_id: defaultWarehouseId } : l)))
  }, [defaultWarehouseId, documentId, header.default_warehouse_id])

  // Editing: stored lines know only their own unit, so fetch the items once and the batch,
  // serial and unit controls behave exactly as they do on a new document.
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

  // ---- derived ----------------------------------------------------------
  const patchHeader = useCallback((patch: Partial<HeaderDraft>) => setHeader((h) => ({ ...h, ...patch })), [])

  const totals = useMemo(() => grnTotals(lines), [lines])
  const impact = useMemo(() => stockImpact(header.stock_effect), [header.stock_effect])
  const today = todayIso()
  const alerts = useMemo(() => grnAlerts({ header, lines, today, fyRange }), [header, lines, today, fyRange])
  const blocked = hasBlockingAlert(alerts)
  const matchedCount = useMemo(() => lines.filter((l) => !isBlankLine(l) && poLink(l).poLineId !== null).length, [lines])

  const offending = useMemo(() => (negative ? new Set(offendingDraftKeys(lines, negative)) : new Set<string>()), [negative, lines])
  const flaggedKeys = useMemo(() => {
    const keys = new Set<string>(offending)
    for (const alert of alerts) {
      if (alert.tone !== 'danger' && alert.tone !== 'warning') continue
      for (const key of alert.lineKeys ?? []) keys.add(key)
    }
    return keys
  }, [alerts, offending])

  const baseline = useRef(JSON.stringify({ header: initial?.header ?? newHeader(spec, todayIso()), lines: initial?.lines ?? [] }))
  const dirty = JSON.stringify({ header, lines }) !== baseline.current && busy === null

  const linkedOrderLabel = useMemo(() => {
    const po = header.metadata.purchase_order_no
    if (typeof po === 'string' && po) return po
    const deferred = header.metadata.linked_source_document_id
    return deferred ? `purchase #${deferred}` : null
  }, [header.metadata])

  // ---- line helpers ------------------------------------------------------
  const lineDefaults = { warehouseId: header.default_warehouse_id }

  const linesRef = useRef(lines)
  linesRef.current = lines

  /**
   * The scanner dialog reports what each scan did, so the merge is computed here and not inside
   * a `setLines` updater: an updater does not run until React renders, and the dialog needs the
   * answer on the same tick. The ref carries the merged list forward so two scans arriving back
   * to back — which is exactly what a hardware scanner does — both see the first one's result.
   */
  const addScanned = useCallback(
    (row: ItemSearchRow, qty: number) => {
      const merge = mergeScannedItem(linesRef.current, spec, row, { warehouseId: header.default_warehouse_id, qty: String(qty) })
      linesRef.current = merge.lines
      setLines(merge.lines)
      const line = merge.lines.find((l) => l.key === merge.key)
      return { merged: merge.merged, qty: toNumber(line?.qty) ?? qty }
    },
    [spec, header.default_warehouse_id],
  )

  const importPurchaseOrder = ({ order, lineIds }: PurchaseOrderSelection, mode: 'append' | 'replace') => {
    const chosen = order.lines.filter((l) => lineIds.includes(l.po_line_id))
    const imported = chosen.map((poLine) => lineFromPurchaseOrder(spec, order, poLine, lineDefaults))
    setLines((current) => (mode === 'replace' ? imported : [...current.filter((l) => !isBlankLine(l)), ...imported]))
    patchHeader({
      reference: header.reference.trim() || order.po_no,
      party_ref: header.party_ref.trim() || (order.party_ref !== null ? String(order.party_ref) : ''),
      party_name: header.party_name.trim() || (order.party_name ?? ''),
      default_warehouse_id: header.default_warehouse_id ?? order.warehouse_id ?? null,
      // A deferred purchase is received by settling it, so the stock effect follows the order
      // rather than the other way round — and the link the server matches on is recorded.
      ...(order.origin === 'inventory_deferred'
        ? {
            stock_effect: 'settle_deferred',
            metadata: { ...header.metadata, linked_source_document_id: order.source_document_id, purchase_order_no: order.po_no },
          }
        : {
            metadata: { ...header.metadata, purchase_order_id: order.po_id, purchase_order_no: order.po_no, tags: withTag(header.metadata.tags, 'Against Purchase Order') },
          }),
    })
    setPoOpen(false)
    toast.success(`${imported.length} line${imported.length === 1 ? '' : 's'} imported from ${order.po_no}.`)
  }

  const unlinkOrder = () => {
    patchHeader({
      metadata: { ...header.metadata, purchase_order_id: undefined, purchase_order_no: undefined, linked_source_document_id: undefined },
      ...(header.stock_effect === 'settle_deferred' ? { stock_effect: spec.stockEffects[0]?.value ?? 'challan_only' } : {}),
    })
    setLines((current) =>
      current.map((l) => {
        if (!l.metadata) return l
        const { po_line_id: _poLine, po_no: _poNo, po_qty_open: _poOpen, settlement_pending_id: _pending, ...rest } = l.metadata
        return { ...l, origin: 'manual', metadata: Object.keys(rest).length ? rest : null }
      }),
    )
  }

  const applyExtraction = async (approval: AiExtractionApproval) => {
    if (!extraction) return
    const data = extraction.data
    const patch: Partial<HeaderDraft> = {}
    if (approval.supplier && data.supplier) {
      patch.party_name = data.supplier.party_name ?? header.party_name
      if (data.supplier.party_ref !== null) patch.party_ref = String(data.supplier.party_ref)
    }
    if (approval.reference && data.reference) patch.reference = data.reference
    if (approval.documentDate && data.document_date) patch.document_date = data.document_date
    if (Object.keys(patch).length) patchHeader(patch)

    const chosen = approval.lineIndexes.map((i) => data.lines[i]).filter(Boolean)
    const built: LineDraft[] = []
    for (const extracted of chosen) {
      // Resolve the item live rather than trusting a name: a description on a supplier's invoice
      // is not an item id, and a line that lands on the wrong item is worse than one left blank.
      const code = extracted.barcode ?? extracted.item_sku
      let row: ItemSearchRow | null = null
      if (extracted.item_id !== null) {
        row = (await lookupApi.itemsByIds([extracted.item_id]).catch(() => []))[0] ?? null
      }
      if (!row && code) row = await lookupApi.itemByBarcode(code, { warehouseId: header.default_warehouse_id }).catch(() => null)
      const qty = extracted.qty !== null ? String(extracted.qty) : ''
      const rate = extracted.rate !== null ? String(extracted.rate) : ''
      if (row) {
        const line = lineFromItem(spec, row, { ...lineDefaults, qty: qty || '1', rate })
        built.push({ ...line, expiry_date: extracted.expiry_date, description: `Read from ${extraction.fileName}` })
      } else {
        // No match: the line still goes in, named, for the clerk to pick the item on. Dropping it
        // silently is how a consignment gets received one short.
        built.push(
          newLine(spec, {
            item_name: extracted.item_name,
            warehouse_id: header.default_warehouse_id,
            qty,
            rate,
            expiry_date: extracted.expiry_date,
            description: `Read from ${extraction.fileName} — pick the matching item`,
          }),
        )
      }
    }
    if (built.length) setLines((current) => [...current.filter((l) => !isBlankLine(l)), ...built])
    setReviewOpen(false)
    const unmatched = built.filter((l) => l.item_id === null).length
    toast.info(
      unmatched > 0
        ? `Document applied. ${unmatched} line${unmatched === 1 ? '' : 's'} need an item picked before posting.`
        : 'Document processed. Review the suggested values before posting.',
    )
  }

  // ---- saving ------------------------------------------------------------
  const submit = async (post: boolean) => {
    setErrors([])
    setApiError(null)
    setWarnings([])
    if (!post) setNegative(null)
    const found = validateGrn(header, lines, { spec, fyRange })
    if (found.length) {
      setErrors(found)
      setPostOpen(false)
      toast.error('Unable to save. Please review the highlighted fields.')
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
      baseline.current = JSON.stringify({ header, lines })
      setPostOpen(false)
      toast.success(post ? 'Inward challan / GRN posted successfully.' : 'GRN draft saved.')
      onSaved(doc, post)
    } catch (err) {
      const neg = parseNegativeStock(err)
      if (neg) {
        setNegative(neg)
        setApiError(id ? `Draft #${id} is saved but could not be posted: ${errorMessage(err)}` : errorMessage(err))
      } else {
        setApiError(describeError(err))
      }
      setPostOpen(false)
      toast.error(post ? 'Unable to post GRN. Please review the highlighted fields.' : 'Unable to save the draft.')
    } finally {
      setBusy(null)
    }
  }

  // ---- guards and shortcuts ---------------------------------------------
  useUnsavedChanges({
    when: dirty,
    onBlocked: (to) => setDiscardTo(to),
  })

  const openPost = useCallback(() => {
    if (!canPost || blocked || busy !== null) return
    setPostOpen(true)
  }, [canPost, blocked, busy])

  useKeyboardScope(
    'form',
    useMemo(
      () => ({
        'alt+a': (e: KeyboardEvent) => {
          e.preventDefault()
          setLines((current) => [...current, newLine(spec, { warehouse_id: header.default_warehouse_id })])
        },
        'alt+s': (e: KeyboardEvent) => {
          e.preventDefault()
          if (canSave && busy === null) void submit(false)
        },
        'alt+p': (e: KeyboardEvent) => {
          e.preventDefault()
          setPreviewOpen(true)
        },
        'alt+b': (e: KeyboardEvent) => {
          e.preventDefault()
          setScanOpen(true)
        },
        'ctrl+enter': (e: KeyboardEvent) => {
          e.preventDefault()
          openPost()
        },
      }),
      // `submit` closes over the whole draft and is rebuilt every render; binding it through the
      // memo would re-register the scope on every keystroke. The scope's own ref keeps the
      // latest handlers, so the identity of these closures is what matters, not their freshness.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [spec, header.default_warehouse_id, canSave, busy, openPost],
    ),
    { allowInInput: true },
  )

  const disabled = busy !== null
  const defaultWarehouseName = warehouseName(header.default_warehouse_id)

  const headerActions = (
    <>
      <Button variant="secondary" size="sm" icon={PlayCircle} className="text-violet-700" onClick={() => setGuideOpen(true)}>
        Watch guide
      </Button>
      <Button variant="secondary" size="sm" icon={FileDown} disabled={disabled} onClick={() => setPoOpen(true)}>
        Import from PO
      </Button>
      <Button
        size="sm"
        icon={ScanLine}
        className="bg-gray-900 text-white hover:bg-gray-800"
        disabled={disabled}
        onClick={() => setScanOpen(true)}
      >
        Scan &amp; add
      </Button>
      <MenuButton
        label="More document actions"
        icon={MoreHorizontal}
        variant="secondary"
        size="sm"
        width={236}
        actions={[
          { key: 'bulk', label: 'Bulk add items…', icon: Upload, disabled, onSelect: () => setBulkOpen(true) },
          { key: 'preview', label: 'Preview GRN', icon: Eye, onSelect: () => setPreviewOpen(true) },
          {
            key: 'reset',
            label: 'Clear this challan',
            icon: Trash2,
            danger: true,
            separated: true,
            disabled,
            onSelect: () => {
              setLines([])
              setHeader({ ...newHeader(spec, todayIso()), default_warehouse_id: defaultWarehouseId })
            },
          },
        ]}
      />
    </>
  )

  return (
    <PageShell paddingBottom>
      <BreadcrumbHeader
        breadcrumbs={[
          { label: 'Documents', to: '/documents' },
          { label: spec.label, to: '/documents/new' },
          { label: savedId ? `#${savedId}` : 'New' },
        ]}
        title={savedId ? `Edit ${spec.label.toLowerCase()}` : `New ${spec.label}`}
        icon={PackageCheck}
        description="Receive goods from supplier against a purchase order, challan or direct supply."
        escDirty={dirty}
        backTo="/documents"
        actions={headerActions}
      />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <GrnDetailsCard
          spec={spec}
          header={header}
          onPatch={patchHeader}
          warehouses={warehouses}
          warehousesLoading={refLoading && warehouses.length === 0}
          fyRange={fyRange}
          autoNumber={autoNumber}
          onAutoNumberChange={setAutoNumber}
          linkedOrderLabel={linkedOrderLabel}
          onUnlinkOrder={unlinkOrder}
          onOpenPurchaseOrders={() => setPoOpen(true)}
          canCreateSupplier={can(['masters.items.create', 'documents.create'])}
          booksOrigin={booksOrigin}
          disabled={disabled}
          invalid={{ date: errors.some((e) => e.toLowerCase().startsWith('document date')) }}
        />
        <AiAssistPanel
          disabled={disabled}
          onExtracted={(data, fileName) => {
            setExtraction({ data, fileName })
            setReviewOpen(true)
          }}
        />
      </div>

      <GrnLinesCard
        spec={spec}
        header={header}
        lines={lines}
        onChange={setLines}
        warehouses={warehouses}
        flaggedKeys={flaggedKeys}
        onScan={() => setScanOpen(true)}
        onBulkAdd={() => setBulkOpen(true)}
        onImportPo={() => setPoOpen(true)}
        currencySymbol={symbol}
        disabled={disabled}
      />

      <GrnSummaryCard
        totals={totals}
        impact={impact}
        alerts={alerts}
        currencySymbol={symbol}
        matchedCount={matchedCount}
        onViewMatches={() => setPoOpen(true)}
      />

      {refError ? <Banner tone="warning" title="Warehouses could not be loaded" body={refError} /> : null}

      {errors.length > 0 ? (
        <Banner
          tone="danger"
          title="Please fix before saving"
          body={
            <ul className="list-disc space-y-0.5 pl-4">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      {apiError && !negative ? <Banner tone="danger" title="The server refused this document" body={apiError} /> : null}

      {negative ? (
        <Banner
          tone="danger"
          title="Insufficient stock"
          body={
            <>
              {apiError ? <p className="mb-1">{apiError}</p> : null}
              <ul className="list-disc space-y-0.5 pl-4">
                {negative.map((detail, index) => (
                  <li key={`${detail.item_id}-${detail.warehouse_id}-${index}`}>
                    {detail.item_name ?? `Item #${detail.item_id}`}
                    {detail.warehouse_id ? ` · warehouse #${detail.warehouse_id}` : ''}: on hand {formatQty(detail.on_hand)}, required{' '}
                    {formatQty(detail.required)}, short by <strong>{formatQty(detail.short_by)}</strong>
                  </li>
                ))}
              </ul>
              {canOverride ? (
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary/30"
                    checked={override}
                    onChange={(e) => setOverride(e.target.checked)}
                  />
                  Post anyway and let stock go negative (override)
                </label>
              ) : (
                <p className="mt-1 text-xs">
                  Reduce the quantities or receive stock first. Posting into negative stock needs the “override negative-stock
                  block” permission.
                </p>
              )}
            </>
          }
        />
      ) : null}

      {warnings.length > 0 ? (
        <Banner
          tone="warning"
          title="Posted with warnings"
          body={
            <ul className="list-disc space-y-0.5 pl-4">
              {warnings.map((warning, index) => (
                <li key={`${warning.code}-${index}`}>{warning.message}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      <StickyActionBar
        status={
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <Badge tone={status === 'DRAFT' ? 'neutral' : 'info'} size="xs">
              {STATUS_LABELS[status] ?? status}
            </Badge>
            <span>
              {totals.items} item{totals.items === 1 ? '' : 's'} · {formatQty(totals.quantity)} units · {symbol}{' '}
              {formatMoney(totals.amount, '0.00')}
            </span>
            {savedId ? <span className="text-gray-400">draft #{savedId}</span> : null}
          </div>
        }
      >
        <Button variant="ghost" onClick={() => setDiscardTo('/documents')} disabled={disabled}>
          Discard
        </Button>
        <Button variant="secondary" icon={Save} onClick={() => void submit(false)} loading={busy === 'save'} disabled={disabled || !canSave} kbd="Alt S">
          {savedId ? 'Save changes' : 'Save as draft'}
        </Button>
        <Button variant="secondary" icon={Eye} onClick={() => setPreviewOpen(true)} disabled={disabled} kbd="Alt P">
          Preview GRN
        </Button>
        {canPost ? (
          <Button icon={PackageCheck} onClick={openPost} loading={busy === 'post'} disabled={disabled || blocked || (!canSave && !savedId)}>
            {negative && override ? 'Post with override' : 'Save & post'}
          </Button>
        ) : null}
      </StickyActionBar>

      {/* ---- overlays ---- */}
      <PurchaseOrderDrawer
        open={poOpen}
        onClose={() => setPoOpen(false)}
        partyRef={toNumber(header.party_ref)}
        hasLines={lines.some((l) => !isBlankLine(l))}
        onImport={importPurchaseOrder}
      />

      <BarcodeScanDialog
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        warehouseId={header.default_warehouse_id}
        warehouseName={defaultWarehouseName}
        onScanned={addScanned}
      />

      <BulkAddDrawer
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        warehouseId={header.default_warehouse_id}
        warehouseName={defaultWarehouseName}
        onAdd={(resolved) => {
          setLines((current) => [
            ...current.filter((l) => !isBlankLine(l)),
            ...resolved.map(({ row, qty }) => lineFromItem(spec, row, { ...lineDefaults, qty: String(qty) })),
          ])
          toast.success(`${resolved.length} item${resolved.length === 1 ? '' : 's'} added.`)
        }}
      />

      <AiExtractionReview
        open={reviewOpen}
        extraction={extraction?.data ?? null}
        fileName={extraction?.fileName ?? null}
        onClose={() => setReviewOpen(false)}
        onApply={(approval) => void applyExtraction(approval)}
      />

      <GrnPreviewDrawer
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        spec={spec}
        header={header}
        lines={lines}
        totals={totals}
        warehouseName={warehouseName}
        unitSymbol={unitSymbol}
        companyName={companyName}
        scopeLabel={scopeLabel}
        currencySymbol={symbol}
        savedId={savedId}
        status={STATUS_LABELS[status] ?? status}
      />

      <PostGrnDialog
        open={postOpen}
        onCancel={() => setPostOpen(false)}
        onConfirm={() => void submit(true)}
        busy={busy === 'post'}
        totals={totals}
        impact={impact}
        alerts={alerts}
        currencySymbol={symbol}
        supplierName={header.party_name}
        warehouseName={defaultWarehouseName}
        documentDate={header.document_date}
        error={apiError}
      />

      <ConfirmDialog
        open={discardTo !== null}
        title="Discard this GRN?"
        message="Your unsaved changes will be lost."
        confirmLabel="Discard"
        danger
        onCancel={() => setDiscardTo(null)}
        onConfirm={() => {
          const to = discardTo ?? '/documents'
          baseline.current = JSON.stringify({ header, lines })
          setDiscardTo(null)
          // The guard reads `dirty` on the next render; navigating in a microtask lets that
          // render happen first, so the click is not caught a second time.
          window.setTimeout(() => navigate(to), 0)
        }}
      />

      <ConfirmDialog
        open={guideOpen}
        title="Receiving goods in Inventory"
        confirmLabel="Got it"
        onCancel={() => setGuideOpen(false)}
        onConfirm={() => setGuideOpen(false)}
        message={
          <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed">
            <li>Pick the supplier, or import an open purchase order to fill the header and the lines at once.</li>
            <li>
              Choose the stock effect. <strong>Challan only</strong> records a pending quantity and moves nothing;{' '}
              <strong>Physical movement</strong> receives the goods into the warehouse straight away.
            </li>
            <li>Add items by searching, scanning (Alt + B), pasting a list, or uploading the supplier&rsquo;s challan for Aicountly AI to read.</li>
            <li>Complete batch, expiry and serial numbers where the item asks for them — the alerts panel lists what is missing.</li>
            <li>
              Save a draft with Alt + S, preview with Alt + P, and post with Ctrl + Enter. Posting is confirmed first and cannot be
              undone with Back.
            </li>
          </ol>
        }
      />
    </PageShell>
  )
}

function withTag(tags: string[] | undefined, tag: string): string[] {
  const current = tags ?? []
  return current.includes(tag) ? current : [...current, tag]
}

function Banner({ tone, title, body }: { tone: 'danger' | 'warning'; title: string; body: React.ReactNode }) {
  const danger = tone === 'danger'
  return (
    <div
      role="alert"
      className={cx(
        'aic flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed',
        danger ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800',
      )}
    >
      {danger ? <XCircle className="mt-px h-4 w-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-px h-4 w-4 shrink-0" aria-hidden />}
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <div className="mt-0.5">{body}</div>
      </div>
    </div>
  )
}

export default InwardChallanForm
