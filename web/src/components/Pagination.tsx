import { ServerTablePagination } from '../ui/shell/TablePagination'
import type { ListMeta } from '../services/api'

interface PaginationProps {
  meta: ListMeta | null
  onPage: (page: number) => void
  onLimit?: (limit: number) => void
  /** Limit currently requested, used before the first response arrives. */
  limit: number
}

/**
 * Kept as a thin alias over the shared pagination control so the ~20 screens
 * that already render `<Pagination meta … />` pick up the new one unchanged.
 */
export function Pagination({ meta, onPage, onLimit, limit }: PaginationProps) {
  return <ServerTablePagination meta={meta} limit={limit} onPage={onPage} onLimit={onLimit} />
}
