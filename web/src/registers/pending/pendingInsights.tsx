import { AlertTriangle, Clock, Lightbulb, Scale, Users, Warehouse } from 'lucide-react'
import { formatInt, formatMoney, formatQty } from '../../utils/format'
import { PENDING_AGEING_BUCKETS } from '../../services/stockApi'
import type { PendingBreakdowns, PendingSummaryResponse } from '../../services/stockApi'
import type { RegisterInsight, RegisterInsightSet } from '../RegisterInsightStrip'

const AGEING_LABEL: Record<string, string> = Object.fromEntries(
  PENDING_AGEING_BUCKETS.map((b) => [b.value, b.label]),
)

/** A percentage of a total, or null when the total is zero and the share is meaningless. */
function share(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null
  return (part / whole) * 100
}

/**
 * What the register's own figures say about the state of things.
 *
 * Rule-based, and the strip says so: the heading carries a BETA badge because
 * these rules will grow, NOT because a model wrote them. Nothing here is
 * generated, predicted or phrased by an LLM, and nothing is fetched for it —
 * every sentence is a restatement of an aggregate the server already computed
 * over the whole filtered set, which is what makes it safe to act on.
 *
 * That is also why each one is a LINK. An insight that states a figure and
 * cannot show the rows behind it is decoration; every card here drills into the
 * same register, re-filtered to exactly the lines the sentence is about.
 *
 * `values` is what the register was actually asked — the reader's own filters with
 * the declared defaults resolved — so a drill-down NARROWS what is already on
 * screen instead of resetting it.
 */
export function buildPendingInsights(
  summary: PendingSummaryResponse,
  breakdowns: PendingBreakdowns | undefined,
  values: Record<string, string>,
): RegisterInsightSet {
  const link = (patch: Record<string, string>) => {
    const next = new URLSearchParams()
    for (const [k, v] of Object.entries(values)) {
      // A toggle that is off is not a filter, and an empty value in a URL reads
      // as a filter set to nothing.
      if (v && v !== '0') next.set(k, v)
    }
    for (const [k, v] of Object.entries(patch)) next.set(k, v)
    next.delete('page')
    return `/registers/pending-quantities?${next.toString()}`
  }

  const items: RegisterInsight[] = []

  // 1. What is late. The first question anyone opens this register with.
  if (summary.overdue_lines > 0) {
    items.push({
      key: 'overdue',
      icon: AlertTriangle,
      tone: 'danger',
      label: `${formatInt(summary.overdue_lines)} ${summary.overdue_lines === 1 ? 'line is' : 'lines are'} overdue`,
      hint: `${formatQty(summary.overdue_quantity)} qty · ${formatMoney(summary.overdue_value)} at cost`,
      to: link({ overdue_only: '1' }),
    })
  } else if (summary.open_lines > 0) {
    items.push({
      key: 'on-time',
      icon: Clock,
      tone: 'success',
      label: 'Nothing is overdue',
      hint: `${formatInt(summary.open_lines)} open ${summary.open_lines === 1 ? 'line' : 'lines'}, all within their expected dates`,
    })
  }

  // 2. Where the quantity is sitting.
  const topWarehouse = breakdowns?.warehouse?.find((w) => w.open_quantity > 0)
  if (topWarehouse) {
    const pct = share(topWarehouse.open_quantity, summary.open_quantity)
    items.push({
      key: 'warehouse',
      icon: Warehouse,
      tone: 'info',
      label: `${topWarehouse.label} holds the most pending`,
      hint:
        pct === null
          ? `${formatQty(topWarehouse.open_quantity)} qty across ${formatInt(topWarehouse.lines)} lines`
          : `${formatQty(topWarehouse.open_quantity)} qty · ${pct.toFixed(0)}% of open quantity`,
      to: topWarehouse.key ? link({ warehouse_id: topWarehouse.key }) : undefined,
    })
  }

  // 3. Who to chase. Only parties with something actually late against them —
  //    "follow up" over a party whose lines are all in date is noise.
  const lateParties = (breakdowns?.party ?? []).filter((p) => p.overdue_lines > 0)
  if (lateParties.length > 0) {
    const named = lateParties.slice(0, 3).map((p) => p.label)
    items.push({
      key: 'parties',
      icon: Users,
      tone: 'warning',
      label: `${formatInt(lateParties.length)} ${lateParties.length === 1 ? 'party needs' : 'parties need'} follow-up`,
      hint: named.join(', ') + (lateParties.length > named.length ? ` +${lateParties.length - named.length} more` : ''),
      to: link({ view: 'follow_up' }),
    })
  }

  // 4. The oldest band that still has anything in it.
  const oldest = [...(breakdowns?.ageing ?? [])].reverse().find((b) => b.lines > 0)
  if (oldest && oldest.label !== '0_7') {
    items.push({
      key: 'ageing',
      icon: Clock,
      tone: 'violet',
      label: `Oldest lines are ${AGEING_LABEL[oldest.label] ?? oldest.label} old`,
      hint: `${formatInt(oldest.lines)} ${oldest.lines === 1 ? 'line' : 'lines'} · ${formatQty(oldest.open_quantity)} qty still open`,
      to: link({ ageing_bucket: oldest.label }),
    })
  }

  // 5. A lopsided book. Stated only when one side is at least twice the other,
  //    because a near-balanced register saying "imbalanced" teaches nothing.
  const { inbound_pending: inbound, outbound_pending: outbound } = summary
  if (inbound > 0 && outbound > 0 && items.length < 4) {
    const ratio = outbound / inbound
    if (ratio >= 2 || ratio <= 0.5) {
      const heavier = ratio >= 2 ? 'Outbound' : 'Inbound'
      items.push({
        key: 'exposure',
        icon: Scale,
        tone: 'slate',
        label: `${heavier} pending outweighs the other side`,
        hint: `Net exposure ${formatQty(summary.net_exposure)} qty (out − in)`,
        to: link({ direction: ratio >= 2 ? 'out' : 'in' }),
      })
    }
  }

  return {
    items: items.slice(0, 4),
    heading: {
      title: 'Smart insights',
      description: 'Computed from this register — click one to see the lines behind it.',
      icon: Lightbulb,
      beta: true,
    },
  }
}
