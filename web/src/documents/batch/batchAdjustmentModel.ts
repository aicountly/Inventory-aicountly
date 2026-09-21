/**
 * The Batch Adjustment workspace's pure layer: how a reallocation is read off the draft lines,
 * what the header figures add up to, and every check the screen runs before the server does.
 *
 * Nothing here touches React or the network, so all of it is unit-tested. The draft shape is
 * `documents/formModel`'s — the same `HeaderDraft` / `LineDraft` every other document editor
 * holds — so `toPayload` keeps producing exactly the payload the server already accepts.
 */

import type { BatchRow } from '../../services/lookupApi'
import { toNumber } from '../../utils/format'
import { isBlankLine, lineBaseQty, round4 } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'

/**
 * A batch adjustment line carries ONE batch on the wire (`inv_document_lines.batch_id`) — the
 * batch the quantity leaves on an out line, the batch it lands on on an in line. The other end of
 * the reallocation is the operator's intent, not a movement, so it rides in the line metadata the
 * server already stores and returns verbatim (`metadata_json`). No column, no migration, and a
 * reloaded draft still shows both ends of the mapping.
 */
export const BATCH_MAPPING_KEY = 'batch_adjustment'

export interface BatchMapping {
  from_batch_id: number | null
  from_batch_no: string | null
  to_batch_id: number | null
  to_batch_no: string | null
}

export type MappingSide = 'from' | 'to'

/** Which end of the mapping the line's own `batch_id` IS. */
export function ownSide(direction: LineDraft['direction']): MappingSide {
  return direction === 'in' ? 'to' : 'from'
}

