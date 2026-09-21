/**
 * Recent bulk edits, read out of the audit trail rather than remembered here.
 *
 * `POST /v1/items/bulk-update` writes one `item.bulk_update` audit row PER ITEM
 * (ItemsController::bulkUpdate), all sharing the request id the server stamps on
 * every row of one HTTP request (ClientRequestContext::requestId). So "12 items
 * · today, 10:24" is not a figure this screen keeps — it is those twelve rows
 * grouped back into the one operation that produced them.
 *
 * Nothing is invented. A batch reports the field and the value only when every
 * row in it agrees; where they differ it says "several fields", because the
 * alternative is picking one row's value and presenting it as the batch's.
 */

import type { AuditLogRow } from '../../../services/auditApi'
import type { ItemFormOptions } from '../../../services/items'
import { formatDateTime, humanize } from '../../../utils/format'
import { BULK_EDIT_FIELDS, formatFieldValue } from './bulkEditFields'

export interface BulkEditBatch {
  /** The request id, or a synthesised key for rows recorded without one. */
  id: string
  /** ISO timestamp of the newest row in the batch. */
  at: string
  actorUuid: string | null
  itemCount: number
  itemIds: number[]
  /** The one field every row changed, or null when they differ. */
  field: string | null
  /** The one value every row was given, or null when they differ. `''` = cleared. */
  value: string | null
  /** The audit rows themselves, newest first — the drawer reads these. */
  rows: AuditLogRow[]
}

function afterValue(row: AuditLogRow, field: string): string | null {
  const after = row.after
  if (!after || typeof after !== 'object') return null
  if (!(field in after)) return null
  const v = (after as Record<string, unknown>)[field]
  if (v === null || v === undefined) return ''
  return String(v)
}

/** The fields one audit row says it changed — from `meta.fields`, else from `after`. */
function changedFields(row: AuditLogRow): string[] {
  const metaFields = row.meta && typeof row.meta === 'object' ? (row.meta as Record<string, unknown>).fields : null
  if (Array.isArray(metaFields)) return metaFields.filter((f): f is string => typeof f === 'string')
  return row.after && typeof row.after === 'object' ? Object.keys(row.after) : []
}

/**
 * One batch per request id, newest first.
 *
 * Rows with no request id (an older entry, a path that did not stamp one) are
 * NOT swept into one bucket: they are kept apart by actor and timestamp, so two
 * unrelated edits a week apart cannot be reported as a single operation on
 * fourteen items.
 */
export function groupBulkEdits(rows: readonly AuditLogRow[]): BulkEditBatch[] {
  const buckets = new Map<string, AuditLogRow[]>()
  for (const row of rows) {
    const key = row.request_id?.trim() || `${row.actor_uuid ?? 'system'}@${row.created_at}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(row)
    else buckets.set(key, [row])
  }

  const batches: BulkEditBatch[] = []
  for (const [id, bucket] of buckets) {
    const sorted = [...bucket].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    const fields = new Set<string>()
    for (const row of sorted) for (const f of changedFields(row)) fields.add(f)
    const field = fields.size === 1 ? [...fields][0] : null

    let value: string | null = null
    if (field) {
      const values = new Set(sorted.map((r) => afterValue(r, field)).filter((v): v is string => v !== null))
      value = values.size === 1 ? [...values][0] : null
    }

    batches.push({
      id,
      at: sorted[0].created_at,
      actorUuid: sorted[0].actor_uuid,
      itemCount: new Set(sorted.map((r) => r.entity_id)).size,
      itemIds: [...new Set(sorted.map((r) => r.entity_id))],
      field,
      value,
      rows: sorted,
    })
  }

  return batches.sort((a, b) => (a.at < b.at ? 1 : -1))
}

/** "HSN / SAC" for a key this screen knows, a humanised column name otherwise. */
export function fieldLabel(field: string | null): string {
  if (!field) return 'Several fields'
  return BULK_EDIT_FIELDS.find((f) => f.key === field)?.label ?? humanize(field)
}

/**
 * One line for a history row: what changed, and to what.
 *
 * Three shapes, because there are three things that can have happened: a value
 * was set, a value was cleared, or the batch touched more than one field and
 * there is no single value to name.
 */
export function describeBatch(batch: BulkEditBatch, options: ItemFormOptions | null): string {
  const label = fieldLabel(batch.field)
  if (!batch.field || batch.value === null) return `${label} updated`
  if (batch.value === '') return `${label} cleared`
  const spec = BULK_EDIT_FIELDS.find((f) => f.key === batch.field)
  const shown = spec ? formatFieldValue(spec, batch.value, options) : batch.value
  return `${label} set to ${shown}`
}

/**
 * `Today, 10:24` for something that happened today, `12 Jun 2026, 10:24`
 * otherwise.
 *
 * "Today" is decided by comparing the DATE PART of the server's timestamp with
 * the browser's own date. The API sends company-local time, so the two agree
 * for a reader sitting in the company's timezone — the assumption every
 * "today" label in every product makes. It degrades to the full date rather
 * than to a wrong word: an unparseable value never becomes "Today".
 */
export function formatWhen(value: string | null | undefined, now: Date = new Date()): string {
  const full = formatDateTime(value)
  if (!value) return full
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  if (!m) return full
  const pad = (n: number) => String(n).padStart(2, '0')
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${m[1]}-${m[2]}-${m[3]}` === today ? `Today, ${m[4]}:${m[5]}` : full
}
