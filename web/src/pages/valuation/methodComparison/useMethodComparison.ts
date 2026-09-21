import { useMemo } from 'react'
import { useCompany } from '../../../company/CompanyContext'
import { useQuery } from '../../../hooks/useQuery'
import { REPORT_METHODS, valuationApi } from '../../../services/valuationApi'
import type { SnapshotQtySign, ValuationSnapshotSummary } from '../../../services/valuationApi'
import { BASIS, buildComparison, previousPeriodDate } from './model'
import type { MethodComparison, MethodSnapshot } from './model'

export interface MethodComparisonQuery {
  asOf: string
  /** '' for the whole company. */
  itemId: string
  warehouseId: string
  qtySign?: SnapshotQtySign
}

export interface MethodComparisonState {
  comparison: MethodComparison
  /** The first load, with nothing on screen yet. */
  loading: boolean
  /** A reload behind figures that are already up. */
  refreshing: boolean
  error: Error | null
  reload: () => void
  fetchedAt: number | null
  /**
   * The basis at the same date one month back, for the KPI deltas — or null
   * when there is no such reading to compare with.
   */
  previousBasis: ValuationSnapshotSummary | null
  previousDate: string | null
}

/**
 * The four valuations behind this screen, and the one behind its deltas.
 *
 * Four requests, one per method, at one date and one scope. They are four
 * separate questions to the valuation engine rather than one combined endpoint
 * because that is what the engine offers, and because a combined endpoint would
 * have to replay the same events four times anyway — the cost is the same and
 * this way a method that fails costs only its own row.
 *
 * A method that fails is reported as unavailable, not as zero. All four failing
 * is a different thing entirely — the service is unreachable, the date is
 * unanswerable — and that throws, so the page shows an error rather than an
 * empty shelf.
 */
export function useMethodComparison({
  asOf,
  itemId,
  warehouseId,
  qtySign,
}: MethodComparisonQuery): MethodComparisonState {
  const { scope, fyRange } = useCompany()
  const resetKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null

  const shared = useMemo(
    () => ({
      as_of: asOf,
      item_id: itemId || undefined,
      warehouse_id: warehouseId || undefined,
      qty_sign: qtySign,
      // The summary is computed over the whole filtered set before the rows are
      // paged, so one row buys the company total (ValuationController::snapshot).
      limit: 1,
      page: 1,
    }),
    [asOf, itemId, warehouseId, qtySign],
  )

  const current = useQuery<MethodSnapshot[]>(
    async (signal) => {
      const settled = await Promise.all(
        REPORT_METHODS.map(async (method) => {
          try {
            const res = await valuationApi.snapshot({ ...shared, method }, signal)
            return { method, summary: res.summary, error: null as unknown }
          } catch (err) {
            return { method, summary: null, error: err }
          }
        }),
      )
      if (settled.every((r) => r.summary === null)) {
        // Every method failed the same way — that is the service, not the
        // methods. Rethrowing the first keeps the real message (and lets an
        // abort stay an abort, which useQuery then ignores).
        throw settled[0].error
      }
      return settled.map(({ method, summary }) => ({ method, summary }))
    },
    [shared, scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    { enabled: scope !== null, resetKey },
  )

  // One month back, and only when that date is still inside the open financial
  // year: a comparative taken from before the year opened would be measured
  // against a different set of opening balances, which is not the same question.
  const previousDate = useMemo(() => {
    const candidate = previousPeriodDate(asOf)
    if (!candidate) return null
    return fyRange.from && candidate < fyRange.from ? null : candidate
  }, [asOf, fyRange.from])

  // Deliberately a second query rather than a fifth leg of the first: the
  // comparative is decoration on four figures that stand perfectly well without
  // it, so it must never hold the table back, and its failure must cost nothing
  // more than the delta chips.
  const previous = useQuery<ValuationSnapshotSummary | null>(
    async (signal) => {
      if (!previousDate) return null
      const res = await valuationApi.snapshot(
        { ...shared, as_of: previousDate, method: BASIS },
        signal,
      )
      return res.summary
    },
    [shared, previousDate, scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    { enabled: scope !== null && previousDate !== null, resetKey },
  )

  const snapshots = current.data
  const comparison = useMemo(
    () => buildComparison(snapshots ?? [], REPORT_METHODS),
    [snapshots],
  )

  return {
    comparison,
    loading: current.loading && snapshots === null,
    refreshing: current.loading && snapshots !== null,
    error: current.error,
    reload: current.reload,
    fetchedAt: current.fetchedAt,
    previousBasis: previous.error ? null : previous.data,
    previousDate,
  }
}
