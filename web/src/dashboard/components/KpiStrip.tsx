import { StatCard, StatCardSkeleton } from '../../ui/StatCard'
import type { KpiCardSpec } from '../model'
import { ICON_TONE, KPI_ICONS } from '../visuals'

/**
 * The eight headline figures.
 *
 * Cards fill in one at a time: the KPIs come from four independent requests, so
 * a card whose source has not landed shows its own skeleton in place while the
 * rest are already usable. The placeholder is the card's own shell rather than
 * a block of a measured height, so the geometry is identical in both states and
 * nothing moves when data arrives.
 */
export interface KpiStripProps {
  cards: readonly KpiCardSpec[]
}

// Books' own KPI strip, literally: the two products share a 13px root, so a
// tightened gap here would only make the same markup read differently there.
const GRID = 'grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-8'

export function KpiStrip({ cards }: KpiStripProps) {
  return (
    <div className={GRID}>
      {cards.map((card) =>
        card.value === null ? (
          <StatCardSkeleton key={card.key} />
        ) : (
          <StatCard
            key={card.key}
            label={card.label}
            value={card.value}
            current={card.numeric}
            // No `previous`: /v1/dashboard and the reports send no prior-period
            // figure, so there is no honest delta to draw. See model.ts.
            icon={KPI_ICONS[card.icon]}
            tone={ICON_TONE[card.tone]}
            hint={card.hint}
            to={card.to}
            emphasizeNegative={card.emphasizeNegative}
            // Badge only the genuinely bad counts. Amber-toned cards (reorder,
            // expiring, waiting) already read as "look at me" through the icon
            // tone; a chip on all five of them is noise, and noise is how a
            // dashboard trains people to stop reading it.
            badge={
              card.attention && (card.tone === 'danger' || card.tone === 'critical')
                ? { label: 'Act now', tone: 'danger' }
                : undefined
            }
          />
        ),
      )}
    </div>
  )
}

export default KpiStrip
