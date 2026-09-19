import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  FileInput,
  History,
  PackagePlus,
  Printer,
  ScanLine,
  Sparkles,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Notice } from '../../components/Notice'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { errorMessage, isApiError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Tooltip } from '../../ui/Tooltip'
import { notify } from '../../ui/notify'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { currencySymbol, todayIso, toNumber } from '../../utils/format'
import { unitOptionsFrom } from '../LineEditor'
import { canCreate, permissionKeysFor } from '../actions'
import { isBlankLine, newHeader, newLine, round4, toPayload } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import type { InventoryDocument, PostingWarning } from '../types'
import { useReferenceData } from '../useReferenceData'
import type { ResolvedBulkLine } from './BulkAddDialog'
import { ReceiptAdditionalInfo } from './ReceiptAdditionalInfo'
import { ReceiptAiStrip } from './ReceiptAiStrip'
import { ReceiptAttachments } from './ReceiptAttachments'
import { ReceiptDocumentDetails } from './ReceiptDocumentDetails'
import { ReceiptLines } from './ReceiptLines'
import { ReceiptStickyActions } from './ReceiptStickyActions'
import { ReceiptSummary } from './ReceiptSummary'
import { aiAutofillStatus, attachmentsStatus, purchaseOrdersStatus } from './integrations'
import type { ExtractedReceipt, PurchaseOrderReceivable } from './integrations'
import { extractionToPatch, poLinesToDrafts } from './receiptSources'
import type { ExtractionPatch, PoSelection } from './receiptSources'
import { readExtras, receiptTotals, validateReceipt, writeExtras } from './receiptModel'
import type { ReceiptExtras } from './receiptModel'

export interface MaterialReceiptFormProps {
  spec: DocumentTypeSpec
  /** Set when editing a stored draft. */
  documentId?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  currencyCode?: string
}

const BREADCRUMBS = [
  { label: 'Documents', to: '/documents' },
  { label: 'Material receipt', to: '/documents?document_type=MATERIAL_RECEIPT' },
] as const

const HISTORY_TO = '/documents?document_type=MATERIAL_RECEIPT'

/*
 * The four workflows behind the toolbar are each a screen of their own, and
 * most receipts are typed in without opening any of them. They load when one is
 * asked for, so the bundle a storekeeper downloads to enter a receipt does not
 * carry a camera loop, a CSV parser and two integration clients it will never
 * run.
 */
const AiAutofillDialog = lazy(() => import('./AiAutofillDialog').then((m) => ({ default: m.AiAutofillDialog })))
const BarcodeScanDialog = lazy(() => import('./BarcodeScanDialog').then((m) => ({ default: m.BarcodeScanDialog })))
const BulkAddDialog = lazy(() => import('./BulkAddDialog').then((m) => ({ default: m.BulkAddDialog })))
const PurchaseOrderDialog = lazy(() => import('./PurchaseOrderDialog').then((m) => ({ default: m.PurchaseOrderDialog })))

function describeError(err: unknown): string {
  if (isApiError(err)) return err.field ? `${err.message} (${err.field})` : err.message
  return errorMessage(err, 'Something went wrong. Nothing on this receipt has been lost — try again.')
}

/**
 * `/documents/new/material_receipt` and `/documents/:id/edit` for a receipt.
 *
 * The screen a storekeeper spends their day on: header, lines, gate details,
 * totals, and one pinned bar that always says what is on the receipt and what
 * is stopping it. The engine underneath is the shared one — `formModel`'s
 * draft, `toPayload`, and `documentsApi.create / update / post` — so what this
 * screen sends is byte for byte what every other document editor sends, and
 * nothing about posting, valuation or permissions is re-implemented here.
 */
