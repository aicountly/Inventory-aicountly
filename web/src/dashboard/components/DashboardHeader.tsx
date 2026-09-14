import { RefreshCw } from 'lucide-react'
import { FILTER_LABEL_COMPACT } from '../../styles/designTokens'
import { greetingFor, relativeTimeFromNow } from '../formatters'
import { formatDate } from '../../utils/format'

/**
 * Greeting, scope line and the two controls that change what the page counts.
 *
 * The scope line is load-bearing, not decoration: every figure below is scoped
 * to this company / financial year / branch and computed as at this date, and a
 * user comparing the dashboard with a register needs to see which.
 */
export interface DashboardHeaderProps {
  userName?: string | null
  companyName: string
  fyLabel: string
  branchLabel: string
  asOf: string
  lastSyncedAt: number | null
  refreshing: boolean
  onRefresh: () => void
  nearExpiryDays: number
  nearExpiryChoices: readonly number[]
  onNearExpiryDays: (days: number) => void
}

export function DashboardHeader({
  userName,
  companyName,
  fyLabel,
  branchLabel,
  asOf,
  lastSyncedAt,
  refreshing,
  onRefresh,
  nearExpiryDays,
  nearExpiryChoices,
  onNearExpiryDays,
}: DashboardHeaderProps) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-lg md:text-xl font-bold text-gray-900 truncate">
          {greetingFor()}
          {userName ? `, ${userName}` : ''}
          <span aria-hidden className="ml-1">
            👋
          </span>
        </h1>
        <p className="text-xs text-gray-500 mt-0.5 truncate">
          <span className="font-semibold text-gray-600">{companyName || 'Company'}</span>
          {' · '}
          {fyLabel}
          {' · '}
          {branchLabel}
          {' · as at '}
          {formatDate(asOf)}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0 print:hidden">
        <div className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5">
          <span className={FILTER_LABEL_COMPACT}>Expiry window</span>
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
            {nearExpiryChoices.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onNearExpiryDays(d)}
                aria-pressed={d === nearExpiryDays}
                className={`rounded-md px-2 py-0.5 text-label-md font-semibold transition-colors ${
                  d === nearExpiryDays
                    ? 'bg-white text-primary shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-primary/40 hover:text-primary disabled:opacity-60 transition-colors"
          title="Reload every card"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">
            {refreshing ? 'Refreshing…' : `Synced ${relativeTimeFromNow(lastSyncedAt)}`}
          </span>
        </button>
      </div>
    </div>
  )
}

export default DashboardHeader
