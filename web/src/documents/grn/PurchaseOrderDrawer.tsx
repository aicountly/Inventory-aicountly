import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, Info, PackageSearch, RefreshCw, Search } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorState } from '../../ui/ErrorState'
import { Input } from '../../ui/Input'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Spinner } from '../../ui/Spinner'
import { cx } from '../../ui/cx'
import { useDebounce } from '../../hooks/useDebounce'
import { isAbortError, errorMessage } from '../../services/api'
import { purchaseOrdersApi } from '../../services/purchaseOrdersApi'
import type { PurchaseOrderRow } from '../../services/purchaseOrdersApi'
import { formatDate, formatMoney, formatQty } from '../../utils/format'

type SourceFilter = 'all' | 'purchases' | 'deferred'

export interface PurchaseOrderSelection {
  order: PurchaseOrderRow
  /** `po_line_id`s the user chose. */
  lineIds: string[]
}

export interface PurchaseOrderDrawerProps {
  open: boolean
  onClose: () => void
  /** Books ledger id of the supplier already on the document, if any. */
  partyRef: number | null
  /** True when lines already exist, so importing has to ask before replacing them. */
  hasLines: boolean
  onImport: (selection: PurchaseOrderSelection, mode: 'append' | 'replace') => void
}

/**
 * Pick the order these goods arrived against.
 *
 * Two live sources, side by side and labelled: open purchase orders from Aicountly Purchases,
 * which owns them, and purchases Books already invoiced with deferred inward, which leave an open
 * pending quantity in Inventory. Neither is stored here — both are read each time the drawer
 * opens, because a balance that was true five minutes ago is exactly the kind of number a
 * receiving bench must not act on.
 *
 * Quantities proposed are what is still OPEN, never what was ordered, and the import never
 * silently discards lines already typed: with a draft in progress the footer asks whether to add
 * to it or replace it.
 */
