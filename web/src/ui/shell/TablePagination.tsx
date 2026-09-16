import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '../Button'
import { AIC, cx } from '../cx'
import { PAGE_SIZE_OPTIONS } from '../../hooks/useListParams'
import { pageCount, pageForOffset, pageRange } from '../../services/api'
import type { ListMeta } from '../../services/api'
import type { PageSize } from './paginateRows'
import { formatInt } from '../../utils/format'

/**
 * The page numbers to draw: the ends, the current page and its neighbours,
 * with a gap marker wherever a run was skipped.
 *
 * `[1, '…', 7, 8, 9, '…', 250]`. An audit log runs to hundreds of pages, and a
 * reader who knows an event was "near the end of last quarter" navigates by
 * jumping, not by pressing Next forty times — but 250 buttons is not a control
 * either, so the window is bounded and the ends are always reachable.
 */
export function pageWindow(page: number, totalPages: number, span = 1): (number | 'gap')[] {
  if (totalPages <= 1) return totalPages === 1 ? [1] : []

  const band = span * 2 + 1
  // Both ends, the band, and the two gap markers. Below this the gaps would
  // stand in for fewer numbers than they cost, so every page is drawn instead.
  if (totalPages <= band + 3) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  let start = Math.max(2, page - span)
  let end = Math.min(totalPages - 1, page + span)
  // Near an end the band is clipped, so it is made up from the other side and
  // the strip keeps one width instead of shuffling as the reader pages.
  if (page - span < 2) end = Math.min(totalPages - 1, 1 + band)
  if (page + span > totalPages - 1) start = Math.max(2, totalPages - band)

  const out: (number | 'gap')[] = [1]
  if (start > 2) out.push('gap')
  for (let p = start; p <= end; p += 1) out.push(p)
  if (end < totalPages - 1) out.push('gap')
  out.push(totalPages)
  return out
}

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
  /**
   * Numbered page buttons instead of "Page 3 of 250".
   *
   * Off by default: every list that renders this control today shows the
   * counter, and a strip of numbers on a three-page list is noise. A screen
   * whose reader navigates by jumping opts in.
   */
  numbered?: boolean
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
  numbered = false,
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
        <nav className="inline-flex items-center gap-0.5" aria-label="Pagination">
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
          {numbered ? (
            pageWindow(page, totalPages).map((entry, i) =>
              entry === 'gap' ? (
                <span key={`gap-${i}`} className="px-1 text-gray-400" aria-hidden>
                  …
                </span>
              ) : (
                <button
                  key={entry}
                  type="button"
                  onClick={() => onPageChange?.(entry)}
                  aria-current={entry === page ? 'page' : undefined}
                  aria-label={`Page ${entry}`}
                  className={cx(
                    'h-7 min-w-[1.75rem] rounded-md px-1.5 text-xs font-medium tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30',
                    entry === page
                      ? 'bg-primary text-white'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                  )}
                >
                  {formatInt(entry)}
                </button>
              ),
            )
          ) : (
            <span className="px-2 tabular-nums text-gray-700">
              Page {formatInt(page)} of {formatInt(totalPages)}
            </span>
          )}
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
        </nav>
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
  /** Numbered page buttons instead of the "Page 3 of 250" counter. */
  numbered?: boolean
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
  numbered = false,
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
      numbered={numbered}
      className={className}
    />
  )
}

export default TablePagination
