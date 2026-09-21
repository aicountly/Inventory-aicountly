/**
 * The item's free-form attributes — description, notes, provenance, tags and whatever else a
 * company has put on its items.
 *
 * ## Why this is not a schema change
 *
 * `inv_items` has no description column, no tag column and no custom-field table, and adding them
 * to make a screen look fuller would be exactly the kind of change the domain contract rules out.
 * It does have `attributes_json JSONB`, which `ItemsController::buildRow` already round-trips:
 * `attributes` on the way in, `attributes` on the way out. The column has been there since the
 * first migration and nothing in the UI ever surfaced it. This module is that surface.
 *
 * ## The rule that matters
 *
 * Whatever was in the column and is not a field on this screen comes back out untouched. A company
 * that put `{"gsm": 70}` on its paper items through the API must still have it after somebody
 * edits the description in the browser. Unknown scalars become editable custom rows; unknown
 * objects and arrays are preserved verbatim without being rendered, because a text box is not an
 * honest editor for a nested structure.
 */

/** Keys this screen owns. Everything else on the item is custom or preserved. */
const KNOWN_KEYS = ['description', 'notes', 'manufacturer', 'country_of_origin', 'weight', 'dimensions', 'tags'] as const

export interface CustomAttribute {
  key: string
  value: string
}

export interface ItemAttributesDraft {
  description: string
  notes: string
  manufacturer: string
  country_of_origin: string
  weight: string
  dimensions: string
  tags: string[]
  /** Scalar keys already on the item that have no dedicated field here. */
  custom: CustomAttribute[]
  /** Nested values kept verbatim: not shown, not edited, never dropped. */
  preserved: Record<string, unknown>
}

export function emptyAttributes(): ItemAttributesDraft {
  return {
    description: '',
    notes: '',
    manufacturer: '',
    country_of_origin: '',
    weight: '',
    dimensions: '',
    tags: [],
    custom: [],
    preserved: {},
  }
}

const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

const str = (v: unknown): string => (isScalar(v) ? String(v) : '')

/**
 * Tags accept either shape the column may hold: a JSON array from the API, or a comma-separated
 * string from whoever wrote the row by hand. Blank entries and duplicates are dropped, order kept.
 */
export function normaliseTags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const out: string[] = []
  for (const entry of raw) {
    if (!isScalar(entry)) continue
    const tag = String(entry).trim()
    if (!tag) continue
    if (out.some((t) => t.toLowerCase() === tag.toLowerCase())) continue
    out.push(tag)
  }
  return out
}

/**
 * `attributes` as the API returned it → the draft this screen edits.
 *
 * PHP's `json_decode($json, true)` turns `{}` into `[]`, so an item whose attributes were cleared
 * comes back as an empty ARRAY rather than an object. Anything that is not a plain object is
 * therefore read as "nothing recorded" rather than trusted for indexing.
 */
export function attributesToDraft(raw: unknown): ItemAttributesDraft {
  const draft = emptyAttributes()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return draft
  const source = raw as Record<string, unknown>

  draft.description = str(source.description)
  draft.notes = str(source.notes)
  draft.manufacturer = str(source.manufacturer)
  draft.country_of_origin = str(source.country_of_origin)
  draft.weight = str(source.weight)
  draft.dimensions = str(source.dimensions)
  draft.tags = normaliseTags(source.tags)

  for (const [key, value] of Object.entries(source)) {
    if ((KNOWN_KEYS as readonly string[]).includes(key)) continue
    if (value === null || value === undefined) continue
    if (isScalar(value)) draft.custom.push({ key, value: String(value) })
    else draft.preserved[key] = value
  }
  draft.custom.sort((a, b) => a.key.localeCompare(b.key))
  return draft
}

/**
 * The draft → the `attributes` object to send.
 *
 * Empty fields are omitted rather than written as `""`: an attribute nobody filled in should not
 * exist on the row, and a column full of empty strings makes every future reader test for two
 * kinds of absent. Custom rows without a key are dropped; preserved values go back first so a
 * custom row can never shadow one.
 */
export function draftToAttributes(draft: ItemAttributesDraft): Record<string, unknown> {
  const out: Record<string, unknown> = { ...draft.preserved }
  const put = (key: string, value: string) => {
    const trimmed = value.trim()
    if (trimmed) out[key] = trimmed
  }
  put('description', draft.description)
  put('notes', draft.notes)
  put('manufacturer', draft.manufacturer)
  put('country_of_origin', draft.country_of_origin)
  put('weight', draft.weight)
  put('dimensions', draft.dimensions)
  const tags = normaliseTags(draft.tags)
  if (tags.length > 0) out.tags = tags

  for (const row of draft.custom) {
    const key = row.key.trim()
    if (!key) continue
    if ((KNOWN_KEYS as readonly string[]).includes(key)) continue
    const value = row.value.trim()
    if (value) out[key] = value
  }
  return out
}

/** Key order must not decide whether a payload is sent, so both sides are compared sorted. */
function stable(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .map((k) => [k, value[k]]),
  )
}

/**
 * Did the user actually change anything here?
 *
 * The answer decides whether `attributes` rides along in the payload at all. `buildRow` only
 * writes `attributes_json` when the request carries the key, so leaving it out is the difference
 * between "unchanged" and "rewritten with whatever this screen could model" — which matters for
 * an item whose attributes were written by another Aicountly app.
 */
export function attributesChanged(original: unknown, draft: ItemAttributesDraft): boolean {
  return stable(draftToAttributes(attributesToDraft(original))) !== stable(draftToAttributes(draft))
}
