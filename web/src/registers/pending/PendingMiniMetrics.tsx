import { ArrowDownLeft, ArrowUpRight, Scale } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import type { PendingSummaryResponse } from '../../services/stockApi'

/**
 * Inbound, outbound and the net of the two, pinned beside the table.
 *
 * All three come off the server's aggregate over the WHOLE filtered set, not the
 * page — a net exposure computed from fifty visible rows would be the most
 * confidently wrong figure on the screen.
 *
 * The directions mean what Inventory means by them: `in` is stock owed to us and
 * expected to arrive (an inward challan, a deferred purchase, goods due back from
 * a job worker); `out` is stock that has left or is committed to leave. Net
 * exposure is outbound less inbound — what the company is out of pocket in
 * quantity terms once everything outstanding settles.
 */
function Chip({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  hint: string
  icon: LucideIcon
  tone: 'in' | 'out' | 'net'
}) {
  const TONE: Record<typeof tone, string> = {
    in: 'text-emerald-600 bg-emerald-50',
    out: 'text-red-600 bg-red-50',
    net: 'text-violet-600 bg-violet-50',
  }
  return (
    <div
      className="flex min-w-[8.5rem] items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5"
      title={hint}
    >
      <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-md', TONE[tone])} aria-hidden>
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[10px] uppercase tracking-wide text-gray-500">
          {label}
        </span>
        <span className="block truncate text-xs font-semibold tabular-nums text-gray-900">
          {value}
        </span>
      </span>
    </div>
  )
}

export function PendingMiniMetrics({ summary }: { summary: PendingSummaryResponse }) {
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Chip
        label="Inbound pending"
        value={`${formatQty(summary.inbound_pending)} qty`}
        hint="Stock owed to the company and not yet received, across every matching row."
        icon={ArrowDownLeft}
        tone="in"
      />
      <Chip
        label="Outbound pending"
        value={`${formatQty(summary.outbound_pending)} qty`}
        hint="Stock issued or committed and not yet settled, across every matching row."
        icon={ArrowUpRight}
        tone="out"
      />
      <Chip
        label="Net exposure (out − in)"
        value={`${formatQty(summary.net_exposure)} qty`}
        hint="Outbound pending less inbound pending, across every matching row."
        icon={Scale}
        tone="net"
      />
    </div>
  )
}

export default PendingMiniMetrics