function asId(value: unknown): number | null {
  const n = toNumber(value)
  return n === null || n <= 0 ? null : Math.floor(n)
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** Both ends of the reallocation the line describes. */
export function batchMapping(line: LineDraft): BatchMapping {
  const stored = (line.metadata?.[BATCH_MAPPING_KEY] ?? null) as Record<string, unknown> | null
  const own = ownSide(line.direction)
  const counterpart: BatchMapping = {
    from_batch_id: asId(stored?.from_batch_id),
    from_batch_no: asText(stored?.from_batch_no),
    to_batch_id: asId(stored?.to_batch_id),
    to_batch_no: asText(stored?.to_batch_no),
  }
  if (own === 'to') {
    return { ...counterpart, to_batch_id: line.batch_id, to_batch_no: line.batch_no }
  }
  return { ...counterpart, from_batch_id: line.batch_id, from_batch_no: line.batch_no }
}

/** The metadata object that records `mapping`, or the untouched rest of it when there is nothing to record. */
function withMapping(line: LineDraft, mapping: BatchMapping): Record<string, unknown> | null {
  const { [BATCH_MAPPING_KEY]: _previous, ...rest } = line.metadata ?? {}
  const hasMapping =
    mapping.from_batch_id !== null || mapping.to_batch_id !== null || mapping.from_batch_no !== null || mapping.to_batch_no !== null
  const next = hasMapping ? { ...rest, [BATCH_MAPPING_KEY]: mapping } : rest
  return Object.keys(next).length ? next : null
}

/**
 * Put `batch` on one end of the mapping. Setting the end the direction makes the line's own
 * carries the real `batch_id`; setting the other end records intent only.
 */
export function applyBatchMapping(line: LineDraft, side: MappingSide, batch: Pick<BatchRow, 'batch_id' | 'batch_no'> | null): Partial<LineDraft> {
  const mapping: BatchMapping = { ...batchMapping(line) }
  if (side === 'from') {
    mapping.from_batch_id = batch?.batch_id ?? null
    mapping.from_batch_no = batch?.batch_no ?? null
  } else {
    mapping.to_batch_id = batch?.batch_id ?? null
    mapping.to_batch_no = batch?.batch_no ?? null
  }
  const patch: Partial<LineDraft> = { metadata: withMapping(line, mapping) }
  if (side === ownSide(line.direction)) {
    patch.batch_id = batch?.batch_id ?? null
    patch.batch_no = batch?.batch_no ?? null
    // The serials were picked against the old batch; they cannot survive it changing.
    patch.serials = []
  }
  return patch
}

/** Drop both ends of the mapping and the serials picked against them, leaving the rest of the line. */
export function clearBatchMapping(line: LineDraft): Partial<LineDraft> {
  const { [BATCH_MAPPING_KEY]: _mapping, ...rest } = line.metadata ?? {}
  return {
    batch_id: null,
    batch_no: null,
    serials: [],
    metadata: Object.keys(rest).length ? rest : null,
  }
}

/** Flipping in ↔ out swaps which end of the mapping the stored `batch_id` is. */
export function applyDirection(line: LineDraft, direction: 'in' | 'out' | null): Partial<LineDraft> {
  const mapping = batchMapping(line)
  const side = ownSide(direction)
  return {
    direction,
    batch_id: side === 'to' ? mapping.to_batch_id : mapping.from_batch_id,
    batch_no: side === 'to' ? mapping.to_batch_no : mapping.from_batch_no,
    metadata: withMapping(line, mapping),
    serials: [],
  }
}

/** Key of the batch list for an item at a warehouse — how the screen caches `GET /v1/batches`. */
export function batchCatalogKey(itemId: number | null, warehouseId: number | null): string {
  return `${itemId ?? 0}:${warehouseId ?? 0}`
}

export type IssueSeverity = 'error' | 'warning'

export type IssueCode =
  | 'HEADER_DATE_REQUIRED'
  | 'HEADER_WAREHOUSE_REQUIRED'
  | 'NO_LINES'
  | 'ITEM_REQUIRED'
  | 'WAREHOUSE_REQUIRED'
  | 'WAREHOUSE_MISMATCH'
  | 'BATCH_REQUIRED'
  | 'TARGET_BATCH_REQUIRED'
  | 'DIRECTION_REQUIRED'
  | 'QUANTITY_REQUIRED'
  | 'ZERO_QUANTITY'
  | 'NEGATIVE_QUANTITY'
  | 'UNBALANCED_QUANTITY'
  | 'SAME_BATCH_MAPPING'
  | 'DUPLICATE_MAPPING'
  | 'MISSING_SERIALS'
  | 'SERIAL_COUNT_MISMATCH'
  | 'DUPLICATE_SERIAL'
  | 'INSUFFICIENT_STOCK'
  | 'BLOCKED_BATCH'
  | 'EXPIRED_BATCH'

export type IssueField = 'document_date' | 'default_warehouse' | 'item' | 'warehouse' | 'from_batch' | 'to_batch' | 'direction' | 'qty' | 'serials' | null

export interface BatchIssue {
  code: IssueCode
  severity: IssueSeverity
  /** `null` for a document-level issue. */
  lineKey: string | null
  field: IssueField
  message: string
}

export interface BatchValidationContext {
  header: HeaderDraft
  lines: readonly LineDraft[]
  /**
   * Batches known for `batchCatalogKey(item, warehouse)`. A key that is absent simply has not
   * loaded yet — the rules that need batch stock, status or expiry are skipped for it rather
   * than guessed at.
   */
  batchIndex?: ReadonlyMap<string, readonly BatchRow[]>
}

/** Lines the user has actually started — a trailing empty row is not a line. */
export function populatedLines(lines: readonly LineDraft[]): LineDraft[] {
  return lines.filter((l) => !isBlankLine(l))
}

function qtyOf(line: LineDraft): number {
  return toNumber(line.qty) ?? 0
}

function describeLine(line: LineDraft, index: number): string {
  return line.item_name ? `${line.item_name} (line ${index + 1})` : `Line ${index + 1}`
}

function batchOf(index: BatchValidationContext['batchIndex'], line: LineDraft, warehouseId: number | null, batchId: number | null): BatchRow | null {
  if (!index || batchId === null || line.item_id === null) return null
  const rows = index.get(batchCatalogKey(line.item_id, warehouseId))
  return rows?.find((b) => b.batch_id === batchId) ?? null
}

/**
 * Every check the screen can run without asking the server again. Blocking `error`s mirror rules
 * the server would reject anyway (`formModel.validateDraft`); everything a posting would accept
 * is a `warning`, because the backend stays the authority on what may post.
 */
export function validateBatchAdjustment(ctx: BatchValidationContext): BatchIssue[] {
  const { header, batchIndex } = ctx
  const issues: BatchIssue[] = []
  const lines = populatedLines(ctx.lines)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(header.document_date)) {
    issues.push({ code: 'HEADER_DATE_REQUIRED', severity: 'error', lineKey: null, field: 'document_date', message: 'Enter the document date (YYYY-MM-DD).' })
  }
  if (lines.length === 0) {
    issues.push({ code: 'NO_LINES', severity: 'error', lineKey: null, field: null, message: 'Add at least one adjustment line.' })
  }
  if (header.default_warehouse_id === null && lines.some((l) => l.warehouse_id === null)) {
    issues.push({ code: 'HEADER_WAREHOUSE_REQUIRED', severity: 'error', lineKey: null, field: 'default_warehouse', message: 'Pick a default warehouse, or set one on every line.' })
  }

  const mappingSeen = new Map<string, string>()
  const serialSeen = new Map<number, string>()
  const outByBatch = new Map<string, { qty: number; lineKey: string; label: string; batch: BatchRow }>()
  let qtyIn = 0
  let qtyOut = 0

  lines.forEach((line, i) => {
    const label = describeLine(line, i)
    const key = line.key
    const warehouseId = line.warehouse_id ?? header.default_warehouse_id
    const mapping = batchMapping(line)
    const qty = qtyOf(line)

    if (line.item_id === null) {
      issues.push({ code: 'ITEM_REQUIRED', severity: 'error', lineKey: key, field: 'item', message: `${label}: pick an item.` })
    }
    if (warehouseId === null) {
      issues.push({ code: 'WAREHOUSE_REQUIRED', severity: 'error', lineKey: key, field: 'warehouse', message: `${label}: pick a warehouse.` })
    } else if (header.default_warehouse_id !== null && line.warehouse_id !== null && line.warehouse_id !== header.default_warehouse_id) {
      issues.push({ code: 'WAREHOUSE_MISMATCH', severity: 'warning', lineKey: key, field: 'warehouse', message: `${label}: posts to a different warehouse from the document default.` })
    }
    if (!line.direction) {
      issues.push({ code: 'DIRECTION_REQUIRED', severity: 'error', lineKey: key, field: 'direction', message: `${label}: choose in or out.` })
    }

    if (toNumber(line.qty) === null) {
      issues.push({ code: 'QUANTITY_REQUIRED', severity: 'error', lineKey: key, field: 'qty', message: `${label}: enter a quantity.` })
    } else if (qty < 0) {
      issues.push({ code: 'NEGATIVE_QUANTITY', severity: 'error', lineKey: key, field: 'qty', message: `${label}: quantity cannot be negative.` })
    } else if (qty === 0) {
      issues.push({ code: 'ZERO_QUANTITY', severity: 'error', lineKey: key, field: 'qty', message: `${label}: quantity must be greater than zero.` })
    }
    if (line.direction === 'in') qtyIn = round4(qtyIn + Math.max(qty, 0))
    else if (line.direction === 'out') qtyOut = round4(qtyOut + Math.max(qty, 0))

    if (line.track_batch) {
      if (line.batch_id === null) {
        issues.push({
          code: 'BATCH_REQUIRED',
          severity: 'error',
          lineKey: key,
          field: ownSide(line.direction) === 'to' ? 'to_batch' : 'from_batch',
          message: `${label}: pick the batch the quantity ${line.direction === 'in' ? 'lands on' : 'leaves'}.`,
        })
      }
      const counterpartSide: MappingSide = ownSide(line.direction) === 'to' ? 'from' : 'to'
      const counterpartId = counterpartSide === 'to' ? mapping.to_batch_id : mapping.from_batch_id
      if (line.batch_id !== null && counterpartId === null) {
        issues.push({
          code: 'TARGET_BATCH_REQUIRED',
          severity: 'warning',
          lineKey: key,
          field: counterpartSide === 'to' ? 'to_batch' : 'from_batch',
          message: `${label}: name the ${counterpartSide === 'to' ? 'revised' : 'current'} batch so the reallocation reads end to end.`,
        })
      }
      if (mapping.from_batch_id !== null && mapping.from_batch_id === mapping.to_batch_id) {
        issues.push({ code: 'SAME_BATCH_MAPPING', severity: 'warning', lineKey: key, field: 'to_batch', message: `${label}: the current and revised batch are the same, so nothing is reallocated.` })
      }
    }

    if (line.item_id !== null) {
      const signature = [line.item_id, warehouseId ?? 0, line.direction ?? '-', mapping.from_batch_id ?? 0, mapping.to_batch_id ?? 0].join('|')
      const previous = mappingSeen.get(signature)
      if (previous) {
        issues.push({ code: 'DUPLICATE_MAPPING', severity: 'warning', lineKey: key, field: 'from_batch', message: `${label}: repeats the same item, warehouse and batch mapping as an earlier line.` })
      } else {
        mappingSeen.set(signature, key)
      }
    }

    if (line.track_serial) {
      const required = lineBaseQty(line)
      if (line.serials.length === 0) {
        issues.push({ code: 'MISSING_SERIALS', severity: 'warning', lineKey: key, field: 'serials', message: `${label}: serial-tracked — map ${required > 0 ? required : 'the'} serial number(s).` })
      } else if (required > 0 && line.serials.length !== required) {
        issues.push({ code: 'SERIAL_COUNT_MISMATCH', severity: 'error', lineKey: key, field: 'serials', message: `${label}: ${line.serials.length} serial number(s) mapped for a base quantity of ${required}.` })
      }
      for (const serial of line.serials) {
        const previous = serialSeen.get(serial.serial_id)
        if (previous && previous !== key) {
          issues.push({ code: 'DUPLICATE_SERIAL', severity: 'error', lineKey: key, field: 'serials', message: `${label}: serial ${serial.serial_no ?? serial.serial_id} is mapped on more than one line.` })
        } else {
          serialSeen.set(serial.serial_id, key)
        }
      }
    }

    // Batch status, expiry and stock only when the batch list for this item/warehouse has loaded.
    const sourceBatch = batchOf(batchIndex, line, warehouseId, mapping.from_batch_id)
    const targetBatch = batchOf(batchIndex, line, warehouseId, mapping.to_batch_id)
    for (const [batch, field] of [
      [sourceBatch, 'from_batch'],
      [targetBatch, 'to_batch'],
    ] as const) {
      if (!batch) continue
      if (batch.status && batch.status !== 'active') {
        issues.push({ code: 'BLOCKED_BATCH', severity: 'warning', lineKey: key, field, message: `${label}: batch ${batch.batch_no} is ${batch.status}.` })
      }
      if (batch.expiry_date && header.document_date && batch.expiry_date.slice(0, 10) < header.document_date) {
        issues.push({ code: 'EXPIRED_BATCH', severity: 'warning', lineKey: key, field, message: `${label}: batch ${batch.batch_no} expired on ${batch.expiry_date.slice(0, 10)}.` })
      }
    }
    if (line.direction === 'out' && sourceBatch?.stock) {
      const stockKey = `${line.item_id}|${warehouseId ?? 0}|${sourceBatch.batch_id}`
      const seen = outByBatch.get(stockKey)
      const total = round4((seen?.qty ?? 0) + lineBaseQty(line))
      outByBatch.set(stockKey, { qty: total, lineKey: seen?.lineKey ?? key, label: seen?.label ?? label, batch: sourceBatch })
    }
  })

  for (const entry of outByBatch.values()) {
    const available = toNumber(entry.batch.stock?.available) ?? 0
    if (entry.qty > available) {
      issues.push({
        code: 'INSUFFICIENT_STOCK',
        severity: 'warning',
        lineKey: entry.lineKey,
        field: 'qty',
        message: `${entry.label}: batch ${entry.batch.batch_no} shows ${available} available against ${entry.qty} going out.`,
      })
    }
  }

  const variance = round4(qtyIn - qtyOut)
  if (lines.length > 0 && variance !== 0) {
    issues.push({
      code: 'UNBALANCED_QUANTITY',
      severity: 'warning',
      lineKey: null,
      field: null,
      message: `In and out do not balance: ${variance > 0 ? '+' : ''}${variance}. A batch adjustment normally moves the same quantity out of one batch and into another.`,
    })
  }

  return issues
}

