import { Link } from 'react-router-dom'
import { ArrowRight, Star } from 'lucide-react'
import { IconTile } from '../../ui/IconTile'
import { AIC, cx } from '../../ui/cx'
import { ReportPreview } from './ReportPreview'
import type { ReportDirectoryEntry } from './reportDirectory'

export interface ReportCardProps {
  report: ReportDirectoryEntry
  to: string
  favourite: boolean
  onToggleFavourite: (id: string) => void
}

/**
 * One report on the directory.
 *
 * The whole card is clickable, but it is not a clickable div and it is not a
 * link with buttons inside it — an anchor may not contain a button, and a card
 * that wrapped one would be invalid markup that browsers resolve however they
 * like. Instead the title is the link and its `::after` is stretched over the
 * card, so a pointer gets the whole surface while assistive technology and the
 * keyboard get exactly one link, named by the report. The star sits above that
 * overlay on its own z-index, which is also why clicking it cannot open the
 * report; the arrow is under it and purely decorative, because a second control
 * to the same destination would only be one more thing to tab past.
 */
export function ReportCard({ report, to, favourite, onToggleFavourite }: ReportCardProps) {
  const favouriteLabel = favourite
    ? `Remove ${report.title} from favourites`
    : `Add ${report.title} to favourites`

  return (
    <article
      className={cx(
        AIC,
        'group relative flex min-h-[11.5rem] flex-col rounded-xl border border-gray-200 bg-white p-4',
        'shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-overlay',
        'focus-within:ring-2 focus-within:ring-primary/30',
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <IconTile icon={report.icon} tone={report.tone} size="lg" />
        <button
          type="button"
          onClick={() => onToggleFavourite(report.id)}
          aria-label={favouriteLabel}
          title={favouriteLabel}
          className={cx(
            'relative z-10 -mr-1 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
            'hover:bg-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            favourite ? 'text-primary' : 'text-gray-300 hover:text-primary',
          )}
        >
          <Star className={cx('h-4 w-4', favourite && 'fill-current')} aria-hidden />
        </button>
      </div>

      <h3 className="mt-3 text-sm font-semibold leading-snug text-gray-900">
        <Link
          to={to}
          title={report.fullDescription}
          className={cx(
            'text-inherit no-underline transition-colors group-hover:text-primary',
            'after:absolute after:inset-0 after:rounded-xl after:content-[""]',
            'focus:outline-none',
          )}
        >
          {report.title}
        </Link>
      </h3>

      <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-gray-500">{report.blurb}</p>

      <div className="mt-auto flex items-end justify-between gap-3 pt-4">
        <ReportPreview kind={report.preview} tone={report.tone} />
        <span
          aria-hidden
          className={cx(
            'pointer-events-none inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200',
            'bg-gray-50 text-gray-600 transition-all duration-200',
            'group-hover:translate-x-0.5 group-hover:border-primary/30 group-hover:bg-primary-light group-hover:text-primary',
            'motion-reduce:transition-none motion-reduce:group-hover:translate-x-0',
          )}
        >
          <ArrowRight className="h-4 w-4" />
        </span>
      </div>
    </article>
  )
}

export default ReportCard

/**
 * A card-shaped placeholder.
 *
 * The directory cannot draw a card until it knows which reports this user may
 * read, and that answer arrives from `/v1/access/me` a moment after the page
 * mounts. Holding the exact geometry the cards will take keeps the grid from
 * jumping when it lands — and keeps the page from flashing "no reports found"
 * at someone who has ten.
 */
export function ReportCardSkeleton() {
  return (
    <div
      aria-hidden
      className={cx(
        AIC,
        'flex min-h-[11.5rem] flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-card',
      )}
    >
      <div className="flex items-start justify-between">
        <span className="skeleton h-12 w-12 rounded-xl" />
        <span className="skeleton h-4 w-4 rounded" />
      </div>
      <span className="skeleton mt-3 h-4 w-2/3 rounded" />
      <span className="skeleton mt-2.5 h-3 w-full rounded" />
      <span className="skeleton mt-1.5 h-3 w-4/5 rounded" />
      <div className="mt-auto flex items-end justify-between pt-4">
        <span className="skeleton h-8 w-24 rounded" />
        <span className="skeleton h-9 w-9 rounded-full" />
      </div>
    </div>
  )
}
