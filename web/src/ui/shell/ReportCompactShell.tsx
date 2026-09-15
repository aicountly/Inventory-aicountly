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
  const actions = (
    <>
      {showHint ? (
        <KeyboardShortcutHint
          keys={hintKeys}
          label={hintLabel}
          className="hidden xl:inline-flex"
        />
      ) : null}
      {headerActions}
    </>
  )

  return (
    <PageShell
      compact
      paddingBottom={false}
      className={cx('flex flex-col tall:h-[calc(100dvh-7rem)] tall:overflow-hidden', className)}
    >
      <BreadcrumbHeader
        breadcrumbs={breadcrumbs}
        title={title}
        description={description}
        icon={icon}
        actions={actions}
        toolbar={toolbar}
        backTo={backTo}
        compact
        className="shrink-0 print:hidden"
      />
      <div className="flex flex-col flex-1 min-h-0 gap-2">{children}</div>
    </PageShell>
  )
}

export default ReportCompactShell
