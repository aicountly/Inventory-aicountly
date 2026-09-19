import type { ReactNode } from 'react'
import { ReportCompactShell } from './ReportCompactShell'
import type { ReportCompactShellProps } from './ReportCompactShell'
import { SUMMARY_CARD_GRID, TOOLBAR_CARD } from '../../styles/designTokens'

export interface ReportListShellProps extends ReportCompactShellProps {
  /** Pinned filter row — rendered inside the shared toolbar card. */
  filters?: ReactNode
  /**
   * Company · financial year · branch, pinned beside the filters.
   *
   * The compact header prints only the breadcrumb and the actions, so a
   * subtitle is not a place a reader can see this. In a multi-company,
   * multi-branch product the figures on a register mean nothing without it, and
   * the export already carries it — the screen should not be the one view that
   * makes you guess.
   */
  scope?: ReactNode
  /**
   * The filters node already IS a card — render it as given rather than wrapping
   * it in the shared toolbar card. The filter panel owns its own heading, chips
   * and grid, and a card inside a card draws two borders around one control set.
   */
  bareFilters?: boolean
  /** Extra pinned row between the filters and the summary (view switches…). */
  toolbar?: ReactNode
  /** KPI cards above the table. */
  summary?: ReactNode
  /**
   * The at-a-glance strip under the KPI cards.
   *
   * Counts and states read off the response the register already has — what
   * the rows say about the state of things, rather than what they sum to.
   */
  insights?: ReactNode
  /** Grid the KPI cards are laid out in. Defaults to the six-up strip. */
  summaryClassName?: string
  /**
   * The intelligence rail: a narrow column of cards to the right of the table.
   *
   * Below `xl` it stacks under the table rather than squeezing both into half a
   * viewport — at that width the table is already scrolling sideways and a 17rem
   * column beside it would cost the rows more than the rail is worth. Marked
   * `print:hidden`: the sheet carries the rows and the totals, not the commentary.
   */
  aside?: ReactNode
}

/**
 * The register layout: pinned header, filters, optional summary, then a table
 * area that takes the rest of the height.
 */
export function ReportListShell({
  filters,
  scope,
  bareFilters = false,
  toolbar,
  summary,
  summaryClassName,
  insights,
  aside,
  children,
  ...shell
}: ReportListShellProps) {
  return (
    <ReportCompactShell {...shell}>
      {bareFilters ? (
        filters ?? null
      ) : filters || scope ? (
        <div className={TOOLBAR_CARD}>
          {scope ? (
            <span className="text-xs font-semibold text-gray-500 whitespace-nowrap">{scope}</span>
          ) : null}
          {scope && filters ? <span className="h-4 w-px bg-gray-200" aria-hidden="true" /> : null}
          {filters}
        </div>
      ) : null}
      {toolbar ? <div className="shrink-0 print:hidden">{toolbar}</div> : null}
      {summary ? <div className={summaryClassName ?? SUMMARY_CARD_GRID}>{summary}</div> : null}
      {insights}
      {aside ? (
        <div className="flex flex-1 min-h-0 flex-col gap-3 xl:grid xl:grid-cols-[minmax(0,1fr)_17rem] xl:items-start xl:gap-3">
          <div className="flex min-w-0 flex-col">{children}</div>
          <aside
            aria-label="Stock intelligence"
            className="flex flex-col gap-2.5 print:hidden xl:min-w-0"
          >
            {aside}
          </aside>
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0">{children}</div>
      )}
    </ReportCompactShell>
  )
}

export default ReportListShell
