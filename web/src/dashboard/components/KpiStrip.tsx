import { StatCard } from '../../ui/StatCard'
import { SkeletonCard } from '../../ui/Skeleton'
import type { KpiCardSpec } from '../model'
import { ICON_TONE, KPI_ICONS } from '../visuals'

/**
 * The eight headline figures.
 *
 * Cards fill in one at a time: the KPIs come from four independent requests, so
 * a card whose source has not landed shows its own skeleton in place while the
 * rest are already usable. The grid geometry is identical in both states, so
 * nothing moves when data arrives.
 */
export interface KpiStripProps {
  cards: readonly KpiCardSpec[]
}

const GRID = 'grid gap-2.5 grid-cols-2 md:grid-cols-4 xl:grid-cols-8'

export function KpiStrip({ cards }: KpiStripProps) {
  return (
    <div className={GRID}>
      {cards.map((card) =>
        card.value === null ? (
          <SkeletonCard key={card.key} className="h-[104px]" />
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
