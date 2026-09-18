import type { ItemFormOptions, ItemSearchRow } from '../../../services/items'
import { toNumber } from '../../../utils/format'
import type { ItemFormState } from '../itemForm'

/**
 * Everything the item form knows about an item WITHOUT asking a server.
 *
 * ## Why this is deterministic and not a model
 *
 * There is no inventory-intelligence endpoint in this API — no classifier, no
 * HSN oracle, no "items like yours" analytics. Rather than invent one, or
 * hardcode an answer and present it as a backend result, every recommendation
 * and every suggestion below is derived from two things the screen already
 * holds honestly: the draft the user is typing, and this company's own master
 * data (`GET /v1/items/form-options`) and existing items (`GET /v1/items/search`).
 *
 * So the panel never claims "most businesses in your sector track batches".
 * It says "this item has a shelf life and batch tracking is off", which is a
 * fact about the form, and "Brand 'Sunfeast' matches this item's name", which
 * is a fact about the company's own brand list. Both are checkable by the
 * reader, which is the bar a finance product has to clear.
 *
 * Pure and side-effect free on purpose: all of it is unit-tested, and the panel
 * re-derives on every keystroke, so nothing here may allocate a request.
 */

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type StepId = 'identity' | 'classification' | 'units' | 'valuation'

export interface StepSpec {
  id: StepId
  label: string
  /** Element id the desktop stepper scrolls to. */
  anchor: string
}

/**
 * Four steps, the labels from the design. They are reading order, not a state
 * machine: on desktop every section is on the page at once and a step is an
 * anchor. Only the narrow layout walks them one at a time.
 */
export const ITEM_FORM_STEPS: readonly StepSpec[] = [
  { id: 'identity', label: 'Identity', anchor: 'item-identity' },
  { id: 'classification', label: 'Classification', anchor: 'item-classification' },
  { id: 'units', label: 'Units', anchor: 'item-units' },
  { id: 'valuation', label: 'Valuation', anchor: 'item-valuation' },
] as const

/** Which step owns a validation key, so a failed save can mark the step red. */
const FIELD_STEP: Record<string, StepId> = {
  item_name: 'identity',
  item_alias: 'identity',
  print_name: 'identity',
  item_type: 'identity',
  item_sku: 'identity',
  item_upc: 'identity',
  hsn_sac: 'identity',
  mrp: 'identity',
  is_active: 'identity',
  item_grp_id: 'classification',
  stock_cat_id: 'classification',
  brand_id: 'classification',
  itc_eligibility: 'classification',
  unit_id: 'units',
  purchase_unit_id: 'units',
  sales_unit_id: 'units',
  valuation_method: 'valuation',
  standard_cost: 'valuation',
  negative_stock_policy: 'valuation',
  shelf_life_days: 'valuation',
  min_stock_qty: 'valuation',
  max_stock_qty: 'valuation',
  reorder_point_qty: 'valuation',
  reorder_qty: 'valuation',
  safety_stock_qty: 'valuation',
  lead_time_days: 'valuation',
  default_warehouse_id: 'valuation',
}

export function stepOfFieldKey(key: string): StepId | null {
  if (key.startsWith('unitLines.')) return 'units'
  if (key.startsWith('openings.')) return 'valuation'
  return FIELD_STEP[key] ?? null
}

/** The steps that hold at least one of these validation errors. */
export function stepsWithErrors(errors: Record<string, string>): Set<StepId> {
  const out = new Set<StepId>()
  for (const key of Object.keys(errors)) {
    const step = stepOfFieldKey(key)
    if (step) out.add(step)
  }
  return out
}

// ---------------------------------------------------------------------------
// Completeness
// ---------------------------------------------------------------------------

export type GroupState = 'complete' | 'partial' | 'todo' | 'error'

export interface CompletenessGroup {
  id: StepId
  label: string
  state: GroupState
}

export interface Completeness {
  percent: number
  groups: CompletenessGroup[]
}

const filled = (v: string): boolean => v.trim() !== ''

/**
 * How far the draft is from a well-described item.
 *
 * The two fields the API actually refuses to create an item without — the name
 * and the base unit — carry 70 of the 100 points between them, so a valid item
 * never reads as barely started. The remaining 30 are the optional detail that
 * makes the item usable downstream (classification, an identifier, HSN, a
 * price, a reorder point); a blank optional field lowers the score, but it can
 * never drag a saveable item below 70.
 */
