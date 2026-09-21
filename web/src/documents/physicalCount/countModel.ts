/**
 * Everything the Physical Stock Count screen derives from its draft.
 *
 * Pure on purpose: the KPI strip, the row badges, the posting-readiness gate,
 * the confirmation dialog and the rule engine all read the SAME functions, so
 * the figure in the header and the figure in the dialog cannot disagree — and
 * all of it is unit-tested without mounting a component.
 *
 * Nothing here invents a number. A line whose counted quantity has not been
 * entered has a `null` difference and a `pending` status; it is not silently
 * treated as zero, because "not counted yet" and "counted as zero" are opposite
 * facts about a warehouse and posting them alike would write off real stock.
 */

import { countDifference, isBlankLine, round4 } from '../formModel'
import type { LineDraft } from '../formModel'
import { toNumber } from '../../utils/format'

/** What a count line is, once the draft and the loaded snapshot are combined. */
export type CountStatus = 'pending' | 'ok' | 'shortage' | 'excess' | 'recount' | 'exception'

export type ExceptionSeverity = 'critical' | 'warning' | 'info'

export interface CountException {
  /** Stable per (line, kind) so a re-derivation does not re-key the list. */
  id: string
  lineKey: string
  kind:
    | 'serial_missing'
    | 'serial_duplicate'
    | 'serial_unknown'
    | 'serial_foreign_warehouse'
    | 'serial_count_mismatch'
    | 'batch_expired'
    | 'batch_missing'
    | 'invalid_qty'
  severity: ExceptionSeverity
  title: string
  detail: string
}

/**
 * Snapshot facts about a line that the draft itself cannot carry.
 *
 * `LineDraft` is the shape the document API round-trips, and widening it would
 * change every other document editor. The count screen keeps its extra columns
 * — unit cost, serial counts, batch expiry, availability — in a side map keyed
 * by line key, which is also what makes them easy to leave out entirely when
 * the reader may not see cost.
 */
export interface LineSnapshot {
  unitCost: number | null
  availableQty: number | null
  onHandQty: number | null
  /** Serial numbers the system believes are in that warehouse for this line. */
  bookSerialCount: number | null
  batchExpiry: string | null
  warehouseName: string | null
  unitSymbol: string | null
  /** Marked for a second count by the operator. UI-side until posted. */
  recount?: boolean
}

export const EMPTY_SNAPSHOT: LineSnapshot = {
  unitCost: null,
  availableQty: null,
  onHandQty: null,
  bookSerialCount: null,
  batchExpiry: null,
  warehouseName: null,
  unitSymbol: null,
}

export type SnapshotMap = Readonly<Record<string, LineSnapshot>>

/** One row of the count sheet: the draft line plus everything derived from it. */
export interface CountRow {
  line: LineDraft
  snapshot: LineSnapshot
  /** counted − book, in the line's own unit. Null until counted. */
  difference: number | null
  /** difference × unit cost. Null when either is unknown. */
  varianceValue: number | null
  /** |difference| ÷ book, as a fraction. Null when book is zero or uncounted. */
  variancePct: number | null
  counted: boolean
  status: CountStatus
  exceptions: CountException[]
}

/** physical − book for one line, using the same rounding the server applies. */
export function differenceOf(line: LineDraft): number | null {
  return countDifference(line.book_qty, line.physical_qty)
}

/** A counted quantity has been entered — blank is "not counted", not zero. */
export function isCounted(line: LineDraft): boolean {
  return String(line.physical_qty ?? '').trim() !== '' && toNumber(line.physical_qty) !== null
}

/**
 * difference × unit cost, at 4 dp.
 *
 * Money is derived from two figures the server also holds, so it is rounded the
 * way `formModel.round4` rounds everything else rather than left to accumulate
 * binary error across a thousand rows.
 */
export function varianceValueOf(difference: number | null, unitCost: number | null): number | null {
  if (difference === null || unitCost === null || !Number.isFinite(unitCost)) return null
  return round4(difference * unitCost)
}

