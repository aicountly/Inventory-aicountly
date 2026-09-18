import { Link } from 'react-router-dom'
import { ArrowRight, Boxes, CircleCheck, CirclePause, Warehouse as WarehouseIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '../../ui/Card'
import { IconTile } from '../../ui/IconTile'
import type { IconTone } from '../../ui/IconTile'
import { ProgressBar } from '../../ui/ProgressBar'
import { cx } from '../../ui/cx'
import { formatInt } from '../../utils/format'
import type { GroupStats } from './model'

/**
 * The four figures over the table.
 *
 * Every one of them is counted from the groups this screen holds — see
 * `groupStats`. There is deliberately no "+25% vs last FY" chip: the list
 * endpoint returns no comparative, and a percentage with nothing behind it is
 * worse than no percentage at all. Each card carries a caption that says what
 * the figure covers instead.
 */

const SHELL = 'flex flex-row items-start gap-3 min-w-[13rem] min-h-[6.5rem]'
const LABEL = 'text-[11px] font-semibold uppercase tracking-wide text-gray-500 truncate'
const VALUE = 'mt-1 text-2xl leading-none font-bold tabular-nums tracking-tight text-gray-900'
const CAPTION = 'mt-1.5 text-[11px] leading-snug text-gray-500'

interface MetricCardProps {
  label: string
  value: ReactNode
  icon: LucideIcon
  tone: IconTone
  caption?: ReactNode
  children?: ReactNode
}

function MetricCard({ label, value, icon, tone, caption, children }: MetricCardProps) {
  return (
    <Card as="article" padding="sm" className={SHELL}>
      <IconTile icon={icon} tone={tone} size="lg" />
      <div className="min-w-0 flex-1">
        <p className={LABEL}>{label}</p>
        <p className={VALUE}>{value}</p>
        {caption ? <p className={CAPTION}>{caption}</p> : null}
        {children}
      </div>
    </Card>
  )
}

function CardSkeleton() {
  return (
    <Card aria-hidden padding="sm" className={SHELL}>
      <span className="skeleton h-12 w-12 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className={LABEL}>
          <span className="skeleton inline-block w-20 rounded text-transparent">&nbsp;</span>
        </p>
        <p className={VALUE}>
          <span className="skeleton inline-block w-14 rounded text-transparent">&nbsp;</span>
        </p>
        <p className={CAPTION}>
          <span className="skeleton inline-block w-24 rounded text-transparent">&nbsp;</span>
        </p>
      </div>
    </Card>
  )
}

export const STATS_GRID =
  'grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 print:hidden'

export interface WarehouseGroupsStatsProps {
  stats: GroupStats
  loading: boolean
  /** Where "View details" goes — the warehouses master. */
  warehousesRoute: string
  canReadWarehouses: boolean
  className?: string
}

export function WarehouseGroupsStats({
  stats,
  loading,
  warehousesRoute,
  canReadWarehouses,
  className,
}: WarehouseGroupsStatsProps) {
  if (loading) {
    return (
      <section className={cx(STATS_GRID, className)} aria-label="Warehouse group summary">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </section>
    )
  }

  return (
    <section className={cx(STATS_GRID, className)} aria-label="Warehouse group summary">
      <MetricCard
        label="Total groups"
        value={formatInt(stats.total)}
        icon={Boxes}
        tone="info"
        caption="Across the selected company"
      />

      <MetricCard
        label="Active"
        value={formatInt(stats.active)}
        icon={CircleCheck}
        tone="success"
        caption={stats.total === 0 ? 'No groups yet' : `${stats.activePct}% of all groups`}
      >
        <ProgressBar
          value={stats.activePct}
          size="sm"
          className="mt-2"
          aria-label={`${stats.activePct}% of warehouse groups are active`}
        />
      </MetricCard>

      <MetricCard
        label="Inactive"
        value={formatInt(stats.inactive)}
        icon={CirclePause}
        tone="warning"
        caption={stats.total === 0 ? 'No groups yet' : `${stats.inactivePct}% of all groups`}
      >
        <ProgressBar
          value={stats.inactivePct}
          size="sm"
          className="mt-2"
          barClassName="bg-amber-500"
          aria-label={`${stats.inactivePct}% of warehouse groups are inactive`}
        />
      </MetricCard>

      <MetricCard
        label="Total warehouses"
        value={formatInt(stats.warehousesTotal ?? stats.warehousesInGroups)}
        icon={WarehouseIcon}
        tone="violet"
        caption={
          /*
           * Two different figures under one label would be a lie, so the caption
           * says which one this is. A reader who cannot open the warehouses
           * master is shown what these groups hold; everyone else is shown the
           * company's warehouses and how many of them are in no group at all.
           */
          stats.warehousesTotal === null
            ? `In these groups${stats.emptyGroups > 0 ? ` · ${stats.emptyGroups} empty ${stats.emptyGroups === 1 ? 'group' : 'groups'}` : ''}`
            : stats.ungrouped === 0
              ? 'Every warehouse is in a group'
              : `${formatInt(stats.ungrouped ?? 0)} in no group`
        }
      >
        {canReadWarehouses ? (
          <Link
            to={warehousesRoute}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-primary no-underline hover:underline"
          >
            View details
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        ) : null}
      </MetricCard>
    </section>
  )
}

export default WarehouseGroupsStats
