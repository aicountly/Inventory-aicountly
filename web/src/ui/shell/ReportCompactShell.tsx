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
  /**
   * Draw the icon, title and subtitle as a block above the breadcrumb row.
   *
   * The compact header spends its one line on the breadcrumb, the filters and
   * the actions, which is what a register that is a table wants. A register
   * that opens onto a workspace — several cards and a chart band before the
   * first row — wants to name itself first.
   */
  hero?: boolean
  /**
   * Let the page scroll rather than binding the table to the viewport.
   *
   * Default `true` keeps every existing register exactly as it is: header and
   * filters pinned, the table taking the rest of the height. Turn it off when
   * there is more above the table than a viewport can spare.
   */
  fill?: boolean
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
  hero = false,
  fill = true,
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
      className={cx(
        'flex flex-col',
        fill && 'tall:h-[calc(100dvh-7rem)] tall:overflow-hidden',
        className,
      )}
    >
      {hero ? (
        <ReportHero icon={icon} title={title} description={description} />
      ) : null}
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
      <div className={cx('flex flex-col gap-2', fill ? 'flex-1 min-h-0' : 'min-h-0')}>
        {children}
      </div>
    </PageShell>
  )
}

/**
 * The identity block: icon tile, page title, one line of what the page is for.
 *
 * Its own row above the breadcrumb bar rather than inside it, so the breadcrumb
 * keeps the actions on its line at every width and nothing has to be dropped to
 * fit. `print:hidden` because the exported sheet prints its own letterhead and
 * title — this is screen chrome.
 */
function ReportHero({
  icon: Icon,
  title,
  description,
}: {
  icon?: LucideIcon
  title: ReactNode
  description?: ReactNode
}) {
  return (
    <div className="flex items-start gap-3 shrink-0 print:hidden">
      {Icon ? (
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-light text-primary">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      ) : null}
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 sm:text-[22px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-gray-500 sm:text-[13px]">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export default ReportCompactShell