export function variancePctOf(line: LineDraft, difference: number | null): number | null {
  const book = toNumber(line.book_qty)
  if (difference === null || book === null || book === 0) return null
  return Math.abs(difference) / Math.abs(book)
}

function statusOf(
  line: LineDraft,
  difference: number | null,
  exceptions: readonly CountException[],
  recount: boolean,
): CountStatus {
  if (exceptions.some((e) => e.severity === 'critical')) return 'exception'
  if (recount) return 'recount'
  if (difference === null || !isCounted(line)) return 'pending'
  if (difference < 0) return 'shortage'
  if (difference > 0) return 'excess'
  return 'ok'
}

export const STATUS_LABEL: Record<CountStatus, string> = {
  pending: 'Pending',
  ok: 'OK',
  shortage: 'Shortage',
  excess: 'Excess',
  recount: 'Recount',
  exception: 'Review',
}

/**
 * Line-level exceptions that come from the line itself.
 *
 * Deliberately narrow: these are arithmetic and consistency facts about the row
 * in front of the user (a serial count that does not match the quantity, an
 * expired batch, a quantity that is not a number). Cross-row findings — the
 * same serial scanned on two lines, a variance that is an outlier against the
 * rest of the sheet — belong to the rule engine in `countInsights`, which can
 * see the whole sheet.
 */
export function exceptionsFor(
  line: LineDraft,
  snapshot: LineSnapshot,
  difference: number | null,
  today: string,
): CountException[] {
  const out: CountException[] = []
  const label = line.item_sku ? `${line.item_sku} · ${line.item_name}` : line.item_name || `Item #${line.item_id ?? '?'}`

  const raw = String(line.physical_qty ?? '').trim()
  if (raw !== '' && toNumber(raw) === null) {
    out.push({
      id: `${line.key}:invalid_qty`,
      lineKey: line.key,
      kind: 'invalid_qty',
      severity: 'critical',
      title: 'Counted quantity is not a number',
      detail: label,
    })
  }

  if (line.track_serial && isCounted(line) && difference !== null) {
    const picked = line.serials.length
    // Only an OUTWARD difference names the serials that left: a shortage has to
    // say which units are missing. An excess brings unknown units in, and those
    // serials are registered on the way in rather than picked from stock.
    if (difference < 0 && picked !== Math.abs(difference)) {
      out.push({
        id: `${line.key}:serial_count_mismatch`,
        lineKey: line.key,
        kind: picked === 0 ? 'serial_missing' : 'serial_count_mismatch',
        severity: 'critical',
        title:
          picked === 0
            ? 'Serial numbers not identified for a shortage'
            : `${picked} serial number${picked === 1 ? '' : 's'} named for a shortage of ${Math.abs(difference)}`,
        detail: label,
      })
    }
  }

  if (snapshot.batchExpiry && snapshot.batchExpiry < today) {
    out.push({
      id: `${line.key}:batch_expired`,
      lineKey: line.key,
      kind: 'batch_expired',
      severity: 'warning',
      title: `Batch ${line.batch_no ?? ''} expired`.trim(),
      detail: `${label} · expired ${snapshot.batchExpiry}`,
    })
  }

  if (line.track_batch && !line.batch_id && isCounted(line) && difference !== null && difference !== 0) {
    out.push({
      id: `${line.key}:batch_missing`,
      lineKey: line.key,
      kind: 'batch_missing',
      severity: 'critical',
      title: 'Batch-tracked item counted without a batch',
      detail: label,
    })
  }

  return out
}

/** Build every derived row. Memoize the call — it walks the whole sheet. */
export function buildRows(
  lines: readonly LineDraft[],
  snapshots: SnapshotMap,
  options: { today: string; showCost: boolean },
): CountRow[] {
  return lines.map((line) => {
    const snapshot = snapshots[line.key] ?? EMPTY_SNAPSHOT
    const difference = differenceOf(line)
    const exceptions = exceptionsFor(line, snapshot, difference, options.today)
    const unitCost = options.showCost ? snapshot.unitCost : null
    return {
      line,
      snapshot,
      difference,
      varianceValue: varianceValueOf(difference, unitCost),
      variancePct: variancePctOf(line, difference),
      counted: isCounted(line),
      status: statusOf(line, difference, exceptions, snapshot.recount === true),
      exceptions,
    }
  })
}