export type VarianceRisk = 'low' | 'medium' | 'high'

export interface BatchAdjustmentMetrics {
  /** Lines the user has started. */
  totalLines: number
  /** Of those, the ones with nothing flagged against them. */
  readyLines: number
  totalQtyOut: number
  totalQtyIn: number
  variance: number
  affectedBatches: number
  serialTrackedItems: number
  /** Lines carrying at least one warning or error. */
  exceptionCount: number
  /** Serial-tracked lines whose serial allocation does not yet satisfy the quantity. */
  needsSerialMapping: number
  errorCount: number
  warningCount: number
  varianceRisk: VarianceRisk
}

export function issuesByLine(issues: readonly BatchIssue[]): Map<string, BatchIssue[]> {
  const out = new Map<string, BatchIssue[]>()
  for (const issue of issues) {
    if (issue.lineKey === null) continue
    const bucket = out.get(issue.lineKey)
    if (bucket) bucket.push(issue)
    else out.set(issue.lineKey, [issue])
  }
  return out
}

export function worstSeverity(issues: readonly BatchIssue[]): IssueSeverity | null {
  if (issues.some((i) => i.severity === 'error')) return 'error'
  return issues.length > 0 ? 'warning' : null
}

export function batchAdjustmentMetrics(lines: readonly LineDraft[], issues: readonly BatchIssue[]): BatchAdjustmentMetrics {
  const active = populatedLines(lines)
  const perLine = issuesByLine(issues)
  const batches = new Set<number>()
  const serialItems = new Set<number>()
  let totalQtyIn = 0
  let totalQtyOut = 0
  let needsSerialMapping = 0

  for (const line of active) {
    const qty = Math.max(qtyOf(line), 0)
    if (line.direction === 'in') totalQtyIn = round4(totalQtyIn + qty)
    else if (line.direction === 'out') totalQtyOut = round4(totalQtyOut + qty)
    const mapping = batchMapping(line)
    if (mapping.from_batch_id !== null) batches.add(mapping.from_batch_id)
    if (mapping.to_batch_id !== null) batches.add(mapping.to_batch_id)
    if (line.track_serial && line.item_id !== null) serialItems.add(line.item_id)
    if (line.track_serial && !serialsSatisfied(line)) needsSerialMapping += 1
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length
  const warningCount = issues.length - errorCount
  const variance = round4(totalQtyIn - totalQtyOut)
  const exceptionCount = active.filter((l) => (perLine.get(l.key)?.length ?? 0) > 0).length

  let varianceRisk: VarianceRisk = 'low'
  if (errorCount > 0 || (active.length > 0 && variance !== 0)) varianceRisk = 'high'
  else if (warningCount > 0) varianceRisk = 'medium'

  return {
    totalLines: active.length,
    readyLines: active.length - exceptionCount,
    totalQtyOut,
    totalQtyIn,
    variance,
    affectedBatches: batches.size,
    serialTrackedItems: serialItems.size,
    exceptionCount,
    needsSerialMapping,
    errorCount,
    warningCount,
    varianceRisk,
  }
}

/** A serial-tracked line whose mapped serials match the base quantity it moves. */
export function serialsSatisfied(line: LineDraft): boolean {
  if (!line.track_serial) return true
  const required = lineBaseQty(line)
  if (required <= 0) return line.serials.length === 0
  return line.serials.length === required
}

export type LineStatus = 'empty' | 'matched' | 'changed' | 'serial_required' | 'warning' | 'error'

/** The chip a row shows: what the line is, or the worst thing wrong with it. */
export function lineStatus(line: LineDraft, issues: readonly BatchIssue[]): LineStatus {
  if (isBlankLine(line)) return 'empty'
  const severity = worstSeverity(issues)
  if (severity === 'error') return 'error'
  if (issues.some((i) => i.code === 'MISSING_SERIALS' || i.code === 'SERIAL_COUNT_MISMATCH')) return 'serial_required'
  if (severity === 'warning') return 'warning'
  const mapping = batchMapping(line)
  const reallocates = mapping.from_batch_id !== null && mapping.to_batch_id !== null && mapping.from_batch_id !== mapping.to_batch_id
  return reallocates ? 'changed' : 'matched'
}

export const LINE_STATUS_LABEL: Record<LineStatus, string> = {
  empty: 'New',
  matched: 'Matched',
  changed: 'Changed',
  serial_required: 'Serial required',
  warning: 'Warning',
  error: 'Error',
}

export type CheckStatus = 'passed' | 'warning' | 'issue'

export interface ValidationCheck {
  id: string
  label: string
  status: CheckStatus
  issues: BatchIssue[]
}

const CHECK_GROUPS: { id: string; label: string; codes: IssueCode[] }[] = [
  { id: 'header', label: 'Required header fields', codes: ['HEADER_DATE_REQUIRED', 'HEADER_WAREHOUSE_REQUIRED', 'NO_LINES'] },
  { id: 'warehouse', label: 'Warehouse consistency', codes: ['WAREHOUSE_REQUIRED', 'WAREHOUSE_MISMATCH'] },
  { id: 'selection', label: 'Item and batch selection', codes: ['ITEM_REQUIRED', 'BATCH_REQUIRED', 'TARGET_BATCH_REQUIRED', 'DIRECTION_REQUIRED'] },
  { id: 'quantity', label: 'Zero quantity lines', codes: ['QUANTITY_REQUIRED', 'ZERO_QUANTITY', 'NEGATIVE_QUANTITY'] },
  { id: 'mapping', label: 'Duplicate batch mapping', codes: ['DUPLICATE_MAPPING', 'SAME_BATCH_MAPPING'] },
  { id: 'balance', label: 'Total qty in vs out', codes: ['UNBALANCED_QUANTITY'] },
  { id: 'serials', label: 'Missing serials (for tracked items)', codes: ['MISSING_SERIALS', 'SERIAL_COUNT_MISMATCH', 'DUPLICATE_SERIAL'] },
  { id: 'stock', label: 'Batch stock and status', codes: ['INSUFFICIENT_STOCK', 'BLOCKED_BATCH', 'EXPIRED_BATCH'] },
]

/** The right rail's checklist: one row per rule group, worst state first within the row. */
export function validationChecks(issues: readonly BatchIssue[]): ValidationCheck[] {
  return CHECK_GROUPS.map((group) => {
    const found = issues.filter((i) => group.codes.includes(i.code))
    const severity = worstSeverity(found)
    return {
      id: group.id,
      label: group.label,
      status: severity === 'error' ? 'issue' : severity === 'warning' ? 'warning' : 'passed',
      issues: found,
    }
  })
}

/** "Passed", "2 warnings", "1 issue" — what the chip beside a check says. */
export function checkSummary(check: ValidationCheck): string {
  if (check.status === 'passed') return 'Passed'
  const errors = check.issues.filter((i) => i.severity === 'error').length
  if (errors > 0) return `${errors} issue${errors === 1 ? '' : 's'}`
  const warnings = check.issues.length
  return `${warnings} warning${warnings === 1 ? '' : 's'}`
}

export type LineTab = 'all' | 'exceptions' | 'serials' | 'resolved'

export interface LineTabCounts {
  all: number
  exceptions: number
  serials: number
  resolved: number
}

/**
 * Which lines each tab holds.
 *
 * "Resolved" is a session fact, not a stored one: a line is resolved when it carried an issue
 * earlier in this editing session and carries none now. Nothing is persisted for it.
 */
export function tabLines(lines: readonly LineDraft[], issues: readonly BatchIssue[], everFlagged: ReadonlySet<string>): Record<LineTab, LineDraft[]> {
  const perLine = issuesByLine(issues)
  const active = populatedLines(lines)
  return {
    all: [...lines],
    exceptions: active.filter((l) => (perLine.get(l.key)?.length ?? 0) > 0),
    serials: active.filter((l) => l.track_serial && !serialsSatisfied(l)),
    resolved: active.filter((l) => everFlagged.has(l.key) && (perLine.get(l.key)?.length ?? 0) === 0),
  }
}

export function tabCounts(lines: readonly LineDraft[], issues: readonly BatchIssue[], everFlagged: ReadonlySet<string>): LineTabCounts {
  const groups = tabLines(lines, issues, everFlagged)
  return {
    all: populatedLines(lines).length,
    exceptions: groups.exceptions.length,
    serials: groups.serials.length,
    resolved: groups.resolved.length,
  }
}
