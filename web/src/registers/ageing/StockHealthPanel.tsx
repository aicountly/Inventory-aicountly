import { useId, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChevronDown, Clock, Coins, HeartPulse, ShieldAlert, TrendingDown } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Card } from '../../ui/Card'
import { Skeleton } from '../../ui/Skeleton'
import { cx } from '../../ui/cx'
import { formatCurrencyCompact } from '../../dashboard/formatters'
import { formatMoney } from '../../utils/format'
import { AGE_BUCKET_LABELS } from '../../reports/helpers'
import {
  HEALTH_BANDS,
  HEALTH_BAND_META,
  HEALTH_PENALTY,
  capitalAtRisk,
  formatAgeDays,
  formatShare,
} from './ageingModel'
import type { AgeBucketKey, StockAgeingSummary } from '../../services/reportsApi'

/**
 * The health band, its score, and the four figures the score is made of.
 *
 * The score itself is the server's (`InventoryReportService::healthScore`) — this
 * draws it and, crucially, shows its working. "How is this calculated?" opens the
 * actual weights and the actual band floors, because a number out of 100 on a
 * controller's screen is worth nothing if nobody can reproduce it. It is a
 * disclosure, not a tooltip: the explanation is the point, and a tooltip would put it
 * out of reach of a keyboard and off the printed sheet.
 *
 * Nothing here is described as intelligence, learning or prediction. It is weighted
 * arithmetic over five buckets, and it says so.
 */
export interface StockHealthPanelProps {
  summary: StockAgeingSummary
  loading: boolean
  className?: string
}

