/**
 * One serial's story, assembled from what already exists.
 *
 * `GET /v1/serials/{id}/history` returns two streams — the audit trail and the
 * document lines that carry the serial — and this turns them into one ordered
 * list of things that happened, in words. Nothing here is stored: the lifecycle
 * is a READ across records the posting engine and the audit service already
 * write, which is why it survives this screen being rewritten and why there is
 * no second copy of it to fall out of step.
 *
 * Pure on purpose. The drawer renders what it is given; what an event MEANS is
 * decided here, where it can be tested.
 */

import { humanize } from '../utils/format'
import type { SerialHistoryEvent } from '../services/masters'

export type LifecycleTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export interface LifecycleChange {
  field: string
  label: string
  before: string
  after: string
}

export interface LifecycleEntry {
  id: string
  kind: 'audit' | 'document'
  /** Date or timestamp, as the source recorded it. */
  at: string
  title: string
  detail?: string
  tone: LifecycleTone
  /** Set on document entries — the drawer links to it. */
  documentId?: number
  changes: LifecycleChange[]
}

/** Lookups the drawer already holds, so an id can be shown as a name. */
export interface LifecycleNames {
  warehouses?: Record<string, string>
  locations?: Record<string, string>
  batches?: Record<string, string>
}

/**
 * The fields worth reporting a change in.
 *
 * Deliberately not "every key that differs": an audit snapshot is the whole
 * row, so `updated_at` and `updated_by` differ on every single update and would
 * bury the one change the reader came to find.
 */
const TRACKED_FIELDS: { field: string; label: string; lookup?: keyof LifecycleNames }[] = [
  { field: 'serial_no', label: 'Serial number' },
  { field: 'status', label: 'Status' },
  { field: 'warehouse_id', label: 'Warehouse', lookup: 'warehouses' },
  { field: 'location_id', label: 'Location', lookup: 'locations' },
  { field: 'batch_id', label: 'Batch', lookup: 'batches' },
  { field: 'unit_cost', label: 'Unit cost' },
  { field: 'warranty_until', label: 'Warranty until' },
]

const AUDIT_TITLES: Record<string, { title: string; tone: LifecycleTone }> = {
  'serial.create': { title: 'Serial number registered', tone: 'success' },
  'serial.bulk_create': { title: 'Registered in a bulk upload', tone: 'success' },
  'serial.update': { title: 'Details edited', tone: 'neutral' },
  'serial.bulk_update': { title: 'Edited in a bulk update', tone: 'neutral' },
  'serial.delete': { title: 'Serial number deleted', tone: 'danger' },
}

const STATUS_TONE: Record<string, LifecycleTone> = {
  in_stock: 'success',
  expected: 'info',
  reserved: 'info',
  in_transit: 'info',
  issued: 'neutral',
  returned: 'warning',
  damaged: 'danger',
  scrapped: 'danger',
}

function show(field: string, value: unknown, names: LifecycleNames): string {
  if (value === null || value === undefined || value === '') return '—'
  const spec = TRACKED_FIELDS.find((f) => f.field === field)
  if (spec?.lookup) {
    const key = String(value)
    return names[spec.lookup]?.[key] ?? `#${key}`
  }
  if (field === 'status') return humanize(value)
  return String(value)
}

/** The tracked fields that actually changed between two audit snapshots. */
export function lifecycleChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  names: LifecycleNames = {},
): LifecycleChange[] {
  if (!before || !after) return []
  const changes: LifecycleChange[] = []
  for (const spec of TRACKED_FIELDS) {
    if (!(spec.field in after)) continue
    const a = before[spec.field] ?? null
    const b = after[spec.field] ?? null
    // Compared as text: an id arrives as 12 from one source and "12" from the
    // other, and a lifecycle that reported "Warehouse: #12 → #12" would train
    // the reader to stop reading it.
    if (String(a ?? '') === String(b ?? '')) continue
    changes.push({
      field: spec.field,
      label: spec.label,
      before: show(spec.field, a, names),
      after: show(spec.field, b, names),
    })
  }
  return changes
}

function documentTitle(event: Extract<SerialHistoryEvent, { kind: 'document' }>): string {
  const type = humanize(event.document_type) || 'Document'
  if (event.direction === 'in') return `Received on ${type.toLowerCase()}`
  if (event.direction === 'out') return `Issued on ${type.toLowerCase()}`
  return `Recorded on ${type.toLowerCase()}`
}

function documentDetail(event: Extract<SerialHistoryEvent, { kind: 'document' }>): string | undefined {
  const parts: string[] = []
  if (event.document_no) parts.push(event.document_no)
  if (event.direction === 'in' && event.warehouse_name) parts.push(`into ${event.warehouse_name}`)
  else if (event.direction === 'out' && event.warehouse_name) parts.push(`from ${event.warehouse_name}`)
  else if (event.warehouse_name) parts.push(event.warehouse_name)
  if (event.dest_warehouse_name && event.dest_warehouse_name !== event.warehouse_name) {
    parts.push(`→ ${event.dest_warehouse_name}`)
  }
  if (event.location_code) parts.push(event.location_code)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * The timeline, oldest first.
 *
 * Order is the server's — it merged the two streams by date — and is preserved
 * rather than re-sorted here: a browser re-ordering an audit trail is a browser
 * that can disagree with the audit trail.
 */
export function buildSerialLifecycle(
  events: readonly SerialHistoryEvent[],
  names: LifecycleNames = {},
): LifecycleEntry[] {
  return events.map((event, index) => {
    if (event.kind === 'document') {
      return {
        id: `doc-${event.document_id}-${index}`,
        kind: 'document' as const,
        at: event.at,
        title: documentTitle(event),
        detail: documentDetail(event),
        tone: event.direction === 'in' ? 'success' : event.direction === 'out' ? 'info' : 'neutral',
        documentId: event.document_id,
        changes: [],
      }
    }
    const preset = AUDIT_TITLES[event.action] ?? { title: humanize(event.action), tone: 'neutral' as LifecycleTone }
    const changes = lifecycleChanges(event.before, event.after, names)
    const statusChange = changes.find((c) => c.field === 'status')
    return {
      id: `audit-${event.ref_id}-${index}`,
      kind: 'audit' as const,
      at: event.at,
      // A status change is the headline when there is one: "Details edited"
      // over a row that went from in stock to scrapped buries the only part
      // anybody reads a lifecycle for.
      title: statusChange ? `Status changed to ${statusChange.after}` : preset.title,
      detail: event.reason ?? undefined,
      tone: statusChange
        ? (STATUS_TONE[String(event.after?.status ?? '')] ?? 'neutral')
        : preset.tone,
      changes,
    }
  })
}
