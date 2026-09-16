import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ReactNode, RefObject } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowLeft, Search } from 'lucide-react'
import { BreadcrumbBar } from './BreadcrumbBar'
import type { Crumb } from './BreadcrumbBar'
import { PageShell } from './PageShell'
import { RegisterHero } from './RegisterHero'
import { Button } from '../Button'
import { focusPageSearch, usePageKeyboard } from '../../keyboard/usePageKeyboard'
import { usePageBackKeyboard } from '../../keyboard/usePageBackKeyboard'
import { resolveBackTarget } from '../../keyboard/resolveBackTarget'
import { AIC, cx } from '../cx'

export interface ReportCompactShellProps {
  breadcrumbs?: readonly Crumb[]
  title: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  headerActions?: ReactNode
  toolbar?: ReactNode
  backTo?: string
  className?: string
  searchInputRef?: RefObject<HTMLInputElement | null>
  onRefresh?: () => void
  onPrint?: () => void
  /** Right-hand slot in the hero row — the live-data badge on a register. */
  heroAside?: ReactNode
  children?: ReactNode
}

/**
 * Viewport-bound report layout — header and filters pinned, the table flexing
 * to fill what is left. Port of
 * books-react-app/web/src/modules/reports/shared/ReportCompactShell.jsx.
 *
 * The header is two rows, not one: the trail and the page's actions above, the
 * register's own identity below. The single-row version put a 16px heading in
 * the same line as six buttons, so the name of the screen read as one more
 * control; a reader arriving from a Books hand-off could not tell at a glance
 * which register they had landed on.
 *
 * Replication checklist for a new register or list page:
 *  1. Wrap in ReportCompactShell, or ReportListShell for the filters + KPI slots.
 *  2. Pin the filters in a `shrink-0` card (FilterBar / FILTER_CARD).
 *  3. Spread REPORT_TABLE_PROPS into SmartTable (sticky head, scrolling body,
 *     fill-available) so the header and the totals row stay on screen.
 *  4. Mark every piece of chrome `print:hidden`.
 *  5. Pass `searchInputRef`, `onRefresh` and `onPrint` so `/`, Ctrl+R and
 *     Ctrl+P do what they do on every other screen.
 *
 * The `tall:` breakpoint is deliberate: on a short viewport the page scrolls
 * normally rather than squeezing the table into a few rows.
 */
export function ReportCompactShell({
  breadcrumbs,
  title,
  description,
  icon,
  headerActions,
  toolbar,
  backTo,
  className,
  searchInputRef,
  onRefresh,
  onPrint,
  heroAside,
  children,
}: ReportCompactShellProps) {
  const navigate = useNavigate()
  usePageKeyboard({ searchInputRef, onRefresh, onPrint })
  // Esc → back. It used to be wired by BreadcrumbHeader, which this shell no
  // longer renders; losing it would have broken the one shortcut every
  // register shares with every form in the product.
  usePageBackKeyboard({ backTo, breadcrumbs })

  // Where Esc would go, so the visible Back button and the key agree. A button
  // that went somewhere else than the shortcut beside it is worse than none.
  const backTarget = resolveBackTarget({ backTo, breadcrumbs })

  // Same policy as `/`, from the same function, so the two cannot disagree.
  const focusSearch = useCallback(() => focusPageSearch(searchInputRef), [searchInputRef])

  return (
    <PageShell
      compact
      paddingBottom={false}
      className={cx('flex flex-col tall:h-[calc(100dvh-7rem)] tall:overflow-hidden', className)}
    >
      <div className={cx(AIC, 'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 print:hidden')}>
        <div className="min-w-0 shrink-0">
          {breadcrumbs?.length ? (
            <BreadcrumbBar items={breadcrumbs} homeTo="/dashboard" />
          ) : null}
        </div>
        {toolbar ? (
          <div className="flex min-w-[12rem] flex-1 flex-wrap items-center gap-2">{toolbar}</div>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {backTarget ? (
            <Button
              variant="secondary"
              size="sm"
              icon={ArrowLeft}
              onClick={() => navigate(backTarget)}
              kbd="Esc"
              title="Back"
            >
              Back
            </Button>
          ) : null}
          {searchInputRef ? (
            <Button
              variant="secondary"
              size="sm"
              icon={Search}
              onClick={focusSearch}
              kbd="/"
              title="Search this register"
            >
              Search
            </Button>
          ) : null}
          {headerActions}
        </div>
      </div>

      <RegisterHero
        icon={icon}
        title={title}
        description={description}
        aside={heroAside}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2">{children}</div>
    </PageShell>
  )
}

export default ReportCompactShell
