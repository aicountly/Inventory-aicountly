/**
 * Everything the reconciliation screens derive from what the API already sends.
 *
 * The rule this file exists to hold: Inventory owns the closing valuation,
 * Books owns the Stock-in-Hand ledger, and neither copies the other's tables.
 * So every figure below is either a column of `inv_reconciliation_runs` as the
 * server computed it, or arithmetic over two of them. Nothing here invents a
 * metric the API does not support — where the data is absent the helper returns
 * `null` and the screen says so in words.
 */

import type {
  ReconciliationBreakdown,
  ReconciliationBucket,
  ReconciliationRun,
} from '../../services/reconciliationApi'
import { toNumber } from '../../utils/format'

/** Below this the two sides are the same number; rounding, not a difference. */
export const AGREED_TOLERANCE = 0.005

/**
 * The gap at which a residual stops being rounding, in rupees.
 *
 * Not a new accounting tolerance: it is `ReconciliationService::ROUNDING_TOLERANCE`
 * (1.00), the rule the server already applies when it decides whether a
 * leftover lands in the `rounding` bucket or the `unexplained` one. The screen
 * colours to the same threshold the run was computed with.
 */
export const MATERIAL_TOLERANCE = 1

export type DifferenceTone = 'good' | 'warning' | 'critical' | 'neutral'

/** Null (Books never answered) is not zero, and must not read as agreement. */
export function differenceTone(difference: number | null | undefined): DifferenceTone {
  const n = toNumber(difference)
  if (n === null) return 'neutral'
  const abs = Math.abs(n)
  if (abs < AGREED_TOLERANCE) return 'good'
  return abs < MATERIAL_TOLERANCE ? 'warning' : 'critical'
}

/**
 * Did Books answer for this run?
 *
 * A `BOOKS_UNAVAILABLE` run carries a real Inventory closing value and a null
 * ledger balance. Rendering that null as ₹0 would turn "we could not ask" into
 * "Books holds nothing", which is a different — and alarming — statement.
 */
export function booksAnswered(run: ReconciliationRun | null | undefined): boolean {
  if (!run) return false
  return run.status !== 'BOOKS_UNAVAILABLE' && toNumber(run.books_stock_ledger_balance) !== null
}

/** Newest first by accounting date, then by run id — never by insertion order. */
export function orderRunsDesc(runs: readonly ReconciliationRun[]): ReconciliationRun[] {
  return [...runs].sort((a, b) => {
    if (a.as_of_date !== b.as_of_date) return a.as_of_date < b.as_of_date ? 1 : -1
    return b.run_id - a.run_id
  })
}

/**
 * The run the headline figures speak for: the most recent COMPLETED one.
 *
 * A failed run has no figures and a Books-unavailable one has half of them, so
 * neither may quietly become "the current position". They are still returned as
 * a fallback when there is nothing else — a screen that shows an empty strip
 * while a red run sits at the top of the table is hiding the very thing the
 * reader came for — and the caller labels what it is showing.
 */
export function headlineRun(runs: readonly ReconciliationRun[]): ReconciliationRun | null {
  const ordered = orderRunsDesc(runs)
  return ordered.find((r) => r.status === 'COMPLETED') ?? ordered[0] ?? null
}

/** The completed run immediately before `run`, for the change chips. */
export function previousCompletedRun(
  runs: readonly ReconciliationRun[],
  run: ReconciliationRun | null,
): ReconciliationRun | null {
  if (!run) return null
  const ordered = orderRunsDesc(runs).filter((r) => r.status === 'COMPLETED')
  const idx = ordered.findIndex((r) => r.run_id === run.run_id)
  if (idx === -1) {
    return ordered.find((r) => r.as_of_date < run.as_of_date || r.run_id < run.run_id) ?? null
  }
  return ordered[idx + 1] ?? null
}

/**
 * Percentage change against the previous run, or null when there is nothing
 * honest to compare with (no previous run, a previous zero, a missing figure).
 */
export function changePercent(current: unknown, previous: unknown): number | null {
  const c = toNumber(current)
  const p = toNumber(previous)
  if (c === null || p === null || p === 0) return null
  return ((c - p) / Math.abs(p)) * 100
}

