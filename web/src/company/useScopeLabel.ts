import { useCompany } from './CompanyContext'

/**
 * `Acme Ltd · FY 2025-26 · All branches` for page subtitles.
 *
 * The middle segment is a claim about the rows underneath it, and on a printed
 * sheet it is the only record of what was asked for. A register whose query
 * does not constrain the financial year passes the period it does cover, rather
 * than letting the selected FY speak for rows drawn from every year.
 */
export function useScopeLabel(period?: string): string {
  const { companyName, fy, branch } = useCompany()
  const periodLabel = period?.trim() || (fy?.label ?? 'FY')
  return `${companyName || 'Company'} · ${periodLabel} · ${branch ? branch.name : 'All branches'}`
}
