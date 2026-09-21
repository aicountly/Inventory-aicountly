/**
 * Resolving typed / scanned serial numbers against the live serial master.
 *
 * There is no bulk serial-validation endpoint (see the completion notes), so a pasted list of
 * 300 serials could only be checked one request at a time. Two things keep that from being 300
 * round trips in a row:
 *
 *  1. A list produced by a scanner or a spreadsheet almost always shares a prefix
 *     (`DELL-10001`, `DELL-10002`, …). One `GET /v1/serials?q=<common prefix>&q_mode=prefix`
 *     brings the whole block back in a single request, and the rest is matched in memory.
 *  2. Whatever the prefix pass missed is looked up individually through a small worker pool,
 *     so the browser holds a handful of connections rather than hundreds.
 *
 * Correctness never depends on (1): a serial the prefix pass did not return is always looked up
 * exactly before it is called missing, and a truncated prefix response disables the shortcut
 * altogether. It is an optimisation, not a source of truth.
 */

import { isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow, SerialLookupRow } from '../../services/lookupApi'
import { baseUnitOf } from './model'

/** How many individual lookups may be in flight at once. */
const POOL_SIZE = 5

/** Below this the prefix pass is not worth a request of its own. */
const PREFIX_MIN_BATCH = 8
const PREFIX_MIN_LENGTH = 3
const PREFIX_LIMIT = 500

export interface ResolvedSerial {
  /** The value asked for, trimmed — not what came back. */
  query: string
  row: SerialLookupRow | null
  /** Set when the lookup itself failed, as opposed to finding nothing. */
  error: string | null
}

/** The longest prefix every value shares, case-sensitively. */
export function commonPrefix(values: string[]): string {
  if (values.length === 0) return ''
  let prefix = values[0]
  for (const value of values.slice(1)) {
    let i = 0
    while (i < prefix.length && i < value.length && prefix[i] === value[i]) i += 1
    prefix = prefix.slice(0, i)
    if (prefix === '') break
  }
  return prefix
}

/** Run `task` over `values` with at most `size` in flight, preserving input order in the result. */
export async function pooled<T, R>(values: T[], size: number, task: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(size, values.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= values.length) return
      out[index] = await task(values[index], index)
    }
  })
  await Promise.all(workers)
  return out
}

export async function resolveSerial(serialNo: string, signal?: AbortSignal): Promise<ResolvedSerial> {
  const query = serialNo.trim()
  try {
    const row = await lookupApi.findSerialExact(query, signal)
    return { query, row, error: null }
  } catch (err) {
    if (isAbortError(err)) throw err
    return { query, row: null, error: err instanceof Error ? err.message : 'Could not check this serial number.' }
  }
}

export interface ResolveManyOptions {
  signal?: AbortSignal
  /** Called as results land so a long list can fill in progressively. */
  onProgress?: (done: number, total: number) => void
}

export async function resolveSerials(serialNos: string[], options: ResolveManyOptions = {}): Promise<ResolvedSerial[]> {
  const queries = serialNos.map((s) => s.trim()).filter((s) => s !== '')
  if (queries.length === 0) return []

  const found = new Map<string, SerialLookupRow>()
  const prefix = commonPrefix(queries)
  if (queries.length >= PREFIX_MIN_BATCH && prefix.length >= PREFIX_MIN_LENGTH) {
    try {
      const rows = await lookupApi.findSerials(prefix, { limit: PREFIX_LIMIT, signal: options.signal })
      // A full page means the server had more to give: matching against a truncated block
      // would report serials as missing that exist, so the shortcut is dropped entirely.
      if (rows.length < PREFIX_LIMIT) {
        for (const row of rows) found.set(row.serial_no.trim().toLowerCase(), row)
      }
    } catch (err) {
      if (isAbortError(err)) throw err
      // The individual pass below is the real check; a failed shortcut costs nothing.
    }
  }

  let done = 0
  const total = queries.length
  const report = () => {
    done += 1
    options.onProgress?.(done, total)
  }

  return pooled(queries, POOL_SIZE, async (query) => {
    const hit = found.get(query.toLowerCase())
    if (hit) {
      report()
      return { query, row: hit, error: null }
    }
    const result = await resolveSerial(query, options.signal)
    report()
    return result
  })
}

/**
 * Base unit and conversion factor for each item id, from `POST /v1/items/bulk-lookup`.
 *
 * A serial row must post in the item's base unit — one serial is one piece, and a row counted
 * in Boxes would send `qty: 1` for a serial worth a twelfth of that. The lookup does not carry
 * the item's unit table, so the items are fetched once per batch of new ids.
 */
export async function fetchBaseUnits(itemIds: number[], signal?: AbortSignal): Promise<Map<number, { unit_id: number | null; conversion_factor: number }>> {
  const out = new Map<number, { unit_id: number | null; conversion_factor: number }>()
  const ids = [...new Set(itemIds)].filter((id) => Number.isFinite(id))
  if (ids.length === 0) return out
  const items: ItemSearchRow[] = await lookupApi.itemsByIds(ids, signal)
  for (const item of items) out.set(item.item_id, baseUnitOf(item))
  return out
}
