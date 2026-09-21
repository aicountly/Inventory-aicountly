import { MoreHorizontal } from 'lucide-react'
import { Card } from '../../../ui/Card'
import { ActiveBadge } from '../../../ui/StatusBadge'
import { MenuButton } from '../../../ui/MenuButton'
import type { MenuAction } from '../../../ui/MenuButton'
import { formatDateTime, formatQty } from '../../../utils/format'
import type { ItemListRow } from '../../../services/items'
import { getStockHealth, trackingFlags } from '../itemsModel'
import { ItemIdentity } from './ItemIdentity'
import { StockHealthBadge } from './StockHealthBadge'

export interface ItemsCardGridProps {
  rows: readonly ItemListRow[]
  selected: ReadonlySet<number>
  onToggle: (id: number) => void
  onOpen: (item: ItemListRow) => void
  actionsFor: (item: ItemListRow) => MenuAction[]
  selectable: boolean
}

/**
 * The item as a card: the layout the table becomes on a phone, and an option on
 * a laptop.
 *
 * It carries the same facts in the same order as the row — identity, stock,
 * classification, freshness — so switching view changes the shape of the
 * information and not the information. The on-hand figure is given the largest
 * type on the card because on a touch screen it is the one number the reader
 * came for.
 */
export function ItemsCardGrid({ rows, selected, onToggle, onOpen, actionsFor, selectable }: ItemsCardGridProps) {
  return (
    <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((item) => {
        const health = getStockHealth(item)
        const isSelected = selected.has(item.item_id)
        const tracking = trackingFlags(item)
        return (
          <li key={item.item_id}>
            <Card
              padding="none"
              className={isSelected ? 'border-primary/50 ring-1 ring-primary/20' : undefined}
            >
              <div className="flex items-start justify-between gap-2 p-3 pb-2">
                <div className="flex min-w-0 items-start gap-2">
                  {selectable ? (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggle(item.item_id)}
                      aria-label={`Select ${item.item_name}`}
                      className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 text-primary focus:ring-primary/40"
                    />
                  ) : null}
                  <ItemIdentity item={item} onOpen={() => onOpen(item)} />
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <ActiveBadge active={item.is_active} />
                  <MenuButton
                    actions={actionsFor(item)}
                    label={`Actions for ${item.item_name}`}
                    icon={MoreHorizontal}
                    size="xs"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => onOpen(item)}
                className="mx-3 mb-2 flex w-[calc(100%-1.5rem)] items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2.5 text-left transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <span>
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">On hand</span>
                  <span
                    className={
                      health.key === 'negative'
                        ? 'block text-xl font-semibold tabular-nums text-red-600'
                        : health.key === 'low'
                          ? 'block text-xl font-semibold tabular-nums text-amber-600'
                          : 'block text-xl font-semibold tabular-nums text-gray-900'
                    }
                  >
                    {health.onHand === null ? '—' : formatQty(health.onHand)}
                    {item.unit_symbol ? <span className="ml-1 text-xs font-medium text-gray-500">{item.unit_symbol}</span> : null}
                  </span>
                </span>
                <StockHealthBadge health={health} />
              </button>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 px-3 pb-2 text-[11px]">
                {[
                  ['SKU', item.item_sku],
                  ['HSN', item.hsn_sac],
                  ['Group', item.grp_name],
                  ['Brand', item.brand_name],
                  ['Valuation', item.valuation_method],
                  ['Tracking', tracking.length ? tracking.join(', ') : null],
                ].map(([label, value]) => (
                  <div key={label as string} className="min-w-0">
                    <dt className="text-gray-400">{label}</dt>
                    <dd className="truncate font-medium text-gray-900">{value || '—'}</dd>
                  </div>
                ))}
              </dl>

              <p className="border-t border-gray-100 px-3 py-2 text-[10px] text-gray-400">
                Updated {formatDateTime(item.updated_at)}
              </p>
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
