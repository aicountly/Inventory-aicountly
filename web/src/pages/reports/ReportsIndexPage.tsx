import { useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileSearch } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useReferenceData } from '../../documents/useReferenceData'
import { usePageKeyboard } from '../../keyboard/usePageKeyboard'
import { ReportCardSkeleton } from '../../reports/directory/ReportCard'
import { ReportSection } from '../../reports/directory/ReportSection'
import { ReportToolbar } from '../../reports/directory/ReportToolbar'
import { ReportsHero } from '../../reports/directory/ReportsHero'
import { CustomReportCard, ReportsTips } from '../../reports/directory/ReportsSidePanel'
import {
  CATEGORY_ORDER,
  REPORT_DIRECTORY,
  filterReports,
  reportsInCategory,
  toCategory,
} from '../../reports/directory/reportDirectory'
import type { ReportCategory } from '../../reports/directory/reportDirectory'
import { useReportFavorites } from '../../reports/directory/useReportFavorites'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorState } from '../../ui/ErrorState'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../ui/shell/PageShell'

/** Stable across renders — the favourites hook keys its storage read off it. */
const ALL_REPORT_IDS = REPORT_DIRECTORY.map((r) => r.id)

/**
 * The reports landing screen.
 *
 * A directory, not a report: nothing here fetches a row of stock. The only
 * request it depends on is the permission list every page already waits for,
 * so it paints as fast as the shell around it. Everything a reader does on it —
 * searching, narrowing to a shelf, choosing a warehouse to open reports for —
 * is held in the query string, which is what makes a tuned view something you
 * can bookmark, share, and come back to with the browser's back button.
 *
 * What it is NOT is a second reporting system. Every card opens the URL that
 * report already had; the titles, descriptions, icons and permissions come from
 * the configs that serve them (`reports/directory/reportDirectory.ts`).
 */
export function ReportsIndexPage() {
  const [params, setParams] = useSearchParams()
  const { can, loading, error, reload } = useAccess()
  const { warehouses } = useReferenceData()
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  usePageKeyboard({ searchInputRef })

  const search = params.get('q') ?? ''
  const category = toCategory(params.get('category'))
  const warehouseId = params.get('warehouse_id') ?? ''
  const favouritesOnly = params.get('favourites') === '1'

  // `replace` so that typing in the search box does not push a history entry
  // per keystroke — back should leave the page, not rewind the search.
  const update = useCallback(
    (patch: Record<string, string>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value)
            else next.delete(key)
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const { favourites, toggle } = useReportFavorites(ALL_REPORT_IDS)

  /* Permission first: a report the user may not read is removed, never shown
     as a locked tile that teases. The server enforces it either way. */
  const allowed = useMemo(() => REPORT_DIRECTORY.filter((r) => can(r.permission)), [can])

  const visible = useMemo(
    () => filterReports(allowed, { search, category, favouritesOnly, favourites }),
    [allowed, search, category, favouritesOnly, favourites],
  )

  const sections = useMemo(
    () =>
      CATEGORY_ORDER.map((c) => ({ category: c, reports: reportsInCategory(visible, c) })).filter(
        (s) => s.reports.length > 0,
      ),
    [visible],
  )

  const onViewAll = useCallback(
    (next: ReportCategory) => update({ category: next, favourites: '' }),
    [update],
  )
  const resetFilters = useCallback(
    () => update({ q: '', category: '', favourites: '', warehouse_id: '' }),
    [update],
  )

  const filtersApplied = Boolean(search) || category !== 'all' || favouritesOnly
  const sidePanel = (
    <aside className="grid content-start gap-3.5 sm:grid-cols-2 xl:grid-cols-1">
      <CustomReportCard />
      <ReportsTips />
    </aside>
  )

  /* The first shelf gets the full width — it is the widest and the one a reader
     lands on. The rest sit in a three-quarter column with the side panel beside
     them, which is what turns the empty half-row those shorter shelves would
     otherwise leave into something worth reading.

     It only earns the full width if it has the cards to fill one. Once a search
     or a filter has cut the page down, a full-width row holding one card is the
     same band of empty grid this layout exists to avoid, so everything moves
     into the narrow column and the panel rides alongside from the top. */
  const splitHead = sections.length > 1 && sections[0].reports.length >= 4
  const head = splitHead ? sections.slice(0, 1) : []
  const tail = splitHead ? sections.slice(1) : sections

  return (
    <PageShell>
      <div className="grid items-center gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.8fr)]">
        <BreadcrumbHeader
          breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Reports' }]}
          title="Reports"
          description="Get complete visibility of your inventory with powerful, accurate and exportable reports."
        />
        <ReportsHero />
      </div>

      <ReportToolbar
        search={search}
        onSearch={(value) => update({ q: value })}
        category={category}
        onCategory={(value) => update({ category: value === 'all' ? '' : value })}
        warehouseId={warehouseId}
        onWarehouse={(value) => update({ warehouse_id: value })}
        warehouses={warehouses}
        favouritesOnly={favouritesOnly}
        onToggleFavouritesOnly={() => update({ favourites: favouritesOnly ? '' : '1' })}
        searchInputRef={searchInputRef}
      />

      {error ? (
        <ErrorState
          title="Unable to load reports"
          description={error}
          onRetry={reload}
          retryLabel="Try again"
        />
      ) : loading ? (
        <div className="grid grid-cols-1 gap-3.5 pt-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <ReportCardSkeleton key={i} />
          ))}
        </div>
      ) : !allowed.length ? (
        <EmptyState
          icon={FileSearch}
          title="No reports are available for your access level"
          description="Reports are granted per report. Ask an administrator to give you access in Settings › Access."
        />
      ) : !visible.length ? (
        <div className="mx-auto w-full max-w-3xl space-y-4">
          <EmptyState
            icon={FileSearch}
            title="No reports found"
            description="Try another search term or reset your filters."
            action={
              <Button variant="secondary" onClick={resetFilters}>
                Reset filters
              </Button>
            }
          />
          {sidePanel}
        </div>
      ) : (
        <div className="space-y-6">
          {head.map((section) => (
            <ReportSection
              key={section.category}
              category={section.category}
              reports={section.reports}
              warehouseId={warehouseId}
              favourites={favourites}
              onToggleFavourite={toggle}
              onViewAll={category === 'all' && !filtersApplied ? onViewAll : undefined}
            />
          ))}

          <div className="grid gap-4 xl:grid-cols-4">
            <div className="min-w-0 space-y-6 xl:col-span-3">
              {tail.map((section) => (
                <ReportSection
                  key={section.category}
                  category={section.category}
                  reports={section.reports}
                  warehouseId={warehouseId}
                  favourites={favourites}
                  onToggleFavourite={toggle}
                  onViewAll={category === 'all' && !filtersApplied ? onViewAll : undefined}
                  width="narrow"
                />
              ))}
            </div>
            {sidePanel}
          </div>
        </div>
      )}
    </PageShell>
  )
}

export default ReportsIndexPage
