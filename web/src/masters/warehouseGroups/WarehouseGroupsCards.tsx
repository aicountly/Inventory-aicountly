import type { ReactNode } from 'react'
import { Boxes, MoreHorizontal, Warehouse as WarehouseIcon } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { MenuButton } from '../../ui/MenuButton'
import { ActiveBadge } from '../../ui/StatusBadge'
import { cx } from '../../ui/cx'
import type { WarehouseGroup } from '../../services/masters'
import { formatDateTime } from '../../utils/format'
import { actorLabel, isActive, warehouseCount } from './model'
import type { RowAction } from './rowActions'

/**
 * The card view.
 *
 * Same records, same actions, same words as the table — a card is a row with
 * room for the description to breathe, not a different screen. The description
 * is clamped to three lines so a long one cannot make its card twice the height
 * of its neighbours and break the grid's rhythm.
 */

export const CARD_GRID = 'grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3'

export interface WarehouseGroupsCardsProps {
  rows: readonly WarehouseGroup[]
  loading: boolean
  empty: ReactNode
  selected: ReadonlySet<number>
  onToggle: (id: number) => void
  onOpen: (row: WarehouseGroup) => void
  onShowWarehouses: (row: WarehouseGroup) => void
  actionsFor: (row: WarehouseGroup) => RowAction[]
  canWrite: boolean
  canReadWarehouses: boolean
}

export function WarehouseGroupsCards({
  rows,
  loading,
  empty,
  selected,
  onToggle,
  onOpen,
  onShowWarehouses,
  actionsFor,
  canWrite,
  canReadWarehouses,
}: WarehouseGroupsCardsProps) {
  if (loading && rows.length === 0) {
    return (
      <div className={CARD_GRID} aria-hidden>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Card key={i} padding="md" className="min-h-[9.5rem]">
            <div className="skeleton h-9 w-9 rounded-lg" />
            <div className="skeleton mt-3 h-4 w-32 rounded" />
            <div className="skeleton mt-2 h-3 w-full rounded" />
            <div className="skeleton mt-1.5 h-3 w-2/3 rounded" />
          </Card>
        ))}
      </div>
    )
  }

  if (rows.length === 0) return <Card padding="md">{empty}</Card>

  return (
    <ul className={cx(CARD_GRID, 'list-none p-0')} aria-label="Warehouse groups">
      {rows.map((row) => {
        const count = warehouseCount(row)
        const who = actorLabel(row.updated_by ?? row.created_by, row.updated_by_name ?? row.created_by_name)
        const isSelected = selected.has(row.warehouse_group_id)
        return (
          <Card
            as="li"
            key={row.warehouse_group_id}
            padding="md"
            className={cx(
              'flex min-w-0 flex-col transition-colors',
              isSelected ? 'border-primary/50 bg-primary-light/30' : 'hover:border-primary/30',
            )}
          >
            <div className="flex items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[rgb(var(--color-primary))]"
                checked={isSelected}
                onChange={() => onToggle(row.warehouse_group_id)}
                aria-label={`Select ${row.grp_name}`}
              />
              <span
                className={cx(
                  'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
                  isActive(row) ? 'bg-primary-light text-primary' : 'bg-gray-100 text-gray-400',
                )}
                aria-hidden
              >
                <Boxes className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onOpen(row)}
                  className="block max-w-full truncate text-left text-sm font-semibold text-gray-900 transition-colors hover:text-primary focus:outline-none focus-visible:text-primary focus-visible:underline"
                >
                  {row.grp_name}
                </button>
                {row.grp_code ? (
                  <span className="mt-0.5 block font-mono text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    {row.grp_code}
                  </span>
                ) : null}
              </div>
              <ActiveBadge active={row.is_active} />
              <MenuButton
                label={`Actions for ${row.grp_name}`}
                actions={actionsFor(row)}
                icon={MoreHorizontal}
                variant="ghost"
                size="xs"
                buttonProps={{ className: 'px-1' }}
              />
            </div>

            <p className="mt-2.5 line-clamp-3 min-h-[2.5rem] text-xs leading-relaxed text-gray-500">
              {row.description ?? <span className="text-gray-300">No description</span>}
            </p>

            <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-2.5 text-[11px] text-gray-500">
              <WarehouseIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
              <span className="tabular-nums">
                {count} {count === 1 ? 'warehouse' : 'warehouses'}
              </span>
              <span className="ml-auto truncate" title={who ? `Updated by ${who}` : undefined}>
                {formatDateTime(row.updated_at ?? row.created_at)}
              </span>
            </div>

            <div className="mt-2 flex items-center gap-1.5">
              {canReadWarehouses ? (
                <Button variant="ghost" size="xs" onClick={() => onShowWarehouses(row)}>
                  View warehouses
                </Button>
              ) : null}
              <Button variant="ghost" size="xs" className="ml-auto" onClick={() => onOpen(row)}>
                {canWrite ? 'Edit' : 'View'}
              </Button>
            </div>
          </Card>
        )
      })}
    </ul>
  )
}

export default WarehouseGroupsCards