const RADIUS = 42
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function StockHealthPanel({ summary, loading, className }: StockHealthPanelProps) {
  const [open, setOpen] = useState(false)
  const explainerId = useId()

  const score = summary.health_score
  const band = summary.health_band
  const meta = band ? HEALTH_BAND_META[band] : null
  const risk = capitalAtRisk(summary)

  if (loading && !summary.items) {
    return (
      <div className={cx('grid gap-2 md:grid-cols-2 xl:grid-cols-4', className)}>
        <Skeleton className="h-[132px] w-full xl:col-span-2" />
        <Skeleton className="h-[132px] w-full" />
        <Skeleton className="h-[132px] w-full" />
      </div>
    )
  }

  return (
    <div className={cx('grid gap-2 md:grid-cols-2 xl:grid-cols-4', className)}>
      <Card padding="sm" className="flex min-w-0 flex-col gap-3 xl:col-span-2">
        <div className="flex items-start gap-4">
          <ScoreRing score={score} hex={meta?.hex ?? '#94a3b8'} />
          <div className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-label-xs font-semibold uppercase tracking-wide text-gray-400">
              <HeartPulse className="h-3.5 w-3.5" aria-hidden />
              Stock health
            </span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold leading-tight text-gray-900">
                {meta?.label ?? 'Not scored'}
              </h2>
              {meta ? (
                <Badge tone={meta.badge} size="xs" dot>
                  {score} / 100
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
              {meta?.blurb ?? 'There is no stock on hand at this date to score.'}
            </p>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls={explainerId}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              How is this calculated?
              <ChevronDown
                className={cx('h-3 w-3 transition-transform', open && 'rotate-180')}
                aria-hidden
              />
            </button>
          </div>
        </div>

        <div id={explainerId} hidden={!open} className="rounded-xl bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-600">
          <p>
            Every score starts at <strong className="font-semibold text-gray-800">100</strong> and
            loses a weighted share of the stock value sitting in each ageing band. Stock inside 60
            days costs nothing — it is stock, not ageing.
          </p>
          <ul className="mt-2 space-y-1">
            {(Object.keys(HEALTH_PENALTY) as AgeBucketKey[]).map((key) => (
              <li key={key} className="flex items-baseline justify-between gap-3">
                <span>
                  {summary.bucket_labels?.[key] ?? AGE_BUCKET_LABELS[key]} —{' '}
                  {formatShare(
                    key === '61_90' ? risk.watchShare : key === '91_180' ? risk.slowShare : risk.obsoleteShare,
                  )}{' '}
                  of value
                </span>
                <span className="shrink-0 tabular-nums text-gray-500">
                  × {HEALTH_PENALTY[key]} penalty
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2">
            The result is clamped to 0-100 and read as a band:{' '}
            {Object.entries(HEALTH_BANDS)
              .map(([b, floor]) => `${HEALTH_BAND_META[b as keyof typeof HEALTH_BANDS].label} ${floor}+`)
              .join(', ')}
            , below {HEALTH_BANDS.at_risk} Critical. It is arithmetic over the ageing buckets, not a
            forecast, and the same rule decides the Health column on every row.
          </p>
        </div>
      </Card>

      <HealthMetricCard
        icon={TrendingDown}
        label="Capital over 90 days"
        value={formatCurrencyCompact(risk.over90)}
        title={formatMoney(risk.over90)}
        hint={`${formatShare(risk.over90Share)} of stock value`}
        tone={risk.over90Share >= 25 ? 'danger' : risk.over90Share >= 10 ? 'warning' : 'success'}
      />
      <HealthMetricCard
        icon={ShieldAlert}
        label="Capital over 180 days"
        value={formatCurrencyCompact(risk.over180)}
        title={formatMoney(risk.over180)}
        hint={`${formatShare(risk.over180Share)} of stock value`}
        tone={risk.over180Share >= 10 ? 'danger' : risk.over180Share > 0 ? 'warning' : 'success'}
      />

      <div className="grid gap-2 sm:grid-cols-2 md:col-span-2 xl:col-span-4 xl:grid-cols-4">
        <HealthMetricCard
          icon={Coins}
          label="Fresh stock"
          value={formatShare(risk.freshShare)}
          hint="Value aged 60 days or less"
          tone="success"
          compact
        />
        <HealthMetricCard
          icon={TrendingDown}
          label="Slow moving"
          value={formatShare(risk.slowShare)}
          hint="Value aged 91-180 days"
          tone="warning"
          compact
        />
        <HealthMetricCard
          icon={ShieldAlert}
          label="Obsolete"
          value={formatShare(risk.obsoleteShare)}
          hint="Value aged over 180 days"
          tone="danger"
          compact
        />
        <HealthMetricCard
          icon={Clock}
          label="Weighted average age"
          value={formatAgeDays(summary.weighted_age_days)}
          hint={
            summary.oldest_days === null
              ? 'Across the stock on hand'
              : `Oldest layer ${formatAgeDays(summary.oldest_days)}`
          }
          tone="info"
          compact
        />
      </div>
    </div>
  )
}

/** The 0-100 ring. An arc, not a gauge: no needle, no zones, no implied precision. */
function ScoreRing({ score, hex }: { score: number | null; hex: string }) {
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score))
  const dash = (pct / 100) * CIRCUMFERENCE
  return (
    <div className="relative h-[88px] w-[88px] shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="rgb(var(--color-surface-3))" strokeWidth="9" />
        {pct > 0 ? (
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke={hex}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
            className="transition-[stroke-dasharray] duration-700"
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xl font-semibold leading-none tabular-nums text-gray-900">
          {score ?? '—'}
        </span>
        <span className="mt-0.5 text-[10px] text-gray-400">/ 100</span>
      </div>
    </div>
  )
}

const METRIC_TONE = {
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-red-600',
  info: 'text-sky-600',
} as const

function HealthMetricCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  title,
  compact = false,
}: {
  icon: LucideIcon
  label: string
  value: string
  hint: string
  tone: keyof typeof METRIC_TONE
  /** Full-precision figure behind a compacted one. */
  title?: string
  compact?: boolean
}) {
  return (
    <Card padding="sm" className="flex min-w-0 flex-col justify-center">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        <Icon className={cx('h-3.5 w-3.5 shrink-0', METRIC_TONE[tone])} aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      <strong
        className={cx(
          'mt-1.5 truncate font-semibold tabular-nums text-gray-900',
          compact ? 'text-lg' : 'text-xl',
        )}
        title={title}
      >
        {value}
      </strong>
      <small className="mt-1 truncate text-[11px] text-gray-400">{hint}</small>
    </Card>
  )
}

export default StockHealthPanel
