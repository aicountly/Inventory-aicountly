import type { ReactNode } from 'react'
import { AlertTriangle, CircleCheck, Info } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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
  /** Overrides the tone's default glyph when the figure has a better one. */
  icon?: LucideIcon
}

export type SummaryTone = NonNullable<SummaryItem['tone']>

/** The one mapping from a summary tone to the KPI palette. */
export const SUMMARY_TONE: Record<SummaryTone, IconTone> = {
  neutral: 'slate',
  good: 'success',
  warning: 'warning',
  critical: 'danger',
}

/**
 * Every KPI card carries a glyph, so a tone that names no icon still has to
 * resolve to one — an IconTile with nothing in it is a coloured square.
 */
export const SUMMARY_ICON: Record<SummaryTone, LucideIcon> = {
  neutral: Info,
  good: CircleCheck,
  warning: AlertTriangle,
  critical: AlertTriangle,
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
          icon={item.icon ?? SUMMARY_ICON[item.tone ?? 'neutral']}
          tone={SUMMARY_TONE[item.tone ?? 'neutral']}
          to={item.to}
        />
      ))}
    </div>
  )
}
