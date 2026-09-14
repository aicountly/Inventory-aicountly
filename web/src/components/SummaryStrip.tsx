import type { ReactNode } from 'react'
import { StatCard } from '../ui/StatCard'
import type { IconTone } from '../ui/IconTile'
import { SUMMARY_CARD_GRID } from '../styles/designTokens'

export interface SummaryItem {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'neutral' | 'good' | 'warning' | 'critical'
  /** Drill-down target — the card becomes a link when set. */
  to?: string
}

const TONE: Record<NonNullable<SummaryItem['tone']>, IconTone> = {
  neutral: 'slate',
  good: 'success',
  warning: 'warning',
  critical: 'danger',
}

/**
 * The row of totals above a report table, now rendered as KPI cards.
 *
 * Props are unchanged, so every existing report keeps working; a config that
 * adds `to` gets a clickable card with no further change. No delta chip is
 * ever shown here — these items carry no comparative figure, and inventing one
 * would be worse than omitting it.
 */
export function SummaryStrip({ items }: { items: SummaryItem[] }) {
  if (items.length === 0) return null
  return (
    <div className={SUMMARY_CARD_GRID}>
      {items.map((item) => (
        <StatCard
          key={item.label}
          label={item.label}
          value={item.value}
          hint={item.hint}
          tone={TONE[item.tone ?? 'neutral']}
          to={item.to}
        />
      ))}
    </div>
  )
}
