import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChartNoAxesCombined } from 'lucide-react'
import { useCompany } from '../../company/CompanyContext'
import { useScopeLabel } from '../../company/useScopeLabel'
import { Notice } from '../../components/Notice'
import { RequirePermission } from '../../components/RequirePermission'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { reconciliationApi } from '../../services/reconciliationApi'
import { Button } from '../../ui/Button'
import { Card, CardHeader } from '../../ui/Card'
import { EmptyState } from '../../ui/EmptyState'
import { Skeleton } from '../../ui/Skeleton'
import { cx } from '../../ui/cx'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { formatDate, formatInt, formatMoney } from '../../utils/format'
import { ReconciliationTabs } from './ReconciliationTabs'
import { ReconciliationTrend } from './ReconciliationTrend'
import { insights, trendPoints } from './reconciliationModel'

/** How far back the insights look. One request, newest first. */
const WINDOW = 50
const TREND_RUNS = 12

function Stat({
  label,
  value,
  hint,
  tone = 'default',
  loading,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'good' | 'warn' | 'bad'
  loading: boolean
}) {
  return (
    <Card padding="md" as="article">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-6 w-24" rounded="md" />
      ) : (
        <p
          className={cx(
            'mt-1.5 text-xl font-bold tabular-nums tracking-tight',
            tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : tone === 'bad' ? 'text-red-600' : 'text-gray-900',
          )}
        >
          {value}
        </p>
      )}
      {hint ? <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{hint}</p> : null}
    </Card>
  )
}

/**
 * Reconciliation health, counted — never modelled.
 *
 * Every figure here is arithmetic over the runs the API already returned: a
 * count, an average, a maximum, a difference between the last two. Nothing is
 * forecast, nothing is scored, and no accounting data leaves the app to be
 * summarised elsewhere. If it cannot be derived from the run rows on this page,
 * it is not on this page.
 */
export function ReconciliationInsightsPage() {
  const { scope } = useCompany()
  const scopeLabel = useScopeLabel()
  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null

  const list = useQuery(
    (signal) => reconciliationApi.runs({ limit: WINDOW, sort: 'as_of_date', order: 'desc' }, signal),
    [scopeKey],
    { enabled: scope !== null, resetKey: scopeKey },
  )
  const runs = list.data?.data ?? []
  const stats = useMemo(() => insights(runs), [runs])
  const trend = useMemo(() => trendPoints(runs, TREND_RUNS), [runs])
  const loading = list.loading && !list.data

  const movementHint =
    stats.movement === null
      ? 'Two completed runs are needed before a direction exists.'
      : stats.movement < 0
        ? 'The gap narrowed against the run before it.'
        : stats.movement > 0
          ? 'The gap widened against the run before it.'
          : 'Unchanged against the run before it.'

  return (
    <PageShell fullBleed>
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Inventory', to: '/' }, { label: 'Reconciliation', to: '/reconciliation' }, { label: 'Insights' }]}
        icon={ChartNoAxesCombined}
        title="Reconciliation Insights"
        description={`Counts and averages over the last ${WINDOW} runs on record — whether reconciliation health is improving or deteriorating, and which run to look at first.`}
        meta={<span className="text-[11px] text-gray-500">{scopeLabel}</span>}
        escBack={false}
        actions={
          <Button variant="secondary" size="md" onClick={list.reload} disabled={list.loading}>
            {list.loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      />

      <RequirePermission permission={P.reconciliationRead} what="reconciliation runs">
        <ReconciliationTabs />

        {list.error ? <Notice kind="error">{list.error.message}</Notice> : null}

        {!loading && runs.length === 0 ? (
          <Card padding="md">
            <EmptyState
              icon={ChartNoAxesCombined}
              title="Nothing to measure yet"
              description="Insights count the runs on record. Run a reconciliation and this screen fills itself in."
              action={<Link to="/reconciliation" className="text-sm font-semibold text-primary hover:underline">Go to runs →</Link>}
            />
          </Card>
        ) : (
          <>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                loading={loading}
                label="Runs completed"
                value={formatInt(stats.completed)}
                hint={`${formatInt(stats.booksUnavailable)} could not reach Books · ${formatInt(stats.failed)} failed`}
              />
              <Stat
                loading={loading}
                label="Runs with a material difference"
                value={formatInt(stats.withMaterialDifference)}
                tone={stats.withMaterialDifference > 0 ? 'warn' : 'good'}
                hint={`${formatInt(stats.agreed)} run${stats.agreed === 1 ? '' : 's'} agreed to the rupee. A difference of ₹1 or more is counted as material — the same threshold the run itself uses.`}
              />
              <Stat
                loading={loading}
                label="Average absolute difference"
                value={stats.averageAbsoluteDifference === null ? '—' : `₹ ${formatMoney(stats.averageAbsoluteDifference)}`}
                hint="Mean of |Inventory − Books| across completed runs where Books answered."
              />
              <Stat
                loading={loading}
                label="Latest difference"
                value={stats.latestDifference === null ? '—' : `₹ ${formatMoney(stats.latestDifference)}`}
                tone={stats.movement === null ? 'default' : stats.movement < 0 ? 'good' : stats.movement > 0 ? 'bad' : 'default'}
                hint={movementHint}
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-5">
              <Card padding="md" className="lg:col-span-3">
                <CardHeader
                  title="Inventory vs Books Trend"
                  description={`The last ${TREND_RUNS} completed runs, by accounting date`}
                />
                <ReconciliationTrend points={trend} />
              </Card>

              <Card padding="md" className="lg:col-span-2">
                <CardHeader title="Worth looking at first" description="Derived from the runs above, nothing else" />
                {loading ? (
                  <div className="space-y-2" aria-hidden>
                    <Skeleton className="h-10 w-full" rounded="lg" />
                    <Skeleton className="h-10 w-full" rounded="lg" />
                  </div>
                ) : (
                  <ul className="m-0 list-none space-y-3 p-0 text-sm">
                    <li>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Largest variance</p>
                      {stats.largestDifference ? (
                        <p className="mt-0.5 text-gray-800">
                          <Link to={`/reconciliation/${stats.largestDifference.run_id}`} className="font-semibold text-primary">
                            Run #{stats.largestDifference.run_id}
                          </Link>{' '}
                          as at {formatDate(stats.largestDifference.as_of_date)} — ₹{' '}
                          {formatMoney(stats.largestDifference.difference)}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-gray-500">No completed run with a Books balance yet.</p>
                      )}
                    </li>
                    <li>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Unfinished postings</p>
                      <p className="mt-0.5 text-gray-800">
                        A gap is usually a posting that has not finished.{' '}
                        <Link to="/reconciliation/posting-status" className="font-semibold text-primary">
                          Pending adjustments
                        </Link>{' '}
                        names the vouchers, and the{' '}
                        <Link to="/integration/outbox" className="font-semibold text-primary">
                          audit trail
                        </Link>{' '}
                        shows what Inventory has told Books.
                      </p>
                    </li>
                    <li>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Runs Books could not answer</p>
                      <p className="mt-0.5 text-gray-800">
                        {formatInt(stats.booksUnavailable)} of the last {formatInt(runs.length)} runs reached Inventory
                        but not Books. Those runs report no difference at all — they are not a zero.
                      </p>
                    </li>
                  </ul>
                )}
              </Card>
            </div>
          </>
        )}
      </RequirePermission>
    </PageShell>
  )
}

export default ReconciliationInsightsPage
