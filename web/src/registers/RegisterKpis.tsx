import { Activity } from 'lucide-react'
import { SUMMARY_ICON, SUMMARY_TONE } from '../components/SummaryStrip'
import type { SummaryItem } from '../components/SummaryStrip'
import { StatCard, StatCardSkeleton } from '../ui/StatCard'
import type { StatCardSpec } from './RegisterConfig'

/**
 * The register's KPI cards.
 *
 * `previous` is never passed. The Inventory report endpoints send no
 * comparative figures, and StatCard's contract is that an absent `previous`
 * renders the hint line and no delta chip — which is the designed fallback.
 * Inventing a percentage here would put a number on a manager's screen that no
 * server ever computed.
 */
export function RegisterKpis({ cards }: { cards: readonly StatCardSpec[] }) {
  if (!cards.length) return null
  return (
    <>
      {cards.map((card) => (
        <StatCard
          key={card.key}
          label={card.label}
          value={card.value}
          hint={card.hint}
          icon={card.icon ?? Activity}
          tone={card.tone ?? 'primary'}
          badge={card.badge}
          to={card.to}
          current={card.current}
          emphasizeNegative={card.emphasizeNegative}
          size="lg"
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
export function RegisterKpisSkeleton({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <StatCardSkeleton key={i} size="lg" />
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
