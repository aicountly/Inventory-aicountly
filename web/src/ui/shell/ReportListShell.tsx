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
  /** Extra pinned row between the filters and the summary (view switches…). */
  toolbar?: ReactNode
  /** KPI cards above the table. */
  summary?: ReactNode
  /** Replaces the default KPI grid — for a strip of four rather than six. */
  summaryClassName?: string
  /** Charts between the KPI cards and the table. See RegisterConfig.analytics. */
  analytics?: ReactNode
}

/**
 * The register layout: pinned header, filters, optional summary, then a table
 * area that takes the rest of the height.
 */
export function ReportListShell({
  filters,
  scope,
  toolbar,
  summary,
  summaryClassName,
  analytics,
  children,
  ...shell
}: ReportListShellProps) {
  return (
    <ReportCompactShell {...shell}>
      {filters || scope ? (
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
      {analytics ? <div className="shrink-0 print:hidden">{analytics}</div> : null}
      <div className="flex flex-col flex-1 min-h-0">{children}</div>
    </ReportCompactShell>
  )
}

export default ReportListShell
