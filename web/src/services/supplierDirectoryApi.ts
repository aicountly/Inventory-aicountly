/**
 * Finding a supplier for an inward document.
 *
 * A supplier is a **Books ledger**. Inventory stores the ledger id (`party_ref`, the Books
 * `acc_id`) and a name snapshot on the document — that is what pending quantities and
 * settlements are matched on — and it must never grow a supplier master of its own.
 *
 * So there are two live reads here and no local table:
 *
 *  1. **Books** — `v1/books/suppliers`, a read-only relay onto the Books ledger directory.
 *     Authoritative: it knows every supplier, including one Inventory has never seen.
 *     TODO(books-relay): implement it in server-php over `BooksApiClient` (the service key and
 *     the company scope are already there); until then this returns `{ available: false }`.
 *
 *  2. **Inventory's own documents** — the distinct parties already used on inward documents in
 *     this company (`GET /v1/inventory-documents`). Not a master and not a copy: it is the
 *     document register, read live, and at a receiving bench the supplier wanted is nearly
 *     always one used before. This is the fallback while the Books relay is pending, and it
 *     stays useful afterwards as the "recent" section.
 *
 * Either way the ledger id can still be typed by hand, which is what this screen did before.
 */

import { api } from './api'
import type { ItemResponse, ListResponse } from './api'
import { relayCall } from './crossProduct'
import type { RelayResult } from './crossProduct'
import { documentsApi } from './documentsApi'
import { toNumber } from '../utils/format'

export interface SupplierOption {
  /** Books ledger id (acc_id). Null only for a name typed by hand. */
  party_ref: number | null
  party_name: string
  /** Books ledger code / alias, when the directory sends one. */
  ledger_code: string | null
  gstin: string | null
  /** 'books' = the ledger directory; 'recent' = used on an Inventory document before. */
  source: 'books' | 'recent'
  /** Recent only: when this supplier was last received from. */
  last_used: string | null
}

const INWARD_TYPES = 'INWARD_CHALLAN,MATERIAL_RECEIPT,PURCHASE_RECEIPT,OPENING_STOCK'

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

/** Normalise one row of the Books supplier directory; tolerant because the shape is not frozen. */
export function normaliseSupplier(raw: Record<string, unknown>): SupplierOption | null {
  const name = str(raw.acc_name ?? raw.party_name ?? raw.name ?? raw.ledger_name)
  const ref = toNumber(raw.acc_id ?? raw.party_ref ?? raw.id)
  if (!name && ref === null) return null
  return {
    party_ref: ref,
    party_name: name ?? `Ledger #${ref}`,
    ledger_code: str(raw.acc_code ?? raw.ledger_code ?? raw.code),
    gstin: str(raw.gstin ?? raw.gst_no ?? raw.tax_no),
    source: 'books',
    last_used: null,
  }
}

export const supplierDirectoryApi = {
  /** Supplier ledgers from Books, or why they could not be read. */
  async search(q: string, signal?: AbortSignal): Promise<RelayResult<SupplierOption[]>> {
    const result = await relayCall(
      () =>
        api.get<ItemResponse<unknown[]> | ListResponse<unknown>>('v1/books/suppliers', {
          query: { q: q.trim() || undefined, limit: 20 },
          signal,
        }),
      'the Books supplier directory',
    )
    if (!result.available) return result
    const rows = Array.isArray(result.data?.data) ? (result.data.data as Record<string, unknown>[]) : []
    return { available: true, data: rows.map(normaliseSupplier).filter((s): s is SupplierOption => s !== null) }
  },

  /**
   * Suppliers already used on inward documents in this company, most recent first.
   *
   * Inventory's own register, read live — never a stored supplier list.
   */
  async recent(q: string, signal?: AbortSignal): Promise<SupplierOption[]> {
    const res = await documentsApi.list(
      { document_type: INWARD_TYPES, q: q.trim() || undefined, limit: 60, sort: 'document_date', order: 'desc', all_fy: true },
      signal,
    )
    const seen = new Map<string, SupplierOption>()
    for (const row of res.data ?? []) {
      const name = str(row.party_name)
      if (!name && row.party_ref === null) continue
      const key = row.party_ref !== null ? `ref:${row.party_ref}` : `name:${(name ?? '').toLowerCase()}`
      if (seen.has(key)) continue
      seen.set(key, {
        party_ref: row.party_ref,
        party_name: name ?? `Ledger #${row.party_ref}`,
        ledger_code: null,
        gstin: null,
        source: 'recent',
        last_used: row.document_date ?? null,
      })
    }
    return [...seen.values()]
  },
}

/** Merge the two sources, Books first, dropping a recent row the directory already covered. */
export function mergeSuppliers(books: SupplierOption[], recent: SupplierOption[]): SupplierOption[] {
  const known = new Set(books.map((s) => (s.party_ref !== null ? `ref:${s.party_ref}` : `name:${s.party_name.toLowerCase()}`)))
  const extra = recent.filter((s) => !known.has(s.party_ref !== null ? `ref:${s.party_ref}` : `name:${s.party_name.toLowerCase()}`))
  return [...books, ...extra]
}
