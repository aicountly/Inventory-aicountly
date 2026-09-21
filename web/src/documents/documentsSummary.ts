/**
 * The documents register's figures, from the server when it sent them and from
 * the served page when it did not.
 *
 * `/v1/inventory-documents?summary=1` answers an aggregate over EVERY matching
 * document (DocumentsController::summarise), so the KPI cards and the pinned
 * footer speak for the whole filtered set — which is what a reader takes them
 * for. When the aggregate is absent (an older API, or a read whose aggregate
 * query failed) the figures fall back to `pageSummary`'s honest page sums and
 * keep its "this page only" caveat, rather than the screen losing its footer or,
 * far worse, presenting a page sum as a register total.
 */

import { pageSummaryFor, summaryOverRows } from '../registers/configs/pageSummary'
import type { PageSummary } from '../registers/configs/pageSummary'
import type { ReportResponse } from '../services/reportsApi'
import type { DocumentListResponse } from '../services/documentsApi'
import type { DocumentListRow } from './types'

export interface DocumentsSummary extends PageSummary {
  /** The sums are the server's, over every matching document. */
  fromServer: boolean
  /** Distinct warehouses the matching documents touch; null when not known. */
  warehousesImpacted: number | null
}

/** What the figures are totalled over, for the caption under each one. */
export function documentsScopeHint(summary: DocumentsSummary): string {
  if (summary.fromServer) return 'Matching these filters'
  return summary.isWholeResult ? 'all rows' : 'this page only'
}

export function documentsSummaryFor(
  response: DocumentListResponse,
  keys: readonly string[],
): DocumentsSummary {
  const page = pageSummaryFor(response, keys)
  const server = response.summary
  if (!server) {
    return { ...page, fromServer: false, warehousesImpacted: null }
  }
  return {
    ...page,
    // The aggregate covers the filtered set, so the page caveat does not apply
    // to these sums and `isWholeResult` says so — it is what `pageHint` and the
    // totals label read.
    isWholeResult: true,
    fromServer: true,
    sums: {
      line_count: Number(server.line_count) || 0,
      valuation_total: Number(server.valuation_total) || 0,
    },
    warehousesImpacted: Number.isFinite(Number(server.warehouses_impacted))
      ? Number(server.warehouses_impacted)
      : null,
  }
}

/** Adapt the list response to the register engine's envelope. */
export function withDocumentsSummary(
  response: DocumentListResponse,
  keys: readonly string[],
): ReportResponse<DocumentListRow, DocumentsSummary> {
  return { ...response, summary: documentsSummaryFor(response, keys), report: 'documents' }
}

/**
 * The same figures, re-totalled over the rows an export actually wrote.
 *
 * An export that walked every page reproduces the server's aggregate, so
 * nothing changes. An export the pager CAPPED wrote fewer rows than match, and
 * the sheet has to total what is on it — at which point the figures are no
 * longer the server's and the warehouse count, which cannot be re-derived from
 * document rows at all, is dropped rather than carried over as if it were.
 */
export function documentsSummaryOverRows(
  summary: DocumentsSummary,
  rows: readonly DocumentListRow[],
  keys: readonly string[],
): DocumentsSummary {
  const rescoped = summaryOverRows(summary, rows, keys)
  const whole = rescoped.isWholeResult
  return {
    ...rescoped,
    fromServer: summary.fromServer && whole,
    warehousesImpacted: whole ? summary.warehousesImpacted : null,
  }
}
