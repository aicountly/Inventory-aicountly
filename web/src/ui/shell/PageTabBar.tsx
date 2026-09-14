import { NavLink } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { SegmentedControl } from '../SegmentedControl'
import type { SegmentedOption } from '../SegmentedControl'
import { AIC, cx } from '../cx'

export interface PageTabBarProps<V extends string> {
  value: V
  onChange?: (value: V) => void
  options: readonly SegmentedOption<V>[]
  label?: ReactNode
  className?: string
}

/** State-driven page tabs — a thin wrapper over SegmentedControl. */
export function PageTabBar<V extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: PageTabBarProps<V>) {
  return (
    <SegmentedControl
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      className={cx('print:hidden', className)}
    />
  )
}

export interface RouteTab {
  label: ReactNode
  to: string
  end?: boolean
  icon?: LucideIcon
  badge?: ReactNode
}

/**
 * Route-driven tabs, for the sub-navigation of a section (Stock → Balances /
 * Ledger / Movements). Looks identical to the segmented control but each tab
 * is a real link, so the URL stays the source of truth.
 */
export function RouteTabBar({
  tabs,
  className,
  'aria-label': ariaLabel = 'Section',
}: {
  tabs: readonly RouteTab[]
  className?: string
  'aria-label'?: string
}) {
  return (
    <nav
      className={cx(AIC, 'inline-flex items-center bg-gray-100 rounded-lg p-0.5 print:hidden', className)}
      aria-label={ariaLabel}
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cx(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors no-underline',
              isActive
                ? 'bg-white shadow-sm text-primary'
                : 'text-gray-600 hover:text-gray-900',
            )
          }
        >
          {tab.icon ? <tab.icon className="w-3.5 h-3.5" aria-hidden /> : null}
          {tab.label}
          {tab.badge ? <span className="ml-0.5">{tab.badge}</span> : null}
        </NavLink>
      ))}
    </nav>
  )
}

export default PageTabBar