export function computeCompleteness(form: ItemFormState, errors: Record<string, string> = {}): Completeness {
  const isStock = form.item_type === 'stock'
  const mandatory = [filled(form.item_name), filled(form.unit_id)]
  const optional = [
    filled(form.item_grp_id) || filled(form.stock_cat_id) || filled(form.brand_id),
    filled(form.item_sku) || filled(form.item_upc),
    filled(form.hsn_sac),
    filled(form.mrp) || filled(form.standard_cost),
    !isStock || filled(form.reorder_point_qty) || filled(form.min_stock_qty),
  ]
  const mandatoryScore = (mandatory.filter(Boolean).length / mandatory.length) * 70
  const optionalScore = (optional.filter(Boolean).length / optional.length) * 30
  const percent = Math.round(mandatoryScore + optionalScore)

  const errored = stepsWithErrors(errors)
  const state = (id: StepId, done: boolean, started: boolean): GroupState =>
    errored.has(id) ? 'error' : done ? 'complete' : started ? 'partial' : 'todo'

  const identityExtras = [form.item_alias, form.item_sku, form.item_upc, form.hsn_sac, form.mrp].some(filled)
  const classificationPicked = [form.item_grp_id, form.stock_cat_id, form.brand_id].filter(filled).length
  const trackingConfigured =
    form.track_batch || form.track_serial || form.track_expiry || filled(form.reorder_point_qty) || filled(form.standard_cost)

  return {
    percent,
    groups: [
      { id: 'identity', label: 'Identity', state: state('identity', filled(form.item_name) && identityExtras, filled(form.item_name)) },
      { id: 'classification', label: 'Classification', state: state('classification', classificationPicked === 3, classificationPicked > 0) },
      { id: 'units', label: 'Units', state: state('units', filled(form.unit_id), filled(form.unit_id)) },
      { id: 'valuation', label: 'Valuation & tracking', state: state('valuation', filled(form.valuation_method) && trackingConfigured, filled(form.valuation_method)) },
    ],
  }
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export type InsightTone = 'good' | 'warning' | 'info'

export interface Insight {
  id: string
  tone: InsightTone
  text: string
  /** Step to jump to when the reader acts on it. */
  step?: StepId
}

export interface InsightContext {
  /** Units the item actually carries a conversion for — the base plus its alternates. */
  itemUnitIds: Set<string>
  /** Company default from `GET /v1/items/form-options`. */
  defaultValuationMethod?: string
  unitLabel?: (unitId: string) => string
}

/**
 * Every recommendation is a statement about THIS draft that the reader can
 * check against the fields in front of them. Nothing here is a market claim,
 * an average or a benchmark: this API reports none of those, so the panel does
 * not pretend to know them.
 */
export function deriveInsights(form: ItemFormState, ctx: InsightContext): Insight[] {
  const out: Insight[] = []
  const isStock = form.item_type === 'stock'
  const shelfLife = toNumber(form.shelf_life_days) ?? 0
  const mrp = toNumber(form.mrp)
  const standardCost = toNumber(form.standard_cost)
  const minQty = toNumber(form.min_stock_qty)
  const maxQty = toNumber(form.max_stock_qty)
  const unitName = ctx.unitLabel ?? ((id: string) => `unit #${id}`)

  if (filled(form.hsn_sac)) {
    if (/^[0-9A-Za-z]{4,8}$/.test(form.hsn_sac.trim())) {
      out.push({ id: 'hsn-ok', tone: 'good', text: 'HSN / SAC is in the 4–8 character format the API accepts.' })
    }
  } else {
    out.push({ id: 'hsn-missing', tone: 'info', text: 'No HSN / SAC yet. Smart Books uses it on the documents that carry this item.', step: 'identity' })
  }

  if (form.item_grp_id || form.stock_cat_id || form.brand_id) {
    const picked = [form.item_grp_id, form.stock_cat_id, form.brand_id].filter(filled).length
    if (picked === 3) out.push({ id: 'classified', tone: 'good', text: 'Group, category and brand are all set — stock reports can slice on every one.' })
    else out.push({ id: 'classified-partial', tone: 'info', text: 'Some classification is set. The rest sharpens group, category and brand reporting.', step: 'classification' })
  } else {
    out.push({ id: 'unclassified', tone: 'info', text: 'No group, category or brand. Reports that slice on them will not see this item.', step: 'classification' })
  }

  if (shelfLife > 0 && !form.track_batch) {
    out.push({ id: 'shelf-no-batch', tone: 'warning', text: 'A shelf life is set but batches are not tracked — the expiry has no batch to sit on.', step: 'valuation' })
  }
  if (form.track_expiry && !form.track_batch) {
    out.push({ id: 'expiry-no-batch', tone: 'warning', text: 'Expiry tracking records dates against batches. Turn on batch tracking as well.', step: 'valuation' })
  }
  if (form.track_batch && shelfLife <= 0) {
    out.push({ id: 'batch-no-shelf', tone: 'info', text: 'Set a shelf life and each batch expiry is filled from its manufacturing date.', step: 'valuation' })
  }
  if (form.track_serial) {
    out.push({ id: 'serial-on', tone: 'info', text: 'Every unit will need a serial number on the stock documents that move this item.' })
  }
  if (!isStock && (form.track_batch || form.track_serial || form.track_expiry)) {
    out.push({ id: 'tracking-non-stock', tone: 'warning', text: 'Tracking flags are set on an item that does not hold stock, so nothing will record them.', step: 'identity' })
  }

  if (isStock && !filled(form.reorder_point_qty)) {
    out.push({ id: 'no-reorder', tone: 'warning', text: 'No reorder point. The replenishment report only lists items that have one.', step: 'valuation' })
  }
  if (isStock && filled(form.reorder_point_qty) && !filled(form.reorder_qty)) {
    out.push({ id: 'no-reorder-qty', tone: 'info', text: 'A reorder quantity tells the replenishment report how much to suggest ordering.', step: 'valuation' })
  }
  if (minQty !== null && maxQty !== null && maxQty > 0 && minQty > maxQty) {
    out.push({ id: 'min-over-max', tone: 'warning', text: 'The minimum stock level is above the maximum. Check both figures.', step: 'valuation' })
  }
  if (mrp !== null && standardCost !== null && standardCost > 0 && mrp > 0 && mrp < standardCost) {
    out.push({ id: 'mrp-below-cost', tone: 'warning', text: 'MRP is below the standard cost. Confirm both are per the base unit.', step: 'identity' })
  }

  for (const [key, label] of [
    ['purchase_unit_id', 'Purchase'],
    ['sales_unit_id', 'Sales'],
  ] as const) {
    const value = form[key]
    if (filled(value) && !ctx.itemUnitIds.has(value)) {
      out.push({
        id: `${key}-unconverted`,
        tone: 'warning',
        text: `The ${label.toLowerCase()} unit ${unitName(value)} has no conversion on this item. Add it as an alternate unit.`,
        step: 'units',
      })
    }
  }

  if (ctx.defaultValuationMethod && filled(form.valuation_method) && form.valuation_method !== ctx.defaultValuationMethod) {
    out.push({
      id: 'method-differs',
      tone: 'info',
      text: `Valuation is ${form.valuation_method}; this company's default is ${ctx.defaultValuationMethod}.`,
      step: 'valuation',
    })
  }

  if (!form.is_active) {
    out.push({ id: 'inactive', tone: 'warning', text: 'This item will be created inactive, so it stays out of every picker until it is activated.', step: 'identity' })
  }

  return out
}

// ---------------------------------------------------------------------------
// Local suggestions (the "AI Assist" drawer)
// ---------------------------------------------------------------------------

export type SuggestionField = 'print_name' | 'item_alias' | 'item_sku' | 'item_grp_id' | 'stock_cat_id' | 'brand_id' | 'hsn_sac' | 'valuation_method'

export interface Suggestion {
  field: SuggestionField
  label: string
  /** The value that would be written into the form state. */
  value: string
  /** What the user sees — a master's name rather than its id. */
  display: string
  /** Where it came from, in the user's words. Never a claim about other businesses. */
  source: string
  /** The value in the form right now, if any — shown as `current → proposed`. */
  current: string | null
  currentDisplay: string | null
}

const ALPHA_NUM = /[^A-Za-z0-9]+/g

/** `Paracetamol 500mg` → `PARA`. Upper-cased, letters and digits only. */
export function skuToken(value: string, length: number): string {
  return value.replace(ALPHA_NUM, '').toUpperCase().slice(0, length)
}

/**
 * A short alias from the item name: initials when the name has three or more
 * words, otherwise the first four characters — plus the first multi-digit run,
 * which in practice is the strength or the pack size.
 */
export function suggestAlias(itemName: string): string {
  const words = itemName.trim().split(/\s+/).filter(Boolean)
  const alphaWords = words.filter((w) => /[A-Za-z]/.test(w))
  if (alphaWords.length === 0) return ''
  const digits = itemName.match(/\d{2,}/)?.[0] ?? ''
  const base =
    alphaWords.length >= 3
      ? alphaWords
          .slice(0, 4)
          .map((w) => w.replace(ALPHA_NUM, '').charAt(0))
          .join('')
          .toUpperCase()
      : skuToken(alphaWords[0], 4)
  return [base, digits].filter(Boolean).join(' ').trim()
}

/**
 * A SKU that is unique enough to submit and short enough to read:
 * `<group or brand>-<name><digits>-<clock>`.
 *
 * The suffix is the clock in base 36 rather than a random string so the same
 * draft at the same instant produces the same SKU and the test can pin it. The
 * API is still the authority — it refuses a duplicate SKU with a 409 on
 * `item_sku`, which the form shows on the field.
 */
export function generateSku(form: ItemFormState, options: ItemFormOptions | null, now: number = Date.now()): string {
  const group = options?.item_groups.find((g) => String(g.item_grp_id) === form.item_grp_id)
  const brand = options?.brands.find((b) => String(b.brand_id) === form.brand_id)
  const category = options?.stock_categories.find((c) => String(c.stock_cat_id) === form.stock_cat_id)
  const prefix = skuToken(group?.grp_name ?? brand?.brand_name ?? category?.cat_name ?? '', 3)
  const words = form.item_name.trim().split(/\s+/).filter(Boolean)
  const core = `${skuToken(words[0] ?? 'ITEM', 4)}${(form.item_name.match(/\d{1,4}/)?.[0] ?? '')}`
  const suffix = Math.floor(now % 36 ** 4)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0')
  return [prefix, core || 'ITEM', suffix].filter(Boolean).join('-').slice(0, 64)
}

/** The master whose name is named by the item's own name, longest match first. */
function matchMaster<T>(rows: readonly T[], nameOf: (row: T) => string, itemName: string): T | null {
  const haystack = ` ${itemName.toLowerCase().replace(ALPHA_NUM, ' ').trim()} `
  let best: T | null = null
  let bestLength = 0
  for (const row of rows) {
    const name = nameOf(row).toLowerCase().replace(ALPHA_NUM, ' ').trim()
    if (name.length < 3) continue
    if (haystack.includes(` ${name} `) && name.length > bestLength) {
      best = row
      bestLength = name.length
    }
  }
  return best
}

export interface SuggestionContext {
  options: ItemFormOptions | null
  /** Items this company already has whose name looks like the one being typed. */
  similar: readonly ItemSearchRow[]
  now?: number
}

/**
 * What the assistant would fill in, each with the value it would replace.
 *
 * NOTHING here is applied: the drawer renders the list and the user picks. A
 * field the user has already typed into is still offered — with its current
 * value shown beside the proposal — but never silently overwritten.
 */
export function buildSuggestions(form: ItemFormState, ctx: SuggestionContext): Suggestion[] {
  const out: Suggestion[] = []
  const name = form.item_name.trim()
  if (name === '') return out
  const options = ctx.options

  const printName = name
  if (form.print_name.trim() !== printName) {
    out.push({
      field: 'print_name',
      label: 'Print name',
      value: printName,
      display: printName,
      source: 'The item name, which is what documents print when this is blank.',
      current: form.print_name || null,
      currentDisplay: form.print_name || null,
    })
  }

  const alias = suggestAlias(name)
  if (alias && form.item_alias.trim().toUpperCase() !== alias) {
    out.push({
      field: 'item_alias',
      label: 'Alias',
      value: alias,
      display: alias,
      source: 'Shortened from the item name for quick search.',
      current: form.item_alias || null,
      currentDisplay: form.item_alias || null,
    })
  }

  if (!form.item_sku.trim()) {
    const sku = generateSku(form, options, ctx.now ?? Date.now())
    out.push({
      field: 'item_sku',
      label: 'SKU',
      value: sku,
      display: sku,
      source: 'Built from the classification and the item name. The API confirms it is unique when you save.',
      current: null,
      currentDisplay: null,
    })
  }

  const group = matchMaster(options?.item_groups ?? [], (g) => g.grp_name, name)
  if (group && String(group.item_grp_id) !== form.item_grp_id) {
    const currentName = options?.item_groups.find((g) => String(g.item_grp_id) === form.item_grp_id)?.grp_name ?? null
    out.push({
      field: 'item_grp_id',
      label: 'Item group',
      value: String(group.item_grp_id),
      display: group.grp_name,
      source: `The item name contains "${group.grp_name}", a group in this company.`,
      current: form.item_grp_id || null,
      currentDisplay: currentName,
    })
  }

  const category = matchMaster(options?.stock_categories ?? [], (c) => c.cat_name, name)
  if (category && String(category.stock_cat_id) !== form.stock_cat_id) {
    const currentName = options?.stock_categories.find((c) => String(c.stock_cat_id) === form.stock_cat_id)?.cat_name ?? null
    out.push({
      field: 'stock_cat_id',
      label: 'Stock category',
      value: String(category.stock_cat_id),
      display: category.cat_name,
      source: `The item name contains "${category.cat_name}", a category in this company.`,
      current: form.stock_cat_id || null,
      currentDisplay: currentName,
    })
  }

  const brand = matchMaster(options?.brands ?? [], (b) => b.brand_name, name)
  if (brand && String(brand.brand_id) !== form.brand_id) {
    const currentName = options?.brands.find((b) => String(b.brand_id) === form.brand_id)?.brand_name ?? null
    out.push({
      field: 'brand_id',
      label: 'Brand',
      value: String(brand.brand_id),
      display: brand.brand_name,
      source: `The item name contains "${brand.brand_name}", a brand in this company.`,
      current: form.brand_id || null,
      currentDisplay: currentName,
    })
  }

  // HSN is copied from a real neighbour, never guessed: an HSN drives a GST
  // return, so the only honest source is an item this company already files under.
  if (!form.hsn_sac.trim()) {
    const donor = ctx.similar.find((r) => (r.hsn_sac ?? '').trim() !== '')
    if (donor) {
      out.push({
        field: 'hsn_sac',
        label: 'HSN / SAC',
        value: String(donor.hsn_sac).trim().toUpperCase(),
        display: String(donor.hsn_sac).trim().toUpperCase(),
        source: `Used by "${donor.item_name}", an item with a similar name in this company.`,
        current: null,
        currentDisplay: null,
      })
    }
  }

  const defaultMethod = options?.default_valuation_method
  if (defaultMethod && form.valuation_method && form.valuation_method !== defaultMethod) {
    out.push({
      field: 'valuation_method',
      label: 'Valuation method',
      value: defaultMethod,
      display: defaultMethod,
      source: "This company's default valuation method.",
      current: form.valuation_method,
      currentDisplay: form.valuation_method,
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

export type DuplicateReason = 'name' | 'sku' | 'barcode' | 'similar'

export interface DuplicateMatch {
  item: ItemSearchRow
  reason: DuplicateReason
  /** `conflict` is refused by the API on save; `warning` is only worth a look. */
  severity: 'conflict' | 'warning'
  message: string
}

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase()

/**
 * What the company's existing items say about this draft.
 *
 * The API is the authority on the two that matter: it answers a duplicate name
 * or SKU with a 409 naming the field. This only says so before the round trip.
 * A merely SIMILAR name is never treated as a conflict — plenty of real
 * catalogues carry "Bolt M8" and "Bolt M8 galvanised" — so it is reported and
 * nothing is blocked.
 */
export function classifyDuplicates(form: ItemFormState, rows: readonly ItemSearchRow[], excludeItemId: number | null = null): DuplicateMatch[] {
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
      match = { item, reason: 'name', severity: 'conflict', message: 'An item with this exact name already exists. The API refuses a second one.' }
    } else if (sku !== '' && norm(item.item_sku) === sku) {
      match = { item, reason: 'sku', severity: 'conflict', message: 'This SKU is already taken. SKUs are unique within the company.' }
    } else if (barcode !== '' && norm(item.item_upc) === barcode) {
      match = { item, reason: 'barcode', severity: 'warning', message: 'This barcode is already on another item, so a scan will not tell them apart.' }
    } else if (name.length >= 3 && (norm(item.item_name).includes(name) || name.includes(norm(item.item_name)) || norm(item.item_alias) === name)) {
      match = { item, reason: 'similar', severity: 'warning', message: 'A similar item already exists. Check it before creating another.' }
    }
    if (match) {
      seen.add(item.item_id)
      out.push(match)
    }
  }
  // Conflicts first: they are the ones that stop a save.
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'conflict' ? -1 : 1)).slice(0, 4)
}

/** `true` when the draft names something the API will refuse outright. */
export function hasBlockingDuplicate(matches: readonly DuplicateMatch[]): boolean {
  return matches.some((m) => m.severity === 'conflict')
}
