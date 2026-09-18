/**
 * The job-worker directory, derived from data Inventory already holds.
 *
 * A job worker IS a Books ledger — `party_ref` is its `acc_id` and Books owns the master
 * (docs/DOMAIN_OWNERSHIP.md). Inventory must not keep a second copy of it, and there is no
 * Books ledger-search endpoint reachable from here today, so this builds the pick list out of
 * the ledgers this company has *actually* sent job work to: the party on its own job-work
 * documents, joined to the pending quantities still open against them.
 *
 * Everything below is therefore a fact already on record, never a guess: a ledger nobody has
 * transacted with simply is not in the list, and the picker falls back to entering the
 * `acc_id` by hand — which is exactly the contract the create payload has always taken.
 */

import type { PendingRow } from '../../services/stockApi'
import type { DocumentListRow } from '../types'
import { round4 } from '../formModel'

export interface JobWorkerOption {
  /** Books `acc_id`. What pending quantities and settlements are matched on. */
  party_ref: number
  /** The name snapshot the last document carried; Books owns the current one. */
  party_name: string | null
  /** Most recent job-work document for this ledger. */
  last_document_date: string | null
  last_document_no: string | null
  last_document_type: string | null
  /** Job-work documents on record for this ledger, in the loaded window. */
  documents: number
  /** Base quantity still open with this job worker (job_work / out). */
  pending_qty: number
  pending_lines: number
  /** Distinct items still out with this job worker. */
  pending_items: number
}

/** `2026-09-18` sorts lexically, and a missing date sorts last. */
function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

/**
 * Fold job-work documents and open pending rows into one entry per ledger.
 *
 * `documents` may hold both JOB_WORK_OUT and JOB_WORK_IN: a ledger that has only ever received
 * a settlement is still a job worker, and leaving it out would hide it from the picker on the
 * very next dispatch.
 */
export function buildJobWorkerOptions(documents: DocumentListRow[], pending: PendingRow[]): JobWorkerOption[] {
  const byRef = new Map<number, JobWorkerOption>()

  const entry = (ref: number): JobWorkerOption => {
    const found = byRef.get(ref)
    if (found) return found
    const fresh: JobWorkerOption = {
      party_ref: ref,
      party_name: null,
      last_document_date: null,
      last_document_no: null,
      last_document_type: null,
      documents: 0,
      pending_qty: 0,
      pending_lines: 0,
      pending_items: 0,
    }
    byRef.set(ref, fresh)
    return fresh
  }

  for (const doc of documents) {
    const ref = Number(doc.party_ref)
    if (!Number.isFinite(ref) || ref <= 0) continue
    const row = entry(ref)
    row.documents += 1
    const date = doc.document_date?.slice(0, 10) ?? null
    // Keep the name and number that belong to the LATEST document: a ledger renamed in Books
    // shows the most recent snapshot, not whichever row the list happened to return first.
    if (date && date === laterOf(row.last_document_date, date) && date !== row.last_document_date) {
      row.last_document_no = doc.document_no
      row.last_document_type = doc.document_type
      if (doc.party_name) row.party_name = doc.party_name
    } else if (row.last_document_date === null) {
      row.last_document_no = doc.document_no
      row.last_document_type = doc.document_type
    }
    row.last_document_date = laterOf(row.last_document_date, date)
    if (!row.party_name && doc.party_name) row.party_name = doc.party_name
  }

  const itemsByRef = new Map<number, Set<number>>()
  for (const p of pending) {
    const ref = Number(p.party_ref)
    if (!Number.isFinite(ref) || ref <= 0) continue
    const row = entry(ref)
    row.pending_qty = round4(row.pending_qty + (Number(p.qty_open) || 0))
    row.pending_lines += 1
    const items = itemsByRef.get(ref) ?? new Set<number>()
    items.add(p.item_id)
    itemsByRef.set(ref, items)
  }
  for (const [ref, items] of itemsByRef) {
    const row = byRef.get(ref)
    if (row) row.pending_items = items.size
  }

  return [...byRef.values()].sort((a, b) => {
    // Whoever still holds material comes first — that is who the next document is most
    // likely for — then by recency, then by name so the order is stable.
    if ((b.pending_qty > 0 ? 1 : 0) !== (a.pending_qty > 0 ? 1 : 0)) return b.pending_qty > 0 ? 1 : -1
    const byDate = (b.last_document_date ?? '').localeCompare(a.last_document_date ?? '')
    if (byDate !== 0) return byDate
    return (a.party_name ?? '').localeCompare(b.party_name ?? '')
  })
}

/** Name or ledger id, case-insensitive. An empty query keeps everything. */
export function filterJobWorkers(options: JobWorkerOption[], query: string): JobWorkerOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return options
  return options.filter((o) => {
    if (String(o.party_ref).includes(q)) return true
    return (o.party_name ?? '').toLowerCase().includes(q)
  })
}

/** A bare number typed into the picker is a ledger id the directory may not know yet. */
export function parseLedgerId(query: string): number | null {
  const trimmed = query.trim()
  if (!/^\d{1,12}$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isFinite(n) && n > 0 ? n : null
}

export interface ItemPendingSummary {
  qty_open: number
  lines: number
  /** Oldest open dispatch date, when the rows carry one. */
  since: string | null
}

/**
 * What is still out with this job worker for one item — the figure that makes a second
 * dispatch an informed decision rather than a blind one. Null when nothing is open, so the
 * caller can omit the hint entirely rather than print a zero.
 */
export function pendingForItem(pending: PendingRow[], partyRef: number | null, itemId: number | null): ItemPendingSummary | null {
  if (!partyRef || !itemId) return null
  let qty = 0
  let lines = 0
  let since: string | null = null
  for (const p of pending) {
    if (Number(p.party_ref) !== partyRef || p.item_id !== itemId) continue
    qty = round4(qty + (Number(p.qty_open) || 0))
    lines += 1
    const date = p.document_date?.slice(0, 10) ?? null
    if (date && (since === null || date < since)) since = date
  }
  return lines === 0 ? null : { qty_open: qty, lines, since }
}
