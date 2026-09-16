import { AIC, cx } from '../../ui/cx'
import type { RegisterKpi } from './useRegistersSummary'

/*
 * One geometry, two states.
 *
 * The cell's classes are shared with its placeholder below, so the strip is
 * exactly as tall before the numbers land as after: a menu that reflows under
 * the pointer the moment a counter arrives is how a click lands on the wrong
 * register.
 */
const CELL = 'flex min-w-0 items-center gap-2.5 bg-white px-3 py-3.5 sm:gap-3 sm:px-4'
const TILE = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10'
const VALUE =
  'block truncate text-sm font-bold leading-tight tabular-nums text-gray-900 sm:text-base'
const LABEL = 'mt-0.5 block truncate text-[11.5px] leading-tight text-gray-500'

/*
 * `gap-px` over a lined background draws the separators — one rule that keeps
 * working at every column count, instead of a pseudo-element per breakpoint.
 *
 * Two cells across until `lg`: a tablet still shows the rail, and three cells
 * in what is left of a 768px screen cut the figures in half. Six only once the
 * page is wide enough for a cell to hold a date whole, which is around 1600px
 * — past the end of Tailwind's scale. That last step is `register-kpi-strip`
 * in theme/primitives.css, because this build emits nothing for `2xl:` or for
 * an arbitrary `min-[…]:` variant: a class for it would never have shipped.
 */
const GRID =
  'register-kpi-strip grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 shadow-card lg:grid-cols-3'

export interface RegistersKpiStripProps {
  cards: readonly RegisterKpi[]
}

export function RegistersKpiStrip({ cards }: RegistersKpiStripProps) {
  return (
    <div className={cx(AIC, GRID)} role="group" aria-label="Register counters">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <article key={card.key} className={CELL}>
            <span
              aria-hidden
              className={cx(
                TILE,
                card.neutral ? 'bg-gray-100 text-gray-500' : 'bg-primary-light text-primary',
                // Dimmed only once we know the figure is not coming — a null
                // value is still in flight, and its cell is already shimmering.
                card.value !== null && !card.available && 'opacity-60',
              )}
            >
              <Icon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
            </span>
            <div className="min-w-0">
              {card.value === null ? (
                <span className={VALUE}>
                  <span className="skeleton inline-block w-20 rounded text-transparent">&nbsp;</span>
                </span>
              ) : (
                <strong className={VALUE}>{card.value}</strong>
              )}
              {/* A title where the label carries something the eye may lose —
                  a caveat, or text long enough to be cut off. Not on every
                  label: a tooltip over "Warehouses" is noise. */}
              <span className={LABEL} title={card.hint ?? (card.label.length > 20 ? card.label : undefined)}>
                {card.label}
              </span>
            </div>
          </article>
        )
      })}
    </div>
  )
}

export default RegistersKpiStrip
