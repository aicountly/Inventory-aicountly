import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { AIC, cx } from '../ui/cx'
import type { IconTone } from '../ui/IconTile'

export interface RegisterInsight {
  key: string
  /** The headline — a figure and what it counts. */
  label: ReactNode
  /** The line under it, which is where the scope caveat belongs. */
  hint?: ReactNode
  icon?: LucideIcon
  tone?: IconTone
}

export interface RegisterInsightSet {
  items: readonly RegisterInsight[]
  /** Right-hand closing remark. Omitted when it would not be true. */
  note?: ReactNode
}

/** Tints for the small square beside each insight. */
const TONE_STYLES: Partial<Record<IconTone, string>> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-emerald-500/10 text-emerald-600',
  warning: 'bg-amber-500/10 text-amber-600',
  danger: 'bg-red-500/10 text-red-600',
  info: 'bg-sky-500/10 text-sky-600',
  violet: 'bg-violet-500/10 text-violet-600',
  slate: 'bg-slate-500/10 text-slate-600',
  rose: 'bg-rose-500/10 text-rose-600',
  teal: 'bg-teal-500/10 text-teal-600',
}

/**
 * The operational read on what is currently on screen.
 *
 * Every figure here is derived from the response the register already has —
 * nothing is fetched for it and nothing is guessed. Where a register's endpoint
 * sends no aggregate (configs/pageSummary.ts), the count is of the rows served
 * and the hint under it says so, exactly as the KPI cards and the totals row
 * do. A strip that quietly reported "2 SKUs" over page 1 of 40 would be the
 * most confidently wrong element on the page.
 *
 * It is a summary of figures stated elsewhere, so it is `print:hidden`: the
 * sheet carries the KPI cards and the totals row, which are the record.
 */
export function RegisterInsightStrip({ items, note }: RegisterInsightSet) {
  if (!items.length) return null
  return (
    <section
      aria-label="At a glance"
      className={cx(
        AIC,
        'shrink-0 overflow-hidden rounded-2xl border border-primary/15 print:hidden',
        'bg-gradient-to-r from-primary/[0.04] via-primary/[0.07] to-primary/[0.03]',
      )}
    >
      <div className="flex flex-wrap items-stretch">
        {items.map((insight) => {
          const Icon = insight.icon
          return (
            <div
              key={insight.key}
              className="flex min-w-[10rem] flex-1 items-center gap-2.5 border-b border-primary/10 px-3.5 py-2.5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
            >
              {Icon ? (
                <span
                  className={cx(
                    'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                    TONE_STYLES[insight.tone ?? 'primary'] ?? TONE_STYLES.primary,
                  )}
                  aria-hidden
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
              ) : null}
              <span className="min-w-0 leading-tight">
                <span
                  className="block truncate text-xs font-semibold text-gray-800"
                  title={typeof insight.label === 'string' ? insight.label : undefined}
                >
                  {insight.label}
                </span>
                {insight.hint ? (
                  <span
                    className="mt-0.5 block truncate text-[11px] text-gray-500"
                    title={typeof insight.hint === 'string' ? insight.hint : undefined}
                  >
                    {insight.hint}
                  </span>
                ) : null}
              </span>
            </div>
          )
        })}
        {note ? (
          <div className="flex shrink-0 items-center px-3.5 py-2.5 text-right text-[11px] font-semibold leading-tight text-primary/80">
            <span className="w-full">{note}</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}

/** Matching placeholder, so the strip does not pop in under the KPI cards. */
export function RegisterInsightStripSkeleton() {
  return (
    <div
      aria-hidden
      className={cx(AIC, 'skeleton h-[3.75rem] shrink-0 rounded-2xl print:hidden')}
    />
  )
}

export default RegisterInsightStrip
