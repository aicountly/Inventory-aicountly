import { ArrowRight, Lightbulb, PieChart, Warehouse } from 'lucide-react'
import { BarList } from '../../../dashboard/charts/BarList'
import { DonutChart } from '../../../dashboard/charts/DonutChart'
import type { SeriesItem } from '../../../dashboard/model'
import { Card } from '../../../ui/Card'
import { Skeleton } from '../../../ui/Skeleton'
import { AIC, cx } from '../../../ui/cx'
import { formatInt } from '../../../utils/format'
import type { LocationInsight } from './locationsModel'

/**
 * The contextual column: where the locations are, what kinds they are, and the
 * one thing worth doing about them.
 *
 * All three read the same loaded set the KPI strip counts, so nothing here can
 * disagree with the figures above the table.
 */

const CARD_TITLE = 'text-[13px] font-semibold text-gray-900'
const CARD_SUB = 'mt-0.5 text-[11px] text-gray-500'

function WidgetHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className={CARD_TITLE}>{title}</h2>
        <p className={CARD_SUB}>{subtitle}</p>
      </div>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="shrink-0 rounded-md px-1.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}

function WidgetEmpty({ icon: Icon, children }: { icon: typeof Warehouse; children: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gray-100 text-gray-400" aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
      <p className="max-w-[15rem] text-[11px] leading-relaxed text-gray-500">{children}</p>
    </div>
  )
}

export interface LocationsSidebarProps {
  coverage: readonly SeriesItem[]
  distribution: readonly SeriesItem[]
  insights: readonly LocationInsight[]
  total: number
  loading?: boolean
  onOpenCoverage: () => void
  onOpenInsights: () => void
  className?: string
}

const INSIGHT_TONE = {
  info: 'border-sky-100 bg-sky-50/60',
  warning: 'border-amber-200 bg-amber-50/60',
  success: 'border-primary/20 bg-primary-light/70',
} as const

export function LocationsSidebar({
  coverage,
  distribution,
  insights,
  total,
  loading = false,
  onOpenCoverage,
  onOpenInsights,
  className,
}: LocationsSidebarProps) {
  const lead = insights[0]

  if (loading) {
    return (
      <aside className={cx(AIC, 'grid gap-3.5 lg:grid-cols-2 xl:grid-cols-3 ultra:grid-cols-1', className)} aria-hidden>
        <Card padding="md">
          <Skeleton className="mb-3 h-4 w-32" />
          <Skeleton className="h-[7.5rem] w-full" />
        </Card>
        <Card padding="md">
          <Skeleton className="mb-3 h-4 w-40" />
          <Skeleton className="h-[8.25rem] w-full" />
        </Card>
      </aside>
    )
  }

  return (
    <aside className={cx(AIC, 'grid gap-3.5 lg:grid-cols-2 xl:grid-cols-3 ultra:grid-cols-1', className)}>
      <Card padding="md">
        <WidgetHeader
          title="Warehouse coverage"
          subtitle="Locations by warehouse"
          action={coverage.length > 0 ? { label: 'View all', onClick: onOpenCoverage } : undefined}
        />
        {coverage.length === 0 ? (
          <WidgetEmpty icon={Warehouse}>
            Locations appear here once they are mapped to a warehouse.
          </WidgetEmpty>
        ) : (
          <>
            <BarList items={coverage} limit={5} />
            {coverage.length > 5 ? (
              <button
                type="button"
                onClick={onOpenCoverage}
                className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-primary transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {coverage.length - 5} more {coverage.length - 5 === 1 ? 'warehouse' : 'warehouses'}
                <ArrowRight className="h-3 w-3" aria-hidden />
              </button>
            ) : null}
          </>
        )}
      </Card>

      <Card padding="md">
        <WidgetHeader title="Location type distribution" subtitle="Share of the location tree" />
        {distribution.length === 0 ? (
          <WidgetEmpty icon={PieChart}>
            Create zones, racks, shelves or bins to see how your layout is made up.
          </WidgetEmpty>
        ) : (
          <DonutChart
            items={distribution}
            centerValue={formatInt(total)}
            centerLabel={total === 1 ? 'Location' : 'Locations'}
            ariaLabel="Locations by type"
          />
        )}
      </Card>

      {lead ? (
        <div
          className={cx(
            'rounded-xl border p-3.5 lg:col-span-2 xl:col-span-1',
            INSIGHT_TONE[lead.tone],
          )}
        >
          <div className="flex items-start gap-2.5">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/80 text-primary"
              aria-hidden
            >
              <Lightbulb className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                Smart suggestion
              </p>
              <p className="mt-1 text-[13px] font-semibold leading-snug text-gray-900">{lead.title}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-600">{lead.detail}</p>
              <button
                type="button"
                onClick={onOpenInsights}
                className="mt-2.5 inline-flex items-center gap-1 rounded-md text-[11px] font-semibold text-primary transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {insights.length > 1 ? `See all ${insights.length} insights` : 'See details'}
                <ArrowRight className="h-3 w-3" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  )
}

export default LocationsSidebar
