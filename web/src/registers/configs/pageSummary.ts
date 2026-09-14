/**
 * Page-scoped totals, labelled as such.
 *
 * `/v1/stock-movements`, `/v1/stock-balances`, `/v1/reservations` and
 * `/v1/reconciliation` send rows and a count, and nothing else — no aggregate
 * over the filtered set. A register still wants a footer, so these registers
 * total the rows they were served and say "(this page)" on every figure.
 *
 * That is the honest option. Presenting a page sum as the register's total
 * would be a wrong number in a footer, which is exactly the kind of thing a
 * reader trusts without checking. Raise a server task to add real summaries to
 * these four endpoints; until then the label carries the caveat.
 */

import { sumColumns } from '../registerTotals'
import type { ListResponse } from '../../services/api'
import type { ReportResponse } from '../../services/reportsApi'

export interface PageSummary {
  /** Rows matching the filters, from `meta.total`. */
  total: number
  /** Rows on this page. */
  pageRows: number
  /** Sums over this page only. */
  sums: Record<string, number>
  /** True when the page is the whole result, so the sums are the real totals. */
  isWholeResult: boolean
}

export function pageSummaryFor<T>(
  response: ListResponse<T>,
  keys: readonly string[],
): PageSummary {
  const total = response.meta?.total ?? response.data.length
  return {
    total,
    pageRows: response.data.length,
    sums: sumColumns(response.data, keys),
    isWholeResult: response.data.length >= total,
  }
}

/** Adapt a plain `{data, meta}` list endpoint to the register engine's envelope. */
export function withPageSummary<T>(
  response: ListResponse<T>,
  report: string,
  keys: readonly string[],
): ReportResponse<T, PageSummary> {
  return { ...response, summary: pageSummaryFor(response, keys), report }
}

/** "(this page)" unless the page happens to be everything. */
export function pageHint(summary: PageSummary): string {
  return summary.isWholeResult ? 'all rows' : 'this page only'
}
