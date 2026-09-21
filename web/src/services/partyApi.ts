/**
 * Party (customer / supplier) lookup for the document editors.
 *
 * ## Where the data comes from, and where it does NOT
 *
 * Parties are **Books** ledgers. Books owns the customer master, the ledger
 * balance, the credit limit and every commercial figure attached to them, and
 * Inventory deliberately keeps no copy of any of it — no mirrored table, no
 * cron, no nightly sync. What Inventory stores is exactly what a stock document
 * needs and nothing more: `party_ref` (the Books `acc_id` the pending quantity
 * is matched on) and `party_name` (a name snapshot, as printed on the challan).
 *
 * So this module answers two questions, both from Inventory's own live API:
 *
 *  1. **Which parties has this company dispatched to before?** — read back off
 *     `inv_documents` through `GET /v1/inventory-documents` (which already
 *     matches `party_name`), deduplicated on the ledger id. It is a recall of
 *     what this company typed on its own documents, not a customer directory.
 *  2. **What does Inventory know about this party right now?** — open pending
 *     challan quantities and the document history, from
 *     `GET /v1/pending-quantities` and the documents list.
 *
 * Outstanding, credit limit, GSTIN and billing address are Books' and are NOT
 * returned here, because no relay serves them to Inventory today. When one is
 * published, `partyDirectory` below is the single seam to point at it: swap the
 * body, keep the shape, and every caller picks the richer answer up. Nothing in
 * this file may be replaced by a local parties table.
 */

import { documentsApi } from './documentsApi'
import { pendingApi } from './stockApi'
import type { DocumentListRow } from '../documents/types'

/** One party as Inventory has it on record. */
export interface PartyOption {
  /** Books ledger id (`acc_id`). Null when only a name was ever typed. */
  party_ref: number | null
  party_name: string
  /** Most recent document date this party appears on (ISO). */
  last_document_date: string | null
  last_document_no: string | null
  /** Documents seen in the sample the search read — an indication, not a total. */
  seen: number
}

/** What Inventory can say about a party. Purely stock-side: no ledger figures. */
export interface PartyContext {
  party_ref: number
  /** Open (unsettled) outward challan quantity, base units. */
  open_challan_qty: number
  open_challan_lines: number
  /** Distinct documents carrying those open lines. */
  open_challan_documents: number
  /** Documents of any type on record for this party in the current scope. */
  documents_on_record: number
  last_document_date: string | null
  last_document_no: string | null
  last_document_type: string | null
  /**
   * Books-owned figures (outstanding, credit limit, GSTIN) are not served to
   * Inventory. True only once a relay exists and answered.
   */
  commercial_available: false
}

function nameOf(row: DocumentListRow): string {
  return (row.party_name ?? '').trim()
}

function keyOf(row: DocumentListRow): string {
  return row.party_ref !== null ? `id:${row.party_ref}` : `name:${nameOf(row).toLowerCase()}`
}

/**
 * Fold a page of documents into distinct parties, newest first.
 *
 * Exported for the unit test: the dedupe rule (ledger id wins over name, the
 * newest document supplies the snapshot) is the whole behaviour here.
 */
export function partiesFromDocuments(rows: DocumentListRow[], limit = 12): PartyOption[] {
  const byKey = new Map<string, PartyOption>()
  for (const row of rows) {
    const name = nameOf(row)
    if (!name && row.party_ref === null) continue
    const key = keyOf(row)
    const existing = byKey.get(key)
    if (existing) {
      existing.seen += 1
      continue
    }
    byKey.set(key, {
      party_ref: row.party_ref,
      party_name: name || `Ledger #${row.party_ref}`,
      last_document_date: row.document_date ?? null,
      last_document_no: row.document_no ?? null,
      seen: 1,
    })
  }
  return [...byKey.values()].slice(0, limit)
}

export const partyDirectory = {
  /**
   * Parties this company has already raised documents for, matching `q`
   * (the list endpoint matches document no. / party name / source no.).
   *
   * `all_fy` so a customer dispatched to last year is still found, and the
   * sample is capped: this is a typeahead, not a report.
   */
  async search(q: string, options: { documentType?: string; limit?: number; signal?: AbortSignal } = {}): Promise<PartyOption[]> {
    const res = await documentsApi.list(
      {
        q: q.trim() || undefined,
        document_type: options.documentType,
        all_fy: true,
        limit: 60,
        sort: 'document_date',
        order: 'desc',
      },
      options.signal,
    )
    return partiesFromDocuments(res.data, options.limit ?? 12)
  },

  /** Stock-side context for one ledger id. Never throws for a missing party — it returns zeroes. */
  async context(partyRef: number, signal?: AbortSignal): Promise<PartyContext> {
    const [pending, documents] = await Promise.all([
      pendingApi.list({ party_ref: partyRef, kind: 'challan', direction: 'out', limit: 500 }, signal),
      documentsApi.list({ party_ref: partyRef, all_fy: true, limit: 1, sort: 'document_date', order: 'desc' }, signal),
    ])
    const open = pending.data.filter((r) => Number(r.qty_open) > 0)
    const latest = documents.data[0] ?? null
    return {
      party_ref: partyRef,
      open_challan_qty: open.reduce((sum, r) => sum + (Number(r.qty_open) || 0), 0),
      open_challan_lines: open.length,
      open_challan_documents: new Set(open.map((r) => r.document_id)).size,
      documents_on_record: documents.meta?.total ?? documents.data.length,
      last_document_date: latest?.document_date ?? null,
      last_document_no: latest?.document_no ?? null,
      last_document_type: latest?.document_type_label ?? latest?.document_type ?? null,
      commercial_available: false,
    }
  },
}
