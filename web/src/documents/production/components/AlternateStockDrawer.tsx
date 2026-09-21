import { Link } from 'react-router-dom'
import { ArrowLeftRight, Warehouse } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { EmptyState } from '../../../ui/EmptyState'
import { cx } from '../../../ui/cx'
import { formatQty } from '../../../utils/format'
import type { ComponentRow } from '../productionModel'

export interface AlternateStockDrawerProps {
  open: boolean
  row: ComponentRow | null
  warehouseName: (id: number | null) => string
  onClose: () => void
  onUseWarehouse: (lineKey: string, warehouseId: number) => void
  disabled: boolean
}

/**
 * Where else the component is, and what may be done about it.
 *
 * Two honest options and no third: point this line at a warehouse that holds the stock, or raise
 * a stock transfer on the screen that exists for it. Nothing here moves inventory. A button that
 * silently transferred stock from another warehouse would post a movement nobody entered and
 * nobody approved, and it would be invisible in the transfer register afterwards.
 */
export function AlternateStockDrawer({ open, row, warehouseName, onClose, onUseWarehouse, disabled }: AlternateStockDrawerProps) {
  const itemName = row?.line.item_name || 'Component'
  const here = row ? warehouseName(row.warehouseId) : ''

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="md"
      title="Alternative stock locations"
      description={row ? `${itemName} — ${formatQty(row.requiredBase)} needed, ${formatQty(row.availableHere ?? 0)} available in ${here || 'the selected warehouse'}` : undefined}
      footer={
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/documents/new/stock_transfer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
            Create a stock transfer
          </Link>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {!row || row.alternates.length === 0 ? (
        <EmptyState
          icon={Warehouse}
          size="sm"
          title="No other warehouse holds this item"
          description="Receive the material, or post with a negative-stock override if your profile allows it."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {row.alternates.map((alt) => {
            const covers = alt.available + 0.0001 >= row.requiredBase
            return (
              <li
                key={alt.warehouseId}
                className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">{warehouseName(alt.warehouseId)}</p>
                  <p className="mt-0.5 text-[11px] text-gray-500">
                    Available <span className="font-semibold tabular-nums text-gray-700">{formatQty(alt.available)}</span>
                    {' · needs '}
                    <span className="tabular-nums">{formatQty(row.requiredBase)}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={covers ? 'success' : 'warning'} size="xs">
                    {covers ? 'Covers the line' : 'Partial'}
                  </Badge>
                  <Button
                    variant={covers ? 'primary' : 'secondary'}
                    size="xs"
                    disabled={disabled}
                    onClick={() => onUseWarehouse(row.key, alt.warehouseId)}
                  >
                    Use warehouse
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <p className={cx('mt-4 rounded-lg bg-gray-50 px-3 py-2.5 text-[11px] leading-relaxed text-gray-600')}>
        &ldquo;Use warehouse&rdquo; only re-points this line; it moves nothing. Availability is read live from stock
        balances and is re-checked by the server when the document posts.
      </p>
    </Drawer>
  )
}

export default AlternateStockDrawer
