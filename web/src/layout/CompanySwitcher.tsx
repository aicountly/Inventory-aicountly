import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Building2, Calendar, Check, ChevronDown, MapPin, Search, Star } from 'lucide-react'
import { useCompany } from '../company/CompanyContext'
import { writeSelection } from '../company/companyStorage'
import { readPinnedCompanies, togglePinnedCompany } from '../company/pinnedCompanies'
import { getManageApiOrigin } from '../services/appLauncher'
import { formatDate } from '../utils/format'
import { notify } from '../ui/notify'
import { Badge } from '../ui/Badge'
import { Select } from '../ui/Select'
import { Spinner } from '../ui/Spinner'
import { cx } from '../ui/cx'

/**
 * Company switcher and financial year / branch switcher.
 *
 * Two independent controls side by side, matching the pattern Books uses
 * (`books-react-app/web/src/components/CompanySwitcher.jsx`): a company
 * button that opens a searchable list, and — separated by a divider — a
 * context button that opens the financial year and branch. They used to be
 * one combined popover; splitting them is what "match the layout" asked for,
 * and it also means switching only the branch does not require scrolling past
 * a whole company list to get there.
 *
 * Two differences from Books are deliberate, not oversights:
 *
 *  - **No full-page reload.** Books applies a FY/branch change by writing
 *    localStorage and calling `window.location.reload()`. Inventory's
 *    `selectFy` / `selectBranch` already update React state and every scoped
 *    query refetches on its own — a reload here would be a regression, not a
 *    match.
 *  - **"Save as default" has nothing left to do.** `selectCompany` /
 *    `selectFy` / `selectBranch` already call `writeSelection` on every
 *    change (`company/companyStorage.ts`), so the current scope is ALWAYS
 *    already what reopens next time — there is no separate "live" vs "saved"
 *    state the way Books has via its server-side `userDefaultsApi`. The
 *    button is kept, because the visual reassurance is worth it, but it is
 *    honest about what it does: it re-confirms the current selection and
 *    says so, rather than pretending to unlock a capability that was not
 *    already active.
 *
 * The dropdowns are plain `position: absolute` panels, not portals — that is
 * fine as long as no ancestor between here and the page root clips overflow.
 * See the comment in `AppTopbar.tsx` on why that ancestor must never carry
 * `overflow: hidden` again.
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

  const [companyOpen, setCompanyOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pinned, setPinned] = useState<ReadonlySet<number>>(() => readPinnedCompanies())

  const companyRef = useRef<HTMLDivElement>(null)
  const contextRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const switching = status === 'loading'

  // One listener pair for both popovers: each closes on a click outside
  // itself, and Escape closes whichever is open — matching every other
  // overlay in the app (CommandPalette, UserMenu).
  useEffect(() => {
    if (!companyOpen && !contextOpen) return undefined
    const onDown = (e: MouseEvent) => {
      if (companyOpen && !companyRef.current?.contains(e.target as Node)) setCompanyOpen(false)
      if (contextOpen && !contextRef.current?.contains(e.target as Node)) setContextOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setCompanyOpen(false)
        setContextOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [companyOpen, contextOpen])

  useEffect(() => {
    if (!companyOpen) {
      setQuery('')
      return undefined
    }
    const t = setTimeout(() => searchRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [companyOpen])

  const filteredCompanies = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q ? companies.filter((c) => c.name.toLowerCase().includes(q)) : companies
    // Pinned first; stable otherwise, so the list does not reshuffle itself
    // under the pointer the moment something is pinned.
    return [...base].sort((a, b) => Number(pinned.has(b.cmpId)) - Number(pinned.has(a.cmpId)))
  }, [companies, query, pinned])

  const branchLabel = branch ? branch.name : 'All branches'
  const fyLabel = fy?.label ?? (fyId ? `FY #${fyId}` : 'FY')
  const contextSummary = `${fyLabel} · ${branchLabel}`

  const saveAsDefault = () => {
    if (cmpId === null || fyId === null) return
    // Already true before this click — see the module comment. This just
    // re-states it and gives the user a moment of visible confirmation.
    writeSelection({ cmpId, fyId, boId })
    notify.success(`Saved as your default: ${companyName} · ${contextSummary}`)
    setContextOpen(false)
  }

  return (
    <div className="aic flex min-w-0 items-center gap-1">
      {/* `flex min-w-0` on the wrapper, not just `relative min-w-0`: the
          button inside is a normal block child, not a flex item of anything,
          so on its own it sizes by shrink-to-fit against this box's width —
          which measurably does NOT track this div's own flex-shrunk width in
          a nested-flex squeeze (verified: at 390px this div correctly shrinks
          to ~65px while its plain-block button child kept rendering at its
          max-width of 130px, overflowing straight into the button next to
          it). Making the button an actual flex item of a `flex` parent puts
          it under real flexbox shrink rules, where `min-w-0` on the button
          is honoured against the space this div was actually given. */}
      <div className="relative flex min-w-0" ref={companyRef}>
        <button
          type="button"
          onClick={() => {
            setContextOpen(false)
            setCompanyOpen((v) => !v)
          }}
          aria-haspopup="dialog"
          aria-expanded={companyOpen}
          title={companyName || 'Select company'}
          className={cx(
            'inline-flex h-8 min-w-0 max-w-[10rem] items-center gap-1.5 rounded-lg border px-2.5 text-left transition-colors sm:max-w-[16rem]',
            companyOpen
              ? 'border-primary/40 bg-primary-light/50'
              : 'border-gray-200 bg-white hover:border-primary/40 hover:bg-primary-light/40',
          )}
        >
          <Building2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 truncate text-sm font-semibold text-gray-900">
            {companyName || 'Select company'}
          </span>
          {switching ? <Spinner size="xs" /> : null}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
        </button>

        {companyOpen ? (
          <div
            role="dialog"
            aria-label="Switch company"
            data-keyboard-overlay="true"
            className="absolute left-0 top-full z-50 mt-1.5 flex max-h-[70vh] w-72 animate-rise-in flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-overlay"
          >
            <div className="shrink-0 border-b border-gray-100 p-2.5">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
                  aria-hidden
                />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search companies…"
                  aria-label="Search companies"
                  className="h-8 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            <ul className="min-h-0 flex-1 space-y-0.5 overflow-auto scrollbar-thin p-2">
              {filteredCompanies.map((c) => {
                const active = c.cmpId === cmpId
                const isPinned = pinned.has(c.cmpId)
                return (
                  <li key={c.cmpId}>
                    <button
                      type="button"
                      onClick={() => {
                        selectCompany(c.cmpId)
                        setCompanyOpen(false)
                      }}
                      // Explicit, rather than left to the star's nested
                      // aria-label bleeding into this button's computed name:
                      // without it, a screen reader would read this row as
                      // "Pin Acme Traders to top Acme Traders" instead of the
                      // company name.
                      aria-label={c.name}
                      className={cx(
                        'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                        active
                          ? 'bg-primary-light font-semibold text-primary'
                          : 'text-gray-700 hover:bg-gray-50',
                      )}
                    >
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation()
                          setPinned(togglePinnedCompany(c.cmpId))
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          e.preventDefault()
                          e.stopPropagation()
                          setPinned(togglePinnedCompany(c.cmpId))
                        }}
                        title={isPinned ? 'Unpin' : 'Pin to top'}
                        aria-label={isPinned ? `Unpin ${c.name}` : `Pin ${c.name} to top`}
                        className="shrink-0 rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <Star
                          className={cx(
                            'h-4 w-4',
                            isPinned ? 'fill-amber-400 text-amber-400' : 'text-gray-300 hover:text-amber-400',
                          )}
                          aria-hidden
                        />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {active ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                    </button>
                  </li>
                )
              })}
              {filteredCompanies.length === 0 ? (
                <li className="px-2 py-3 text-sm text-gray-500">No company matches.</li>
              ) : null}
            </ul>

            <div className="shrink-0 border-t border-gray-100 p-2">
              <a
                href={getManageApiOrigin()}
                target="_blank"
                rel="noreferrer"
                onClick={() => setCompanyOpen(false)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-primary no-underline hover:bg-primary-light"
              >
                Manage all companies
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </a>
            </div>
          </div>
        ) : null}
      </div>

      {cmpId !== null ? (
        <div className="relative flex min-w-0 border-l border-gray-200 pl-1" ref={contextRef}>
          <button
            type="button"
            onClick={() => {
              setCompanyOpen(false)
              setContextOpen((v) => !v)
            }}
            aria-haspopup="dialog"
            aria-expanded={contextOpen}
            disabled={switching}
            title={contextSummary}
            // The label text is hidden below `sm` (see the span) so the
            // company name gets the room instead — an explicit aria-label
            // keeps the button nameable for assistive tech either way,
            // rather than falling back to nothing once the span is gone.
            aria-label={`Financial year and branch: ${contextSummary}`}
            className={cx(
              'inline-flex h-8 min-w-0 max-w-[2.25rem] items-center justify-center gap-1 rounded-lg px-1.5 text-left text-xs text-gray-500 transition-colors disabled:opacity-60 sm:max-w-[13rem] sm:justify-start sm:px-2',
              contextOpen ? 'bg-primary-light/50 text-primary' : 'hover:bg-gray-100',
            )}
          >
            <Calendar className="h-3.5 w-3.5 shrink-0 sm:hidden" aria-hidden />
            <span className="hidden min-w-0 flex-1 truncate sm:inline">{contextSummary}</span>
            <ChevronDown className="hidden h-3.5 w-3.5 shrink-0 text-gray-400 sm:block" aria-hidden />
          </button>

          {contextOpen ? (
            <div
              role="dialog"
              aria-label="Change financial year and branch"
              data-keyboard-overlay="true"
              className="absolute left-0 top-full z-50 mt-1.5 w-72 animate-rise-in space-y-3 rounded-xl border border-gray-200 bg-white p-3 shadow-overlay"
            >
              <section>
                <label className="flex items-center gap-1.5 text-label-xs font-semibold uppercase tracking-wide text-gray-500">
                  <Calendar className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                  Financial year
                  {fy?.start && fy.end ? (
                    <span className="ml-auto font-normal normal-case tracking-normal text-gray-400">
                      {formatDate(fy.start)} – {formatDate(fy.end)}
                    </span>
                  ) : null}
                </label>
                <Select
                  className="mt-1.5 w-full"
                  value={fyId ?? ''}
                  disabled={switching || fyList.length === 0}
                  onChange={(e) => selectFy(Number(e.target.value))}
                  aria-label="Financial year"
                >
                  {fyList.length === 0 && fyId ? <option value={fyId}>FY #{fyId} (list unavailable)</option> : null}
                  {fyList.map((f) => (
                    <option key={f.fyId} value={f.fyId}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </section>

              <section>
                <label className="flex items-center gap-1.5 text-label-xs font-semibold uppercase tracking-wide text-gray-500">
                  <MapPin className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                  Branch
                </label>
                <Select
                  className="mt-1.5 w-full"
                  value={boId}
                  disabled={switching}
                  onChange={(e) => selectBranch(Number(e.target.value))}
                  aria-label="Branch"
                >
                  <option value={0}>All branches (consolidated)</option>
                  {branches.map((b) => (
                    <option key={b.boId} value={b.boId}>
                      {b.name}
                      {b.isHeadOffice ? ' (HO)' : ''}
                    </option>
                  ))}
                </Select>
                {branch?.isHeadOffice ? (
                  <Badge tone="info" size="xs" className="mt-1.5 normal-case">
                    Head office
                  </Badge>
                ) : null}
              </section>

              <button
                type="button"
                disabled={switching || cmpId === null || fyId === null}
                onClick={saveAsDefault}
                className="w-full rounded-lg border border-primary/30 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary-light disabled:opacity-60"
              >
                Save FY/branch as default
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default CompanySwitcher
