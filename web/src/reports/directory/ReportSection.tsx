import { ArrowRight } from 'lucide-react'
import { AIC, cx } from '../../ui/cx'
import { ReportCard } from './ReportCard'
import { CATEGORY_LABELS, reportLink } from './reportDirectory'
import type { ReportCategory, ReportDirectoryEntry } from './reportDirectory'

export interface ReportSectionProps {
  category: ReportCategory
  reports: readonly ReportDirectoryEntry[]
  warehouseId: string
  favourites: ReadonlySet<string>
  onToggleFavourite: (id: string) => void
  /** Omit to hide "View all" — there is nothing to narrow to. */
  onViewAll?: (category: ReportCategory) => void
  /** Narrow sections sit beside the side panel and hold three across. */
  width?: 'full' | 'narrow'
}

const GRID: Record<'full' | 'narrow', string> = {
  full: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
  narrow: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
}

/** One shelf of the directory: a labelled heading, a count, and its cards. */
export function ReportSection({
  category,
  reports,
  warehouseId,
  favourites,
  onToggleFavourite,
  onViewAll,
  width = 'full',
}: ReportSectionProps) {
  if (!reports.length) return null

  return (
    <section className={cx(AIC, 'min-w-0')} aria-labelledby={`report-section-${category}`}>
      <header className="mb-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <div className="flex items-center gap-2.5">
          <span className="h-5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          <h2
            id={`report-section-${category}`}
            className="text-xs font-bold uppercase tracking-wider text-gray-600"
          >
            {CATEGORY_LABELS[category]} reports
          </h2>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>
            {reports.length} {reports.length === 1 ? 'report' : 'reports'}
          </span>
          {onViewAll ? (
            <button
              type="button"
              onClick={() => onViewAll(category)}
              className={cx(
                'inline-flex items-center gap-1 rounded border-0 bg-transparent p-0 font-semibold text-primary',
                'hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              )}
            >
              View all
              <ArrowRight className="h-3 w-3" aria-hidden />
            </button>
          ) : null}
        </div>
      </header>

      <div className={cx('grid gap-3.5', GRID[width])}>
        {reports.map((report) => (
          <ReportCard
            key={report.id}
            report={report}
            to={reportLink(report, warehouseId)}
            favourite={favourites.has(report.id)}
            onToggleFavourite={onToggleFavourite}
          />
        ))}
      </div>
    </section>
  )
}

export default ReportSection
