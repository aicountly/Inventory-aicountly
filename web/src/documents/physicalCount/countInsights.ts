/**
 * Variance insights for a physical count.
 *
 * ## What these are, and what they are not
 *
 * Everything in this file is a DETERMINISTIC RULE run in the browser over the
 * count sheet that is on screen. No model is consulted, nothing is predicted,
 * and every finding can be re-derived from the rows by hand. They are labelled
 * that way in the UI (`source: 'rules'`) because a duplicate serial number is
 * arithmetic, and dressing arithmetic up as machine intelligence is how a
 * stores clerk learns to distrust the panel that also flags the real problems.
 *
 * `PhysicalCountInsightProvider` is the seam an actual insight service plugs
 * into later. When one exists it returns `source: 'service'` and the card says
 * so; until then the rules below are what the rail shows, and the rail says
 * whose findings they are. A service that fails or is absent must never stop
 * somebody counting stock, so the fallback is always these rules.
 */

import type { CountException, CountRow, CountSummary } from './countModel'
import { formatQty } from '../../utils/format'

export type InsightTone = 'danger' | 'warning' | 'info' | 'success'

export interface CountInsight {
  id: string
  tone: InsightTone
  title: string
  detail: string
  /** Rows the insight is about — clicking it filters the sheet to them. */
  lineKeys: string[]
  /** What the reader should do about it, for the assist drawer. */
  action?: 'recount' | 'serials' | 'batches' | 'review'
}

export interface PhysicalCountInsights {
  /** Where these findings came from. The rail prints it; never claim 'service' for rules. */
  source: 'rules' | 'service'
  summary: CountInsight[]
  recountRecommendations: string[]
  /** Cross-row exceptions — the ones a single line cannot see. */
  anomalies: CountException[]
  /** Only a real service supplies this. Rules do not guess a confidence. */
  confidence: number | null
  generatedAt: string | null
}

export const EMPTY_INSIGHTS: PhysicalCountInsights = {
  source: 'rules',
  summary: [],
  recountRecommendations: [],
  anomalies: [],
  confidence: null,
  generatedAt: null,
}

/**
 * The seam. An Inventory insight endpoint, when one is built, implements this
 * and is injected at the provider; nothing in the UI changes.
 */
export interface PhysicalCountInsightProvider {
  getPhysicalCountInsights(
    input: { documentId: number | null; rows: readonly CountRow[]; summary: CountSummary },
    signal?: AbortSignal,
  ): Promise<PhysicalCountInsights>
}

/** Variance beyond this share of book quantity reads as shrinkage, not miscount. */
export const HIGH_SHRINKAGE_RATIO = 0.2

/** A variance worth a second look regardless of ratio, as a share of sheet value. */
export const HIGH_VALUE_SHARE = 0.25

/**
 * A counted figure this many times the book figure is far more likely to be a
 * decimal or a keying slip than a real find — 10× and 100× are where a misplaced
 * decimal point lands.
 */
const DECIMAL_SLIP_FACTORS = [10, 100, 1000]
const DECIMAL_SLIP_TOLERANCE = 0.02

function isDecimalSlip(book: number, counted: number): boolean {
  if (book <= 0 || counted <= 0) return false
  for (const factor of DECIMAL_SLIP_FACTORS) {
    for (const ratio of [counted / book, book / counted]) {
      if (Math.abs(ratio - factor) <= factor * DECIMAL_SLIP_TOLERANCE) return true
    }
  }
  return false
}

/** Serial numbers named on more than one line — the same unit counted twice. */
export function duplicateSerials(rows: readonly CountRow[]): CountException[] {
  const seen = new Map<number, { serialNo: string | null; lineKeys: string[] }>()
  for (const row of rows) {
    for (const s of row.line.serials) {
      const entry = seen.get(s.serial_id)
      if (entry) entry.lineKeys.push(row.line.key)
      else seen.set(s.serial_id, { serialNo: s.serial_no, lineKeys: [row.line.key] })
    }
  }
  const out: CountException[] = []
  for (const [serialId, entry] of seen) {
    if (entry.lineKeys.length < 2) continue
    out.push({
      id: `dup-serial:${serialId}`,
      lineKey: entry.lineKeys[0],
      kind: 'serial_duplicate',
      severity: 'critical',
      title: `Serial ${entry.serialNo ?? `#${serialId}`} counted on ${entry.lineKeys.length} lines`,
      detail: 'The same unit cannot be in two places; remove it from all but one line.',
    })
  }
  return out
}

/**
 * The same item and warehouse loaded twice.
 *
 * Only reachable through import or a manually added line — the loader keys on
 * the balance row — and it is worth catching, because both lines post and the
 * adjustment is applied twice.
 */
export function duplicateLines(rows: readonly CountRow[]): CountException[] {
  const seen = new Map<string, string[]>()
  for (const row of rows) {
    if (row.line.item_id === null) continue
    const key = `${row.line.item_id}|${row.line.warehouse_id ?? ''}|${row.line.batch_id ?? ''}`
    seen.set(key, [...(seen.get(key) ?? []), row.line.key])
  }
  const out: CountException[] = []
  for (const [key, lineKeys] of seen) {
    if (lineKeys.length < 2) continue
    const row = rows.find((r) => r.line.key === lineKeys[0])
    out.push({
      id: `dup-line:${key}`,
      lineKey: lineKeys[0],
      kind: 'serial_duplicate',
      severity: 'warning',
      title: `${row?.line.item_name ?? 'Item'} appears on ${lineKeys.length} lines`,
      detail: 'Same item, warehouse and batch — the adjustment would be applied more than once.',
    })
  }
  return out
}

/**
 * Run every rule over the sheet.
 *
 * `summary` is passed in rather than recomputed so the panel and the KPI strip
 * are reading one set of figures.
 */
