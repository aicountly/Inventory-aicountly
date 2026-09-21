import { useEffect, useState } from 'react'
import { ArrowLeft, FileInput, Loader2, Search } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { useDebounce } from '../../hooks/useDebounce'
import { errorMessage, isAbortError } from '../../services/api'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { EmptyState } from '../../ui/EmptyState'
import { formatDate, formatMoney, formatQty } from '../../utils/format'
import { purchaseOrdersApi } from './integrations'
import type { PurchaseOrderReceivable, PurchaseOrderSummary } from './integrations'
import { clampReceiptQty, defaultSelection } from './receiptSources'
import type { PoSelection } from './receiptSources'

export interface PurchaseOrderDialogProps {
  open: boolean
  onClose: () => void
  /** Narrows the search when the receipt already names a supplier. */
  supplierRef: number | null
  onApply: (receivable: PurchaseOrderReceivable, selection: PoSelection) => void
}

/**
 * Receive against a purchase order.
 *
 * The order lives in Purchases and stays there: this reads it over the API,
 * shows what is still pending on each line, and hands the chosen quantities to
 * the receipt as ordinary editable lines carrying a reference back to the order
 * line. No purchase order is copied into an inv_* table, and nothing here
 * writes to Purchases either — receiving is Inventory's half of the story.
 *
 * A line cannot be received for more than is pending: the dialog clamps it, and
 * an over-delivery is a line the storekeeper adds on purpose, not one that
 * slips through because a field accepted it.
 */
export function PurchaseOrderDialog({ open, onClose, supplierRef, onApply }: PurchaseOrderDialogProps) {
  const [query, setQuery] = useState('')
  const debounced = useDebounce(query, 300)
  const [orders, setOrders] = useState<PurchaseOrderSummary[]>([])
  const [searching, setSearching] = useState(false)
  const [receivable, setReceivable] = useState<PurchaseOrderReceivable | null>(null)
  const [loadingLines, setLoadingLines] = useState(false)
  const [selection, setSelection] = useState<PoSelection>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setOrders([])
      setReceivable(null)
      setSelection({})
      setError(null)
    }
  }, [open])

  useEffect(() => {
    if (!open || receivable) return undefined
    const controller = new AbortController()
    setSearching(true)
    setError(null)
    purchaseOrdersApi
      .search(debounced.trim(), { supplierRef, signal: controller.signal })
      .then((rows) => {
        if (controller.signal.aborted) return
        setOrders(rows)
        setSearching(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setOrders([])
        setError(errorMessage(err, 'Could not load purchase orders.'))
        setSearching(false)
      })
    return () => controller.abort()
  }, [open, debounced, supplierRef, receivable])

  const openOrder = async (order: PurchaseOrderSummary) => {
    setLoadingLines(true)
    setError(null)
    try {
      const loaded = await purchaseOrdersApi.receivable(order.po_id)
      setReceivable(loaded)
      setSelection(defaultSelection(loaded.lines))
    } catch (err) {
      setError(errorMessage(err, 'Could not load the order lines.'))
    } finally {
      setLoadingLines(false)
    }
  }

  const chosen = receivable
    ? receivable.lines.filter((l) => l.item_id && clampReceiptQty(selection[String(l.po_line_id)], Number(l.pending_qty) || 0) > 0).length
    : 0

  return (
    <Modal
      open={open}
      title={receivable ? `Receive against ${receivable.order.po_no}` : 'Create from purchase order'}
      description={
        receivable
          ? 'Set what actually arrived. Nothing can exceed the pending quantity.'
          : 'Pick the order these goods came against — the ordered lines are pulled in for you to check.'
      }
      onClose={onClose}
      size="xl"
      busy={loadingLines}
      footer={
        <>
          {receivable ? (
            <Button variant="ghost" icon={ArrowLeft} onClick={() => setReceivable(null)}>
              Another order
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {receivable ? (
            <Button onClick={() => onApply(receivable, selection)} disabled={chosen === 0}>
              Add {chosen} line{chosen === 1 ? '' : 's'}
            </Button>
          ) : null}
        </>
      }
    >
      {error ? <p className="text-xs font-medium text-red-600 mb-2">{error}</p> : null}

      {!receivable ? (
        <div className="space-y-2">
          <Input
            autoFocus
            size="md"
            leadingIcon={Search}
            value={query}
            placeholder="Search by PO number or supplier…"
            aria-label="Search purchase orders"
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching ? (
            <p className="text-[11px] text-gray-500 inline-flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Loading orders…
            </p>
          ) : orders.length === 0 ? (
            <EmptyState
              icon={FileInput}
              size="sm"
              title="No open purchase orders match"
              description="Try the order number, or add the items to the receipt by hand."
            />
          ) : (
            <ul className="space-y-1 list-none p-0 m-0 max-h-96 overflow-y-auto">
              {orders.map((order) => (
                <li key={String(order.po_id)}>
                  <button
                    type="button"
                    onClick={() => void openOrder(order)}
                    className="w-full text-left rounded-xl border border-gray-200 px-3 py-2 hover:border-primary/40 hover:bg-primary-light transition-colors"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-900">{order.po_no}</span>
                      <span className="text-[11px] text-gray-500">{formatDate(order.po_date)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5 flex-wrap">
                      {order.supplier_name ? <span className="truncate">{order.supplier_name}</span> : null}
                      {order.status ? <span>· {order.status}</span> : null}
                      {order.pending_lines ? <span>· {order.pending_lines} pending</span> : null}
                      {order.ordered_amount ? <span className="tabular-nums">· {formatMoney(order.ordered_amount)}</span> : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full min-w-[42rem] border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-500">
                <th scope="col" className="px-2 py-2 text-left font-semibold">Item</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Ordered</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Received</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Pending</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Receiving now</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {receivable.lines.map((line) => {
                const key = String(line.po_line_id)
                const pending = Number(line.pending_qty) || 0
                const unknownItem = !line.item_id
                return (
                  <tr key={key} className={unknownItem ? 'bg-amber-50' : undefined}>
                    <td className="px-2 py-1.5">
                      <span className="block font-medium text-gray-900 truncate">{line.item_name ?? `Item #${line.po_line_id}`}</span>
                      <span className="block text-[11px] text-gray-500">
                        {[line.item_sku, line.unit_symbol].filter(Boolean).join(' · ')}
                        {unknownItem ? ' · not in this company’s item master' : ''}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{formatQty(line.ordered_qty)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{formatQty(line.received_qty)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium text-gray-900">{formatQty(pending)}</td>
                    <td className="px-2 py-1.5 w-32">
                      <Input
                        size="sm"
                        className="text-right tabular-nums"
                        inputMode="decimal"
                        aria-label={`Quantity received for ${line.item_name ?? key}`}
                        value={selection[key] ?? ''}
                        disabled={unknownItem || pending <= 0}
                        onChange={(e) => setSelection((s) => ({ ...s, [key]: e.target.value }))}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

export default PurchaseOrderDialog
