import { Boxes, CircleCheck, CirclePause, Link2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '../../../ui/Card'
import { IconTile } from '../../../ui/IconTile'
import type { IconTone } from '../../../ui/IconTile'
import { AIC, cx } from '../../../ui/cx'
import { formatInt } from '../../../utils/format'
import type { UomSummary } from '../../../services/uomApi'

/**
 * The four figures over the list.
 *
 * Each comes from `GET /v1/uom/summary`, counted over the whole master rather
 * than the page on screen — a "Total units" that changed when you turned the
 * page would not be a total. Nothing here is computed from the visible rows,
 * and nothing is hard-coded: before the response lands the cards render their
 * own geometry in grey, and a figure the API did not send reads as an em dash
 * instead of a zero, because zero is a claim about the company's data.
 */

interface StatProps {
  icon: LucideIcon
  tone: IconTone
  label: string
  value: number | null
  /** The pill at the top right — a rate, or a real comparison. Never a guess. */
  note?: ReactNode
  loading?: boolean
}

function Stat({ icon, tone, label, value, note, loading }: StatProps) {
  return (
    <Card padding="sm" className="flex items-start gap-3 min-h-[92px]">
      <IconTile icon={icon} tone={tone} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
          {note && !loading ? (
            <span className="shrink-0 whitespace-nowrap rounded-full bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500">
              {note}
            </span>
          ) : null}
        </div>
        {loading ? (
          <span className="skeleton mt-1.5 block h-6 w-16 rounded" aria-hidden />
        ) : (
          <p className="mt-1 truncate text-2xl font-semibold leading-none tabular-nums text-gray-900">
            {value === null ? <span className="text-gray-300">—</span> : formatInt(value)}
          </p>
        )}
      </div>
    </Card>
  )
}

export interface UomStatsProps {
  summary: UomSummary | null
  loading?: boolean
  className?: string
}

export function UomStats({ summary, loading = false, className }: UomStatsProps) {
  const busy = loading && !summary

  /*
   * "+2 vs last month" only when the API really counted two.
   *
   * created_last_30d is a count of rows with a created_at inside the window, so
   * a master migrated in one go reads 0 rather than pretending to a trend. The
   * pill is dropped entirely in that case instead of printing "+0", which reads
   * as a measured result rather than an absent one.
   */
  const added = summary?.created_last_30d ?? 0
  const newNote = added > 0 ? `+${formatInt(added)} in 30 days` : undefined

  return (
    <section
      className={cx(AIC, 'grid grid-cols-2 gap-3 xl:grid-cols-4', className)}
      aria-label="Units of measure summary"
      aria-busy={busy || undefined}
    >
      <Stat
        icon={Boxes}
        tone="primary"
        label="Total units"
        value={summary?.total ?? null}
        note={newNote}
        loading={busy}
      />
      <Stat
        icon={CircleCheck}
        tone="info"
        label="Active units"
        value={summary?.active ?? null}
        note={summary ? `${summary.active_rate}% active` : undefined}
        loading={busy}
      />
      <Stat
        icon={CirclePause}
        tone="danger"
        label="Inactive units"
        value={summary?.inactive ?? null}
        note={summary ? `${summary.inactive_rate}% inactive` : undefined}
        loading={busy}
      />
      <Stat
        icon={Link2}
        tone="violet"
        label="Used in items"
        value={summary?.used_in_items ?? null}
        note={summary ? `${summary.usage_rate}% in use` : undefined}
        loading={busy}
      />
    </section>
  )
}

export default UomStats
