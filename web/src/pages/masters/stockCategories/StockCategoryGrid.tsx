import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Badge } from '../../../ui/Badge'
import { Card } from '../../../ui/Card'
import { IconTile } from '../../../ui/IconTile'
import { LoadingState } from '../../../ui/LoadingState'
import { ErrorState } from '../../../ui/ErrorState'
import { cx } from '../../../ui/cx'
import type { StockCategory } from '../../../services/masters'
import { formatDateTime, formatInt } from '../../../utils/format'
import { categoryAppearance } from './categoryAppearance'

/**
 * The same rows as cards.
 *
 * It exists because a category is a thing you recognise by its icon and its
 * size before you read its name, and a nine-tile board answers "what does this
 * company sort its stock by" faster than nine rows of a table. It is a view of
 * the SAME query — same page, same filters, same sort, same selection — not a
 * second data path: switching back and forth cannot show two different
 * answers, and the control is only offered because there is something real
 * behind it.
 */

export interface StockCategoryGridProps {
  rows: readonly StockCategory[]
  loading: boolean
  error: Error | null
  selectedIds: ReadonlySet<number>
  onToggleRow: (id: number, selected: boolean) => void
  onOpen: (row: StockCategory) => void
  itemsLinkFor?: (stockCatId: number) => string | undefined
  empty?: ReactNode
  onRetry?: () => void
}

export function StockCategoryGrid({
  rows,
  loading,
  error,
  selectedIds,
  onToggleRow,
  onOpen,
  itemsLinkFor,
  empty,
  onRetry,
}: StockCategoryGridProps) {
  if (loading && rows.length === 0) {
    return (
      <div className="p-4">
        <LoadingState variant="skeleton" rows={6} />
      </div>
    )
  }
  if (error) {
    return (
      <div className="p-4">
        <ErrorState title="Unable to load stock categories." description={error.message} onRetry={onRetry} />
      </div>
    )
  }
  if (rows.length === 0) return <div className="p-4">{empty}</div>

  return (
    <ul className="grid list-none grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Stock categories">
      {rows.map((row) => {
        const id = Number(row.stock_cat_id)
        const { icon, tone } = categoryAppearance(row)
        const selected = selectedIds.has(id)
        const to = itemsLinkFor?.(id)
        const count = typeof row.item_count === 'number' ? row.item_count : null
        return (
          <Card
            as="li"
            key={id}
            padding="sm"
            className={cx('flex flex-col gap-2', selected && 'border-primary/50 bg-primary-light/40')}
          >
            <div className="flex items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[rgb(var(--color-primary))]"
                checked={selected}
                onChange={(e) => onToggleRow(id, e.target.checked)}
                aria-label={`Select ${row.cat_name}`}
              />
              <IconTile icon={icon} tone={tone} size="md" />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onOpen(row)}
                  className="block w-full truncate rounded text-left text-sm font-semibold text-gray-900 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {row.cat_name}
                </button>
                <p className="truncate text-xs text-gray-500">
                  {row.cat_alias ? <span className="font-mono">{row.cat_alias}</span> : 'No alias'}
                </p>
              </div>
              {Number(row.is_active) === 1 ? (
                <Badge tone="success" size="xs" dot className="normal-case">
                  Active
                </Badge>
              ) : (
                <Badge tone="neutral" size="xs" dot className="normal-case">
                  Inactive
                </Badge>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-2 text-xs text-gray-500">
              <span>
                {count === null ? (
                  '—'
                ) : to && count > 0 ? (
                  <Link to={to} className="font-semibold text-primary no-underline hover:underline">
                    {formatInt(count)} {count === 1 ? 'item' : 'items'}
                  </Link>
                ) : (
                  <span className="tabular-nums">
                    {formatInt(count)} {count === 1 ? 'item' : 'items'}
                  </span>
                )}
              </span>
              <span className="truncate">{formatDateTime(row.updated_at)}</span>
            </div>
          </Card>
        )
      })}
    </ul>
  )
}

export default StockCategoryGrid
