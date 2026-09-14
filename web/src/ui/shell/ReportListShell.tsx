import type { ReactNode } from 'react'
import { ReportCompactShell } from './ReportCompactShell'
import type { ReportCompactShellProps } from './ReportCompactShell'
import { SUMMARY_CARD_GRID, TOOLBAR_CARD } from '../../styles/designTokens'

export interface ReportListShellProps extends ReportCompactShellProps {
  /** Pinned filter row — rendered inside the shared toolbar card. */
  filters?: ReactNode
  /** Extra pinned row between the filters and the summary (view switches…). */
  toolbar?: ReactNode
  /** KPI cards above the table. */
  summary?: ReactNode
}

/**
 * The register layout: pinned header, filters, optional summary, then a table
 * area that takes the rest of the height.
 */
export function ReportListShell({
  filters,
  toolbar,
  summary,
  children,
  ...shell
}: ReportListShellProps) {
  return (
    <ReportCompactShell {...shell}>
      {filters ? <div className={TOOLBAR_CARD}>{filters}</div> : null}
      {toolbar ? <div className="shrink-0 print:hidden">{toolbar}</div> : null}
      {summary ? <div className={SUMMARY_CARD_GRID}>{summary}</div> : null}
      <div className="flex flex-col flex-1 min-h-0">{children}</div>
    </ReportCompactShell>
  )
}

export default ReportListShell