/**
 * |difference| as a share of the Inventory closing value.
 *
 * Inventory is the denominator because it is the side this app can vouch for.
 * A zero valuation yields null rather than Infinity: "100%" of nothing is not a
 * measure of anything.
 */
export function differencePercent(run: ReconciliationRun | null | undefined): number | null {
  if (!run || !booksAnswered(run)) return null
  const diff = toNumber(run.difference)
  const inv = toNumber(run.inventory_closing_value)
  if (diff === null || inv === null || inv === 0) return null
  return (Math.abs(diff) / Math.abs(inv)) * 100
}

/** `0.43%` / `12.5%` / `< 0.01%` — never `0.00%` for a non-zero gap. */
export function formatPercent(value: number | null, empty = '—'): string {
  if (value === null || !Number.isFinite(value)) return empty
  if (value === 0) return '0%'
  if (Math.abs(value) < 0.01) return `${value < 0 ? '-' : ''}< 0.01%`
  return `${value.toFixed(2)}%`
}

/** `+2.4%` / `-1.1%` — the signed form the change chips use. */
export function formatSignedPercent(value: number | null, empty = '—'): string {
  if (value === null || !Number.isFinite(value)) return empty
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

export interface TrendPoint {
  runId: number
  date: string
  inventory: number
  books: number
  difference: number
}

/**
 * The last `limit` completed runs, oldest first.
 *
 * Only runs where BOTH sides answered are plotted: a Books-unavailable run has
 * no ledger balance, and drawing its missing value as a point on the floor of
 * the chart would invent a collapse that never happened. One run per accounting
 * date — the newest — so a day re-run four times does not become four points.
 */
export function trendPoints(runs: readonly ReconciliationRun[], limit = 7): TrendPoint[] {
  const seen = new Set<string>()
  const points: TrendPoint[] = []
  for (const run of orderRunsDesc(runs)) {
    if (run.status !== 'COMPLETED' || !booksAnswered(run)) continue
    if (seen.has(run.as_of_date)) continue
    const inventory = toNumber(run.inventory_closing_value)
    const books = toNumber(run.books_stock_ledger_balance)
    if (inventory === null || books === null) continue
    seen.add(run.as_of_date)
    points.push({
      runId: run.run_id,
      date: run.as_of_date,
      inventory,
      books,
      difference: toNumber(run.difference) ?? inventory - books,
    })
    if (points.length >= limit) break
  }
  return points.reverse()
}

export interface ReconciliationInsights {
  completed: number
  booksUnavailable: number
  failed: number
  /** Completed runs whose difference is at or above the material threshold. */
  withMaterialDifference: number
  agreed: number
  averageAbsoluteDifference: number | null
  largestDifference: ReconciliationRun | null
  latestDifference: number | null
  /** Latest |difference| minus the one before it: negative is improvement. */
  movement: number | null
}

/**
 * Deterministic counts over the runs already on screen. No model, no forecast,
 * no external call — arithmetic a reader could repeat with the table in front
 * of them.
 */
export function insights(runs: readonly ReconciliationRun[]): ReconciliationInsights {
  const ordered = orderRunsDesc(runs)
  const completed = ordered.filter((r) => r.status === 'COMPLETED' && booksAnswered(r))
  const diffs = completed
    .map((r) => toNumber(r.difference))
    .filter((d): d is number => d !== null)
    .map((d) => Math.abs(d))

  const largest = completed.reduce<ReconciliationRun | null>((best, run) => {
    const d = Math.abs(toNumber(run.difference) ?? 0)
    const bestD = best ? Math.abs(toNumber(best.difference) ?? 0) : -1
    return d > bestD ? run : best
  }, null)

  const latest = completed[0] ?? null
  const previous = previousCompletedRun(runs, latest)
  const latestDiff = latest ? Math.abs(toNumber(latest.difference) ?? 0) : null
  const previousDiff = previous ? Math.abs(toNumber(previous.difference) ?? 0) : null

  return {
    completed: ordered.filter((r) => r.status === 'COMPLETED').length,
    booksUnavailable: ordered.filter((r) => r.status === 'BOOKS_UNAVAILABLE').length,
    failed: ordered.filter((r) => r.status === 'FAILED').length,
    withMaterialDifference: diffs.filter((d) => d >= MATERIAL_TOLERANCE).length,
    agreed: diffs.filter((d) => d < AGREED_TOLERANCE).length,
    averageAbsoluteDifference: diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null,
    largestDifference: largest,
    latestDifference: latestDiff,
    movement: latestDiff !== null && previousDiff !== null ? latestDiff - previousDiff : null,
  }
}

/* ------------------------------------------------------------------ buckets */

/**
 * What each bucket means and which way it moves Books towards Inventory.
 * Written for the person clearing the gap, not for the person who wrote the
 * query behind it.
 */
export const BUCKET_HELP: Record<string, string> = {
  opening_difference: 'Opening stock differs between Inventory (openings) and the Books ledger opening balance.',
  pending_posting: 'Books vouchers whose stock lines are still queued for posting to Inventory.',
  failed_posting: 'Books vouchers Inventory refused; fix and retry from Books (books:inventory-retry).',
  cancelled_reversed: 'Documents reversed in Inventory or cancelled in Books; netted when both sides agree.',
  unacknowledged_valuation_revisions: 'COGS revisions Inventory published that Books has not applied yet.',
  revaluation: 'Revaluation journals Books recorded in adjustment mode.',
  manual_journal: 'Manual journals on the Stock-in-Hand ledger that have no stock document behind them.',
  missing_source: 'Inventory documents that claim a Books source Books cannot find.',
  rounding: 'Sub-rupee rounding between line values and ledger amounts.',
  unexplained: 'What is left after every bucket above, compared against Books. Must be zero before sign-off.',
}

/**
 * Diagnostics are computed entirely from Inventory's own tables — neither reads anything Books
 * reported. They can be large even when Inventory and Books agree on every transaction: a
 * point-in-time closing valuation "forgets" a historical cost once the stock that carried it
 * sells through, while Inventory's own reconstructed running ledger never does. Useful context
 * for an unexplained residual, never evidence on its own that Books and Inventory disagree.
 */
export const DIAGNOSTIC_HELP: Record<string, string> = {
  valuation_method_variance: 'Closing snapshot versus opening + movement values, both computed inside Inventory — mixed methods, WAC rounding, negative stock or back-dated recosts. Not a Books comparison.',
  transfer_valuation_gap: 'Stock transfers whose receiving side carries no cost layer (inherited from legacy data), computed entirely from Inventory’s own movements. Not a Books comparison.',
}

/** The bucket names, in the words the screen uses. */
export function bucketLabel(key: string): string {
  const words = key.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Why an `unexplained` residual can exist at all, for the reader who has just
 * been told "must be zero before sign-off" and wants to know what to do about
 * a nonzero one. Written once, not per-run: the mechanism is always the same.
 *
 * Inventory's closing figure is a fresh, point-in-time recompute of today's
 * stock. Books' figure is a running sum of every entry Inventory has ever
 * posted to it. For a healthy item the two are mathematically guaranteed to
 * agree — opening plus every movement equals closing, computed either way.
 * They diverge only for stock that was sold or issued below zero before a
 * real purchase cost existed for it: at that moment each side independently
 * priced the movement, and nothing guarantees two independent estimates land
 * on the same number.
 */
export const UNEXPLAINED_WHY =
  "Inventory's figure here is a fresh, point-in-time recompute of today's stock. Books' figure is a running sum of every entry Inventory has ever posted to its ledger. For a healthy item the two are mathematically guaranteed to agree — opening plus every movement equals closing, computed either way. They diverge only for stock that was sold or issued below zero before a real purchase cost existed for it: at that moment each side had to independently estimate a cost, and nothing guarantees two independent estimates land on the same number."

export const UNEXPLAINED_ACTION =
  'Find the item(s) behind it — layers with a negative balance or a zero cost, opened before a real receipt was on record — enter the real purchase cost on the source document, and run a recalculation from that date. Once both sides price the same movement from the same real cost, this gap closes on its own; nothing here needs changing by hand.'

/** Where the corrective action above sends the reader. */
export const UNEXPLAINED_ACTION_HREF = '/valuation/cost-layers?status=negative'

/**
 * Why an opening difference cannot simply be pushed across, whichever way it leans.
 *
 * Readers reasonably expect a "sync" button here, and its absence looks like a missing feature
 * until you know what each side actually stores. Books keeps ONE amount on the Stock-in-Hand
 * ledger. Inventory keeps an opening per item — a quantity and a rate, warehouse by warehouse,
 * batch by batch — because that is what FIFO, LIFO and WAC consume from.
 */
export const OPENING_DIFFERENCE_WHY =
  "Books keeps one amount on the Stock-in-Hand ledger. Inventory keeps an opening for every item — a quantity and a rate, warehouse by warehouse, batch by batch — because that is what the costing methods consume from. Inventory's total can therefore be written into Books as a single balance, but Books' total cannot be split back into items without deciding which items, how many of each and at what cost, and nothing in Books records that. So this gap is closed by correcting whichever side is wrong, never by copying a number across."

/** What to actually do, in the order a person should consider it. */
export const OPENING_DIFFERENCE_ACTIONS: readonly { title: string; detail: string }[] = [
  {
    title: 'If Inventory is right',
    detail:
      'Set this company to "Inventory Real Data" in Books → Settings → Stock-in-Hand. Books then takes its opening from Inventory and stops accepting a typed one, and this gap closes for good.',
  },
  {
    title: 'If Books is right',
    detail:
      'The item openings in Inventory are wrong or missing. Enter them against the items — the Opening Stock report lists what is there, and its "Unvalued qty" column finds items carrying quantity with no rate, which is the usual cause of a shortfall.',
  },
  {
    title: 'If neither is certain',
    detail:
      'Leave the company on "Manual Stock-in-Hand". The difference stays reported here rather than being silently resolved in favour of a figure nobody has checked.',
  },
]

/** Where "if Books is right" sends the reader. */
export const OPENING_DIFFERENCE_ACTION_HREF = '/reports/opening-stock'

export interface OpeningDifferenceDetail {
  /** Books' Stock-in-Hand opening, or null when Books did not answer this run. */
  booksOpening: number | null
  inventoryOpening: number | null
  /** inventory − books, i.e. the bucket's own contribution. */
  delta: number
  /** False when Books was unreachable — the figures below are not a comparison then. */
  booksReported: boolean
}

/**
 * The two figures behind an opening difference, so the row can show the comparison itself
 * rather than only its net effect. Both come off the bucket the server already computed.
 */
export function openingDifferenceDetail(
  bucket: ReconciliationBucket | null | undefined,
): OpeningDifferenceDetail {
  const books = toNumber(bucket?.books_opening_balance)
  const inventory = toNumber(bucket?.inventory_opening_value)
  // The server sends a boolean here for this bucket; other buckets use the same key for a list.
  const reported = bucket?.books_reported
  return {
    booksOpening: books,
    inventoryOpening: inventory,
    delta: toNumber(bucket?.amount) ?? 0,
    booksReported: typeof reported === 'boolean' ? reported : books !== null,
  }
}

export interface UnexplainedDriver {
  /** `diagnostics.valuation_method_variance.amount` for this run. */
  amount: number
  /** Movements costed with no real rate on record, when the run reported one. */
  unvaluedMovements: number | null
}

export interface UnexplainedExplanation {
  amount: number | null
  /** Worth explaining at all — a residual at or above rounding. */
  active: boolean
  /** Every other bucket nets to ~0, so `unexplained` is not a mix of several causes. */
  otherBucketsClear: boolean
  /**
   * Set only when the residual lines up with Inventory's own internal
   * valuation_method_variance diagnostic AND every other bucket is clear — the
   * one situation where that diagnostic can be named as the mechanism rather
   * than a coincidence. Never asserted from the amount alone.
   */
  driver: UnexplainedDriver | null
}

/** A diagnostic amount within 5% (floor ₹1) of the residual is close enough to name as the driver. */
const DRIVER_ALIGNMENT_TOLERANCE_RATIO = 0.05

/**
 * Explains a run's `unexplained` bucket for the info panel on the variance
 * screens. Pure arithmetic over what the run already returned — no new
 * figure is computed and nothing here reads anything Books reported beyond
 * what `compute()` already netted into the buckets.
 */
export function unexplainedExplanation(breakdown: ReconciliationBreakdown | null | undefined): UnexplainedExplanation {
  const amount = toNumber(breakdown?.buckets?.unexplained?.amount)
  const active = amount !== null && Math.abs(amount) >= AGREED_TOLERANCE

  const buckets = breakdown?.buckets ?? {}
  const otherBucketsClear = Object.entries(buckets).every(([key, bucket]) => {
    if (key === 'unexplained' || key === 'rounding') return true
    return Math.abs(toNumber(bucket?.amount) ?? 0) < AGREED_TOLERANCE
  })

  let driver: UnexplainedDriver | null = null
  const variance = breakdown?.diagnostics?.valuation_method_variance
  const varianceAmount = toNumber(variance?.amount)
  if (active && otherBucketsClear && amount !== null && varianceAmount !== null) {
    const tolerance = Math.max(1, Math.abs(amount) * DRIVER_ALIGNMENT_TOLERANCE_RATIO)
    if (Math.abs(varianceAmount - amount) <= tolerance) {
      driver = { amount: varianceAmount, unvaluedMovements: toNumber(variance?.unvalued_movements) }
    }
  }

  return { amount, active, otherBucketsClear, driver }
}

export interface BucketRow {
  key: string
  label: string
  help: string
  amount: number
  count: number
  /** |amount| as a share of the run's total difference, 0–100, or null. */
  share: number | null
  documents: number
  bucket: ReconciliationBucket
}

/**
 * The breakdown as rows, largest absolute contribution first.
 *
 * Buckets that contributed nothing AND counted nothing are dropped: a list of
 * twelve rows of which nine read 0.00 buries the two that explain the gap.
 */
export function bucketRows(
  breakdown: ReconciliationBreakdown | null | undefined,
  options: { includeEmpty?: boolean } = {},
): BucketRow[] {
  if (!breakdown?.buckets) return []
  const total = Object.values(breakdown.buckets).reduce(
    (sum, b) => sum + Math.abs(toNumber(b?.amount) ?? 0),
    0,
  )
  return Object.entries(breakdown.buckets)
    .map(([key, bucket]) => {
      const amount = toNumber(bucket?.amount) ?? 0
      const count = toNumber(bucket?.count) ?? 0
      const documents = Array.isArray(bucket?.documents)
        ? bucket.documents.length
        : Array.isArray(bucket?.entries)
          ? bucket.entries.length
          : 0
      return {
        key,
        label: bucketLabel(key),
        help: BUCKET_HELP[key] ?? '',
        amount,
        count,
        share: total > 0 ? (Math.abs(amount) / total) * 100 : null,
        documents,
        bucket: bucket as ReconciliationBucket,
      }
    })
    .filter((row) => options.includeEmpty || Math.abs(row.amount) >= 0.005 || row.count > 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
}

/** Buckets that name documents somebody has to act on, for the KPI strip. */
export function actionableBucketCount(breakdown: ReconciliationBreakdown | null | undefined): number | null {
  if (!breakdown?.buckets) return null
  return bucketRows(breakdown).length
}

/**
 * Diagnostics as rows, same shape as `bucketRows()` but reading `breakdown.diagnostics` and
 * `DIAGNOSTIC_HELP` — kept as a separate function, not a flag on `bucketRows()`, so a screen
 * cannot render the two lists interchangeably by accident.
 */
export function diagnosticRows(
  breakdown: ReconciliationBreakdown | null | undefined,
  options: { includeEmpty?: boolean } = {},
): BucketRow[] {
  if (!breakdown?.diagnostics) return []
  return Object.entries(breakdown.diagnostics)
    .map(([key, bucket]) => {
      const amount = toNumber(bucket?.amount) ?? 0
      const count = toNumber(bucket?.count) ?? 0
      const documents = Array.isArray(bucket?.documents)
        ? bucket.documents.length
        : Array.isArray(bucket?.entries)
          ? bucket.entries.length
          : 0
      return {
        key,
        label: bucketLabel(key),
        help: DIAGNOSTIC_HELP[key] ?? '',
        amount,
        count,
        share: null,
        documents,
        bucket: bucket as ReconciliationBucket,
      }
    })
    .filter((row) => options.includeEmpty || Math.abs(row.amount) >= 0.005 || row.count > 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
}
