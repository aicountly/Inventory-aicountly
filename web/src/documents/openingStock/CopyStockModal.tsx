import { useEffect, useMemo, useState } from 'react'
import { useCompany } from '../../company/CompanyContext'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { isAbortError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import type { FormOptionWarehouse } from '../../services/items'
import { lookupApi } from '../../services/lookupApi'
import { stockBalancesApi } from '../../services/stockViewsApi'
import type { StockBalanceGridRow } from '../../services/stockViewsApi'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { SegmentedControl } from '../../ui/SegmentedControl'
import type { SegmentedOption } from '../../ui/SegmentedControl'
import { SkeletonRows } from '../../ui/Skeleton'
import { formatDate, formatMoney, formatQty } from '../../utils/format'
import { lineFromStored } from '../formModel'
import type { LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import type { DocumentListRow } from '../types'
import { lineFromStockBalance } from './openingStockHelpers'
import type { CopySource } from './openingStockHelpers'

interface CopyStockModalProps {
  open: boolean
  initialSource: CopySource
  onClose: () => void
  spec: DocumentTypeSpec
  warehouses: FormOptionWarehouse[]
  onConfirm: (lines: LineDraft[]) => void
}

const SOURCE_OPTIONS: SegmentedOption<CopySource>[] = [
  { value: 'previous_document', label: 'Previous opening stock' },
  { value: 'closing_stock', label: 'Current stock balances' },
]

function warehouseName(id: number | null, warehouses: readonly FormOptionWarehouse[]): string {
  if (id === null) return '—'
  return warehouses.find((w) => w.warehouse_id === id)?.warehouse_name ?? `Warehouse #${id}`
}

/**
 * "Copy from previous year" and "Fetch from closing stock" share one modal because they answer
 * the same question — which lines should seed this draft — from two different live sources: an
 * earlier OPENING_STOCK document (any financial year but this one), or today's on-hand stock.
 * Both preview before anything is added; nothing here calls a write endpoint.
 */
export function CopyStockModal({ open, initialSource, onClose, spec, warehouses, onConfirm }: CopyStockModalProps) {
  const { scope } = useCompany()
  const [source, setSource] = useState<CopySource>(initialSource)

  const [candidates, setCandidates] = useState<DocumentListRow[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [candidatesError, setCandidatesError] = useState<string | null>(null)
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null)
  const [docLines, setDocLines] = useState<LineDraft[] | null>(null)
  const [docLoading, setDocLoading] = useState(false)
  const [docError, setDocError] = useState<string | null>(null)

  const [balances, setBalances] = useState<StockBalanceGridRow[]>([])
  const [balancesLoading, setBalancesLoading] = useState(false)
  const [balancesError, setBalancesError] = useState<string | null>(null)

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)

  // Reset to a clean slate every time the modal opens, so a previous run never leaks in.
  useEffect(() => {
    if (!open) return
    setSource(initialSource)
    setCandidates([])
    setCandidatesError(null)
    setSelectedDocId(null)
    setDocLines(null)
    setDocError(null)
    setBalances([])
    setBalancesError(null)
    setSelectedKeys(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the transition into "open" matters
  }, [open])

  // Previous opening stock: the candidate documents, any FY but this one.
  useEffect(() => {
    if (!open || source !== 'previous_document') return undefined
    const controller = new AbortController()
    setCandidatesLoading(true)
    setCandidatesError(null)
    documentsApi
      .list({ document_type: spec.code, all_fy: true, sort: 'document_date', order: 'desc', limit: 8 }, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return
        const rows = res.data.filter((d) => d.fy_id !== scope?.fy_id)
        setCandidates(rows)
        if (rows.length > 0) setSelectedDocId(rows[0].document_id)
        setCandidatesLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setCandidatesError('Could not load previous documents. Retry.')
        setCandidatesLoading(false)
      })
    return () => controller.abort()
  }, [open, source, spec.code, scope?.fy_id])

  // The chosen candidate's own lines.
  useEffect(() => {
    if (!open || source !== 'previous_document' || selectedDocId === null) {
      setDocLines(null)
      return undefined
    }
    const controller = new AbortController()
    setDocLoading(true)
    setDocError(null)
    documentsApi
      .get(selectedDocId, controller.signal)
      .then((doc) => {
        if (controller.signal.aborted) return
        const built = doc.lines.map((l) => lineFromStored(l, spec))
        setDocLines(built)
        setSelectedKeys(new Set(built.map((l) => l.key)))
        setDocLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setDocError('Could not load that document. Retry.')
        setDocLoading(false)
      })
    return () => controller.abort()
  }, [open, source, selectedDocId, spec])

  // Current stock balances, nonzero only.
  useEffect(() => {
    if (!open || source !== 'closing_stock') return undefined
    const controller = new AbortController()
    setBalancesLoading(true)
    setBalancesError(null)
    stockBalancesApi
      .list({ nonzero: true, limit: 200, sort: 'item_name' }, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return
        setBalances(res.data)
        setSelectedKeys(new Set(res.data.map((r) => String(r.balance_id))))
        setBalancesLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setBalancesError('Could not load current stock balances. Retry.')
        setBalancesLoading(false)
      })
    return () => controller.abort()
  }, [open, source])

  const toggle = (key: string) =>
    setSelectedKeys((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const allKeys = useMemo(() => (source === 'previous_document' ? (docLines ?? []).map((l) => l.key) : balances.map((r) => String(r.balance_id))), [source, docLines, balances])
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selectedKeys.has(k))
  const toggleAll = () => setSelectedKeys(allSelected ? new Set() : new Set(allKeys))

  const confirm = async () => {
    if (source === 'previous_document') {
      const chosen = (docLines ?? []).filter((l) => selectedKeys.has(l.key))
      onConfirm(chosen)
      onClose()
      return
    }
    const chosenBalances = balances.filter((r) => selectedKeys.has(String(r.balance_id)))
    if (chosenBalances.length === 0) return
    setConfirming(true)
    try {
      const itemIds = [...new Set(chosenBalances.map((r) => r.item_id))]
      const items = await lookupApi.itemsByIds(itemIds)
      const byId = new Map(items.map((it) => [it.item_id, it]))
      onConfirm(chosenBalances.map((row) => lineFromStockBalance(spec, row, byId.get(row.item_id))))
      onClose()
    } catch {
      setBalancesError('Could not resolve item details for the selected rows. Retry.')
    } finally {
      setConfirming(false)
    }
  }

  const selectedCount = selectedKeys.size

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Copy stock into this draft"
      description="Preview and choose which lines to bring in — nothing is added until you confirm."
      size="lg"
      busy={confirming}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={confirming}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={() => void confirm()} disabled={confirming || selectedCount === 0} loading={confirming}>
            Add {selectedCount} line{selectedCount === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <SegmentedControl value={source} onChange={setSource} options={SOURCE_OPTIONS} />

      <div className="mt-4">
        {source === 'previous_document' ? (
          <>
            {candidatesLoading ? <SkeletonRows rows={3} /> : null}
            {candidatesError ? <Notice kind="error">{candidatesError}</Notice> : null}
            {!candidatesLoading && !candidatesError && candidates.length === 0 ? (
              <EmptyState size="sm" title="No earlier opening stock found" description={`No ${spec.label.toLowerCase()} document exists in another financial year yet.`} />
            ) : null}
            {candidates.length > 1 ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {candidates.map((c) => (
                  <button
                    key={c.document_id}
                    type="button"
                    onClick={() => setSelectedDocId(c.document_id)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${selectedDocId === c.document_id ? 'border-primary bg-primary-light text-primary' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {c.document_no ?? `#${c.document_id}`} · {formatDate(c.document_date)} · {c.line_count} line{Number(c.line_count) === 1 ? '' : 's'}
                  </button>
                ))}
              </div>
            ) : null}
            {docLoading ? <SkeletonRows rows={4} /> : null}
            {docError ? <Notice kind="error">{docError}</Notice> : null}
            {!docLoading && docLines && docLines.length > 0 ? (
              <PreviewTable
                rows={docLines.map((l) => ({
                  key: l.key,
                  item: l.item_name,
                  sku: l.item_sku,
                  warehouse: warehouseName(l.warehouse_id, warehouses),
                  batch: l.batch_no,
                  qty: l.qty,
                  rate: l.rate,
                }))}
                selectedKeys={selectedKeys}
                onToggle={toggle}
                allSelected={allSelected}
                onToggleAll={toggleAll}
              />
            ) : null}
            {!docLoading && docLines && docLines.length === 0 ? <EmptyState size="sm" title="That document has no lines" /> : null}
          </>
        ) : (
          <>
            {balancesLoading ? <SkeletonRows rows={5} /> : null}
            {balancesError ? <Notice kind="error">{balancesError}</Notice> : null}
            {!balancesLoading && !balancesError && balances.length === 0 ? (
              <EmptyState size="sm" title="No stock on hand" description="There is no nonzero stock balance to bring in right now." />
            ) : null}
            {!balancesLoading && balances.length > 0 ? (
              <>
                <p className="mb-2 text-xs text-gray-500">Rate is not carried over — set it per line, or use Auto-fill rates (AI) once connected.</p>
                <PreviewTable
                  rows={balances.map((r) => ({
                    key: String(r.balance_id),
                    item: r.item_name ?? `Item #${r.item_id}`,
                    sku: r.item_sku,
                    warehouse: r.warehouse_name ?? warehouseName(r.warehouse_id, warehouses),
                    batch: r.batch_no,
                    qty: String(r.on_hand_qty),
                    rate: null,
                  }))}
                  selectedKeys={selectedKeys}
                  onToggle={toggle}
                  allSelected={allSelected}
                  onToggleAll={toggleAll}
                />
              </>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  )
}

interface PreviewRow {
  key: string
  item: string
  sku: string | null
  warehouse: string
  batch: string | null
  qty: string
  rate: string | null
}

function PreviewTable({ rows, selectedKeys, onToggle, allSelected, onToggleAll }: { rows: PreviewRow[]; selectedKeys: Set<string>; onToggle: (key: string) => void; allSelected: boolean; onToggleAll: () => void }) {
  return (
    <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
          <tr>
            <th className="w-8 px-3 py-2">
              <input type="checkbox" checked={allSelected} onChange={onToggleAll} aria-label="Select all rows" />
            </th>
            <th className="px-2 py-2">Item</th>
            <th className="px-2 py-2">Warehouse</th>
            <th className="px-2 py-2">Batch</th>
            <th className="px-2 py-2 text-right">Qty</th>
            <th className="px-2 py-2 text-right">Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-gray-100 hover:bg-gray-50">
              <td className="px-3 py-2">
                <input type="checkbox" checked={selectedKeys.has(r.key)} onChange={() => onToggle(r.key)} aria-label={`Include ${r.item}`} />
              </td>
              <td className="px-2 py-2">
                <div className="font-medium text-gray-900">{r.item}</div>
                {r.sku ? <div className="text-xs text-gray-400">{r.sku}</div> : null}
              </td>
              <td className="px-2 py-2 text-gray-600">{r.warehouse}</td>
              <td className="px-2 py-2 text-gray-600">{r.batch ?? '—'}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatQty(r.qty)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.rate ? formatMoney(r.rate) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default CopyStockModal
