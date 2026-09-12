/**
 * Company / branch / financial-year truth, relayed from Manage through the
 * Inventory API (`/api/manage/*`, read-only — see ManageProxyController).
 */

import { api } from './api'
import { companyListTotal, parseBranchList, parseCompanyInfo, parseCompanyList } from '../company/manageShapes'
import type { BranchOption, CompanyInfo, CompanyOption } from '../company/manageShapes'

const PER_PAGE = 100
const MAX_PAGES = 20

/** Every company the signed-in user can open, across all Manage pages. */
export async function fetchAllCompanies(signal?: AbortSignal): Promise<CompanyOption[]> {
  const merged: CompanyOption[] = []
  const seen = new Set<number>()
  let reportedTotal: number | null = null

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await api.get<unknown>('manage/companies', {
      scope: false,
      signal,
      query: { filter: 'all', page, per_page: PER_PAGE },
    })
    const rows = parseCompanyList(body)
    if (reportedTotal === null) reportedTotal = companyListTotal(body, rows)
    for (const row of rows) {
      if (seen.has(row.cmpId)) continue
      seen.add(row.cmpId)
      merged.push(row)
    }
    if (rows.length === 0 || rows.length < PER_PAGE || merged.length >= reportedTotal) break
  }

  return merged
}

export async function fetchCompanyInfo(cmpId: number, signal?: AbortSignal): Promise<CompanyInfo> {
  const body = await api.get<unknown>('manage/companyinfo', { scope: false, signal, query: { comp_id: cmpId } })
  return parseCompanyInfo(body)
}

export async function fetchBranches(cmpId: number, signal?: AbortSignal): Promise<BranchOption[]> {
  const body = await api.get<unknown>('manage/branch/list', { scope: false, signal, query: { cmp_id: cmpId } })
  return parseBranchList(body)
}
