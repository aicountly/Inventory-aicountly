/**
 * Approval / lifecycle timeline for a document, merged from the document's own stamps, the
 * approvals trail (inv_document_approvals) and — when the user may read it — the audit log.
 */

import type { AuditRow } from '../services/documentsApi'
import type { DocumentApproval, InventoryDocument } from './types'
import type { StatusTone } from './actions'

export interface TimelineEvent {
  when: string
  label: string
  actor: string | null
  note: string | null
  tone: StatusTone
}

const APPROVAL_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  submitted: { label: 'Submitted for approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  rejected: { label: 'Rejected (back to draft)', tone: 'danger' },
}

const AUDIT_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  'document.update': { label: 'Edited', tone: 'neutral' },
  'document.post_failed': { label: 'Posting failed', tone: 'danger' },
  'document.revise': { label: 'Revised (replaced an earlier document)', tone: 'info' },
  'packing.lock': { label: 'Packing list locked', tone: 'info' },
  'packing.unlock': { label: 'Packing list unlocked', tone: 'neutral' },
  'packing.unpack': { label: 'Unpacked back to stock', tone: 'warning' },
  'packing.consume': { label: 'Packed goods sold', tone: 'success' },
}

function note(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export function buildTimeline(doc: InventoryDocument, approvals: DocumentApproval[] = doc.approvals ?? [], audit: AuditRow[] = []): TimelineEvent[] {
  const events: TimelineEvent[] = []
  if (doc.created_at) events.push({ when: doc.created_at, label: `Created${doc.source_app && doc.source_app !== 'inventory' ? ` by ${doc.source_app}` : ''}`, actor: doc.created_by, note: null, tone: 'neutral' })
  for (const a of approvals) {
    const spec = APPROVAL_LABELS[a.action] ?? { label: a.action, tone: 'neutral' as StatusTone }
    events.push({ when: a.created_at, label: spec.label, actor: a.actor_uuid, note: note(a.notes), tone: spec.tone })
  }
  if (doc.approved_at && !approvals.some((a) => a.action === 'approved')) events.push({ when: doc.approved_at, label: 'Approved', actor: doc.approved_by, note: null, tone: 'info' })
  if (doc.posted_at) events.push({ when: doc.posted_at, label: 'Posted', actor: doc.posted_by, note: null, tone: 'success' })
  if (doc.cancelled_at) {
    const reversed = doc.status === 'REVERSED'
    events.push({ when: doc.cancelled_at, label: reversed ? 'Reversed' : 'Cancelled', actor: doc.cancelled_by, note: note(doc.cancel_reason), tone: 'danger' })
  }
  if (doc.status === 'FAILED' && doc.failure_reason && !audit.some((r) => r.action === 'document.post_failed')) {
    events.push({ when: doc.updated_at ?? doc.created_at ?? '', label: 'Posting failed', actor: doc.updated_by, note: note(doc.failure_reason), tone: 'danger' })
  }
  for (const r of audit) {
    const spec = AUDIT_LABELS[r.action]
    if (!spec) continue
    events.push({ when: r.created_at, label: spec.label, actor: r.actor_uuid, note: note(r.reason) ?? note(r.meta?.reason), tone: spec.tone })
  }
  events.sort((a, b) => a.when.localeCompare(b.when))
  return events
}
