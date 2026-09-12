import { PAGE_SIZE_OPTIONS } from '../hooks/useListParams'
import { pageCount, pageForOffset, pageRange } from '../services/api'
import type { ListMeta } from '../services/api'
import { formatInt } from '../utils/format'

interface PaginationProps {
  meta: ListMeta | null
  onPage: (page: number) => void
  onLimit?: (limit: number) => void
  /** Limit currently requested, used before the first response arrives. */
  limit: number
}

export function Pagination({ meta, onPage, onLimit, limit }: PaginationProps) {
  const effective = meta ?? { total: 0, limit, offset: 0 }
  const page = pageForOffset(effective.offset, effective.limit || limit)
  const pages = pageCount(effective.total, effective.limit || limit)
  const { from, to } = pageRange(effective)

  return (
    <div className="pagination">
      <span>
        {effective.total > 0 ? (
          <>
            Showing {formatInt(from)}–{formatInt(to)} of {formatInt(effective.total)}
          </>
        ) : (
          'No rows'
        )}
      </span>
      <div className="pagination-controls">
        {onLimit ? (
          <label>
            <span className="muted" style={{ marginRight: '0.375rem' }}>
              Rows
            </span>
            <select className="select" value={effective.limit || limit} onChange={(e) => onLimit(Number(e.target.value))} aria-label="Rows per page">
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="button" className="btn btn-sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          Previous
        </button>
        <span>
          Page {formatInt(page)} of {formatInt(pages)}
        </span>
        <button type="button" className="btn btn-sm" onClick={() => onPage(page + 1)} disabled={page >= pages}>
          Next
        </button>
      </div>
    </div>
  )
}
