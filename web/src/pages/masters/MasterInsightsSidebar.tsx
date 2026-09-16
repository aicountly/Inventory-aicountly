import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CircleCheck, History, Lightbulb, X } from 'lucide-react'
import { EmptyState } from '../../ui/EmptyState'
import { AIC, cx } from '../../ui/cx'
import { MasterHealthRing } from './MasterHealthRing'
import { formatRelativeTime } from './mastersOverview'
import type { MasterActivity, MasterHealth } from './mastersOverview'

/**
 * The contextual column beside the grid: how the master data is doing, what
 * changed lately, and one standing piece of advice.
 *
 * Both panels degrade rather than invent. The health card falls back to
 * "Configuration overview" and an em dash when no count could be read, and the
 * activity feed distinguishes three states that look alike if you conflate
 * them: still loading, nothing has happened, and this profile may not read the
 * audit trail.
 */

const TIP_KEY = 'inventory.masters.proTip.dismissed'

function readTipDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(TIP_KEY) === '1'
  } catch {
    return false
  }
}

function writeTipDismissed(): void {
  try {
    window.sessionStorage.setItem(TIP_KEY, '1')
  } catch {
    // Private mode / blocked storage — it still stays shut for this page view.
  }
}

function InsightCard({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={cx(AIC, 'rounded-xl border border-gray-200 bg-white p-4')}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  )
}

function LegendRow({ tone, label, value }: { tone: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', tone)} aria-hidden />
      <span className="flex-1 truncate text-gray-500">{label}</span>
      <strong className="shrink-0 font-semibold tabular-nums text-gray-900">{value}</strong>
    </div>
  )
}

function MasterHealthCard({ health }: { health: MasterHealth }) {
  return (
    <InsightCard title="Master Health">
      <div className="flex items-center gap-4">
        <MasterHealthRing health={health} />
        <div className="min-w-0 max-w-[15rem] flex-1 space-y-2">
          <LegendRow tone="bg-primary" label="All good" value={health.good} />
          <LegendRow tone="bg-amber-500" label="Need review" value={health.review} />
          <LegendRow tone="bg-red-500" label="Missing setup" value={health.missing} />
        </div>
      </div>

      {health.message ? (
        <div
          className={cx(
            'mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-relaxed',
            health.missing > 0
              ? 'bg-red-50 text-red-700'
              : health.review > 0
                ? 'bg-amber-50 text-amber-700'
                : 'bg-primary-light/60 text-primary',
          )}
        >
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{health.message}</span>
        </div>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-gray-500">
          Configuration overview — no master could be counted with your current access.
        </p>
      )}
    </InsightCard>
  )
}

function ActivityRow({ activity, now }: { activity: MasterActivity; now: number }) {
  const Icon = activity.icon
  const when = formatRelativeTime(activity.createdAt, now)
  const row = (
    <>
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-light/60 text-primary">
        {Icon ? <Icon className="h-4 w-4" aria-hidden /> : <History className="h-4 w-4" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-gray-900">{activity.title}</span>
        <span className="block truncate text-xs text-gray-500">{activity.subject}</span>
      </span>
      {when ? (
        <time dateTime={activity.createdAt} className="shrink-0 text-[11px] text-gray-400">
          {when}
        </time>
      ) : null}
    </>
  )

  const className =
    'flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 no-underline transition-colors'

  return activity.to ? (
    <Link
      to={activity.to}
      className={cx(
        className,
        'hover:bg-primary-light/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      )}
    >
      {row}
    </Link>
  ) : (
    <div className={className}>{row}</div>
  )
}

function RecentMasterActivity({
  activity,
  readable,
  loading,
}: {
  activity: MasterActivity[]
  readable: boolean
  loading: boolean
}) {
  const now = Date.now()
  return (
    <InsightCard
      title="Recent Activity"
      action={
        readable ? (
          <Link
            to="/audit"
            className="inline-flex items-center gap-1 rounded-md text-xs font-semibold text-primary no-underline hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            View all
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : null
      }
    >
      {loading ? (
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2.5 px-1.5 py-1.5">
              <span className="skeleton h-8 w-8 rounded-lg" />
              <span className="flex-1 space-y-1">
                <span className="skeleton block h-3 w-24 rounded" />
                <span className="skeleton block h-3 w-16 rounded" />
              </span>
            </div>
          ))}
        </div>
      ) : !readable ? (
        <p className="text-xs leading-relaxed text-gray-500">
          Your profile cannot read the audit trail, so master activity is not shown here.
        </p>
      ) : activity.length === 0 ? (
        <EmptyState
          compact
          icon={History}
          title="No recent master activity."
          description="Changes to items, warehouses, units and the other masters will appear here."
        />
      ) : (
        <div className="-mx-1.5 space-y-0.5">
          {activity.map((entry) => (
            <ActivityRow key={entry.id} activity={entry} now={now} />
          ))}
        </div>
      )}
    </InsightCard>
  )
}

function MasterTip() {
  const [dismissed, setDismissed] = useState(readTipDismissed)
  if (dismissed) return null
  return (
    <section
      className={cx(
        AIC,
        'relative flex items-start gap-3 rounded-xl border border-primary/20 bg-primary-light/50 p-4',
      )}
    >
      <button
        type="button"
        onClick={() => {
          writeTipDismissed()
          setDismissed(true)
        }}
        aria-label="Dismiss tip"
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white/70 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-primary">
        <Lightbulb className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 pr-6">
        <strong className="block text-sm font-semibold text-gray-900">Pro tip</strong>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
          Keep your master data up to date for accurate reports and smoother operations.
        </p>
      </div>
    </section>
  )
}

export interface MasterInsightsSidebarProps {
  health: MasterHealth
  activity: MasterActivity[]
  activityReadable: boolean
  activityLoading: boolean
  className?: string
}

export function MasterInsightsSidebar({
  health,
  activity,
  activityReadable,
  activityLoading,
  className,
}: MasterInsightsSidebarProps) {
  return (
    <aside
      className={cx(
        // In the rail these stack; below `wide` the rail becomes a row across
        // the foot of the page, so the cards keep a readable width instead of
        // stretching into full-page bands.
        'grid content-start gap-3 sm:grid-cols-2 wide:grid-cols-1',
        className,
      )}
      aria-label="Master insights"
    >
      <MasterHealthCard health={health} />
      <RecentMasterActivity
        activity={activity}
        readable={activityReadable}
        loading={activityLoading}
      />
      <MasterTip />
    </aside>
  )
}

export default MasterInsightsSidebar
