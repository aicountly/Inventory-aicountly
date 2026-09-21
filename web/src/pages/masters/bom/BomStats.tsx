import { CircleCheck, IndianRupee, Layers, Network, PackageOpen, PauseCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { BomSummary } from '../../../services/masters'
import { Badge } from '../../../ui/Badge'
import { Card } from '../../../ui/Card'
import { IconTile } from '../../../ui/IconTile'
import type { IconTone } from '../../../ui/IconTile'
import { Tooltip } from '../../../ui/Tooltip'
import { AIC, cx } from '../../../ui/cx'
import { formatInt, formatQty } from '../../../utils/format'
import { COST_UNAVAILABLE, compactCost, creationTrend, sharePercent } from './bomPresentation'

/**
 * The six figures above the list.
 *
 * Every one of them is a number the API computed over the whole company, not a
 * page-scoped sum: a card that said "24" while counting the 50 rows that
 * happened to be loaded would be wrong on page two and wrong again after a
 * filter. They deliberately do NOT follow the toolbar's filters either — the
 * cards answer "what do we have", the table answers "what am I looking at".
 *
 * A figure that could not be read is an em dash, and the material cost is the
 * phrase "Cost unavailable" rather than a zero. A zero here is a claim: it says
 * these bills cost nothing to build.
 */

interface StatProps {
  icon: LucideIcon
  tone: IconTone
  label: string
  value: ReactNode
  caption: ReactNode
  badge?: { label: string; tone?: 'success' | 'neutral' } | null
  hint?: string
}

function Stat({ icon, tone, label, value, caption, badge, hint }: StatProps) {
  const body = (
    <Card
      padding="sm"
      className={cx(
        'h-full min-w-0 transition-all duration-150 ease-out motion-reduce:transition-none',
        'hover:-translate-y-px hover:border-primary/30 motion-reduce:hover:translate-y-0',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
        <IconTile icon={icon} tone={tone} size="sm" />
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="truncate text-[1.35rem] font-bold leading-none tracking-tight tabular-nums text-gray-900">
          {value}
        </span>
        {badge ? (
          <Badge tone={badge.tone ?? 'success'} size="xs" className="shrink-0 normal-case">
            {badge.label}
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 truncate text-[11px] text-gray-400">{caption}</p>
      {hint ? <span className="sr-only">{hint}</span> : null}
    </Card>
  )
  return hint ? (
    <Tooltip label={hint} className="h-full w-full">
      {body}
    </Tooltip>
  ) : (
    body
  )
}

function StatSkeleton() {
  return (
    <Card padding="sm" aria-hidden className="h-full min-w-0">
      <div className="flex items-start justify-between gap-2">
        <span className="skeleton h-3 w-20 rounded" />
        <span className="skeleton h-8 w-8 rounded-lg" />
      </div>
      <span className="skeleton mt-2 block h-6 w-16 rounded" />
      <span className="skeleton mt-1.5 block h-3 w-14 rounded" />
    </Card>
  )
}

/**
 * Six across on a wide desktop, three then two as the viewport narrows — the
 * figures stay legible instead of being squeezed into slivers.
 */
const GRID = 'grid grid-cols-2 gap-2.5 md:grid-cols-3 ultra:grid-cols-6'

export interface BomStatsProps {
  summary: BomSummary | null
  loading: boolean
  /** Hide the cost card from a profile that may not see valuation figures. */
  canViewCost?: boolean
  className?: string
}

export function BomStats({ summary, loading, canViewCost = true, className }: BomStatsProps) {
  if (loading && !summary) {
    return (
      <section className={cx(AIC, GRID, className)} aria-label="Bill of materials summary" aria-busy>
        {Array.from({ length: 6 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </section>
    )
  }

  const dash = <span className="text-gray-300">—</span>
  const activeShare = summary ? sharePercent(summary.active, summary.total) : null
  const inactiveShare = summary ? sharePercent(summary.inactive, summary.total) : null
  const trend = summary ? creationTrend(summary) : { badge: null, caption: 'vs last month' }
  const costKnown = summary ? summary.estimated_material_cost !== null : false

  return (
    <section className={cx(AIC, GRID, className)} aria-label="Bill of materials summary">
      <Stat
        icon={Network}
        tone="primary"
        label="Total BOMs"
        value={summary ? formatInt(summary.total) : dash}
        caption={trend.caption}
        badge={trend.badge ? { label: trend.badge } : null}
      />
      <Stat
        icon={CircleCheck}
        tone="success"
        label="Active BOMs"
        value={summary ? formatInt(summary.active) : dash}
        caption={activeShare === null ? 'of all bills' : `${activeShare}% of all bills`}
      />
      <Stat
        icon={PauseCircle}
        tone="danger"
        label="Inactive BOMs"
        value={summary ? formatInt(summary.inactive) : dash}
        caption={inactiveShare === null ? 'of all bills' : `${inactiveShare}% of all bills`}
      />
      <Stat
        icon={Layers}
        tone="info"
        label="Avg. components"
        value={summary ? formatQty(summary.average_components) : dash}
        caption="per bill of materials"
        hint={
          summary
            ? `${formatInt(summary.component_lines)} component lines across ${formatInt(summary.total)} bills.`
            : undefined
        }
      />
      <Stat
        icon={PackageOpen}
        tone="violet"
        label="Linked items"
        value={summary ? formatInt(summary.linked_finished_items) : dash}
        caption="finished products"
        hint={
          summary
            ? `${formatInt(summary.linked_finished_items_active)} of them are covered by an active bill.`
            : undefined
        }
      />
      {canViewCost ? (
        <Stat
          icon={IndianRupee}
          tone="warning"
          label="Est. material cost"
          value={
            summary ? (
              <span className={costKnown ? undefined : 'text-[0.95rem] font-semibold text-gray-400'}>
                {compactCost(summary.estimated_material_cost, summary.currency)}
              </span>
            ) : (
              dash
            )
          }
          caption={
            !summary
              ? 'for active bills'
              : !costKnown
                ? 'no component has a cost yet'
                : summary.partially_costed_boms > 0
                  ? `${formatInt(summary.partially_costed_boms)} bill${summary.partially_costed_boms === 1 ? '' : 's'} partly priced`
                  : 'for active bills'
          }
          hint={
            summary && !costKnown
              ? `${COST_UNAVAILABLE}: no component of an active bill has a weighted-average or standard cost on record yet.`
              : summary
                ? 'Components of active bills, valued at weighted-average cost, falling back to the standard cost.'
                : undefined
          }
        />
      ) : null}
    </section>
  )
}

export default BomStats
