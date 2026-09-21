import type { ItemSearchRow } from '../../services/items'
import type { ItemFormState } from './itemForm'

/**
 * What this company's existing items say about the draft on screen.
 *
 * ## Why this is a warning and not a gate
 *
 * The API is the authority on the two that matter, and it already is one: `buildRow` in
 * ItemsController refuses a repeated item name and a repeated SKU with a 409 naming the field, so
 * a duplicate cannot be created whether or not this module exists. All it does is say so before
 * the round trip, while the name is still under the cursor and cheap to change.
 *
 * A merely SIMILAR name is never treated as a conflict. Real catalogues carry "Bolt M8" and
 * "Bolt M8 galvanised", and a screen that argued with the second one would be wrong far more often
 * than it was right — so it is reported and nothing is blocked. A shared BARCODE is reported too,
 * and is likewise not a conflict: the server has no uniqueness rule on `item_upc`, and inventing
 * one on the client would refuse a save the API would have accepted.
 */

export type DuplicateReason = 'name' | 'sku' | 'barcode' | 'similar'

export interface DuplicateMatch {
  item: ItemSearchRow
  reason: DuplicateReason
  /** `conflict` is what the API refuses on save; `warning` is only worth a look. */
  severity: 'conflict' | 'warning'
  message: string
}

/** The most matches worth showing: past four the panel is a list, not a warning. */
const MAX_MATCHES = 4

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase()

export function classifyDuplicates(
  form: ItemFormState,
  rows: readonly ItemSearchRow[],
  excludeItemId: number | null = null,
): DuplicateMatch[] {
  const name = norm(form.item_name)
  const sku = norm(form.item_sku)
  const barcode = norm(form.item_upc)
  if (name === '' && sku === '' && barcode === '') return []

  const out: DuplicateMatch[] = []
  const seen = new Set<number>()
  for (const item of rows) {
    if (excludeItemId !== null && item.item_id === excludeItemId) continue
    if (seen.has(item.item_id)) continue

    let match: DuplicateMatch | null = null
    if (name !== '' && norm(item.item_name) === name) {
      match = {
        item,
        reason: 'name',
        severity: 'conflict',
        message: 'An item with this exact name already exists. The API refuses a second one.',
      }
    } else if (sku !== '' && norm(item.item_sku) === sku) {
      match = {
        item,
        reason: 'sku',
        severity: 'conflict',
        message: 'This SKU is already taken. SKUs are unique within the company.',
      }
    } else if (barcode !== '' && norm(item.item_upc) === barcode) {
      match = {
        item,
        reason: 'barcode',
        severity: 'warning',
        message: 'This barcode is already on another item, so a scan will not tell them apart.',
      }
    } else if (
      name.length >= 3 &&
      (norm(item.item_name).includes(name) || name.includes(norm(item.item_name)) || norm(item.item_alias) === name)
    ) {
      match = {
        item,
        reason: 'similar',
        severity: 'warning',
        message: 'A similar item already exists. Check it before creating another.',
      }
    }

    if (match) {
      seen.add(item.item_id)
      out.push(match)
    }
  }

  // Conflicts first: they are the ones that will stop a save.
  return out
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'conflict' ? -1 : 1))
    .slice(0, MAX_MATCHES)
}

/** `true` when the draft names something the API will refuse outright. */
export function hasBlockingDuplicate(matches: readonly DuplicateMatch[]): boolean {
  return matches.some((m) => m.severity === 'conflict')
}
