import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { errorMessage, isAbortError, setActiveScope } from '../services/api'
import type { CompanyScope } from '../services/api'
import { fetchAllCompanies, fetchCompanyInfo, fetchCompanyLogo } from '../services/manage'
import { pickFyForDate } from './manageShapes'
import type { BranchOption, CompanyOption, FyOption } from './manageShapes'
import { readSelection, writeSelection } from './companyStorage'
import {
  askedId,
  clearScopeParamsFromUrl,
  currentUrlScope,
  resolveRequestedBranch,
  resolveRequestedCompany,
  resolveRequestedFy,
  resolveUnreadableScope,
  scopeForCompany,
} from './urlScope'
import type { RequestedScope } from './urlScope'
import { todayIso } from '../utils/format'

/**
 * Selected company / financial year / branch for the whole app.
 *
 * Companies, FYs and branches are Manage's masters, read through the API relay.
 * Where the selection comes from, in order:
 *
 *  1. `cmp_id` / `fy_id` / `bo_id` on the URL — how Books hands a record over
 *     (see `urlScope.ts`). A scope the user cannot open is REFUSED: the app
 *     stays on the banner with nothing below it, because opening the link's
 *     page in the company they happen to be on would show a different record
 *     under the id it named. That swap is the whole defect this guards.
 *  2. The localStorage selection, re-validated against the lists.
 *  3. The first company, today's financial year, all branches.
 *
 * A URL scope is STICKY: the moment it is honoured it is written to
 * localStorage and taken out of the address bar, so a reload, a bookmark and
 * the next visit all stay on the company the link named instead of snapping
 * back to the one before it.
 *
 * Every API call is scoped through `setActiveScope`; `bo_id` 0 means
 * consolidated — all branches. Mounts inside the router (App.tsx), which is
 * what lets a refused link recover to the dashboard rather than reinterpreting
 * its record id in another company.
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
  /** Letterhead: registered office and GSTIN from Manage, logo as a data URL. */
  addressLines: string[]
  gstin: string
  logo: string | null
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
  addressLines: [],
  gstin: '',
  logo: null,
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CompanyState>(INITIAL)
  const [tick, setTick] = useState(0)

  // The address bar is read once, at the first render: a deep link is a
  // document load, and nothing inside Inventory builds a scoped link. It then
  // lives in a ref rather than in state, so consuming it never re-runs the
  // effects below; null means nothing was asked for, or it has been settled.
  const [askedOnArrival] = useState(currentUrlScope)
  const urlScope = useRef<RequestedScope | null>(askedOnArrival)

  /** True while the screen is refusing the company a link asked for. */
  const refusedCompany = useRef(false)

  // `useNavigate` is re-created on every navigation; the ref keeps the
  // selection callbacks below stable, so no consumer re-renders on a route
  // change just because this provider is inside the router.
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  /** Drop the link's request: the user, or the app, has settled the scope. */
  const forgetUrlScope = useCallback(() => {
    if (!urlScope.current) return
    urlScope.current = null
    clearScopeParamsFromUrl()
  }, [])

  // 1. Companies the user can open → the one the URL asked for, else the
  //    remembered one, else the first.
  useEffect(() => {
    const controller = new AbortController()
    setState((s) => ({ ...s, status: 'loading', error: null }))
    fetchAllCompanies(controller.signal)
      .then((companies) => {
        if (controller.signal.aborted) return
        if (companies.length === 0) {
          refusedCompany.current = false
          setState((s) => ({ ...s, status: 'empty', companies, cmpId: null }))
          return
        }
        const requested = resolveRequestedCompany(urlScope.current, companies)
        const unreadable = resolveUnreadableScope(urlScope.current)
        const refusal =
          requested.state === 'refused' ? requested.message : unreadable.state === 'refused' ? unreadable.message : null
        if (refusal) {
          // Refused, and the request is deliberately NOT consumed: the
          // parameters stay in the address bar so a reload refuses again
          // instead of quietly answering with the remembered company.
          refusedCompany.current = true
          setState((s) => ({
            ...s,
            companies,
            status: 'error',
            error: refusal,
            warning: null,
            cmpId: null,
            companyName: '',
            fyList: [],
            branches: [],
            fyId: null,
            boId: 0,
            addressLines: [],
            gstin: '',
            logo: null,
          }))
          return
        }
        refusedCompany.current = false
        const stored = readSelection()
        const askedCompany = requested.state === 'accepted' ? companies.find((c) => c.cmpId === requested.id) : undefined
        const remembered = companies.find((c) => c.cmpId === stored.cmpId)
        const chosen = askedCompany ?? remembered ?? companies[0]
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
        const asked = scopeForCompany(urlScope.current, cmpId)
        const askedFy = resolveRequestedFy(asked, info.name, info.fyList)
        const askedBo = resolveRequestedBranch(asked, info.name, info.branches)
        const stored = readSelection()
        const sameCompany = stored.cmpId === cmpId
        const rememberedFy = sameCompany ? info.fyList.find((fy) => fy.fyId === stored.fyId) : undefined
        const fy = rememberedFy ?? pickFyForDate(info.fyList, todayIso())
        const rememberedBo = sameCompany && stored.boId !== null && (stored.boId === 0 || info.branches.some((b) => b.boId === stored.boId)) ? stored.boId : 0
        const refusal = askedFy.state === 'refused' ? askedFy.message : askedBo.state === 'refused' ? askedBo.message : null

        if (refusal) {
          // The company is one of theirs, but the year or the branch the link
          // named is not one it has. Substituting another would answer a
          // different question under the same link, so the screen waits for a
          // deliberate pick — and, as above, the request is left in the URL.
          setState((s) => ({
            ...s,
            status: 'error',
            error: refusal,
            warning: null,
            companyName: info.name || s.companies.find((c) => c.cmpId === cmpId)?.name || s.companyName,
            fyList: info.fyList,
            branches: info.branches,
            fyId: fy?.fyId ?? null,
            boId: rememberedBo,
            addressLines: info.addressLines,
            gstin: info.gstin,
          }))
          return
        }

        const fyId = askedFy.state === 'accepted' ? askedFy.id : (fy?.fyId ?? null)
        const boId = askedBo.state === 'accepted' ? askedBo.id : rememberedBo
        writeSelection({ cmpId, fyId, boId })
        // Honoured, so it is now the remembered selection: sticky for the
        // reload, the bookmark and the next visit.
        if (asked) forgetUrlScope()
        setState((s) => ({
          ...s,
          status: fyId ? 'ready' : 'error',
          error: fyId ? null : 'This company has no financial year in Manage yet. Create one there, then reload.',
          warning: null,
          companyName: info.name || s.companies.find((c) => c.cmpId === cmpId)?.name || s.companyName,
          fyList: info.fyList,
          branches: info.branches,
          fyId,
          boId,
          addressLines: info.addressLines,
          gstin: info.gstin,
        }))
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        const message = errorMessage(err, 'Could not load the company details from Manage.')
        const asked = scopeForCompany(urlScope.current, cmpId)
        const askedFyId = asked ? askedId(asked.fy) : null
        if (asked && askedFyId !== null) {
          // Degraded, but nothing is being substituted. The company came from
          // the companies list, so it is theirs; the year and branch cannot be
          // checked while Manage is down, so the ones the link asked for are
          // used AS ASKED and the banner says so. Written through, so the next
          // visit is not back on the company this link replaced.
          const boId = askedId(asked.bo) ?? 0
          writeSelection({ cmpId, fyId: askedFyId, boId })
          forgetUrlScope()
          setState((s) => ({
            ...s,
            status: 'ready',
            error: null,
            warning: `${message} Using the financial year and branch the link asked for.`,
            fyList: [],
            branches: [],
            fyId: askedFyId,
            boId,
          }))
          return
        }
        const stored = readSelection()
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
  }, [cmpId, tick, forgetUrlScope])

  // 3. The letterhead logo. Its own request because it is bytes, not JSON, and
  //    because a company with no logo uploaded must not hold up the app.
  useEffect(() => {
    if (!cmpId) return undefined
    const controller = new AbortController()
    fetchCompanyLogo(cmpId, controller.signal).then((logo) => {
      if (!controller.signal.aborted) setState((s) => (s.cmpId === cmpId ? { ...s, logo } : s))
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

  // A pick from the switcher is the user overruling the link, so the request is
  // dropped for this visit and the next: the parameters leave the address bar
  // and what they pick is what is remembered.
  const selectCompany = useCallback(
    (next: number) => {
      const wasRefused = refusedCompany.current
      refusedCompany.current = false
      forgetUrlScope()
      setState((s) => {
        if (s.cmpId === next || !s.companies.some((c) => c.cmpId === next)) return s
        writeSelection({ cmpId: next, fyId: null, boId: null })
        return { ...s, cmpId: next, companyName: s.companies.find((c) => c.cmpId === next)?.name ?? '', status: 'loading', error: null, warning: null, fyList: [], branches: [], fyId: null, boId: 0, addressLines: [], gstin: '', logo: null }
      })
      if (wasRefused) {
        // Recovering from a refused company: the id in the path was that
        // company's, and under this one it is a different record — the very
        // swap the refusal exists to prevent. Recovery starts from the
        // dashboard rather than from someone else's number.
        navigateRef.current('/dashboard', { replace: true })
      }
    },
    [forgetUrlScope],
  )

  const selectFy = useCallback(
    (next: number) => {
      forgetUrlScope()
      setState((s) => {
        if (!s.fyList.some((f) => f.fyId === next)) return s
        if (s.fyId === next && s.status === 'ready') return s
        writeSelection({ fyId: next })
        // Clears a refused financial year: the pick is the answer the app was
        // waiting for, so the screen below the banner may render again.
        return { ...s, fyId: next, status: 'ready', error: null }
      })
    },
    [forgetUrlScope],
  )

  const selectBranch = useCallback(
    (next: number) => {
      forgetUrlScope()
      setState((s) => {
        const valid = next === 0 || s.branches.some((b) => b.boId === next)
        if (!valid) return s
        if (s.boId === next && s.status === 'ready') return s
        writeSelection({ boId: next })
        // Same as selectFy, except a company with no financial year at all is
        // still not something a branch can settle.
        return { ...s, boId: next, status: s.fyId ? 'ready' : s.status, error: s.fyId ? null : s.error }
      })
    },
    [forgetUrlScope],
  )

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