export function runInsightRules(
  rows: readonly CountRow[],
  summary: CountSummary,
): PhysicalCountInsights {
  const counted = rows.filter((r) => r.counted && r.difference !== null)
  const anomalies = [...duplicateSerials(rows), ...duplicateLines(rows)]
  const out: CountInsight[] = []

  const shrinkage = counted.filter(
    (r) => r.difference !== null && r.difference < 0 && r.variancePct !== null && r.variancePct > HIGH_SHRINKAGE_RATIO,
  )
  if (shrinkage.length) {
    out.push({
      id: 'high-shrinkage',
      tone: 'danger',
      title: `${shrinkage.length} item${shrinkage.length === 1 ? '' : 's'} with unusually high shrinkage`,
      detail: `Short by more than ${Math.round(HIGH_SHRINKAGE_RATIO * 100)}% of book quantity.`,
      lineKeys: shrinkage.map((r) => r.line.key),
      action: 'recount',
    })
  }

  const slips = counted.filter((r) => {
    const book = Number(r.line.book_qty)
    const physical = Number(r.line.physical_qty)
    return Number.isFinite(book) && Number.isFinite(physical) && isDecimalSlip(book, physical)
  })
  if (slips.length) {
    out.push({
      id: 'decimal-slip',
      tone: 'warning',
      title: `${slips.length} item${slips.length === 1 ? '' : 's'} may have counting errors`,
      detail: 'Counted quantity is a round multiple of book quantity — possible decimal entry mistake.',
      lineKeys: slips.map((r) => r.line.key),
      action: 'recount',
    })
  }

  const dupSerials = anomalies.filter((a) => a.kind === 'serial_duplicate' && a.severity === 'critical')
  if (dupSerials.length) {
    out.push({
      id: 'duplicate-serial',
      tone: 'danger',
      title: `${dupSerials.length} serial number${dupSerials.length === 1 ? '' : 's'} counted twice`,
      detail: 'The same serial number was named on more than one line.',
      lineKeys: dupSerials.map((a) => a.lineKey),
      action: 'serials',
    })
  }

  // High-value variances: rows whose value swing is a large share of the whole
  // sheet's. Only meaningful when costs are visible at all.
  const valued = counted.filter((r) => r.varianceValue !== null && r.varianceValue !== 0)
  const totalAbs = valued.reduce((sum, r) => sum + Math.abs(r.varianceValue ?? 0), 0)
  if (totalAbs > 0) {
    const heavy = valued.filter((r) => Math.abs(r.varianceValue ?? 0) / totalAbs >= HIGH_VALUE_SHARE)
    if (heavy.length && heavy.length < valued.length) {
      out.push({
        id: 'high-value-variance',
        tone: 'warning',
        title: `${heavy.length} item${heavy.length === 1 ? '' : 's'} carry most of the variance value`,
        detail: `Each is at least ${Math.round(HIGH_VALUE_SHARE * 100)}% of the total value swing on this sheet.`,
        lineKeys: heavy.map((r) => r.line.key),
        action: 'review',
      })
    }
  }

  const expiredBatches = rows.filter((r) => r.exceptions.some((e) => e.kind === 'batch_expired'))
  if (expiredBatches.length) {
    out.push({
      id: 'expired-batches',
      tone: 'warning',
      title: `${expiredBatches.length} expired batch${expiredBatches.length === 1 ? '' : 'es'} on the sheet`,
      detail: 'Expired stock counted in — confirm it should still be on hand.',
      lineKeys: expiredBatches.map((r) => r.line.key),
      action: 'batches',
    })
  }

  if (summary.pendingSerialChecks > 0) {
    out.push({
      id: 'serial-checks',
      tone: 'info',
      title: `${summary.pendingSerialChecks} serial check${summary.pendingSerialChecks === 1 ? '' : 's'} outstanding`,
      detail: 'Serial-tracked shortages need the missing units named before posting.',
      lineKeys: rows
        .filter((r) => r.exceptions.some((e) => e.kind === 'serial_missing' || e.kind === 'serial_count_mismatch'))
        .map((r) => r.line.key),
      action: 'serials',
    })
  }

  // Recount candidates: the rows a supervisor would send back. Ranked by the
  // size of the swing so the list is the three that matter, not the first three.
  const recount = [...shrinkage, ...slips]
    .filter((r, i, list) => list.findIndex((x) => x.line.key === r.line.key) === i)
    .sort((a, b) => Math.abs(b.varianceValue ?? b.difference ?? 0) - Math.abs(a.varianceValue ?? a.difference ?? 0))
    .slice(0, 5)
  if (recount.length) {
    out.push({
      id: 'recount-suggestion',
      tone: 'success',
      title: `Suggested recount (${recount.length} item${recount.length === 1 ? '' : 's'})`,
      detail: 'Largest unexplained differences on this sheet.',
      lineKeys: recount.map((r) => r.line.key),
      action: 'recount',
    })
  }

  if (out.length === 0 && summary.countedLines > 0) {
    out.push({
      id: 'all-clear',
      tone: 'success',
      title: 'No unusual variances found',
      detail: `${summary.countedLines} of ${summary.itemsLoaded} lines counted; nothing tripped a variance rule.`,
      lineKeys: [],
    })
  }

  return {
    source: 'rules',
    summary: out,
    recountRecommendations: recount.map(
      (r) =>
        `${r.line.item_sku ? `${r.line.item_sku} · ` : ''}${r.line.item_name} — book ${formatQty(r.line.book_qty)}, counted ${formatQty(r.line.physical_qty)}`,
    ),
    anomalies,
    confidence: null,
    generatedAt: new Date().toISOString(),
  }
}