export function PurchaseOrderDrawer({ open, onClose, partyRef, hasLines, onImport }: PurchaseOrderDrawerProps) {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<SourceFilter>('all')
  const [onlyThisSupplier, setOnlyThisSupplier] = useState(true)
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([])
  const [relayNote, setRelayNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [skippedLines, setSkippedLines] = useState<Set<string>>(new Set())
  const [tick, setTick] = useState(0)
  const debounced = useDebounce(query, 300)

  const filterRef = onlyThisSupplier ? partyRef : null

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const [relay, deferred] = await Promise.all([
          purchaseOrdersApi.openOrders({ partyRef: filterRef, q: debounced }, controller.signal),
          purchaseOrdersApi.deferredPurchases({ partyRef: filterRef }, controller.signal).catch(() => [] as PurchaseOrderRow[]),
        ])
        if (controller.signal.aborted) return
        setRelayNote(relay.available ? null : relay.message)
        setOrders([...(relay.available ? relay.data : []), ...deferred])
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) return
        setError(errorMessage(err, 'Could not load purchase orders.'))
        setOrders([])
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [open, debounced, filterRef, tick])

  // A closed drawer forgets what was half-chosen in it.
  useEffect(() => {
    if (open) return
    setSelectedId(null)
    setSkippedLines(new Set())
    setQuery('')
  }, [open])

  const visible = useMemo(() => {
    const needle = debounced.trim().toLowerCase()
    return orders
      .filter((o) => (source === 'all' ? true : source === 'purchases' ? o.origin === 'purchases' : o.origin === 'inventory_deferred'))
      .filter((o) =>
        !needle
          ? true
          : o.po_no.toLowerCase().includes(needle) ||
            (o.party_name ?? '').toLowerCase().includes(needle) ||
            o.lines.some((l) => l.item_name.toLowerCase().includes(needle) || (l.item_sku ?? '').toLowerCase().includes(needle)),
      )
  }, [orders, source, debounced])

  const selected = visible.find((o) => o.po_id === selectedId) ?? null
  const chosenLines = selected ? selected.lines.filter((l) => !skippedLines.has(l.po_line_id) && l.qty_open > 0) : []

  const importNow = (mode: 'append' | 'replace') => {
    if (!selected) return
    onImport({ order: selected, lineIds: chosenLines.map((l) => l.po_line_id) }, mode)
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="xl"
      title="Import from purchase order"
      description="Open orders from Aicountly Purchases and purchases awaiting receipt in Inventory, read live."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-gray-500">
            {selected ? `${chosenLines.length} of ${selected.lines.length} line(s) from ${selected.po_no}` : 'Select an order to import'}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {hasLines ? (
              <Button variant="secondary" disabled={chosenLines.length === 0} onClick={() => importNow('replace')}>
                Replace lines
              </Button>
            ) : null}
            <Button disabled={chosenLines.length === 0} onClick={() => importNow('append')}>
              {hasLines ? 'Add to draft' : 'Import lines'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-[12rem] flex-1"
            size="md"
            leadingIcon={Search}
            placeholder="Search by order no., supplier or item…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search purchase orders"
          />
          <SegmentedControl
            value={source}
            onChange={setSource}
            options={[
              { value: 'all', label: 'All' },
              { value: 'purchases', label: 'Purchases' },
              { value: 'deferred', label: 'Awaiting receipt' },
            ]}
          />
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => setTick((t) => t + 1)} aria-label="Reload orders" />
        </div>

        {partyRef !== null ? (
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary/30"
              checked={onlyThisSupplier}
              onChange={(e) => setOnlyThisSupplier(e.target.checked)}
            />
            Only orders for the supplier on this document
          </label>
        ) : null}

        {relayNote ? (
          <p className="flex items-start gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-2 text-[11px] leading-snug text-sky-900">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            {relayNote} Purchases awaiting receipt in Inventory are still listed below.
          </p>
        ) : null}

        {loading && orders.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
            <Spinner /> Loading open orders…
          </div>
        ) : error ? (
          <ErrorState size="sm" title="Could not load purchase orders" description={error} onRetry={() => setTick((t) => t + 1)} />
        ) : visible.length === 0 ? (
          <EmptyState
            compact
            icon={PackageSearch}
            title="No open purchase orders found"
            description={
              partyRef !== null && onlyThisSupplier
                ? 'Nothing is open for this supplier. Clear the supplier filter to see every open order.'
                : 'Nothing is awaiting receipt. Add the items by hand, or scan them in.'
            }
          />
        ) : (
          <ul className="space-y-2">
            {visible.map((order) => {
              const active = order.po_id === selectedId
              return (
                <li key={order.po_id}>
                  <div className={cx('rounded-xl border transition-colors', active ? 'border-primary/40 bg-primary-light/30' : 'border-gray-200 bg-white')}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
                      aria-expanded={active}
                      onClick={() => {
                        setSelectedId(active ? null : order.po_id)
                        setSkippedLines(new Set())
                      }}
                    >
                      <ClipboardList className={cx('mt-0.5 h-4 w-4 shrink-0', active ? 'text-primary' : 'text-gray-400')} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-gray-900">{order.po_no}</span>
                          <Badge tone={order.origin === 'purchases' ? 'info' : 'violet'} size="xs">
                            {order.origin === 'purchases' ? 'Purchases' : 'Awaiting receipt'}
                          </Badge>
                          <Badge tone="neutral" size="xs">
                            {order.status}
                          </Badge>
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                          {[order.party_name, formatDate(order.po_date), `${order.lines.length} line(s)`].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[10px] uppercase tracking-wide text-gray-400">Open</span>
                        <span className="block text-sm font-semibold tabular-nums text-gray-900">{formatQty(order.qty_open)}</span>
                      </span>
                    </button>

                    {active ? (
                      <div className="border-t border-gray-100 px-3 py-2">
                        <div className="mb-1.5 flex items-center justify-between">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Lines to receive</p>
                          <div className="flex gap-1">
                            <Button variant="link" size="xs" onClick={() => setSkippedLines(new Set())}>
                              All
                            </Button>
                            <Button variant="link" size="xs" onClick={() => setSkippedLines(new Set(order.lines.map((l) => l.po_line_id)))}>
                              None
                            </Button>
                          </div>
                        </div>
                        <ul className="space-y-1">
                          {order.lines.map((poLine) => {
                            const closed = poLine.qty_open <= 0
                            const on = !skippedLines.has(poLine.po_line_id) && !closed
                            return (
                              <li key={poLine.po_line_id}>
                                <label className={cx('flex items-center gap-2.5 rounded-lg px-2 py-1.5', closed ? 'opacity-50' : 'hover:bg-white')}>
                                  <input
                                    type="checkbox"
                                    className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-primary focus:ring-primary/30"
                                    checked={on}
                                    disabled={closed}
                                    onChange={() =>
                                      setSkippedLines((current) => {
                                        const next = new Set(current)
                                        if (next.has(poLine.po_line_id)) next.delete(poLine.po_line_id)
                                        else next.add(poLine.po_line_id)
                                        return next
                                      })
                                    }
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-medium text-gray-900">{poLine.item_name}</span>
                                    <span className="block truncate text-[10px] text-gray-500">
                                      {[poLine.item_sku, `ordered ${formatQty(poLine.qty_ordered)}`, `received ${formatQty(poLine.qty_received)}`].filter(Boolean).join(' · ')}
                                    </span>
                                  </span>
                                  <span className="shrink-0 text-right">
                                    <span className="block text-xs font-semibold tabular-nums text-gray-900">
                                      {formatQty(poLine.qty_open)} {poLine.unit_symbol ?? ''}
                                    </span>
                                    {poLine.rate !== null ? (
                                      <span className="block text-[10px] tabular-nums text-gray-500">{formatMoney(poLine.rate)}</span>
                                    ) : null}
                                  </span>
                                </label>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Drawer>
  )
}

export default PurchaseOrderDrawer
