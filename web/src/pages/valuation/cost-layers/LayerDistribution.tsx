import { Select } from '../../../ui/Select'
import { Skeleton } from '../../../ui/Skeleton'
import { cx } from '../../../ui/cx'
import type { CostLayerDistribution, CostLayerStatus } from '../../../services/valuationApi'
import { formatMoney, formatQty } from '../../../utils/format'
import { distributionSegments } from './costLayersModel'
import type { DistributionMeasure } from './costLayersModel'

/** One colour per state, shared by the bar and its legend swatch. */
const SEGMENT_CLASS: Record<CostLayerStatus, string> = {
  open: 'bg-emerald-500',
  partial: 'bg-amber-400',
  closed: 'bg-gray-400',
  negative: 'bg-red-500',
}

export interface LayerDistributionProps {
  distribution: CostLayerDistribution | null | undefined
  measure: DistributionMeasure
  onMeasure: (measure: DistributionMeasure) => void
  loading?: boolean
  /** Rendered under the legend — what the split covers. */
  scopeNote?: string
}

/**
 * Where this item's cost sits: how much of it is still open, partly issued or
 * fully consumed.
 *
 * One bar and three lines rather than a chart, because there are only ever four
 * segments and the reader wants the figure beside the share. The split is at
 * OPENING value: a closed layer has no remaining value, so a split over what is
 * left would price every exhausted layer at zero and report that the item's
 * cost had never moved.
 */
export function LayerDistribution({
  distribution,
  measure,
  onMeasure,
  loading = false,
  scopeNote,
}: LayerDistributionProps) {
  const segments = distributionSegments(distribution, measure)
  const format = measure === 'value' ? formatMoney : formatQty

  return (
    <section className="border-t border-gray-100 px-3 py-3" aria-label="Cost layer distribution">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-gray-900">Cost layer distribution</h4>
        <Select
          value={measure}
          onChange={(e) => onMeasure(e.target.value as DistributionMeasure)}
          aria-label="Measure the distribution by"
          className="h-7 w-[6.5rem] text-[11px]"
        >
          <option value="value">By value</option>
          <option value="qty">By quantity</option>
        </Select>
      </div>

      {loading ? (
        <>
          <Skeleton className="h-3.5 w-full" rounded="md" />
          <div className="mt-2 space-y-1.5">
            <Skeleton className="h-3 w-full" rounded="md" />
            <Skeleton className="h-3 w-4/5" rounded="md" />
            <Skeleton className="h-3 w-3/5" rounded="md" />
          </div>
        </>
      ) : segments.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-gray-500">
          No layers to split. The distribution appears once this item has at least one cost layer in the selected
          warehouse and period.
        </p>
      ) : (
        <>
          <div
            className="flex h-3.5 overflow-hidden rounded bg-gray-200"
            role="img"
            aria-label={segments
              .map((s) => `${s.label} ${s.share.toFixed(0)} per cent`)
              .join(', ')}
          >
            {segments.map((segment) => (
              <span
                key={segment.status}
                className={cx('h-full transition-[width] duration-300', SEGMENT_CLASS[segment.status])}
                style={{ width: `${segment.share}%` }}
              />
            ))}
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {segments.map((segment) => (
              <li
                key={segment.status}
                className="grid grid-cols-[0.5rem_minmax(0,1fr)_auto] items-center gap-2 text-[11px] text-gray-600"
              >
                <span
                  className={cx('h-2 w-2 shrink-0 rounded-sm', SEGMENT_CLASS[segment.status])}
                  aria-hidden
                />
                <span className="truncate">
                  {segment.label}{' '}
                  <span className="text-gray-400 tabular-nums">
                    ({segment.share.toFixed(0)}% · {segment.layerCount})
                  </span>
                </span>
                <strong className="tabular-nums font-semibold text-gray-900">{format(segment.amount)}</strong>
              </li>
            ))}
          </ul>
          {scopeNote ? <p className="mt-2 text-[10.5px] leading-relaxed text-gray-400">{scopeNote}</p> : null}
        </>
      )}
    </section>
  )
}

export default LayerDistribution