// ---------------------------------------------------------------------------
// The KPI strip
// ---------------------------------------------------------------------------

export interface CountSummary {
  warehousesSelected: number
  itemsLoaded: number
  countedLines: number
  pendingLines: number
  /** 0–100, rounded to a whole percent. 0 when nothing is loaded. */
  progressPct: number
  shortageItems: number
  excessItems: number
  matchedItems: number
  /** Σ difference × unit cost. Null when no line carries a cost. */
  varianceValue: number | null
  /** Σ|difference| — a quantity, always knowable. */
  netQtyVariance: number
  qtyShort: number
  qtyExcess: number
  pendingSerialChecks: number
  criticalExceptions: number
  warningExceptions: number
}

export function summarise(rows: readonly CountRow[]): CountSummary {
  const warehouses = new Set<number>()
  let counted = 0
  let shortage = 0
  let excess = 0
  let matched = 0
  let variance = 0
  let hasVariance = false
  let qtyShort = 0
  let qtyExcess = 0
  let serialChecks = 0
  let critical = 0
  let warning = 0

  for (const row of rows) {
    if (row.line.warehouse_id !== null) warehouses.add(row.line.warehouse_id)
    if (row.counted) counted += 1
    if (row.difference !== null && row.counted) {
      if (row.difference < 0) {
        shortage += 1
        qtyShort = round4(qtyShort + Math.abs(row.difference))
      } else if (row.difference > 0) {
        excess += 1
        qtyExcess = round4(qtyExcess + row.difference)
      } else {
        matched += 1
      }
    }
    if (row.varianceValue !== null) {
      variance = round4(variance + row.varianceValue)
      hasVariance = true
    }
    // A serial check is outstanding while the line tracks serials and its
    // difference is not yet reconciled to a list of serial numbers.
    if (row.line.track_serial && row.exceptions.some((e) => e.kind === 'serial_missing' || e.kind === 'serial_count_mismatch')) {
      serialChecks += 1
    }
    for (const e of row.exceptions) {
      if (e.severity === 'critical') critical += 1
      else if (e.severity === 'warning') warning += 1
    }
  }

  const itemsLoaded = rows.length
  return {
    warehousesSelected: warehouses.size,
    itemsLoaded,
    countedLines: counted,
    pendingLines: Math.max(0, itemsLoaded - counted),
    progressPct: itemsLoaded === 0 ? 0 : Math.round((counted / itemsLoaded) * 100),
    shortageItems: shortage,
    excessItems: excess,
    matchedItems: matched,
    varianceValue: hasVariance ? variance : null,
    netQtyVariance: round4(qtyExcess - qtyShort),
    qtyShort,
    qtyExcess,
    pendingSerialChecks: serialChecks,
    criticalExceptions: critical,
    warningExceptions: warning,
  }
}

// ---------------------------------------------------------------------------
// Posting readiness
// ---------------------------------------------------------------------------

export type ReadinessLevel = 'ready' | 'blocked' | 'empty'

export interface ReadinessIssue {
  /** Blocking issues stop the Post button; advisory ones only warn. */
  blocking: boolean
  message: string
  /** Rows to reveal when the reader clicks the issue. */
  lineKeys?: string[]
}

export interface PostingReadiness {
  level: ReadinessLevel
  canPost: boolean
  issues: ReadinessIssue[]
  /** One line for the sticky footer. */
  summary: string
}

/**
 * Whether this count could be posted — as far as the BROWSER can tell.
 *
 * The server re-validates everything and is the authority; this exists so the
 * operator is told what to fix before a round trip, and so the Post button is
 * not offered while a serial conflict would certainly be rejected. It never
 * *permits* anything: `canPost` false hides the action, `canPost` true still
 * goes through DocumentService.
 */