export function MaterialReceiptForm({ spec, documentId, initial, currencyCode }: MaterialReceiptFormProps) {
  const navigate = useNavigate()
  const { can } = useAccess()
  const { warehouses, defaultWarehouseId, loading: refLoading, error: refError } = useReferenceData()

  const [header, setHeader] = useState<HeaderDraft>(() => initial?.header ?? newHeader(spec, todayIso()))
  const [lines, setLines] = useState<LineDraft[]>(() => initial?.lines ?? [newLine(spec)])
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [busy, setBusy] = useState<'save' | 'post' | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<PostingWarning[]>([])
  const [posted, setPosted] = useState<InventoryDocument | null>(null)
  const [dirty, setDirty] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [focus, setFocus] = useState<{ key: string | null; nonce: number }>({ key: null, nonce: 0 })
  const [assistantOpen, setAssistantOpen] = useState(true)
  const [dialog, setDialog] = useState<'scan' | 'bulk' | 'po' | 'ai' | null>(null)
  const [leaving, setLeaving] = useState<{ to: string; proceed: () => void } | null>(null)
  const errorAnchor = useRef<HTMLDivElement>(null)

  /** After the render that puts the messages on screen, not before it. */
  const revealProblems = useCallback(() => {
    window.requestAnimationFrame(() => errorAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }, [])

  const currency = currencySymbol(currencyCode || 'INR')
  const extras = useMemo(() => readExtras(header.metadata), [header.metadata])
  const totals = useMemo(() => receiptTotals(lines, spec), [lines, spec])
  const hasWarehouses = warehouses.length > 0

  // What the sticky bar and the cells show: the post-time rules, live, so a
  // clerk is never told at the last moment that a line was never going to post.
  const validation = useMemo(
    () => validateReceipt(header, lines, { forPost: true, hasWarehouses }),
    [header, lines, hasWarehouses],
  )
  const headerIssues = attempted ? validation.header : []

  const poStatus = purchaseOrdersStatus()
  const aiStatus = aiAutofillStatus()
  const attachStatus = attachmentsStatus()

  const canPost = can(permissionKeysFor('post', spec.code))
  const canSave = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)

  const linkedPo = useMemo(() => {
    const id = header.metadata.purchase_order_id
    const no = header.metadata.purchase_order_no
    return id && no ? { id: id as number | string, no: String(no) } : null
  }, [header.metadata])

  // Pre-fill the default warehouse once reference data lands (new receipts only),
  // and carry it onto the empty lines the form started with.
  useEffect(() => {
    if (documentId || header.default_warehouse_id !== null || defaultWarehouseId === null) return
    setHeader((h) => ({ ...h, default_warehouse_id: defaultWarehouseId }))
    setLines((ls) => ls.map((l) => (l.warehouse_id === null ? { ...l, warehouse_id: defaultWarehouseId } : l)))
  }, [defaultWarehouseId, documentId, header.default_warehouse_id])

  const touch = useCallback(() => setDirty(true), [])

  const patchHeader = useCallback(
    (patch: Partial<HeaderDraft>) => {
      touch()
      setHeader((h) => ({ ...h, ...patch }))
    },
    [touch],
  )

  const patchExtras = useCallback(
    (patch: Partial<ReceiptExtras>) => {
      touch()
      setHeader((h) => ({ ...h, metadata: writeExtras(h.metadata, { ...readExtras(h.metadata), ...patch }) }))
    },
    [touch],
  )

  const patchLine = useCallback(
    (key: string, patch: Partial<LineDraft>) => {
      touch()
      setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    },
    [touch],
  )

  const addLine = useCallback(
    (partial: Partial<LineDraft> = {}) => {
      touch()
      const line = newLine(spec, { warehouse_id: header.default_warehouse_id, ...partial })
      setLines((ls) => [...ls, line])
      setFocus((f) => ({ key: line.key, nonce: f.nonce + 1 }))
      return line
    },
    [header.default_warehouse_id, spec, touch],
  )

  const appendLines = useCallback(
    (incoming: LineDraft[], mode: 'append' | 'replace' = 'append') => {
      if (incoming.length === 0) return
      touch()
      setLines((ls) => (mode === 'replace' ? incoming : [...ls.filter((l) => !isBlankLine(l)), ...incoming]))
    },
    [touch],
  )

  const removeLine = useCallback(
    (key: string) => {
      touch()
      setLines((ls) => ls.filter((l) => l.key !== key))
    },
    [touch],
  )

  const duplicateLine = useCallback(
    (key: string) => {
      touch()
      setLines((ls) => {
        const at = ls.findIndex((l) => l.key === key)
        if (at < 0) return ls
        // Everything but the identity: a duplicate is a second line, and the
        // serial numbers on the first one are not on the second.
        const { key: _key, serials: _serials, ...rest } = ls[at]
        const copy = newLine(spec, rest)
        return [...ls.slice(0, at + 1), copy, ...ls.slice(at + 1)]
      })
    },
    [spec, touch],
  )

  const pickItem = useCallback(
    (key: string, row: ItemSearchRow) => {
      touch()
      setLines((ls) =>
        ls.map((l) => {
          if (l.key !== key) return l
          const units = unitOptionsFrom(row)
          const preferred = units.find((u) => u.is_default) ?? units[0]
          return {
            ...l,
            item_id: row.item_id,
            item_name: row.print_name || row.item_name,
            item_sku: row.item_sku,
            track_batch: Number(row.track_batch) === 1,
            track_serial: Number(row.track_serial) === 1,
            units,
            unit_id: preferred?.unit_id ?? row.unit_id ?? null,
            warehouse_id: l.warehouse_id ?? row.default_warehouse_id ?? header.default_warehouse_id ?? null,
            batch_id: null,
            batch_no: null,
            batch_expiry: null,
            serials: [],
          }
        }),
      )
    },
    [header.default_warehouse_id, touch],
  )

  const clearItem = useCallback(
    (key: string) => {
      patchLine(key, {
        item_id: null,
        item_name: '',
        item_sku: null,
        track_batch: false,
        track_serial: false,
        units: [],
        unit_id: null,
        batch_id: null,
        batch_no: null,
        batch_expiry: null,
        serials: [],
      })
    },
    [patchLine],
  )

  /** A scan tops up the line that item is already on, rather than stacking duplicates. */
  const onScanned = useCallback(
    (row: ItemSearchRow) => {
      touch()
      setLines((ls) => {
        const at = ls.findIndex((l) => l.item_id === row.item_id && !l.track_serial)
        if (at >= 0) {
          const line = ls[at]
          const next = round4((toNumber(line.qty) ?? 0) + 1)
          const rate = line.rate
          return ls.map((l, i) =>
            i === at
              ? { ...l, qty: String(next), amount: rate ? String(round4(next * (toNumber(rate) ?? 0))) : l.amount }
              : l,
          )
        }
        const units = unitOptionsFrom(row)
        const preferred = units.find((u) => u.is_default) ?? units[0]
        const fresh = newLine(spec, {
          item_id: row.item_id,
          item_name: row.print_name || row.item_name,
          item_sku: row.item_sku,
          track_batch: Number(row.track_batch) === 1,
          track_serial: Number(row.track_serial) === 1,
          units,
          unit_id: preferred?.unit_id ?? row.unit_id ?? null,
          warehouse_id: row.default_warehouse_id ?? header.default_warehouse_id ?? null,
          qty: '1',
          metadata: { source: 'scan' },
        })
        return [...ls.filter((l) => !isBlankLine(l)), fresh]
      })
    },
    [header.default_warehouse_id, spec, touch],
  )

  const onBulkAdd = useCallback(
    (resolved: ResolvedBulkLine[]) => {
      const drafts = resolved.map(({ item, qty, rate, batchNo }) => {
        const units = unitOptionsFrom(item)
        const preferred = units.find((u) => u.is_default) ?? units[0]
        const q = toNumber(qty)
        const r = toNumber(rate)
        return newLine(spec, {
          item_id: item.item_id,
          item_name: item.print_name || item.item_name,
          item_sku: item.item_sku,
          track_batch: Number(item.track_batch) === 1,
          track_serial: Number(item.track_serial) === 1,
          units,
          unit_id: preferred?.unit_id ?? item.unit_id ?? null,
          warehouse_id: item.default_warehouse_id ?? header.default_warehouse_id ?? null,
          batch_no: batchNo.trim() || null,
          qty: q === null ? '' : String(q),
          rate: r === null ? '' : String(r),
          amount: q !== null && r !== null ? String(round4(q * r)) : '',
          metadata: { source: 'import' },
        })
      })
      appendLines(drafts)
      notify.success(`${drafts.length} line${drafts.length === 1 ? '' : 's'} added.`)
    },
    [appendLines, header.default_warehouse_id, spec],
  )

  const onApplyPo = useCallback(
    (receivable: PurchaseOrderReceivable, selection: PoSelection) => {
      const drafts = poLinesToDrafts(receivable, selection, { spec, defaultWarehouseId: header.default_warehouse_id })
      appendLines(drafts)
      patchHeader({
        metadata: {
          ...header.metadata,
          purchase_order_id: receivable.order.po_id,
          purchase_order_no: receivable.order.po_no,
        },
        ...(header.party_name.trim() === '' && receivable.order.supplier_name ? { party_name: receivable.order.supplier_name } : {}),
        ...(header.party_ref.trim() === '' && receivable.order.supplier_ref ? { party_ref: String(receivable.order.supplier_ref) } : {}),
      })
      setDialog(null)
      notify.info(`${drafts.length} line${drafts.length === 1 ? '' : 's'} loaded from ${receivable.order.po_no}.`)
    },
    [appendLines, header.default_warehouse_id, header.metadata, header.party_name, header.party_ref, patchHeader, spec],
  )

  const toPatch = useCallback(
    (extraction: ExtractedReceipt): ExtractionPatch =>
      extractionToPatch(extraction, { spec, defaultWarehouseId: header.default_warehouse_id }),
    [header.default_warehouse_id, spec],
  )

  const onApplyExtraction = useCallback(
    (patch: ExtractionPatch, mode: 'replace' | 'append') => {
      patchHeader(patch.header)
      appendLines(patch.lines, mode)
      setDialog(null)
      notify.info('Details filled in from the invoice — check them before posting.')
    },
    [appendLines, patchHeader],
  )

  const clearPo = useCallback(() => {
    const metadata = { ...header.metadata }
    delete metadata.purchase_order_id
    delete metadata.purchase_order_no
    patchHeader({ metadata })
  }, [header.metadata, patchHeader])

  const clearAll = useCallback(() => {
    touch()
    setLines([])
  }, [touch])

  const submit = useCallback(
    async (post: boolean) => {
      setAttempted(true)
      setApiError(null)
      setWarnings([])
      const result = validateReceipt(header, lines, { forPost: post, hasWarehouses })
      if (!result.ok) {
        notify.error(post ? 'This receipt cannot be posted yet — the highlighted fields need attention.' : 'Fix the highlighted fields before saving.')
        revealProblems()
        return
      }
      const payload = toPayload(header, lines, spec)
      payload.source_document_no = header.source_document_no.trim() || null
      payload.source_document_date = header.source_document_date || null

      setBusy(post ? 'post' : 'save')
      let id = savedId
      try {
        let doc = id ? await documentsApi.update(id, payload) : await documentsApi.create(payload)
        if (!id) {
          id = doc.document_id
          setSavedId(id)
        }
        if (post) {
          doc = await documentsApi.post(doc.document_id, {})
          setWarnings(doc.warnings ?? [])
          setDirty(false)
          setPosted(doc)
          notify.success(`Material receipt ${doc.document_no ?? `#${doc.document_id}`} posted.`)
          return
        }
        setDirty(false)
        notify.success(documentId ? 'Changes saved.' : `Draft saved as ${doc.document_no ?? `#${doc.document_id}`}.`)
        if (documentId) navigate(`/documents/${doc.document_id}`)
      } catch (err) {
        // Nothing is cleared and nothing navigates: whatever failed, the
        // receipt on screen is still exactly what the user typed.
        setApiError(describeError(err))
        revealProblems()
      } finally {
        setBusy(null)
      }
    },
    [documentId, hasWarehouses, header, lines, navigate, revealProblems, savedId, spec],
  )

  const bindings = useMemo(
    () => ({
      'ctrl+s': (e: KeyboardEvent) => {
        e.preventDefault()
        if (busy === null && canSave) void submit(false)
      },
      'ctrl+enter': (e: KeyboardEvent) => {
        e.preventDefault()
        if (busy === null && canPost) void submit(true)
      },
      'alt+a': (e: KeyboardEvent) => {
        e.preventDefault()
        if (busy === null) addLine()
      },
    }),
    [addLine, busy, canPost, canSave, submit],
  )
  useKeyboardScope('form', bindings, { allowInInput: true, enabled: posted === null })

  useUnsavedChanges({
    when: dirty && posted === null,
    onBlocked: (to, proceed) => setLeaving({ to, proceed }),
  })

  const cancel = () => {
    if (dirty) {
      const to = savedId ? `/documents/${savedId}` : '/documents'
      setLeaving({ to, proceed: () => navigate(to) })
      return
    }
    navigate(savedId ? `/documents/${savedId}` : '/documents')
  }

  const startAnother = () => {
    const keepDate = header.document_date
    const keepWarehouse = header.default_warehouse_id
    setPosted(null)
    setSavedId(null)
    setWarnings([])
    setApiError(null)
    setAttempted(false)
    setDirty(false)
    setHeader({ ...newHeader(spec, keepDate || todayIso()), default_warehouse_id: keepWarehouse })
    setLines([newLine(spec, { warehouse_id: keepWarehouse })])
  }

  // ---- posted -------------------------------------------------------------

  if (posted) {
    const label = posted.document_no ?? `#${posted.document_id}`
    return (
      <PageShell>
        <BreadcrumbHeader
          breadcrumbs={[...BREADCRUMBS, { label }]}
          title="Material receipt posted"
          icon={CheckCircle2}
          description={`${label} is in stock. The quantities and their cost are on the stock ledger now.`}
          backTo={HISTORY_TO}
          backLabel="All material receipts"
        />
        <Card className="border-emerald-200 bg-emerald-50/60">
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-white/70 grid place-items-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-700" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 m-0">Material receipt {label} posted successfully.</p>
              <p className="text-xs text-gray-600 mt-0.5 m-0">
                {totals.lines} line{totals.lines === 1 ? '' : 's'} received. Freight or duty on this consignment is
                capitalised with a landed cost allocation against it.
              </p>
            </div>
            <div className="flex items-center flex-wrap gap-2">
              <Link
                to={`/documents/${posted.document_id}`}
                className="inline-flex items-center h-8 px-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:border-primary/40 hover:text-primary transition-colors"
              >
                View receipt
              </Link>
              <Link
                to={`/documents/${posted.document_id}/print`}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:border-primary/40 hover:text-primary transition-colors"
              >
                <Printer className="w-4 h-4" aria-hidden />
                Print
              </Link>
              <Button size="md" icon={PackagePlus} onClick={startAnother}>
                Receive another
              </Button>
            </div>
          </div>
        </Card>
        {warnings.length > 0 ? (
          <Notice kind="warning" title="Posted with notes">
            <ul className="warning-list">
              {warnings.map((w, i) => (
                <li key={`${w.code}-${i}`}>{w.message}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
      </PageShell>
    )
  }

  // ---- editing ------------------------------------------------------------

  const headerAction = (label: string, icon: typeof ScanLine, onClick: () => void, reason: string | null, variant: 'secondary' | 'ghost' = 'secondary') => {
    const button = (
      <Button variant={variant} size="md" icon={icon} onClick={onClick} disabled={busy !== null || Boolean(reason)}>
        {label}
      </Button>
    )
    return reason ? <Tooltip label={reason}>{button}</Tooltip> : button
  }

  return (
    <PageShell paddingBottom>
      <BreadcrumbHeader
        breadcrumbs={[...BREADCRUMBS, { label: documentId ? `Edit ${savedId ? `#${savedId}` : ''}`.trim() : 'New' }]}
        title={documentId ? 'Edit material receipt' : 'Material receipt'}
        icon={PackagePlus}
        description="Receive material into stores at a cost. Stock and its valuation move the moment it posts."
        escDirty={dirty}
        backTo={HISTORY_TO}
        backLabel="All material receipts"
        actions={
          <>
            {headerAction('Scan', ScanLine, () => setDialog('scan'), null)}
            {headerAction('Import', Upload, () => setDialog('bulk'), null)}
            {headerAction('Create from PO', FileInput, () => setDialog('po'), poStatus.reason)}
            {headerAction('AI auto-fill', Sparkles, () => setDialog('ai'), aiStatus.reason)}
            <Link
              to={HISTORY_TO}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:border-primary/40 hover:bg-primary-light hover:text-primary transition-colors"
            >
              <History className="w-4 h-4" aria-hidden />
              History
            </Link>
          </>
        }
      />

      <div ref={errorAnchor} className="space-y-3">
        {refError ? <Notice kind="warning">{refError}</Notice> : null}
        {apiError ? (
          <Notice kind="error" title="Could not save this receipt">
            {apiError}
            <div className="text-xs text-gray-600 mt-1">
              Everything you entered is still here. Correct what the message names and try again.
            </div>
          </Notice>
        ) : null}
        {attempted && validation.errors > 0 ? (
          <Notice kind="warning" title={`${validation.errors} thing${validation.errors === 1 ? '' : 's'} to fix before posting`}>
            <ul className="warning-list">
              {validation.header.filter((i) => i.level === 'error').map((i) => (
                <li key={`h-${i.field}`}>{i.message}</li>
              ))}
              {validation.lines
                .filter((i) => i.level === 'error')
                .slice(0, 6)
                .map((i) => (
                  <li key={`l-${i.key}-${i.field}`}>
                    Line {i.row}: {i.message}
                  </li>
                ))}
            </ul>
          </Notice>
        ) : null}
      </div>

      <ReceiptDocumentDetails
        header={header}
        extras={extras}
        onHeaderChange={patchHeader}
        onExtrasChange={patchExtras}
        warehouses={warehouses}
        warehousesLoading={refLoading && warehouses.length === 0}
        disabled={busy !== null}
        issues={headerIssues}
        linkedPo={linkedPo}
        onOpenPoPicker={() => setDialog('po')}
        onClearPo={clearPo}
        poReason={poStatus.reason}
        assistant={
          assistantOpen ? (
            <ReceiptAiStrip
              onUploadInvoice={() => setDialog('ai')}
              onSelectPo={() => setDialog('po')}
              onDismiss={() => setAssistantOpen(false)}
              aiReason={aiStatus.reason}
              poReason={poStatus.reason}
              disabled={busy !== null}
            />
          ) : null
        }
      />

      <ReceiptLines
        lines={lines}
        issues={validation.lines}
        warehouses={warehouses}
        headerWarehouseId={header.default_warehouse_id}
        disabled={busy !== null}
        totals={totals}
        currency={currency}
        focusKey={focus.key}
        focusNonce={focus.nonce}
        onPatchLine={patchLine}
        onPickItem={pickItem}
        onClearItem={clearItem}
        onRemoveLine={removeLine}
        onDuplicateLine={duplicateLine}
        onAddLine={() => addLine()}
        onClearAll={clearAll}
        onScan={() => setDialog('scan')}
        onBulkAdd={() => setDialog('bulk')}
        onAddFromPo={() => setDialog('po')}
        poReason={poStatus.reason}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <ReceiptAttachments documentId={savedId} disabled={busy !== null} unavailableReason={attachStatus.reason} />
        <ReceiptAdditionalInfo extras={extras} onChange={patchExtras} disabled={busy !== null} />
        <ReceiptSummary totals={totals} currency={currency} />
      </div>

      {validation.warnings > 0 ? (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-700 m-0">
          <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden />
          <span>
            {validation.warnings} thing{validation.warnings === 1 ? '' : 's'} worth checking — they do not stop the
            receipt posting.
          </span>
        </p>
      ) : null}

      <ReceiptStickyActions
        totals={totals}
        currency={currency}
        errors={validation.errors}
        warnings={validation.warnings}
        dirty={dirty}
        busy={busy}
        canSave={canSave}
        canPost={canPost}
        saveLabel={savedId ? 'Save changes' : 'Save draft'}
        cancelTo={savedId ? `/documents/${savedId}` : '/documents'}
        onCancel={cancel}
        onSaveDraft={() => void submit(false)}
        onPost={() => void submit(true)}
      />

      {/* `fallback={null}`: the chunk is a few kilobytes on the same origin, and
          a spinner that flashes for one frame is worse than the button taking
          a moment to open. */}
      <Suspense fallback={null}>
        {dialog === 'scan' ? (
          <BarcodeScanDialog open onClose={() => setDialog(null)} warehouseId={header.default_warehouse_id} onScanned={onScanned} />
        ) : null}
        {dialog === 'bulk' ? (
          <BulkAddDialog open onClose={() => setDialog(null)} warehouseId={header.default_warehouse_id} onAdd={onBulkAdd} />
        ) : null}
        {dialog === 'po' && poStatus.available ? (
          <PurchaseOrderDialog open onClose={() => setDialog(null)} supplierRef={toNumber(header.party_ref)} onApply={onApplyPo} />
        ) : null}
        {dialog === 'ai' && aiStatus.available ? (
          <AiAutofillDialog open onClose={() => setDialog(null)} toPatch={toPatch} onApply={onApplyExtraction} />
        ) : null}
      </Suspense>

      <ConfirmDialog
        open={leaving !== null}
        title="Leave without saving?"
        message="This receipt has changes that have not been saved. Leaving now discards them."
        confirmLabel="Discard and leave"
        danger
        onCancel={() => setLeaving(null)}
        onConfirm={() => {
          const go = leaving?.proceed
          setDirty(false)
          setLeaving(null)
          go?.()
        }}
      />
    </PageShell>
  )
}

export default MaterialReceiptForm
