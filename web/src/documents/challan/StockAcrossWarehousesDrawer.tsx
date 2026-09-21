import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Layers, RotateCcw, Warehouse } from 'lucide-react'
import { errorMessage, isAbortError } from '../../services/api'
import { availabilityApi } from '../../services/stockApi'
import type { AvailabilityRow } from '../../services/stockApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { EmptyState } from '../../ui/EmptyState'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Spinner } from '../../ui/Spinner'
import { cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'

interface StockAcrossWarehousesDrawerProps {
  open: boolean
  onClose: () => void
  itemId: number
  itemName: string
  /** The warehouse the line currently dispatches from, highlighted in the table. */
  currentWarehouseId: number | null
  warehouseName: (id: number | null | undefined) => string
  /** Null hides the "use this warehouse" action (opened from the toolbar, not a line). */
  onUseWarehouse: ((warehouseId: number) => void) | null
}

type Mode = 'warehouse' | 'batch'

/**
 * Where this item actually is, right now — `GET /v1/availability` for one item,
 * by warehouse or broken down by batch.
 *
 * Every bucket on screen is the server's: on hand, what is reserved or
 * committed elsewhere, and what is therefore free to dispatch. Nothing is
 * derived here, because "available" is a rule (reservations, packed stock,
 * quality holds) that the posting engine owns and a second implementation of it
 * on the client would eventually disagree with the one that blocks the post.
 */
export function StockAcrossWarehousesDrawer({
  open,
  onClose,
  itemId,
  itemName,
  currentWarehouseId,
  warehouseName,
  onUseWarehouse,
}: StockAcrossWarehousesDrawerProps) {
  const [mode, setMode] = useState<Mode>('warehouse')
  const [rows, setRows] = useState<AvailabilityRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    availabilityApi
      .forItems([itemId], null, mode === 'batch', controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return
        setRows(res)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setError(errorMessage(err, 'Could not read stock for this item.'))
        setLoading(false)
      })
    return () => controller.abort()
  }, [open, itemId, mode, tick])

  const withStock = rows.filter((r) => Number(r.on_hand) !== 0 || Number(r.available) !== 0)
  const totalAvailable = rows.reduce((sum, r) => sum + (Number(r.available) || 0), 0)

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Stock across warehouses"
      description={itemName}
      width="lg"
      badge={<Badge tone={totalAvailable > 0 ? 'success' : 'warning'} size="xs">{formatQty(totalAvailable)} available in total</Badge>}
      footer={
        <div className="flex items-center justify-between gap-3">
          <Link to={`/registers/stock-ledger?item_id=${itemId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary no-underline hover:underline">
            Open the stock ledger
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'warehouse', label: 'By warehouse' },
              { value: 'batch', label: 'By batch' },
            ]}
          />
          <Button variant="ghost" size="xs" icon={RotateCcw} onClick={() => setTick((t) => t + 1)} disabled={loading}>
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
            <Spinner /> Reading live stock…
          </div>
        ) : error ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <span className="min-w-0">{error}</span>
            <Button variant="secondary" size="xs" icon={RotateCcw} onClick={() => setTick((t) => t + 1)}>
              Retry
            </Button>
          </div>
        ) : withStock.length === 0 ? (
          <EmptyState icon={Warehouse} size="sm" title="No stock anywhere" description="This item has nothing on hand in any warehouse in the selected scope." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-gray-50">
                <tr className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  <th scope="col" className="px-2.5 py-1.5">
                    {mode === 'batch' ? 'Warehouse · batch' : 'Warehouse'}
                  </th>
                  <th scope="col" className="w-24 px-2.5 py-1.5 text-right">
                    On hand
                  </th>
                  <th scope="col" className="w-24 px-2.5 py-1.5 text-right">
                    Reserved
                  </th>
                  <th scope="col" className="w-24 px-2.5 py-1.5 text-right">
                    Available
                  </th>
                  {onUseWarehouse ? <th scope="col" className="w-28 px-2.5 py-1.5" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {withStock.map((r, i) => {
                  const here = r.warehouse_id === currentWarehouseId
                  const available = Number(r.available) || 0
                  return (
                    <tr key={`${r.warehouse_id ?? 0}-${r.batch_id ?? 0}-${i}`} className={cx(here ? 'bg-primary-light/40' : '')}>
                      <td className="px-2.5 py-1.5">
                        <span className="flex items-center gap-1.5">
                          {mode === 'batch' ? <Layers className="h-3 w-3 shrink-0 text-amber-500" aria-hidden /> : <Warehouse className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />}
                          <span className="min-w-0 truncate text-gray-900">
                            {warehouseName(r.warehouse_id) || (r.warehouse_id ? `Warehouse #${r.warehouse_id}` : 'Unassigned')}
                            {mode === 'batch' && r.batch_id ? <span className="text-gray-500"> · batch #{r.batch_id}</span> : null}
                          </span>
                          {here ? (
                            <Badge tone="primary" size="xs">
                              This line
                            </Badge>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums text-gray-700">{formatQty(r.on_hand)}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums text-gray-500">{formatQty(Number(r.reserved) + Number(r.committed) + Number(r.packed))}</td>
                      <td className={cx('px-2.5 py-1.5 text-right font-semibold tabular-nums', available > 0 ? 'text-emerald-700' : 'text-gray-400')}>{formatQty(available)}</td>
                      {onUseWarehouse ? (
                        <td className="px-2.5 py-1.5">
                          {r.warehouse_id && !here ? (
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => {
                                onUseWarehouse(r.warehouse_id as number)
                                onClose()
                              }}
                            >
                              Use this
                            </Button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-gray-500">
          Available is what the posting engine will let this challan take: on hand less anything reserved, committed, packed, held or blocked. The figures are read live and are not cached on
          this page.
        </p>
      </div>
    </Drawer>
  )
}
