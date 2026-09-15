import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '../Button'
import { AIC, cx } from '../cx'
import { PAGE_SIZE_OPTIONS } from '../../hooks/useListParams'
import { pageCount, pageForOffset, pageRange } from '../../services/api'
import type { ListMeta } from '../../services/api'
import type { PageSize } from './paginateRows'
import { formatInt } from '../../utils/format'

export interface TablePaginationProps {
  page: number
  pageSize: PageSize
  total: number
  totalPages: number
  from: number
  to: number
  onPageChange?: (page: number) => void
  onPageSizeChange?: (size: PageSize) => void
  /** Adds an "All" option — only safe for client-side pagination. */
  allowAll?: boolean
  className?: string
}

export function TablePagination({
  page,
  pageSize,
  total,
  totalPages,
  from,
  to,
  onPageChange,
  onPageSizeChange,
  allowAll = false,
  className,
}: TablePaginationProps) {
  const canPrev = page > 1
  const canNext = page < totalPages

  return (
    <div
      className={cx(
        AIC,
        'flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600 print:hidden',
        className,
      )}
    >
      <span>
        {total === 0
          ? 'Showing 0 rows'
          : `Showing ${formatInt(from)}–${formatInt(to)} of ${formatInt(total)}`}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {onPageSizeChange ? (
          <label className="inline-flex items-center gap-1.5">
            <span className="text-gray-500">Rows per page</span>
            <select
              value={pageSize === 'all' ? 'all' : String(pageSize)}
              onChange={(e) => {
                const v = e.target.value
                onPageSizeChange(v === 'all' ? 'all' : Number(v))
                onPageChange?.(1)
              }}
              className="h-7 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
              aria-label="Rows per page"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
              {allowAll ? <option value="all">All</option> : null}
            </select>
          </label>
        ) : null}
        <div className="inline-flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="xs"
            icon={ChevronsLeft}
            disabled={!canPrev}
            onClick={() => onPageChange?.(1)}
            aria-label="First page"
          />
          <Button
            variant="ghost"
            size="xs"
            icon={ChevronLeft}
            disabled={!canPrev}
            onClick={() => onPageChange?.(page - 1)}
            aria-label="Previous page"
          />
          <span className="px-2 tabular-nums text-gray-700">
            Page {formatInt(page)} of {formatInt(totalPages)}
          </span>
          <Button
            variant="ghost"
            size="xs"
            icon={ChevronRight}
            disabled={!canNext}
            onClick={() => onPageChange?.(page + 1)}
            aria-label="Next page"
          />
          <Button
            variant="ghost"
            size="xs"
            icon={ChevronsRight}
            disabled={!canNext}
            onClick={() => onPageChange?.(totalPages)}
            aria-label="Last page"
          />
        </div>
      </div>
    </div>
  )
}

export interface ServerTablePaginationProps {
  meta: ListMeta | null
  /** The limit currently requested, used before the first response arrives. */
  limit: number
  onPage: (page: number) => void
  onLimit?: (limit: number) => void
  className?: string
}

/**
 * The same control driven by an API `ListMeta` — a drop-in replacement for the
 * legacy `components/Pagination.tsx`, so a list page converts by swapping the
 * import and keeping its `useListParams` wiring exactly as it is.
 */
export function ServerTablePagination({
  meta,
  limit,
  onPage,
  onLimit,
  className,
}: ServerTablePaginationProps) {
  const effective = meta ?? { total: 0, limit, offset: 0 }
  const effectiveLimit = effective.limit || limit
  const { from, to } = pageRange(effective)
  return (
    <TablePagination
      page={pageForOffset(effective.offset, effectiveLimit)}
      pageSize={effectiveLimit}
      total={effective.total}
      totalPages={pageCount(effective.total, effectiveLimit)}
      from={from}
      to={to}
      onPageChange={onPage}
      onPageSizeChange={onLimit ? (size) => onLimit(size === 'all' ? effectiveLimit : size) : undefined}
      className={className}
    />
  )
}

export default TablePagination
