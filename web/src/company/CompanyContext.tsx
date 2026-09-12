import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { errorMessage, isAbortError, setActiveScope } from '../services/api'
import type { CompanyScope } from '../services/api'
import { fetchAllCompanies, fetchCompanyInfo } from '../services/manage'
import { pickFyForDate } from './manageShapes'
import type { BranchOption, CompanyOption, FyOption } from './manageShapes'
import { readSelection, writeSelection } from './companyStorage'
import { todayIso } from '../utils/format'

/**
 * Selected company / financial year / branch for the whole app.
 *
 * Companies, FYs and branches are Manage's masters, read through the API relay.
 * The selection is remembered in localStorage and re-validated against the
 * lists on every load, and every API call is scoped through `setActiveScope`.
 * `bo_id` 0 means consolidated — all branches.
 */

export type CompanyStatus = 'loading' | 'ready' | 'empty' | 'error'

interface CompanyState {
  status: CompanyStatus
  /** Fatal: nothing can be shown until it is fixed (Manage unreachable on first load…). */
  error: string | null
  /** Non-fatal: shown as a banner (FY list could not be refreshed, using the remembered one). */
  warning: string | null
  companies: CompanyOption[]
  cmpId: number | null
  companyName: string
  fyList: FyOption[]
  branches: BranchOption[]
  fyId: number | null
  boId: number
}

export interface CompanyContextValue extends CompanyState {
  /** Null until the selection is complete. */
  scope: CompanyScope | null
  company: CompanyOption | null
  fy: FyOption | null
  /** ISO dates, '' when unknown. */
  fyRange: { from: string; to: string }
  /** Null when consolidated. */
  branch: BranchOption | null
  selectCompany: (cmpId: number) => void
  selectFy: (fyId: number) => void
  selectBranch: (boId: number) => void
  reload: () => void
}

const CompanyContext = createContext<CompanyContextValue | null>(null)

const INITIAL: CompanyState = {
  status: 'loading',
  error: null,
  warning: null,
  companies: [],
  cmpId: null,
  companyName: '',
  fyList: [],
  branches: [],
  fyId: null,
  boId: 0,
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CompanyState>(INITIAL)
  const [tick, setTick] = useState(0)

  // 1. Companies the user can open → pick the remembered one, else the first.
  useEffect(() => {
    const controller = new AbortController()
    setState((s) => ({ ...s, status: 'loading', error: null }))
    fetchAllCompanies(controller.signal)
      .then((companies) => {
        if (controller.signal.aborted) return
        if (companies.length === 0) {
          setState((s) => ({ ...s, status: 'empty', companies, cmpId: null }))
          return
        }
        const stored = readSelection()
        const remembered = companies.find((c) => c.cmpId === stored.cmpId)
        const chosen = remembered ?? companies[0]
        setState((s) => ({
          ...s,
          companies,
          cmpId: chosen.cmpId,
          companyName: chosen.name,
          status: 'loading',
        }))
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setState((s) => ({ ...s, status: 'error', error: errorMessage(err, 'Could not load your companies from Manage.') }))
      })
    return () => controller.abort()
  }, [tick])

  // 2. The company's financial years and branches → validate / pick FY and branch.
  const cmpId = state.cmpId
  useEffect(() => {
    if (!cmpId) return undefined
    const controller = new AbortController()
    fetchCompanyInfo(cmpId, controller.signal)
      .then((info) => {
        if (controller.signal.aborted) return
        const stored = readSelection()
        const sameCompany = stored.cmpId === cmpId
        const rememberedFy = sameCompany ? info.fyList.find((fy) => fy.fyId === stored.fyId) : undefined
        const fy = rememberedFy ?? pickFyForDate(info.fyList, todayIso())
        const rememberedBo = sameCompany && stored.boId !== null && (stored.boId === 0 || info.branches.some((b) => b.boId === stored.boId)) ? stored.boId : 0
        const fyId = fy?.fyId ?? null
        writeSelection({ cmpId, fyId, boId: rememberedBo })
        setState((s) => ({
          ...s,
          status: fyId ? 'ready' : 'error',
          error: fyId ? null : 'This company has no financial year in Manage yet. Create one there, then reload.',
          warning: null,
          companyName: info.name || s.companies.find((c) => c.cmpId === cmpId)?.name || s.companyName,
          fyList: info.fyList,
          branches: info.branches,
          fyId,
          boId: rememberedBo,
        }))
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        const stored = readSelection()
        const message = errorMessage(err, 'Could not load the company details from Manage.')
        if (stored.cmpId === cmpId && stored.fyId) {
          // Degraded: keep working on the remembered FY / branch.
          setState((s) => ({
            ...s,
            status: 'ready',
            error: null,
            warning: `${message} Using the remembered financial year and branch.`,
            fyList: [],
            branches: [],
            fyId: stored.fyId,
            boId: stored.boId ?? 0,
          }))
          return
        }
        setState((s) => ({ ...s, status: 'error', error: message }))
      })
    return () => controller.abort()
  }, [cmpId, tick])

  const company = useMemo(() => state.companies.find((c) => c.cmpId === state.cmpId) ?? null, [state.companies, state.cmpId])
  const fy = useMemo(() => state.fyList.find((f) => f.fyId === state.fyId) ?? null, [state.fyList, state.fyId])
  const branch = useMemo(() => (state.boId > 0 ? (state.branches.find((b) => b.boId === state.boId) ?? null) : null), [state.branches, state.boId])

  const scope = useMemo<CompanyScope | null>(() => {
    if (state.status !== 'ready' || !state.cmpId || !state.fyId) return null
    return { cmp_id: state.cmpId, fy_id: state.fyId, bo_id: state.boId, acs_type: company?.acsType ?? null }
  }, [state.status, state.cmpId, state.fyId, state.boId, company?.acsType])

  // Registered during render on purpose: children's effects run before this
  // provider's own effects would, and they must already see the right scope.
  setActiveScope(scope)

  const selectCompany = useCallback((next: number) => {
    setState((s) => {
      if (s.cmpId === next || !s.companies.some((c) => c.cmpId === next)) return s
      writeSelection({ cmpId: next, fyId: null, boId: null })
      return { ...s, cmpId: next, companyName: s.companies.find((c) => c.cmpId === next)?.name ?? '', status: 'loading', error: null, warning: null, fyList: [], branches: [], fyId: null, boId: 0 }
    })
  }, [])

  const selectFy = useCallback((next: number) => {
    setState((s) => {
      if (s.fyId === next || !s.fyList.some((f) => f.fyId === next)) return s
      writeSelection({ fyId: next })
      return { ...s, fyId: next }
    })
  }, [])

  const selectBranch = useCallback((next: number) => {
    setState((s) => {
      const valid = next === 0 || s.branches.some((b) => b.boId === next)
      if (s.boId === next || !valid) return s
      writeSelection({ boId: next })
      return { ...s, boId: next }
    })
  }, [])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  const value = useMemo<CompanyContextValue>(
    () => ({
      ...state,
      scope,
      company,
      fy,
      fyRange: { from: fy?.start ?? '', to: fy?.end ?? '' },
      branch,
      selectCompany,
      selectFy,
      selectBranch,
      reload,
    }),
    [state, scope, company, fy, branch, selectCompany, selectFy, selectBranch, reload],
  )

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>
}

export function useCompany(): CompanyContextValue {
  const ctx = useContext(CompanyContext)
  if (!ctx) throw new Error('useCompany must be used inside <CompanyProvider>')
  return ctx
}
