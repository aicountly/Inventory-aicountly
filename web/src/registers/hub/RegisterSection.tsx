import { AIC, cx } from '../../ui/cx'
import { RegisterCard } from './RegisterCard'
import { RegistersInsightTile } from './RegistersInsightTile'
import type { RegisterHubSection } from './registersHubModel'

/**
 * Grids, by the widest column count the section asks for.
 *
 * Every section stays one-up until `lg`. A tablet still shows the rail, so a
 * two-up grid there leaves each card about 240px of prose — enough to wrap a
 * serial-number description onto five lines and make a row of cards three
 * times the height of the one above it.
 *
 * Written out rather than interpolated: Tailwind scans source text for class
 * names, so `grid-cols-${n}` would be purged out of the production build and
 * the section would collapse to one column — on the deployed site only.
 */
const GRID: Record<2 | 3, string> = {
  2: 'grid gap-3 grid-cols-1 lg:grid-cols-2',
  3: 'grid gap-3 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3',
}

/** The single card that keeps the insight panel company. */
const INSIGHT_ROW = 'grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1.9fr)_minmax(15rem,0.75fr)]'

export function RegisterSection({ section }: { section: RegisterHubSection }) {
  const insight = section.insight && section.tiles.length === 1
  return (
    <section className={cx(AIC, 'space-y-2.5')} aria-labelledby={`register-section-${section.key}`}>
      <header className="flex items-start gap-2.5">
        <span className="mt-0.5 h-6 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2
            id={`register-section-${section.key}`}
            className="text-base font-semibold leading-tight text-gray-900"
          >
            {section.title}
          </h2>
          <p className="text-xs text-gray-500">{section.description}</p>
        </div>
      </header>
      <div className={insight ? INSIGHT_ROW : GRID[section.columns]}>
        {section.tiles.map((tile) => (
          <RegisterCard key={tile.key} tile={tile} wide={insight} />
        ))}
        {insight ? <RegistersInsightTile /> : null}
      </div>
    </section>
  )
}

export default RegisterSection
