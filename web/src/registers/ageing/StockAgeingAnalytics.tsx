import { useState } from 'react'
import { X } from 'lucide-react'
import { cx } from '../../ui/cx'
import { AGE_BUCKET_LABELS } from '../../reports/helpers'
import { AgeingDistributionChart } from './AgeingDistributionChart'
import { AgeingDonut } from './AgeingDonut'
import { StockHealthPanel } from './StockHealthPanel'
import { useAgeingDrilldown } from './useAgeingDrilldown'
import { HEALTH_STATUS_META } from './ageingModel'
import type { AgeingMetric } from './ageingModel'
import type { StockAgeingSummary } from '../../services/reportsApi'

/**
 * The analytics band over the Stock Ageing register.
 *
 * Three questions the rows cannot answer one at a time: where the value is by age,
 * how the items are spread across the bands, and what the whole position scores. Every
 * figure comes from the summary the register already fetched under the reader's own
 * filters, so the band can never answer a differently-filtered question from the table
 * below it — and it issues no requests of its own.
 *
 * Screen only. The printed sheet carries the KPI cards and the totals row, which are
 * the record; a picture of them is not.
 */
export interface StockAgeingAnalyticsProps {
  summary: StockAgeingSummary
  loading: boolean
}

export function StockAgeingAnalytics({ summary, loading }: StockAgeingAnalyticsProps) {
  const [metric, setMetric] = useState<AgeingMetric>('value')
  const { bucket, health, toggleBucket, toggleHealth } = useAgeingDrilldown()

  return (
    <section aria-label="Stock ageing analytics" className="flex flex-col gap-2 print:hidden">
      {bucket || health ? (
        <div
          className={cx(
            'flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-primary/[0.04] px-3 py-2 text-xs',
          )}
        >
          <span className="font-semibold text-gray-800">Drilled into</span>
          {bucket ? (
            <DrilldownChip
              label={summary.bucket_labels?.[bucket] ?? AGE_BUCKET_LABELS[bucket]}
              onClear={() => toggleBucket(bucket)}
            />
          ) : null}
          {health ? (
            <DrilldownChip
              label={HEALTH_STATUS_META[health].label}
              onClear={() => toggleHealth(health)}
            />
          ) : null}
          <span className="text-gray-500">
            Every figure on this page describes the drilled-in rows only.
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-2 xl:grid-cols-[1.55fr_1fr]">
        <AgeingDistributionChart
          summary={summary}
          metric={metric}
          onMetric={setMetric}
          active={bucket}
          onSelect={toggleBucket}
          loading={loading}
        />
        <AgeingDonut summary={summary} active={bucket} onSelect={toggleBucket} loading={loading} />
      </div>

      <StockHealthPanel summary={summary} loading={loading} />
    </section>
  )
}

function DrilldownChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white py-0.5 pl-2.5 pr-1 font-semibold text-primary ring-1 ring-primary/25">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear the ${label} drill-down`}
        className="grid h-4 w-4 place-items-center rounded-full text-primary/70 transition-colors hover:bg-primary/10 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  )
}

export default StockAgeingAnalytics
