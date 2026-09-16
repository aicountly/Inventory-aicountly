import type { ReactNode, RefObject } from 'react'
import type { LucideIcon } from 'lucide-react'
import { BreadcrumbHeader } from './BreadcrumbHeader'
import type { Crumb } from './BreadcrumbBar'
import { PageShell } from './PageShell'
import { KeyboardShortcutHint } from '../Kbd'
import { usePageKeyboard } from '../../keyboard/usePageKeyboard'
import { cx } from '../cx'

export interface ReportCompactShellProps {
  breadcrumbs?: readonly Crumb[]
  title: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  headerActions?: ReactNode
  /**
   * `compact` (the default) prints the breadcrumb trail, the toolbar and the
   * actions on one row — right for a register reached from the hub, where the
   * trail is how the reader knows where they are.
   *
   * `page` gives the screen a proper heading: title, description and actions,
   * with the breadcrumbs above. A top-level destination people work in all day
   * earns the two lines; `/documents` is one.
   */
  headerVariant?: 'compact' | 'page'
  /** `page` only: decoration beside the title, shown only at ≥1536px. */
  headerAside?: ReactNode
  toolbar?: ReactNode
  shortcutKeys?: readonly string[]
  shortcutLabel?: string
  backTo?: string
  className?: string
  searchInputRef?: RefObject<HTMLInputElement | null>
  onRefresh?: () => void
  onPrint?: () => void
  children?: ReactNode
}

/**
 * Viewport-bound report layout — header and filters pinned, the table flexing
 * to fill what is left. Port of
 * books-react-app/web/src/modules/reports/shared/ReportCompactShell.jsx.
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
  headerVariant = 'compact',
  headerAside,
  toolbar,
  shortcutKeys,
  shortcutLabel,
  backTo,
  className,
  searchInputRef,
  onRefresh,
  onPrint,
  children,
}: ReportCompactShellProps) {
  usePageKeyboard({ searchInputRef, onRefresh, onPrint })

  // Only advertise what is wired. A chip promising Ctrl+P on a page with no
  // print handler sends the reader to the browser's own dialog, which prints
  // the app's DOM instead of the sheet.
  const hintKeys = shortcutKeys ?? ['/', 'Ctrl+R', ...(onPrint ? ['Ctrl+P'] : []), 'Esc']
  const hintLabel = shortcutLabel ?? `Search · Refresh${onPrint ? ' · Print' : ''} · Back`

  const showHint = Boolean(onRefresh || onPrint || searchInputRef)
  const hint = showHint ? (
    <KeyboardShortcutHint keys={hintKeys} label={hintLabel} className="hidden xl:inline-flex" />
  ) : null

  // In `page` mode the hint drops under the title instead of competing with the
  // buttons. It is a reminder, not a control, and the action row is where the
  // reader's eye goes for something to press.
  const page = headerVariant === 'page'

  return (
    <PageShell
      compact
      paddingBottom={false}
      className={cx(
        'flex flex-col',
        page
          ? 'taller:h-[calc(100dvh-7rem)] taller:overflow-hidden'
          : 'tall:h-[calc(100dvh-7rem)] tall:overflow-hidden',
        className,
      )}
    >
      <BreadcrumbHeader
        breadcrumbs={breadcrumbs}
        title={title}
        description={description}
        icon={icon}
        meta={page ? hint : undefined}
        aside={page ? headerAside : undefined}
        actions={
          page ? (
            headerActions
          ) : (
            <>
              {hint}
              {headerActions}
            </>
          )
        }
        toolbar={page ? undefined : toolbar}
        backTo={backTo}
        compact={!page}
        className="shrink-0 print:hidden"
      />
      <div className="flex flex-col flex-1 min-h-0 gap-2">{children}</div>
    </PageShell>
  )
}

export default ReportCompactShell
