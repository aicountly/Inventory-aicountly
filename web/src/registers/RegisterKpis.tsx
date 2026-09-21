import { Activity } from 'lucide-react'
import { SUMMARY_ICON, SUMMARY_TONE } from '../components/SummaryStrip'
import type { SummaryItem } from '../components/SummaryStrip'
import { StatCard, StatCardSkeleton } from '../ui/StatCard'
import type { StatCardSpec } from './RegisterConfig'

/**
 * The register's KPI cards.
 *
 * `previous` and `sparkline` are passed through from the register's own `kpis`,
 * and NOTHING here derives either of them. Most Inventory report endpoints send
 * no comparative figures, so most registers declare none and StatCard falls back
 * to the hint line with no delta chip — which is the designed behaviour, not a
 * gap to fill. The registers that do show a delta (the pending register, and the
 * movement register through `/v1/stock-movements?summary=1`) have an
 * endpoint that measured the earlier figure; a percentage computed anywhere else
 * would be a number on a manager's screen that no server ever produced.
 */
export function RegisterKpis({
  cards,
  layout = 'stacked',
}: {
  cards: readonly StatCardSpec[]
  /** `metric` is the wide four-up row the panel layout uses. */
  layout?: 'stacked' | 'metric'
}) {
  if (!cards.length) return null
  return (
    <>
      {cards.map((card) => (
        <StatCard
          key={card.key}
          layout={layout}
          label={card.label}
          value={card.value}
          hint={card.hint}
          icon={card.icon ?? Activity}
          tone={card.tone ?? 'primary'}
          badge={card.badge}
          to={card.to}
          current={card.current}
          previous={card.previous}
          invertDelta={card.invertDelta}
          sparkline={card.sparkline}
          emphasizeNegative={card.emphasizeNegative}
          // Panel registers only: the wide card has a corner to spare, the
          // dashboard's stacked tile does not. Fixed decoration, never a plot
          // — see StatCard's CardOrnament.
          ornament={layout === 'metric'}
        />
      ))}
    </>
  )
}

/**
 * The strip's own geometry while the first response is in flight.
 *
 * `count` is how many cards the register will show, so the placeholder does not
 * hand the reader three boxes and then reflow into five. Rendered only on the
 * FIRST load: a refresh keeps the figures on screen and dims them, because
 * replacing a number a reader is looking at with a grey bar is a worse answer
 * than a number that is one second old.
 */
export function RegisterKpisSkeleton({
  count = 5,
  layout = 'stacked',
}: {
  count?: number
  layout?: 'stacked' | 'metric'
}) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <StatCardSkeleton key={i} layout={layout} />
      ))}
    </>
  )
}

/**
 * Bridge from the `summary` a report already declares to KPI cards, so all
 * eight existing reports get clickable cards without editing one of them.
 */
export function summaryItemsToCards(items: readonly SummaryItem[]): StatCardSpec[] {
  return items.map((item, index) => {
    const tone = item.tone ?? 'neutral'
    return {
      key: `${item.label}-${index}`,
      label: item.label,
      value: item.value,
      hint: item.hint,
      tone: SUMMARY_TONE[tone],
      icon: item.icon ?? SUMMARY_ICON[tone],
      to: item.to,
    }
  })
}

export default RegisterKpis
