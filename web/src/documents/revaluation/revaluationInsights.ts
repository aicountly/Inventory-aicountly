/**
 * The analyses behind the assistant panel.
 *
 * They are deterministic and they run over the lines already in the document, against endpoints
 * this app already serves — there is no model and no inference here, and the panel says so. Each
 * one names the data it read and the rule it applied, and none of them writes anything: a finding
 * becomes a new cost only when the user presses Apply.
 */

import { round4 } from '../formModel'
import { lastMovementAt, lastPurchase, mapWithConcurrency } from './revaluationApi'
import { contextFor } from './revaluationModel'
import type { RevaluationLine, StockContextMap, ValuationScope } from './revaluationModel'

export type InsightId = 'purchase_rates' | 'price_variation' | 'slow_moving'

export interface InsightDefinition {
  id: InsightId
  title: string
  /** What the reader gets. */
  summary: string
  /** Which endpoint the figures come from — shown with the result, never hidden. */
  source: string
  /** The rule, in one line. */
  logic: string
  /** Whether a finding carries a rate that can be applied to the line. */
  suggestsRates: boolean
}

export const INSIGHTS: readonly InsightDefinition[] = [
  {
    id: 'purchase_rates',
    title: 'Suggest new rates from the latest purchase rates',
    summary: 'Proposes each line’s new cost from the most recent posted purchase receipt.',
    source: 'Stock movements — the latest posted PURCHASE_RECEIPT for each item.',
    logic: 'Suggested cost = the unit cost of that receipt. Items with no purchase on record are left alone.',
    suggestsRates: true,
  },
  {
    id: 'price_variation',
    title: 'Show items with high price variation',
    summary: 'Flags lines whose last purchase rate is more than 10% away from the cost they carry now.',
    source: 'Stock movements and the valuation snapshot for the document date.',
    logic: 'Flagged when |last purchase − current cost| ÷ current cost is over 10%.',
    suggestsRates: true,
  },
  {
    id: 'slow_moving',
    title: 'Identify slow-moving items for review',
    summary: 'Lists the lines that have not moved in 180 days — the stock most likely to be carried above what it is worth.',
    source: 'Stock movements — the latest physical movement of each item, in any direction.',
    logic: 'Flagged when nothing has moved for 180 days or more. It proposes no rate: what stale stock is worth is a judgement, not a lookup.',
    suggestsRates: false,
  },
]

export function insightById(id: InsightId): InsightDefinition {
  return INSIGHTS.find((i) => i.id === id) ?? INSIGHTS[0]
}

export interface InsightFinding {
  lineKey: string
  itemId: number
  itemName: string
  currentUnitCost: number | null
  /** The rate Apply would write, when the analysis has one. */
  suggestedUnitCost: number | null
  /** The evidence, in the reader's words. */
  detail: string
}

export interface InsightResult {
  id: InsightId
  findings: InsightFinding[]
  /** Lines the analysis could look at. */
  examined: number
  /** Lines it had no data for. */
  skipped: number
}

const VARIATION_THRESHOLD = 0.1
const SLOW_MOVING_DAYS = 180

export async function runInsight(
  id: InsightId,
  lines: readonly RevaluationLine[],
  contexts: StockContextMap,
  scope: ValuationScope,
  options: { asOf?: string; signal?: AbortSignal } = {},
): Promise<InsightResult> {
  const subjects = lines.filter((l) => l.itemId !== null)
  const findings: InsightFinding[] = []
  let skipped = 0

  if (id === 'slow_moving') {
    const asOf = options.asOf ? new Date(`${options.asOf}T00:00:00Z`) : new Date()
    const dates = await mapWithConcurrency(subjects, 4, (line) => lastMovementAt(line.itemId as number, options.signal))
    subjects.forEach((line, index) => {
      const moved = dates[index]
      const current = contextFor(line, contexts, scope)?.currentUnitCost ?? null
      if (!moved) {
        findings.push({ lineKey: line.key, itemId: line.itemId as number, itemName: line.itemName, currentUnitCost: current, suggestedUnitCost: null, detail: 'No posted movement on record.' })
        return
      }
      const days = daysBetween(moved.slice(0, 10), asOf)
      if (days === null) {
        skipped += 1
        return
      }
      if (days >= SLOW_MOVING_DAYS) {
        findings.push({ lineKey: line.key, itemId: line.itemId as number, itemName: line.itemName, currentUnitCost: current, suggestedUnitCost: null, detail: `Last moved ${moved.slice(0, 10)} — ${days} days ago.` })
      }
    })
    return { id, findings, examined: subjects.length, skipped }
  }

  const purchases = await mapWithConcurrency(subjects, 4, (line) => lastPurchase(line.itemId as number, options.signal))
  subjects.forEach((line, index) => {
    const purchase = purchases[index]
    const current = contextFor(line, contexts, scope)?.currentUnitCost ?? null
    if (!purchase) {
      skipped += 1
      return
    }
    const where = [purchase.documentNo, purchase.date?.slice(0, 10)].filter(Boolean).join(' · ')
    if (id === 'purchase_rates') {
      findings.push({
        lineKey: line.key,
        itemId: line.itemId as number,
        itemName: line.itemName,
        currentUnitCost: current,
        suggestedUnitCost: purchase.rate,
        detail: where ? `Last purchased at this rate on ${where}.` : 'Last purchase rate.',
      })
      return
    }
    if (current === null || current <= 0) {
      skipped += 1
      return
    }
    const variation = round4((purchase.rate - current) / current)
    if (Math.abs(variation) < VARIATION_THRESHOLD) return
    findings.push({
      lineKey: line.key,
      itemId: line.itemId as number,
      itemName: line.itemName,
      currentUnitCost: current,
      suggestedUnitCost: purchase.rate,
      detail: `${variation > 0 ? 'Up' : 'Down'} ${formatPercent(Math.abs(variation))} against the last purchase${where ? ` (${where})` : ''}.`,
    })
  })

  return { id, findings, examined: subjects.length, skipped }
}

function daysBetween(iso: string, to: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const from = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const days = Math.floor((to.getTime() - from) / 86_400_000)
  return Number.isFinite(days) ? Math.max(0, days) : null
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(fraction * 100 >= 10 ? 0 : 1)}%`
}
