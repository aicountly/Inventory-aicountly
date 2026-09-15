import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Kbd } from '../../ui/Kbd'
import { cx } from '../../ui/cx'
import { SEQUENCES_CHANGED_EVENT, readSequencesEnabled, sequenceLabel } from '../../keyboard/sequences'
import { DASHBOARD_VIEWS, dashboardPath } from '../views'
import type { DashboardView, DashboardViewId } from '../views'

/**
 * The five dashboard tabs.
 *
 * Real links, not buttons: the URL is the source of truth for which dashboard
 * is open, so back, forward, reload, middle-click and "copy link address" all
 * do the obvious thing. `preserve` carries the filters that survive a tab
 * change (the as-at date, the warehouse) into the next dashboard's URL, so
 * moving between them does not silently re-scope the figures.
 *
 * The sequence badge is drawn only when sequences are actually ON: a `G 1` on a
 * tab whose shortcut the user has disabled is a promise the app will not keep.
 */
export interface DashboardTabsProps {
  active: DashboardViewId
  /** Only the dashboards this user may open — a tab they cannot use is not drawn. */
  views: readonly DashboardView[]
  preserve?: Record<string, string | number | undefined>
  className?: string
}

export function DashboardTabs({ active, views, preserve, className }: DashboardTabsProps) {
  const [sequencesOn, setSequencesOn] = useState(readSequencesEnabled)

  useEffect(() => {
    const onChange = () => setSequencesOn(readSequencesEnabled())
    window.addEventListener(SEQUENCES_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(SEQUENCES_CHANGED_EVENT, onChange)
  }, [])

  // One tab left is not a choice; drawing a tab bar around it is chrome for its
  // own sake. The heading already says which dashboard this is.
  if (views.length <= 1) return null

  return (
    <nav
      aria-label="Inventory dashboards"
      className={cx('flex gap-1 overflow-x-auto border-b border-gray-200 scrollbar-thin print:hidden', className)}
    >
      {views.map((view) => {
        const isActive = view.id === active
        const badge = DASHBOARD_VIEWS.find((v) => v.id === view.id)?.sequence
        return (
          <Link
            key={view.id}
            to={dashboardPath(view.id, preserve)}
            aria-current={isActive ? 'page' : undefined}
            title={sequencesOn && badge ? `${view.label} — ${sequenceLabel(badge)}` : view.label}
            className={cx(
              'inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm no-underline transition-colors',
              isActive
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900',
            )}
          >
            <view.icon className="h-4 w-4" aria-hidden />
            {view.label}
            {sequencesOn && badge ? (
              <Kbd className="hidden lg:inline-flex">{badge.map((k) => k.toUpperCase()).join(' ')}</Kbd>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}

export default DashboardTabs
