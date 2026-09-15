import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FileStack, Scale, Send } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import type { BadgeTone } from '../../ui/Badge'
import { SkeletonRows } from '../../ui/Skeleton'
import { formatDate, formatDateTime, formatMoney, formatQty } from '../../utils/format'
import { BarList } from '../charts/BarList'
import { WidgetCard } from '../components/WidgetCard'
import type { WidgetState } from '../components/WidgetCard'
import { formatCount, formatCurrencyCompact, plural } from '../formatters'
import { drill } from '../kpiNavigation'
import { documentStatusSeries, inboundSeries, outboxSeries, pendingSeries, postedTypeSeries } from '../model'
import type { DashboardData, DashboardReconciliationRun } from '../../services/dashboard'
import { RECALC_IN_PROGRESS } from '../../services/valuationApi'

interface Loadable<T> {
  data: T | null
  loading: boolean
  error: Error | null
  reload: () => void
}

/**
 * A widget is "loading" until it has either data or an error — not merely while
 * a request is in flight. Before the company scope and the permission list
 * resolve, useQuery has not started yet and reports `loading: false` with no
 * data; keying off that would flash an empty card body on first paint and then
 * swap in the skeleton. Keying off the absence of a result never does.
 */
function state<T>(q: Loadable<T>, empty: boolean): WidgetState {
  return {
    loading: q.data === null && q.error === null,
    error: q.error,
    empty: q.data !== null && empty,
    reload: q.reload,
  }
}

/** Caption over one half of a two-part widget body. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-label-xs uppercase tracking-wide text-gray-400 mb-1">{children}</p>
  )
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function DocumentsWidget({ query }: { query: Loadable<DashboardData> }) {
  const data = query.data
  const statuses = documentStatusSeries(data?.documents.by_status)
  const postedTypes = postedTypeSeries(data?.documents.posted_by_type)
  const pending = pendingSeries(data?.stock.pending_quantities)
  const failed = data?.documents.failed ?? 0

  return (
    <WidgetCard
      title="Documents this year"
      description={data ? `${formatCount(data.documents.total)} documents in the financial year` : undefined}
      icon={FileStack}
      tone="info"
      viewAll={{ to: drill.documents() }}
      state={state(query, statuses.length === 0)}
      skeleton={<SkeletonRows rows={5} />}
      emptyIcon={FileStack}
      emptyTitle="No documents yet"
      emptyDescription="Receipts, issues and transfers posted this financial year appear here by status."
      footer={
        pending.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-gray-400">Open pending:</span>
            {pending.map((p) => (
              <Link key={p.key} to={p.to ?? '#'} className="font-semibold text-gray-700 hover:text-primary">
                {p.label} <span className="tabular-nums">{p.display}</span>
              </Link>
            ))}
          </div>
        ) : (
          <span className="text-gray-400">No open challans, deferred receipts or job work.</span>
        )
      }
    >
      <>
        {failed > 0 ? (
          <Link
            to={drill.documents({ status: 'FAILED' })}
            className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-red-100 bg-red-50/60 px-2.5 py-1.5 text-xs text-red-700 hover:border-red-200 transition-colors"
          >
            <span className="font-semibold">{plural(failed, 'posting')} failed</span>
            <span className="text-red-600/80">Review and repost →</span>
          </Link>
        ) : null}
        <BarList items={statuses} />
        {/* What was actually raised, not merely where it got stuck — the old
            dashboard's "Posted, by type" card, which the payload still sends. */}
        {postedTypes.length > 0 ? (
          <div className="mt-3 border-t border-gray-100 pt-2">
            <SectionLabel>Posted, by type</SectionLabel>
            <BarList items={postedTypes} />
          </div>
        ) : null}
      </>
    </WidgetCard>
  )
}

// ---------------------------------------------------------------------------
// Books integration
// ---------------------------------------------------------------------------

