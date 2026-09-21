import { Link, useSearchParams } from 'react-router-dom'
import { Package } from 'lucide-react'
import { Tooltip } from '../../ui/Tooltip'
import { cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import type { WarehouseStockRow } from '../../services/reportsApi'

/** One item's ledger, filtered the way the row it was opened from was. */
export function ledgerLink(itemId: number, warehouseId?: number | null): string {
  const qs = new URLSearchParams({ item_id: String(itemId) })
  if (warehouseId) qs.set('warehouse_id', String(warehouseId))
  return `/registers/stock-ledger?${qs.toString()}`
}

/**
 * The item thumbnail.
 *
 * Inventory's item master holds no image — there is no column for one anywhere in
 * inv_items — so this is a placeholder and is drawn as one: a neutral tile with the
 * stock glyph, identical on every row. It is here because the name and its group read
 * as a unit against a fixed left edge rather than as two ragged lines, not because a
 * picture is being promised. Hidden from assistive technology, which has the name.
 */
function ItemThumb() {
  return (
    <span
      aria-hidden
      // A flat token-backed surface, not a gradient: theme/darkAccents guards against
      // hardcoded gradient stops precisely because they cannot be remapped for dark mode.
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-gray-200 bg-gray-50 text-gray-400"
    >
      <Package className="h-4 w-4" strokeWidth={1.75} />
    </span>
  )
}

/**
 * The item cell: thumbnail, name, and the group underneath.
 *
 * The name opens the item's ledger filtered to this row's warehouse — the same place a
 * click on the row goes, so the register has one destination and not two. The item
 * master itself is in the row menu, where an action that leaves the register belongs.
 */
export function ItemCell({ row }: { row: WarehouseStockRow }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <ItemThumb />
      <span className="min-w-0">
        <Link
          to={ledgerLink(row.item_id, row.warehouse_id)}
          className="block truncate font-semibold text-gray-900 hover:text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          {row.item_name ?? `Item #${row.item_id}`}
        </Link>
        {row.grp_name ? (
          <span className="mt-0.5 block truncate text-[11px] text-gray-500">{row.grp_name}</span>
        ) : null}
      </span>
    </span>
  )
}

/**
 * The warehouse cell, as a link that narrows the register to that warehouse.
 *
 * Inventory has no warehouse detail screen to send a reader to, and inventing a route
 * for one would be a link to a 404. Narrowing the register they are already reading is
 * the thing they wanted anyway: it keeps the date, the valuation method and every other
 * filter exactly as they were and only adds the warehouse.
 */
export function WarehouseCell({ row }: { row: WarehouseStockRow }) {
  const [params] = useSearchParams()
  if (!row.warehouse_id) {
    return (
      <Tooltip label="Stock recorded without a warehouse — usually an opening balance or a migrated document.">
        <span className="text-gray-400">{row.warehouse_name ?? '(none)'}</span>
      </Tooltip>
    )
  }
  const next = new URLSearchParams(params)
  next.set('warehouse_id', String(row.warehouse_id))
  next.delete('page')
  const already = params.get('warehouse_id') === String(row.warehouse_id)
  if (already) return <span className="text-gray-700">{row.warehouse_name}</span>
  return (
    <Link
      to={{ search: `?${next.toString()}` }}
      className="text-gray-700 underline-offset-2 hover:text-primary hover:underline"
      onClick={(e) => e.stopPropagation()}
      title={`Show only ${row.warehouse_name}`}
    >
      {row.warehouse_name}
    </Link>
  )
}

/**
 * A quantity that came from the live balances rather than from the dated walk.
 *
 * On a back-dated register these are null, and the dash carries the reason: printing
 * this morning's reservations against last March's closing stock would be a figure that
 * is not wrong so much as about a different day.
 */
export function LiveQtyCell({
  value,
  strong = false,
  emphasiseNegative = false,
}: {
  value: number | null
  strong?: boolean
  emphasiseNegative?: boolean
}) {
  if (value === null) {
    return (
      <Tooltip label="Reserved and available are the position as it stands today, so they are not shown for a past date.">
        <span className="text-gray-300">—</span>
      </Tooltip>
    )
  }
  return (
    <span
      className={cx(
        strong && 'font-semibold text-gray-900',
        emphasiseNegative && value < 0 && 'font-semibold text-red-600',
      )}
    >
      {formatQty(value)}
    </span>
  )
}

/** A dated quantity or value, red when it is below zero. */
export function SignedCell({
  value,
  format,
  strong = false,
}: {
  value: unknown
  format: (v: unknown) => string
  strong?: boolean
}) {
  const n = Number(value)
  const negative = Number.isFinite(n) && n < 0
  return (
    <span
      className={cx(
        negative ? 'font-semibold text-red-600' : strong && 'font-semibold text-gray-900',
      )}
    >
      {format(value)}
    </span>
  )
}
