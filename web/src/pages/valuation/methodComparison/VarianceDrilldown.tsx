import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Layers } from 'lucide-react'
import { Drawer } from '../../../ui/Drawer'
import { EmptyState } from '../../../ui/EmptyState'
import { ErrorState } from '../../../ui/ErrorState'
import { SkeletonRows } from '../../../ui/Skeleton'
import { cx } from '../../../ui/cx'
import { useQuery } from '../../../hooks/useQuery'
import { METHOD_LABELS, valuationApi } from '../../../services/valuationApi'
import type { ReportMethod, SnapshotQtySign, ValuationSnapshotRow } from '../../../services/valuationApi'
import { TABLE_STICKY_HEAD } from '../../../styles/designTokens'
import { formatDate, formatInt, formatMoney, formatQty, humanize } from '../../../utils/format'
import { BASIS } from './model'
import type { MethodComparisonRow } from './model'
import { buildVarianceBreakdown } from './varianceDetail'
import { signedMoney, signedPercent } from './words'

/** The server's own ceiling for this endpoint (BaseController::listParams). */
const MAX_ROWS = 5000
/** Enough to find the cause without turning the drawer into a second register. */
const SHOWN = 25

/** The method a row was valued on, spelled the way the rest of the app spells it. */
function methodLabel(applied: string): string {
  const key = applied.trim().toUpperCase() as ReportMethod
  return METHOD_LABELS[key] ?? humanize(applied)
}

export interface VarianceDrilldownProps {
  /** The method being opened; null closes the drawer. */
  row: MethodComparisonRow | null
  onClose: () => void
  asOf: string
  itemId: string
  warehouseId: string
  qtySign?: SnapshotQtySign
}

/**
 * Which items account for a method's difference from the basis.
 *
 * Opened from a method row, and only then: it costs two more calls to the
 * valuation endpoint — the per-item rows for the basis and for this method — so
 * it is never paid for by a reader who did not ask. Both are answers the engine
 * computes; the drawer joins them on item and subtracts (see
 * `varianceDetail.ts`).
 *
 * Read-only, like everything else on this screen. The item links go to the item
 * and to its cost layers, which is where the *why* lives.
 */
