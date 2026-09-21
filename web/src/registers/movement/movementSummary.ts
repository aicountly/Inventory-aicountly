/**
 * What the movement register's figures are, and where each one comes from.
 *
 * `/v1/stock-movements?summary=1` answers an aggregate over the WHOLE filtered set, so the
 * KPI cards over a 25-row page speak for all 4,000 matching movements. That is the point
 * of the register: a footer or a card that quietly totalled the served page would be a
 * wrong number in the place a reader trusts most.
 *
 * The page total is still carried, because two things need it — the export, which walks
 * every page and re-totals what it actually wrote, and the fallback below for a response
 * that arrived without an aggregate (an older API, or the export pager, which does not ask
 * for one). `whole` says which of the two a given summary is, and every caption on screen
 * is driven from it rather than from an assumption.
 */

import type {
  MovementAggregate,
  MovementComparative,
  MovementListResponse,
  MovementTrendSeries,
  StockMovementRow,
} from '../../services/stockViewsApi'
import { formatDate } from '../../utils/format'

export interface MovementRegisterSummary extends MovementAggregate {
  /** Movements matching the filters, from `meta.total`. */
  total: number
  /** Movements in the response that produced this summary. */
  pageRows: number
  from: string | null
  to: string | null
  /** The preceding window of equal length. Null when none can be formed. */
  previous: MovementComparative | null
  trend: MovementTrendSeries | null
  /**
   * True when the figures cover every matching movement.
   *
   * The server's aggregate always does. A summary totalled from rows does only when the
   * rows in hand are the whole result — which is true of an export and false of page 1
   * of 40.
   */
  whole: boolean
}

const ZERO: MovementAggregate = {
  movements: 0,
  items: 0,
  documents: 0,
  in_qty: 0,
  out_qty: 0,
  net_qty: 0,
  in_value: 0,
  out_value: 0,
  net_value: 0,
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Inward, outward and net over rows in hand.
 *
 * The sign of the quantity decides the direction, matching both the endpoint's aggregate
 * and the stock ledger: a reversal of a receipt carries `direction: 'in'` and a negative
 * quantity, and reading the `direction` column here would report goods arriving that left.
 */
export function aggregateMovements(rows: readonly StockMovementRow[]): MovementAggregate {
  const items = new Set<number>()
  const documents = new Set<number>()
  const out = { ...ZERO }
  for (const row of rows) {
    const qty = num(row.qty)
    const value = num(row.value)
    items.add(row.item_id)
    if (row.document_id) documents.add(row.document_id)
    out.movements += 1
    out.net_qty += qty
    out.net_value += value
    if (qty >= 0) {
      out.in_qty += qty
      out.in_value += value
    } else {
      out.out_qty += -qty
      out.out_value += -value
    }
  }
  out.items = items.size
  out.documents = documents.size
  // Four decimals is what the endpoint rounds to; summing floats without it leaves
  // 0.30000000000000004 under a column of tidy figures.
  for (const key of ['in_qty', 'out_qty', 'net_qty', 'in_value', 'out_value', 'net_value'] as const) {
    out[key] = Math.round(out[key] * 1e4) / 1e4
  }
  return out
}

/** The register's summary for one response, server aggregate preferred. */
export function movementSummaryOf(response: MovementListResponse): MovementRegisterSummary {
  const rows = response.data ?? []
  const total = response.meta?.total ?? rows.length
  const served = response.summary
  const aggregate: MovementAggregate = served
    ? {
        movements: num(served.movements),
        items: num(served.items),
        documents: num(served.documents),
        in_qty: num(served.in_qty),
        out_qty: num(served.out_qty),
        net_qty: num(served.net_qty),
        in_value: num(served.in_value),
        out_value: num(served.out_value),
        net_value: num(served.net_value),
      }
    : aggregateMovements(rows)

  return {
    ...aggregate,
    total,
    pageRows: rows.length,
    from: served?.from ?? null,
    to: served?.to ?? null,
    previous: served?.previous ?? null,
    trend: response.trend ?? null,
    whole: served ? true : rows.length >= total,
  }
}

/**
 * The same summary totalled over a different set of rows — the export's.
 *
 * An export walks every page, so its sheet has to carry figures for what it actually
 * wrote. The trend and the comparison are dropped rather than carried over: neither was
 * computed over these rows, and a picture of a different set under an exported register
 * is worse than no picture at all (the sheet carries no chart anyway).
 */
export function movementSummaryOverRows(
  summary: MovementRegisterSummary,
  rows: readonly StockMovementRow[],
): MovementRegisterSummary {
  return {
    ...summary,
    ...aggregateMovements(rows),
    pageRows: rows.length,
    previous: null,
    trend: null,
    whole: rows.length >= summary.total,
  }
}

/** "all movements" / "this page only" — the caveat every derived figure carries. */
export function movementScopeHint(summary: MovementRegisterSummary): string {
  return summary.whole ? 'matching the filters' : 'this page only'
}

/**
 * What a KPI card's comparison line says.
 *
 * Only ever the window the server actually measured. When there is none — an open-ended
 * period, or a preceding window that holds nothing — the card falls back to naming its own
 * scope, and `comparisonFor` hands the card no `previous`, so no percentage is drawn.
 */
export function comparisonHint(summary: MovementRegisterSummary): string {
  const previous = summary.previous
  if (!previous || previous.movements === 0) return movementScopeHint(summary)
  return `vs ${formatDate(previous.from)} – ${formatDate(previous.to)}`
}

/**
 * The previous-period figure for one measure, or null.
 *
 * Null whenever a percentage would be meaningless or invented: no comparison window, an
 * empty one (a period before the company kept records reads as "up ∞%"), or a summary that
 * is not the server's aggregate — page figures compared against a whole-window figure
 * would be a percentage between two different questions.
 */
export function comparisonFor(
  summary: MovementRegisterSummary,
  measure: keyof MovementAggregate,
): number | null {
  const previous = summary.previous
  if (!summary.whole || !previous || previous.movements === 0) return null
  return num(previous[measure])
}
