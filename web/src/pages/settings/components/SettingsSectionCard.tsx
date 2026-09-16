import type { ReactNode } from 'react'
import { Card } from '../../../ui/Card'
import { AIC, cx } from '../../../ui/cx'

export interface SettingsSectionCardProps {
  /** The step number in the badge — the reading order of the page, not an id. */
  step: number
  title: string
  description: ReactNode
  /** Rendered at the right of the heading row (a count, a link). */
  action?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * One numbered group of settings.
 *
 * The number is decoration with a job: these three cards are read top to bottom the first time a
 * company is configured, and the badge is what says so without a paragraph explaining it.
 */
export function SettingsSectionCard({ step, title, description, action, children, className }: SettingsSectionCardProps) {
  return (
    <Card padding="none" className={cx('overflow-hidden', className)}>
      <div className="flex items-start gap-3 p-4">
        <span
          className={cx(
            AIC,
            'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-light text-sm font-bold text-primary',
          )}
          aria-hidden
        >
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[0.9375rem] font-semibold leading-snug text-gray-900">{title}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{description}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="border-t border-gray-100 p-4">{children}</div>
    </Card>
  )
}

export default SettingsSectionCard
