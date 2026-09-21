import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useSearchParams } from 'react-router-dom'
import { Boxes, Clock, Package, Users, Warehouse } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cx } from '../../ui/cx'
import { EmptyState } from '../../ui/EmptyState'
import { LoadingState } from '../../ui/LoadingState'
import { formatInt, formatMoney, formatQty } from '../../utils/format'
import { PENDING_AGEING_BUCKETS } from '../../services/stockApi'
import type { PendingBreakdownRow, PendingBreakdowns } from '../../services/stockApi'
import { pendingKindLabel } from './pendingCells'

const AGEING_LABEL: Record<string, string> = Object.fromEntries(
  PENDING_AGEING_BUCKETS.map((b) => [b.value, b.label]),
)

/**
 * One dimension of the filtered set, as a ranked bar list.
 *
 * Bars rather than a chart library: the question here is "which of these is
 * biggest, and by how much", which a length answers directly and a pie does not.
 * The share is of the rows this card covers, and it says so, because a bar that
 * ran to 100% of a truncated top-eight would overstate the leader.
 */
function BreakdownCard({
  title,
  icon: Icon,
  rows,
  metric,
  linkFor,
  labelFor,
  loading,
}: {
  title: string
  icon: LucideIcon
  rows: readonly PendingBreakdownRow[]
  metric: 'open_quantity' | 'pending_value'
  linkFor?: (row: PendingBreakdownRow) => string | null
  labelFor?: (row: PendingBreakdownRow) => string
  loading: boolean
}) {
  const shown = rows.filter((r) => r.lines > 0)
  const max = Math.max(...shown.map((r) => r[metric]), 0)
  const format = metric === 'pending_value' ? formatMoney : formatQty

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3.5">
      <header className="mb-3 flex items-center gap-2">
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary-light text-primary"
          aria-hidden
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        <h3 className="text-xs font-semibold text-gray-900">{title}</h3>
      </header>

      {loading && shown.length === 0 ? (
        <LoadingState variant="skeleton" rows={4} label={`Loading ${title.toLowerCase()}`} />
      ) : shown.length === 0 ? (
        <p className="py-3 text-center text-xs text-gray-500">Nothing to show.</p>
      ) : (
        <ul className="space-y-2.5">
          {shown.map((row) => {
            const label = labelFor?.(row) ?? row.label
            const share = max > 0 ? (row[metric] / max) * 100 : 0
            const to = linkFor?.(row) ?? null
            const body = (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-xs text-gray-700" title={label}>
                    {label}
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-900">
                    {format(row[metric])}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={cx(
                      'h-1.5 rounded-full',
                      row.overdue_lines > 0 ? 'bg-red-400' : 'bg-primary',
                    )}
                    style={{ width: `${Math.max(share, 2)}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-gray-500">
                  {formatInt(row.lines)} {row.lines === 1 ? 'line' : 'lines'}
                  {row.overdue_lines > 0 ? ` · ${formatInt(row.overdue_lines)} overdue` : ''}
                  {metric === 'open_quantity' ? ` · ${formatMoney(row.pending_value)} at cost` : ''}
                </p>
              </>
            )
            return (
              <li key={row.label}>
                {to ? (
                  <Link
                    to={to}
                    className="block rounded-md px-1 py-0.5 -mx-1 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/**
 * The aggregated read of the register.
 *
 * Every figure comes from the SERVER's own group-by over the whole filtered set
 * (`include=breakdowns`), never from the rows on this page — a "pending by
 * warehouse" built from fifty visible rows would rank warehouses by who happened
 * to sort first. The filters, the period and the branch are the table's; this is
 * the same question asked six ways, which is the whole contract a view signs up
 * to.
 */
export function PendingSummaryView({
  breakdowns,
  loading,
}: {
  breakdowns: PendingBreakdowns | undefined
  loading: boolean
}) {
  // Drill-downs keep the reader's current filters and add the one they clicked.
  const [params] = useSearchParams()
  const withFilter = useMemo(
    () => (key: string, value: string) => {
      const next = new URLSearchParams(params)
      next.set(key, value)
      next.delete('view')
      next.delete('page')
      return `/registers/pending-quantities?${next.toString()}`
    },
    [params],
  )

  if (!breakdowns) {
    return loading ? (
      <LoadingState variant="cards" label="Loading summary" />
    ) : (
      <EmptyState
        icon={Boxes}
        title="No pending quantities to summarise"
        description="Nothing matches the current filters, so there is nothing to group."
      />
    )
  }

  const hasAnything = Object.values(breakdowns).some((group: PendingBreakdownRow[]) =>
    group.some((r) => r.lines > 0),
  )
  if (!hasAnything) {
    return (
      <EmptyState
        icon={Boxes}
        title="No pending quantities to summarise"
        description="Nothing matches the current filters, so there is nothing to group."
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      <BreakdownCard
        title="Pending by ageing"
        icon={Clock}
        rows={breakdowns.ageing}
        metric="open_quantity"
        labelFor={(r) => AGEING_LABEL[r.label] ?? r.label}
        linkFor={(r) => withFilter('ageing_bucket', r.label)}
        loading={loading}
      />
      <BreakdownCard
        title="Pending by kind"
        icon={Package}
        rows={breakdowns.kind}
        metric="open_quantity"
        labelFor={(r) => pendingKindLabel(r.label)}
        linkFor={(r) => withFilter('kind', r.label)}
        loading={loading}
      />
      <BreakdownCard
        title="Inbound vs outbound"
        icon={Boxes}
        rows={breakdowns.direction}
        metric="open_quantity"
        labelFor={(r) => (r.label === 'in' ? 'Inbound (owed to us)' : 'Outbound (issued)')}
        linkFor={(r) => withFilter('direction', r.label)}
        loading={loading}
      />
      <BreakdownCard
        title="Pending by warehouse"
        icon={Warehouse}
        rows={breakdowns.warehouse}
        metric="open_quantity"
        linkFor={(r) => (r.key ? withFilter('warehouse_id', r.key) : null)}
        loading={loading}
      />
      <BreakdownCard
        title="Pending by item"
        icon={Package}
        rows={breakdowns.item}
        metric="open_quantity"
        linkFor={(r) => (r.key ? withFilter('item_id', r.key) : null)}
        loading={loading}
      />
      <BreakdownCard
        title="Pending by party"
        icon={Users}
        rows={breakdowns.party}
        metric="pending_value"
        linkFor={(r) => (r.key ? withFilter('party_ref', r.key) : null)}
        loading={loading}
      />
    </div>
  )
}

export default PendingSummaryView
