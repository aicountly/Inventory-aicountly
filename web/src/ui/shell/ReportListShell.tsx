import type { ReactNode } from 'react'
import { ReportCompactShell } from './ReportCompactShell'
import type { ReportCompactShellProps } from './ReportCompactShell'
import { REGISTER_KPI_GRID } from '../../styles/designTokens'

export interface ReportListShellProps extends ReportCompactShellProps {
  /**
   * The pinned filter panel, already carded by the caller.
   *
   * The shell lays out; it does not know what a register filter looks like.
   * Composition lives with the register (RegisterFilterCard) so this file stays
   * free of a dependency pointing back up at src/registers.
   */
  filters?: ReactNode
  /** Extra pinned row between the filters and the summary (view switches…). */
  toolbar?: ReactNode
  /** KPI cards above the table. */
  summary?: ReactNode
  /** The operational strip under the KPI cards. */
  insights?: ReactNode
}

/**
 * The register layout: pinned header, filters, KPI cards, the at-a-glance
 * strip, then a table area that takes the rest of the height.
 */
export function ReportListShell({
  filters,
  toolbar,
  summary,
  insights,
  children,
  ...shell
}: ReportListShellProps) {
  return (
    <ReportCompactShell {...shell}>
      {filters}
      {toolbar ? <div className="shrink-0 print:hidden">{toolbar}</div> : null}
      {summary ? <div className={REGISTER_KPI_GRID}>{summary}</div> : null}
      {insights}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </ReportCompactShell>
  )
}

export default ReportListShell
