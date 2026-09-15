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

/**
 * The company logo as a data URL, or null.
 *
 * A data URL and not a remote one: the print iframe is a fresh document that
 * may reach the print dialog before a network image has loaded, and a
 * letterhead that is sometimes there is worse than one that never is. Any
 * failure — no logo uploaded, Manage unreachable, an unreadable body — resolves
 * to null, because a missing logo must never stop a document printing.
 */
export async function fetchCompanyLogo(cmpId: number, signal?: AbortSignal): Promise<string | null> {
  try {
    const blob = await api.blob('manage/company/logo', { scope: false, signal, query: { comp_id: cmpId } })
    if (!blob.size || !blob.type.startsWith('image/')) return null

    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export async function fetchBranches(cmpId: number, signal?: AbortSignal): Promise<BranchOption[]> {
  const body = await api.get<unknown>('manage/branch/list', { scope: false, signal, query: { cmp_id: cmpId } })
  return parseBranchList(body)
}
