import { Boxes, CircleDollarSign, ShieldCheck, Tag } from 'lucide-react'
import type { ReactNode } from 'react'
import type { CostConfidence } from './lineFormInsights'
import type { DraftTotals } from './formModel'
import type { DocumentTypeSpec } from './registry'
import { StatCard } from '../ui/StatCard'
import type { IconTone } from '../ui/IconTile'
import { AIC, cx } from '../ui/cx'
import { formatMoney, formatQty } from '../utils/format'

const CONFIDENCE_TONE: Record<CostConfidence['level'], IconTone> = {
  pending: 'slate',
  low: 'danger',
  medium: 'warning',
  high: 'success',
  auto: 'info',
}

export interface StockFormMetricsProps {
  spec: DocumentTypeSpec
  totals: DraftTotals
  /** header.reason_code, trimmed. */
  reasonCode: string
  costConfidence: CostConfidence
}

/**
 * The four summary cards above a "lines"-form document: what is being added, what it is worth,
 * where the variance comes from, and how confident the draft's costing looks. Every figure comes
 * straight from the draft already in DocumentForm's state (or, for cost confidence, from a live
 * valuation lookup) — nothing here is a static placeholder.
 */
export function StockFormMetrics({ spec, totals, reasonCode, costConfidence }: StockFormMetricsProps) {
  const cards: ReactNode[] = []

  cards.push(
    <StatCard key="items" layout="metric" icon={Boxes} tone="info" label="Items Added" value={totals.lines} hint={totals.lines === 0 ? 'Ready to add items' : `${totals.lines} line${totals.lines === 1 ? '' : 's'} entered`} />,
  )

  if (spec.rate) {
    cards.push(
      <StatCard key="value" layout="metric" icon={CircleDollarSign} tone="success" label="Estimated Value" value={`₹ ${formatMoney(totals.amount)}`} hint="Based on entered lines" />,
    )
  } else {
    const qty = totals.qtyIn || totals.qtyOut
    cards.push(
      <StatCard key="qty" layout="metric" icon={CircleDollarSign} tone="success" label="Total Quantity" value={formatQty(qty)} hint="Priced automatically on posting" />,
    )
  }

  if (spec.reason) {
    cards.push(
      <StatCard
        key="variance"
        layout="metric"
        icon={Tag}
        tone="warning"
        label="Variance Source"
        value={reasonCode || 'Manual Entry'}
        hint={reasonCode ? 'From the reason code entered' : 'User recorded excess'}
      />,
    )
  }

  cards.push(
    <StatCard
      key="confidence"
      layout="metric"
      icon={ShieldCheck}
      tone={CONFIDENCE_TONE[costConfidence.level]}
      label="Auto-Cost Confidence"
      value={costConfidence.label}
      hint={costConfidence.hint}
    />,
  )

  return <div className={cx(AIC, 'grid grid-cols-2 lg:grid-cols-4 gap-3')}>{cards}</div>
}

export default StockFormMetrics
