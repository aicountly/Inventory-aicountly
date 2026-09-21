import { Eye, Layers, Package, Pencil } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Bom } from '../../../services/masters'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { ErrorState } from '../../../ui/ErrorState'
import { Tooltip } from '../../../ui/Tooltip'
import { cx } from '../../../ui/cx'
import { formatDate, formatInt } from '../../../utils/format'
import { BomComponentsPreview } from './BomComponentsPreview'
import { BomHealthChip, BomStatusBadge } from './BomStatusBadge'
import { bomCode, bomHealth, bomStatus, yieldLabel } from './bomPresentation'

/**
 * The same bills as cards.
 *
 * The list stays the default — it is the view an operations team works in, and
 * a card grid shows a third as many rows per screen. This is for browsing a
 * catalogue of products rather than working through a queue, so it leads with
 * the finished item and keeps the component chips.
 *
 * Every card is reachable by keyboard: the card itself is not a button (that
 * would swallow the chips' own buttons), the two actions in its footer are.
 */

export interface BomGridProps {
  rows: Bom[]
  loading: boolean
  error: Error | null
  onRetry: () => void
  empty: ReactNode
  onView: (row: Bom) => void
  onEdit: (row: Bom) => void
  canWrite: boolean
}

const GRID = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3 ultra:grid-cols-4'

function CardSkeleton() {
  return (
    <Card padding="md" aria-hidden className="space-y-3">
      <span className="skeleton block h-4 w-20 rounded" />
      <span className="skeleton block h-5 w-3/4 rounded" />
      <span className="skeleton block h-8 w-full rounded" />
      <span className="skeleton block h-3 w-1/2 rounded" />
    </Card>
  )
}

export function BomGrid({ rows, loading, error, onRetry, empty, onView, onEdit, canWrite }: BomGridProps) {
  if (error) {
    return (
      <ErrorState
        title="Could not load bills of materials"
        description={error.message}
        onRetry={onRetry}
      />
    )
  }
  if (loading && rows.length === 0) {
    return (
      <div className={GRID} aria-busy>
        {Array.from({ length: 6 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    )
  }
  if (rows.length === 0) {
    return <Card padding="none">{empty}</Card>
  }

  return (
    <ul className={cx(GRID, 'list-none p-0', loading && 'opacity-60 transition-opacity')}>
      {rows.map((row) => (
        <Card
          as="li"
          key={row.bom_id}
          padding="md"
          className="flex flex-col gap-3 transition-colors hover:border-primary/40"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-1 text-[10.5px] font-semibold text-slate-700">
              {bomCode(row)}
            </span>
            <div className="flex flex-wrap items-center justify-end gap-1">
              <BomStatusBadge status={bomStatus(row)} />
              <BomHealthChip health={bomHealth(row)} />
            </div>
          </div>

          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-gray-900">{row.bom_name}</h3>
            <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] text-gray-500">
              <Package className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
              <span className="truncate">
                {row.finished_item_name ?? `#${row.finished_item_id}`}
                {row.finished_item_sku ? ` · ${row.finished_item_sku}` : ''}
              </span>
            </p>
          </div>

          <BomComponentsPreview row={row} max={4} />

          <div className="mt-auto flex items-center justify-between gap-2 border-t border-gray-100 pt-2.5">
            <span className="flex min-w-0 items-center gap-3 text-[10.5px] text-gray-500">
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <Layers className="h-3 w-3 text-gray-400" aria-hidden />
                {formatInt(row.component_count ?? row.line_count)}
              </span>
              <span className="whitespace-nowrap tabular-nums">{yieldLabel(row)}</span>
              <span className="truncate">{formatDate(row.updated_at ?? row.created_at)}</span>
            </span>
            <span className="flex shrink-0 items-center gap-0.5">
              <Tooltip label="View bill of materials">
                <Button variant="ghost" size="xs" icon={Eye} aria-label={`View ${row.bom_name}`} onClick={() => onView(row)} />
              </Tooltip>
              <Tooltip label={canWrite ? 'Edit bill of materials' : 'Open bill of materials'}>
                <Button
                  variant="ghost"
                  size="xs"
                  icon={Pencil}
                  aria-label={`${canWrite ? 'Edit' : 'Open'} ${row.bom_name}`}
                  onClick={() => onEdit(row)}
                />
              </Tooltip>
            </span>
          </div>
        </Card>
      ))}
    </ul>
  )
}

export default BomGrid
