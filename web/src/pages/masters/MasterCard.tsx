import { Link } from 'react-router-dom'
import { ArrowRight, Clock3 } from 'lucide-react'
import { formatCount } from '../../dashboard/formatters'
import { AIC, cx } from '../../ui/cx'
import type { MasterDefinition } from './masterDefinitions'
import { formatRelativeTime } from './mastersOverview'
import type { MasterStat } from './mastersOverview'

/**
 * One master, as a card.
 *
 * The whole card is clickable and there is still an explicit "Open" call to
 * action, which are usually in tension: a link wrapping the card would swallow
 * the button, and two nested links are invalid markup. The Open link therefore
 * stretches over the card with an `::after` overlay — one tab stop, one
 * accessible name, the full card as the hit area, and the hover state driven
 * from the card so the arrow still moves when the pointer is anywhere on it.
 *
 * Counts and stamps are whatever the API returned. A master whose figures could
 * not be read shows no count pill at all rather than a zero.
 */
export function MasterCard({ master, stat }: { master: MasterDefinition; stat?: MasterStat }) {
  const Icon = master.icon
  const count = stat?.count ?? null
  const updated = formatRelativeTime(stat?.updatedAt)

  let footnote: string
  if (count === null) footnote = 'Record count unavailable'
  else if (count === 0) footnote = 'No records yet'
  else if (updated) footnote = `Updated ${updated}`
  else footnote = 'Last update unknown'

  return (
    <article
      className={cx(
        AIC,
        'group relative flex h-full flex-col rounded-xl border border-gray-200 bg-white p-4',
        'transition-all duration-200 ease-out motion-reduce:transition-none',
        'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-overlay motion-reduce:hover:translate-y-0',
        'focus-within:-translate-y-0.5 focus-within:border-primary/40 focus-within:shadow-overlay',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cx(
            'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
            'bg-primary-light/70 text-primary transition-colors duration-200 group-hover:bg-primary-light',
          )}
          aria-hidden
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
          <h2 className="min-w-0 pt-1.5 text-base font-semibold leading-tight text-gray-900">
            {master.title}
          </h2>
          {count !== null ? (
            <span className="mt-1 shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-gray-600">
              {formatCount(count)}
            </span>
          ) : null}
        </div>
      </div>

      <p className="mt-3 flex-1 text-sm leading-relaxed text-gray-500">{master.description}</p>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-gray-100 pt-3">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-gray-400">
          <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{footnote}</span>
        </span>

        <Link
          to={master.route}
          aria-label={`Open ${master.title}`}
          className={cx(
            'inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-semibold no-underline',
            'text-primary transition-colors duration-200 hover:bg-primary-light/60',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            // Stretches the link over the whole card without nesting anchors.
            "after:absolute after:inset-0 after:rounded-xl after:content-['']",
          )}
        >
          Open
          <ArrowRight
            className="h-4 w-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
            aria-hidden
          />
        </Link>
      </div>
    </article>
  )
}

export default MasterCard