export function IntegrationWidget({ query }: { query: Loadable<DashboardData> }) {
  const data = query.data
  const outbox = outboxSeries(data?.integration.outbox)
  const inbound = inboundSeries(data?.integration.inbound)
  const revisions = data?.integration.unacknowledged_revisions
  const recalcs = data?.integration.recalculations_in_progress ?? 0

  return (
    <WidgetCard
      title="Books integration"
      description="Events both ways, revisions and recalculations"
      icon={Send}
      tone="teal"
      viewAll={{ to: drill.outbox() }}
      state={state(query, outbox.length === 0 && inbound.length === 0 && !revisions?.count && recalcs === 0)}
      skeleton={<SkeletonRows rows={4} />}
      emptyIcon={Send}
      emptyTitle="Nothing queued for Books"
      emptyDescription="Posted documents raise outbox events here on their way to Books."
      footer={
        data ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link to={drill.revisions()} className="hover:text-primary">
              Unacknowledged revisions:{' '}
              <span className={`font-semibold ${revisions?.count ? 'text-amber-600' : 'text-gray-700'}`}>
                {formatCount(revisions?.count ?? 0)}
              </span>
              {revisions?.count ? (
                <span className="text-gray-400"> (Δ {formatMoney(revisions.delta_total)})</span>
              ) : null}
            </Link>
            <Link to={drill.recalculations(recalcs > 0 ? RECALC_IN_PROGRESS : null)} className="hover:text-primary">
              Recalculations running:{' '}
              <span className={`font-semibold ${recalcs > 0 ? 'text-sky-600' : 'text-gray-700'}`}>
                {formatCount(recalcs)}
              </span>
            </Link>
          </div>
        ) : null
      }
    >
      <>
        <SectionLabel>Outbound to Books</SectionLabel>
        <BarList items={outbox} />
        {/* The sync is two-way: a widget showing only the outbox reports half
            the health of it. Inbound events have no screen of their own, so
            these are figures rather than links. */}
        {inbound.length > 0 ? (
          <div className="mt-3 border-t border-gray-100 pt-2">
            <SectionLabel>Inbound from Books</SectionLabel>
            <BarList items={inbound} />
          </div>
        ) : null}
      </>
    </WidgetCard>
  )
}

// ---------------------------------------------------------------------------
// Last reconciliation with Books
// ---------------------------------------------------------------------------

const RUN_TONE: Record<string, BadgeTone> = {
  COMPLETED: 'success',
  FAILED: 'danger',
  BOOKS_UNAVAILABLE: 'warning',
  RUNNING: 'info',
  QUEUED: 'info',
}

function differenceTone(difference: number): BadgeTone {
  if (Math.abs(difference) < 0.005) return 'success'
  if (Math.abs(difference) < 1) return 'warning'
  return 'danger'
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-xs uppercase tracking-wide text-gray-400 truncate">{label}</dt>
      <dd className={`tabular-nums truncate ${strong ? 'text-sm font-bold text-gray-900' : 'text-xs text-gray-700'}`}>
        {value}
      </dd>
    </div>
  )
}

export function ReconciliationWidget({ query }: { query: Loadable<DashboardData> }) {
  const data = query.data
  const run: DashboardReconciliationRun | null = data?.last_reconciliation ?? null
  const difference = Number(run?.difference ?? 0)

  return (
    <WidgetCard
      title="Reconciliation with Books"
      description={run ? `Run ${formatDateTime(run.created_at)}` : 'Inventory closing value vs the Books stock ledger'}
      icon={Scale}
      tone="slate"
      viewAll={run ? { to: drill.reconciliationRun(run.run_id), label: 'Open run' } : { to: drill.reconciliationRuns() }}
      state={state(query, run === null)}
      skeleton={<SkeletonRows rows={3} />}
      emptyIcon={Scale}
      emptyTitle="Not reconciled yet"
      emptyDescription="No reconciliation run exists for this financial year. Run one to prove Inventory and Books agree."
      footer={
        run ? (
          <div className="flex items-center justify-between gap-2">
            <span>As at {formatDate(run.as_of_date)}</span>
            <Badge tone={differenceTone(difference)} size="xs">
              {Math.abs(difference) < 0.005 ? 'In agreement' : `Out by ${formatMoney(Math.abs(difference))}`}
            </Badge>
          </div>
        ) : null
      }
    >
      {run ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge tone={RUN_TONE[run.status] ?? 'neutral'} size="xs">
              {run.status.replace(/_/g, ' ')}
            </Badge>
            <span className="text-label-md text-gray-400 truncate">Run #{run.run_id}</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Figure label="Inventory value" value={formatCurrencyCompact(run.inventory_closing_value)} strong />
            <Figure label="Books ledger" value={formatCurrencyCompact(run.books_stock_ledger_balance)} strong />
            <Figure label="Inventory qty" value={formatQty(run.inventory_closing_qty)} />
            <Figure label="Difference" value={formatMoney(run.difference)} />
          </dl>
        </div>
      ) : null}
    </WidgetCard>
  )
}
