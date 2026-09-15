import { useEffect, useMemo, useRef, useState } from 'react'
import { Building2, Calendar, Check, ChevronDown, MapPin, Search } from 'lucide-react'
import { useCompany } from '../company/CompanyContext'
import { formatDate } from '../utils/format'
import { Badge } from '../ui/Badge'
import { Spinner } from '../ui/Spinner'
import { cx } from '../ui/cx'

/**
 * Company / financial year / branch switcher.
 *
 * Replaces the three bare `<select>`s of ContextSelectors with one control
 * that reads as a sentence — "Acme Ltd · FY 2025-26 · All branches" — because
 * the scope is the single most important thing on the screen: every figure
 * below it is meaningless without it.
 *
 * The selection logic is unchanged: it calls `selectCompany` / `selectFy` /
 * `selectBranch` exactly as before, and `bo_id === 0` still means consolidated.
 */
export function CompanySwitcher() {
  const {
    companies,
    cmpId,
    companyName,
    fyList,
    fyId,
    fy,
    branches,
    boId,
    branch,
    status,
    selectCompany,
    selectFy,
    selectBranch,
  } = useCompany()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const switching = status === 'loading'

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    const t = setTimeout(() => searchRef.current?.focus(), 30)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const filteredCompanies = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return companies
    return companies.filter((c) => c.name.toLowerCase().includes(q))
  }, [companies, query])

  const branchLabel = branch ? branch.name : 'All branches'
  const fyLabel = fy?.label ?? (fyId ? `FY #${fyId}` : 'FY')

  return (
    <div className="aic relative min-w-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cx(
          'inline-flex h-8 min-w-0 max-w-[22rem] items-center gap-2 rounded-lg border px-2.5 text-left transition-colors',
          open
            ? 'border-primary/40 bg-primary-light/50'
            : 'border-gray-200 bg-white hover:border-primary/40 hover:bg-primary-light/40',
        )}
      >
        <Building2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 truncate text-sm font-semibold text-gray-900">
          {companyName || 'Select company'}
        </span>
        <span className="hidden min-w-0 items-center gap-1.5 text-xs text-gray-500 sm:flex">
          <span className="text-gray-300">·</span>
          <span className="truncate">{fyLabel}</span>
          <span className="text-gray-300">·</span>
          <span className="truncate">{branchLabel}</span>
        </span>
        {switching ? <Spinner size="xs" /> : null}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Change scope"
          data-keyboard-overlay="true"
          className="absolute left-0 top-full z-50 mt-1.5 w-[min(34rem,calc(100vw-1.5rem))] animate-rise-in rounded-xl border border-gray-200 bg-white p-3 shadow-overlay"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <section className="min-w-0">
              <header className="mb-1.5 flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                <h3 className="text-label-xs font-semibold uppercase tracking-wide text-gray-500">
                  Company
                </h3>
              </header>
              {companies.length > 6 ? (
                <div className="relative mb-1.5">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
                    aria-hidden
                  />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find a company…"
                    aria-label="Find a company"
                    className="h-7 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-2 text-xs text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              ) : null}
              <ul className="max-h-56 space-y-0.5 overflow-auto scrollbar-thin pr-0.5">
                {filteredCompanies.map((c) => {
                  const active = c.cmpId === cmpId
                  return (
                    <li key={c.cmpId}>
                      <button
                        type="button"
                        onClick={() => {
                          selectCompany(c.cmpId)
                          setOpen(false)
                        }}
                        className={cx(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                          active
                            ? 'bg-primary-light font-semibold text-primary'
                            : 'text-gray-700 hover:bg-gray-50',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        {active ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                      </button>
                    </li>
                  )
                })}
                {filteredCompanies.length === 0 ? (
                  <li className="px-2 py-3 text-xs text-gray-500">No company matches.</li>
                ) : null}
              </ul>
            </section>

            <div className="min-w-0 space-y-3">
              <section>
                <header className="mb-1.5 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                  <h3 className="text-label-xs font-semibold uppercase tracking-wide text-gray-500">
                    Financial year
                  </h3>
                  {fy?.start && fy.end ? (
                    <span className="ml-auto text-[11px] tabular-nums text-gray-400">
                      {formatDate(fy.start)} – {formatDate(fy.end)}
                    </span>
                  ) : null}
                </header>
                <ul className="max-h-28 space-y-0.5 overflow-auto scrollbar-thin pr-0.5">
                  {fyList.length === 0 && fyId ? (
                    <li className="px-2 py-1.5 text-xs text-gray-500">
                      FY #{fyId} (list unavailable)
                    </li>
                  ) : null}
                  {fyList.map((f) => {
                    const active = f.fyId === fyId
                    return (
                      <li key={f.fyId}>
                        <button
                          type="button"
                          disabled={switching}
                          onClick={() => selectFy(f.fyId)}
                          className={cx(
                            'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-60',
                            active
                              ? 'bg-primary-light font-semibold text-primary'
                              : 'text-gray-700 hover:bg-gray-50',
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">{f.label}</span>
                          {active ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>

              <section>
                <header className="mb-1.5 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                  <h3 className="text-label-xs font-semibold uppercase tracking-wide text-gray-500">
                    Branch
                  </h3>
                </header>
                <ul className="max-h-28 space-y-0.5 overflow-auto scrollbar-thin pr-0.5">
                  <li>
                    <button
                      type="button"
                      disabled={switching}
                      onClick={() => selectBranch(0)}
                      className={cx(
                        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-60',
                        boId === 0
                          ? 'bg-primary-light font-semibold text-primary'
                          : 'text-gray-700 hover:bg-gray-50',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">All branches</span>
                      <Badge tone="neutral" size="xs" className="normal-case">
                        Consolidated
                      </Badge>
                      {boId === 0 ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                    </button>
                  </li>
                  {branches.map((b) => {
                    const active = b.boId === boId
                    return (
                      <li key={b.boId}>
                        <button
                          type="button"
                          disabled={switching}
                          onClick={() => selectBranch(b.boId)}
                          className={cx(
                            'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-60',
                            active
                              ? 'bg-primary-light font-semibold text-primary'
                              : 'text-gray-700 hover:bg-gray-50',
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">{b.name}</span>
                          {b.isHeadOffice ? (
                            <Badge tone="info" size="xs" className="normal-case">
                              HO
                            </Badge>
                          ) : null}
                          {active ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default CompanySwitcher