export function VarianceDrilldown({
  row,
  onClose,
  asOf,
  itemId,
  warehouseId,
  qtySign,
}: VarianceDrilldownProps) {
  const method = row?.method ?? null

  const detail = useQuery<{ basis: ValuationSnapshotRow[]; method: ValuationSnapshotRow[]; total: number }>(
    async (signal) => {
      const query = {
        as_of: asOf,
        item_id: itemId || undefined,
        warehouse_id: warehouseId || undefined,
        qty_sign: qtySign,
        limit: MAX_ROWS,
        page: 1,
      }
      const [basis, methodRes] = await Promise.all([
        valuationApi.snapshot({ ...query, method: BASIS }, signal),
        valuationApi.snapshot({ ...query, method: method as string }, signal),
      ])
      return {
        basis: basis.data,
        method: methodRes.data,
        total: Math.max(basis.meta.total ?? 0, methodRes.meta.total ?? 0),
      }
    },
    [method, asOf, itemId, warehouseId, qtySign ?? ''],
    { enabled: method !== null && method !== BASIS, keepData: false },
  )

  const breakdown = useMemo(
    () => (detail.data ? buildVarianceBreakdown(detail.data.basis, detail.data.method) : null),
    [detail.data],
  )

  // The endpoint caps at MAX_ROWS. Past it the ranking is still of real rows,
  // but it is a ranking of the first page of them — which must be said, not
  // quietly presented as "the items behind this difference".
  const capped = (detail.data?.total ?? 0) > MAX_ROWS
  const shown = breakdown?.items.slice(0, SHOWN) ?? []

  return (
    <Drawer
      open={row !== null}
      onClose={onClose}
      title={row ? `${row.label} — what drives the difference` : ''}
      description={
        row
          ? `Per item, against the item-master basis as at ${formatDate(asOf)}. Ranked by the amount that moved.`
          : undefined
      }
      badge={
        row && row.difference !== null ? (
          <span
            className={cx(
              'rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
              row.difference > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
            )}
          >
            {signedMoney(row.difference)}
          </span>
        ) : null
      }
      width="xl"
    >
      {detail.error ? (
        <ErrorState
          title="The breakdown could not be loaded"
          description="The valuation service did not answer for this method. Nothing in your inventory data has been changed."
          onRetry={detail.reload}
          size="sm"
        />
      ) : detail.loading ? (
        <SkeletonRows rows={8} />
      ) : !breakdown || breakdown.items.length === 0 ? (
        <EmptyState
          icon={Layers}
          compact
          title="No item-level difference"
          description="Every item values the same under this method as it does on the basis."
        />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            {formatInt(breakdown.items.length)} of {formatInt(breakdown.items.length + breakdown.unchanged)}{' '}
            items value differently under {row?.label}; the rest are identical. Showing the{' '}
            {Math.min(SHOWN, breakdown.items.length)} largest.
            {capped ? ' Only the first 5,000 items could be read, so this is a partial ranking.' : ''}
          </p>

          {/* `relative` for the same reason as the comparison table: the
              `sr-only` caption is absolutely positioned and would otherwise
              resolve against the viewport, outside this scroller's clip. */}
          <div className="relative overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-[40rem] border-collapse text-xs">
              <caption className="sr-only">
                Items ranked by the difference between {row?.label} and the item-master basis.
              </caption>
              <thead className={TABLE_STICKY_HEAD}>
                <tr className="border-b border-gray-200 text-left">
                  <th scope="col" className="px-3 py-2 font-semibold uppercase tracking-wide text-gray-500">
                    Item
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-gray-500">
                    Closing qty
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-gray-500">
                    Basis value
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-gray-500">
                    {row?.label} value
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-gray-500">
                    Difference
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-gray-500">
                    Variance
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr key={item.itemId} className="table-row-hover border-b border-gray-100 last:border-b-0">
                    <th scope="row" className="px-3 py-2 text-left font-medium text-gray-900">
                      <Link
                        to={`/valuation/cost-layers?item_id=${item.itemId}`}
                        className="text-gray-900 hover:text-primary hover:underline"
                      >
                        {item.name}
                      </Link>
                      <span className="mt-0.5 block text-[11px] font-normal text-gray-500">
                        {item.sku ? `${item.sku} · ` : ''}
                        {/* FIFO and LIFO are acronyms; `humanize` would print
                            them "Fifo". The labels table already has the right
                            spelling for every method the engine can apply. */}
                        basis: {item.basisMethod ? methodLabel(item.basisMethod) : 'company default'}
                      </span>
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                      {formatQty(item.closingQty)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                      {formatMoney(item.basisValue)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                      {formatMoney(item.methodValue)}
                    </td>
                    <td
                      className={cx(
                        'px-3 py-2 text-right font-semibold tabular-nums',
                        item.difference > 0 ? 'text-emerald-600' : 'text-red-600',
                      )}
                    >
                      {signedMoney(item.difference)}
                    </td>
                    <td
                      className={cx(
                        'px-3 py-2 text-right tabular-nums',
                        item.variancePercent === null
                          ? 'text-gray-400'
                          : item.variancePercent > 0
                            ? 'text-emerald-600'
                            : 'text-red-600',
                      )}
                    >
                      {item.variancePercent === null ? '—' : signedPercent(item.variancePercent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-gray-500">
            Differences shown here sum to {signedMoney(breakdown.total)} across every item, which is
            the figure in the comparison row. Open an item&rsquo;s{' '}
            <span className="font-medium text-gray-600">cost layers</span> to see the receipts the
            cost is drawn from.
          </p>
        </div>
      )}
    </Drawer>
  )
}

export default VarianceDrilldown