export function assessReadiness(
  rows: readonly CountRow[],
  header: { document_date: string },
  crossRowExceptions: readonly CountException[] = [],
): PostingReadiness {
  const issues: ReadinessIssue[] = []

  if (!/^\d{4}-\d{2}-\d{2}$/.test(header.document_date)) {
    issues.push({ blocking: true, message: 'Enter the document date.' })
  }

  const active = rows.filter((r) => !isBlankLine(r.line))
  if (active.length === 0) {
    return {
      level: 'empty',
      canPost: false,
      issues: [{ blocking: true, message: 'Load book quantities or import a count sheet before posting.' }],
      summary: 'Nothing loaded to count',
    }
  }

  const noItem = active.filter((r) => r.line.item_id === null)
  if (noItem.length) {
    issues.push({ blocking: true, message: `${noItem.length} line${noItem.length === 1 ? '' : 's'} without an item.`, lineKeys: noItem.map((r) => r.line.key) })
  }

  // Advisory, not blocking. Counting one aisle today and the next tomorrow is
  // ordinary warehouse practice, and the server has no objection: an uncounted
  // line carries no counted quantity, so it is simply not submitted and not
  // adjusted. The posting dialog says so in as many words, which is the right
  // place for the warning — refusing the post outright would make a partial
  // count impossible.
  const uncounted = active.filter((r) => !r.counted)
  if (uncounted.length) {
    issues.push({
      blocking: false,
      message: `${uncounted.length} item${uncounted.length === 1 ? '' : 's'} still uncounted — they will not be adjusted.`,
      lineKeys: uncounted.map((r) => r.line.key),
    })
  }

  const critical = [...active.flatMap((r) => r.exceptions), ...crossRowExceptions].filter((e) => e.severity === 'critical')
  if (critical.length) {
    const byKind = new Map<string, CountException[]>()
    for (const e of critical) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e])
    for (const [kind, list] of byKind) {
      issues.push({
        blocking: true,
        message: `${list.length} ${KIND_LABEL[kind] ?? kind}${list.length === 1 ? '' : 's'} to resolve.`,
        lineKeys: list.map((e) => e.lineKey),
      })
    }
  }

  // The server drops a line whose counted quantity equals its book quantity
  // (DocumentService: "counted equal to book: nothing to adjust") and then
  // refuses a document with no lines left. So a sheet with nothing DIFFERING is
  // unsaveable whatever else is on it — said here rather than after the round
  // trip, and blocking even when lines are still uncounted, because those carry
  // no counted quantity and are not submitted either.
  const counted = active.filter((r) => r.counted)
  const adjusting = counted.filter((r) => r.difference !== null && r.difference !== 0)
  if (adjusting.length === 0) {
    issues.push({
      blocking: true,
      message:
        counted.length === 0
          ? 'Enter at least one counted quantity.'
          : 'Every counted quantity matches the book quantity — there is nothing to adjust.',
    })
  }

  const warnings = active.flatMap((r) => r.exceptions).filter((e) => e.severity === 'warning')
  if (warnings.length) {
    issues.push({ blocking: false, message: `${warnings.length} warning${warnings.length === 1 ? '' : 's'} to review before posting.` })
  }

  const blocking = issues.filter((i) => i.blocking)
  return {
    level: blocking.length ? 'blocked' : 'ready',
    canPost: blocking.length === 0,
    issues,
    summary: blocking.length
      ? `${blocking.length} issue${blocking.length === 1 ? '' : 's'} require attention`
      : 'Ready for audit',
  }
}

const KIND_LABEL: Record<string, string> = {
  serial_missing: 'missing serial list',
  serial_duplicate: 'duplicate serial',
  serial_unknown: 'unknown serial',
  serial_foreign_warehouse: 'serial in another warehouse',
  serial_count_mismatch: 'serial count mismatch',
  batch_expired: 'expired batch',
  batch_missing: 'missing batch',
  invalid_qty: 'invalid quantity',
}
