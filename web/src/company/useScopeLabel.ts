import { useCompany } from './CompanyContext'

/** `Acme Ltd · FY 2025-26 · All branches` for page subtitles. */
export function useScopeLabel(): string {
  const { companyName, fy, branch } = useCompany()
  return `${companyName || 'Company'} · ${fy?.label ?? 'FY'} · ${branch ? branch.name : 'All branches'}`
}
