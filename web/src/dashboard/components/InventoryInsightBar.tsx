import { Link } from 'react-router-dom'
import { CheckCircle2, CircleDashed, RefreshCw } from 'lucide-react'
import { cx } from '../../ui/cx'
import { formatDateTime } from '../../utils/format'
import type { InsightChip } from '../valuationHealth'

/**
 * The foot of the dashboard: what the figures add up to, and how fresh they are.
 *
 * The chips are findings, not decoration — each is generated from a figure on
 * this page (valuationHealth.insightChips) and, where a register lists what is
 * behind it, links there. Nothing here compares against a previous period: no
 * source on this screen returns one, so a chip reading "dead stock down 8%"
 * would be a number this product cannot compute.
 */
export type SyncState = 'synced' | 'refreshing' | 'partial' | 'failed' | 'recalculating'

export interface InventoryInsightBarProps {
  chips: readonly InsightChip[]
  state: SyncState
  /** When the figures on screen landed. Null before the first load completes. */
  lastSyncedAt: number | null
  className?: string
}

const CHIP_TONE: Record<InsightChip['tone'], string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-700',
  info: 'border-sky-200 bg-sky-50 text-sky-700',
}

const STATE_LABEL: Record<SyncState, string> = {
  synced: 'Data is in sync',
  refreshing: 'Refreshing',
  partial: 'Some data unavailable',
  failed: 'Last refresh failed',
  recalculating: 'Valuation recalculation in progress',
}

const STATE_CLASS: Record<SyncState, string> = {
  synced: 'text-emerald-700',
  refreshing: 'text-gray-500',
  partial: 'text-amber-700',
  failed: 'text-red-700',
  recalculating: 'text-sky-700',
}

export function InventoryInsightBar({ chips, state, lastSyncedAt, className }: InventoryInsightBarProps) {
  const Icon = state === 'synced' ? CheckCircle2 : state === 'refreshing' || state === 'recalculating' ? RefreshCw : CircleDashed

  return (
    <div
      className={cx(
        'flex flex-col gap-2 border-t border-gray-200 pt-2.5 text-xs md:flex-row md:items-center md:justify-between',
        className,
      )}
    >
      <ul className="flex min-w-0 flex-wrap gap-1.5">
        {chips.map((chip) => {
          const cls = cx(
            'inline-flex min-h-[28px] items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
            CHIP_TONE[chip.tone],
          )
          return (
            <li key={chip.key}>
              {chip.to ? (
                <Link
                  to={chip.to}
                  className={cx(cls, 'no-underline transition-colors hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 print:hidden')}
                >
                  {chip.label}
                </Link>
              ) : (
                <span className={cls}>{chip.label}</span>
              )}
            </li>
          )
        })}
      </ul>

      {/* Polite, because it changes on every refresh and must not interrupt. */}
      <p
        aria-live="polite"
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500"
      >
        <span>
          {lastSyncedAt ? `Last updated ${formatDateTime(new Date(lastSyncedAt).toISOString())}` : 'Not loaded yet'}
        </span>
        <span className={cx('inline-flex items-center gap-1 font-semibold', STATE_CLASS[state])}>
          <Icon className={cx('h-3 w-3', (state === 'refreshing' || state === 'recalculating') && 'animate-spin')} aria-hidden />
          {STATE_LABEL[state]}
        </span>
      </p>
    </div>
  )
}

export default InventoryInsightBar
