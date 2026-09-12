import type { ReactNode } from 'react'

export interface SummaryItem {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'neutral' | 'good' | 'warning' | 'critical'
}

/** Compact row of totals above a report table. */
export function SummaryStrip({ items }: { items: SummaryItem[] }) {
  if (items.length === 0) return null
  return (
    <dl className="summary-strip">
      {items.map((item) => (
        <div key={item.label} className={`summary-item${item.tone && item.tone !== 'neutral' ? ` tone-${item.tone}` : ''}`}>
          <dt className="summary-label">{item.label}</dt>
          <dd className="summary-value">{item.value}</dd>
          {item.hint ? <dd className="summary-hint">{item.hint}</dd> : null}
        </div>
      ))}
    </dl>
  )
}
