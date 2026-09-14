import { Activity, AlertTriangle, CircleCheck, Info } from 'lucide-react'
import type { SummaryItem } from '../components/SummaryStrip'
import { StatCard } from '../ui/StatCard'
import type { IconTone } from '../ui/IconTile'
import type { StatCardSpec } from './RegisterConfig'

const TONE_FOR_SUMMARY: Record<NonNullable<SummaryItem['tone']>, IconTone> = {
  neutral: 'slate',
  good: 'success',
  warning: 'warning',
  critical: 'danger',
}

const ICON_FOR_SUMMARY: Record<NonNullable<SummaryItem['tone']>, typeof Info> = {
  neutral: Info,
  good: CircleCheck,
  warning: AlertTriangle,
  critical: AlertTriangle,
}

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
        />
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
      tone: TONE_FOR_SUMMARY[tone],
      icon: ICON_FOR_SUMMARY[tone],
      to: item.to,
    }
  })
}

export default RegisterKpis
