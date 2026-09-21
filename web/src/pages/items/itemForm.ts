import { ITC_ELIGIBILITY } from '../../services/items'
import type { ItcEligibility, Item, ItemOpening, ItemUnitLine } from '../../services/items'
import { toNumber } from '../../utils/format'
import { attributesChanged, attributesToDraft, draftToAttributes, emptyAttributes } from './itemAttributes'
import type { ItemAttributesDraft } from './itemAttributes'

/** Pure draft ↔ payload helpers for the item form. */

export interface UnitLineDraft {
  key: string
  unit_id: string
  conversion_factor: string
  uom_role: string
}

export interface OpeningDraft {
  key: string
  warehouse_id: string
  unit_id: string
  batch_id: string
  opening_qty: string
  opening_valuation_rate: string
}

export interface ItemFormState {
  item_name: string
  item_alias: string
  print_name: string
  item_type: string
  item_sku: string
  item_upc: string
  hsn_sac: string
  mrp: string
  item_grp_id: string
  stock_cat_id: string
  brand_id: string
  unit_id: string
  purchase_unit_id: string
  sales_unit_id: string
  valuation_method: string
  standard_cost: string
  negative_stock_policy: string
  /** inherit | claim | block — an attribute of the goods; Books resolves what it means. */
  itc_eligibility: ItcEligibility
  track_batch: boolean
  track_serial: boolean
  track_expiry: boolean
  shelf_life_days: string
  min_stock_qty: string
  max_stock_qty: string
  reorder_point_qty: string
  reorder_qty: string
  safety_stock_qty: string
  lead_time_days: string
  default_warehouse_id: string
  is_active: boolean
  unitLines: UnitLineDraft[]
  openings: OpeningDraft[]
  /**
   * `attributes_json` on the row — description, notes, tags and whatever else this company keeps
   * on its items. See itemAttributes.ts for why it is a JSON column and not seven new ones.
   */
  attributes: ItemAttributesDraft
}

let keySeq = 0
export function nextKey(prefix = 'k'): string {
  keySeq += 1
  return `${prefix}${keySeq}`
}

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const on = (v: unknown): boolean => v === 1 || v === '1' || v === true

/**
 * A stored decimal as a person would type it: `15.0000` → `15`, `0.0833` → `0.0833`.
 *
 * Every numeric column here is NUMERIC(18,4) and PostgreSQL hands back all four decimals, so an
 * MRP of fifteen rupees arrived in the box reading "15.0000". The trailing zeros are noise the
 * user then has to edit around, and they make the form read as dirty-looking data.
 *
 * Only the presentation changes — the payload goes through `toNumber` either way, so `15.0000`
 * and `15` are the same number to the server. Anything that is not a plain decimal is passed
 * through untouched rather than guessed at.
 */
const num = (v: unknown): string => {
  const raw = s(v)
  if (!/^-?\d+\.\d+$/.test(raw)) return raw
  return raw.replace(/0+$/, '').replace(/\.$/, '')
}

export function emptyItemForm(defaultValuationMethod = 'FIFO'): ItemFormState {
  return {
    item_name: '',
    item_alias: '',
    print_name: '',
    item_type: 'stock',
    item_sku: '',
    item_upc: '',
    hsn_sac: '',
    mrp: '',
    item_grp_id: '',
    stock_cat_id: '',
    brand_id: '',
    unit_id: '',
    purchase_unit_id: '',
    sales_unit_id: '',
    valuation_method: defaultValuationMethod,
    standard_cost: '',
    negative_stock_policy: '',
    itc_eligibility: 'inherit',
    track_batch: false,
    track_serial: false,
    track_expiry: false,
    shelf_life_days: '',
    min_stock_qty: '',
    max_stock_qty: '',
    reorder_point_qty: '',
    reorder_qty: '',
    safety_stock_qty: '',
    lead_time_days: '',
    default_warehouse_id: '',
    is_active: true,
    unitLines: [],
    openings: [],
    attributes: emptyAttributes(),
  }
}

/** Alternate-unit drafts from the API's unit lines (the base line is implied by `unit_id`). */
export function unitLinesFromItem(lines: ItemUnitLine[], baseUnitId: number | null): UnitLineDraft[] {
  return lines
    .filter((l) => Number(l.is_default) !== 1 && Number(l.unit_id) !== baseUnitId)
    .map((l) => ({ key: nextKey('u'), unit_id: s(l.unit_id), conversion_factor: num(l.conversion_factor), uom_role: s(l.uom_role) }))
}

export function openingsFromRows(rows: ItemOpening[], fyId: number): OpeningDraft[] {
  return rows
    .filter((r) => Number(r.fy_id) === fyId)
    .map((r) => ({
      key: nextKey('o'),
      warehouse_id: r.warehouse_id ? s(r.warehouse_id) : '',
      unit_id: s(r.unit_id),
      batch_id: r.batch_id ? s(r.batch_id) : '',
      opening_qty: num(r.opening_qty),
      opening_valuation_rate: num(r.opening_valuation_rate),
    }))
}

export function itemToForm(item: Item, openingRows: ItemOpening[], effectiveFyId: number): ItemFormState {
  const base = item.unit_id ? Number(item.unit_id) : null
  return {
    item_name: s(item.item_name),
    item_alias: s(item.item_alias),
    print_name: s(item.print_name),
    item_type: s(item.item_type) || 'stock',
    item_sku: s(item.item_sku),
    item_upc: s(item.item_upc),
    hsn_sac: s(item.hsn_sac),
    mrp: num(item.mrp),
    item_grp_id: s(item.item_grp_id),
    stock_cat_id: s(item.stock_cat_id),
    brand_id: s(item.brand_id),
    unit_id: s(item.unit_id),
    purchase_unit_id: s(item.purchase_unit_id),
    sales_unit_id: s(item.sales_unit_id),
    valuation_method: s(item.valuation_method).toUpperCase() || 'FIFO',
    standard_cost: num(item.standard_cost),
    negative_stock_policy: s(item.negative_stock_policy),
    // An unrecognised stored value reads as "the item says nothing" rather than picking a side for
    // it; the server refuses writing one, so this only guards a row that predates the vocabulary.
    itc_eligibility: ITC_ELIGIBILITY.includes(s(item.itc_eligibility) as ItcEligibility) ? (s(item.itc_eligibility) as ItcEligibility) : 'inherit',
    track_batch: on(item.track_batch),
    track_serial: on(item.track_serial),
    track_expiry: on(item.track_expiry),
    shelf_life_days: s(item.shelf_life_days),
    min_stock_qty: num(item.min_stock_qty),
    max_stock_qty: num(item.max_stock_qty),
    reorder_point_qty: num(item.reorder_point_qty),
    reorder_qty: num(item.reorder_qty),
    safety_stock_qty: num(item.safety_stock_qty),
    lead_time_days: s(item.lead_time_days),
    default_warehouse_id: s(item.default_warehouse_id),
    is_active: on(item.is_active),
    unitLines: unitLinesFromItem(item.unit_lines ?? [], base),
    openings: openingsFromRows(openingRows, effectiveFyId),
    attributes: attributesToDraft(item.attributes),
  }
}

export function newUnitLine(): UnitLineDraft {
  return { key: nextKey('u'), unit_id: '', conversion_factor: '1', uom_role: '' }
}

export function newOpening(defaultUnitId: string): OpeningDraft {
  return { key: nextKey('o'), warehouse_id: '', unit_id: defaultUnitId, batch_id: '', opening_qty: '', opening_valuation_rate: '' }
}

export function openingValue(qty: unknown, rate: unknown): number {
  const q = toNumber(qty) ?? 0
  const r = toNumber(rate) ?? 0
  return Math.round(q * r * 10000) / 10000
}

const optNum = (v: string): number | null => {
  const n = toNumber(v)
  return n === null ? null : n
}
const optId = (v: string): number | null => {
  const n = toNumber(v)
  return n !== null && n > 0 ? Math.floor(n) : null
}
const optStr = (v: string): string | null => (v.trim() === '' ? null : v.trim())

/** Unit lines for the API: the base line first with factor 1, then the alternates (blank rows dropped). */
export function unitLinesPayload(lines: UnitLineDraft[], baseUnitId: number): { unit_id: number; is_default: 0 | 1; conversion_factor: number; uom_role: string | null }[] {
  const out: { unit_id: number; is_default: 0 | 1; conversion_factor: number; uom_role: string | null }[] = [{ unit_id: baseUnitId, is_default: 1, conversion_factor: 1, uom_role: 'base' }]
  const seen = new Set<number>([baseUnitId])
  for (const l of lines) {
    const unitId = optId(l.unit_id)
    if (!unitId || seen.has(unitId)) continue
    const factor = toNumber(l.conversion_factor)
    if (factor === null || factor <= 0) continue
    seen.add(unitId)
    out.push({ unit_id: unitId, is_default: 0, conversion_factor: factor, uom_role: optStr(l.uom_role) })
  }
  return out
}

/** Opening rows for `PUT /items/{id}/openings`: rows without a unit or with zero quantity are dropped. */
export function openingsPayload(rows: OpeningDraft[]): { warehouse_id: number | null; unit_id: number; batch_id: number | null; opening_qty: number; opening_valuation_rate: number }[] {
  const out: { warehouse_id: number | null; unit_id: number; batch_id: number | null; opening_qty: number; opening_valuation_rate: number }[] = []
  for (const r of rows) {
    const unitId = optId(r.unit_id)
    const qty = toNumber(r.opening_qty) ?? 0
    if (!unitId || qty === 0) continue
    out.push({ warehouse_id: optId(r.warehouse_id), unit_id: unitId, batch_id: optId(r.batch_id), opening_qty: qty, opening_valuation_rate: toNumber(r.opening_valuation_rate) ?? 0 })
  }
  return out
}

/**
 * Body for POST / PUT `/v1/items` (openings travel separately).
 *
 * `originalAttributes` is what the API last returned for this item. It decides whether
 * `attributes` rides along at all: the server only rewrites `attributes_json` when the request
 * carries the key, so omitting it on an untouched item is what keeps a value written by another
 * Aicountly app — or by a future field this screen does not model — exactly where it was.
 *
 * Note what is NOT here: `books_sales_acc_id`, `books_purchase_acc_id` and `books_tax_cat_id`.
 * Books owns those rows and this screen has no live list to pick from, so it shows them read-only
 * and never sends them. A column a request does not carry is a column it cannot damage.
 */
export function itemPayload(f: ItemFormState, originalAttributes?: unknown): Record<string, unknown> {
  const baseUnit = optId(f.unit_id)
  const body: Record<string, unknown> = {
    item_name: f.item_name.trim(),
    item_alias: optStr(f.item_alias),
    print_name: optStr(f.print_name),
    item_type: f.item_type || 'stock',
    item_sku: optStr(f.item_sku),
    item_upc: optStr(f.item_upc),
    hsn_sac: optStr(f.hsn_sac)?.toUpperCase() ?? null,
    mrp: optNum(f.mrp),
    item_grp_id: optId(f.item_grp_id),
    stock_cat_id: optId(f.stock_cat_id),
    brand_id: optId(f.brand_id),
    unit_id: baseUnit,
    purchase_unit_id: optId(f.purchase_unit_id),
    sales_unit_id: optId(f.sales_unit_id),
    valuation_method: f.valuation_method || null,
    standard_cost: optNum(f.standard_cost),
    negative_stock_policy: optStr(f.negative_stock_policy),
    itc_eligibility: f.itc_eligibility,
    track_batch: f.track_batch ? 1 : 0,
    track_serial: f.track_serial ? 1 : 0,
    track_expiry: f.track_expiry ? 1 : 0,
    shelf_life_days: optId(f.shelf_life_days),
    min_stock_qty: optNum(f.min_stock_qty),
    max_stock_qty: optNum(f.max_stock_qty),
    reorder_point_qty: optNum(f.reorder_point_qty),
    reorder_qty: optNum(f.reorder_qty),
    safety_stock_qty: optNum(f.safety_stock_qty),
    lead_time_days: optId(f.lead_time_days),
    default_warehouse_id: optId(f.default_warehouse_id),
    is_active: f.is_active ? 1 : 0,
    unit_lines: baseUnit ? unitLinesPayload(f.unitLines, baseUnit) : [],
  }
  if (attributesChanged(originalAttributes ?? null, f.attributes)) {
    body.attributes = draftToAttributes(f.attributes)
  }
  return body
}

export function validateItemForm(f: ItemFormState): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!f.item_name.trim()) errors.item_name = 'Item name is required'
  if (!optId(f.unit_id)) errors.unit_id = 'Pick the base unit'
  if (f.hsn_sac.trim() && !/^[0-9A-Za-z]{4,8}$/.test(f.hsn_sac.trim())) errors.hsn_sac = 'HSN/SAC must be 4 to 8 letters or digits'
  const nonNegative: (keyof ItemFormState)[] = ['mrp', 'standard_cost', 'min_stock_qty', 'max_stock_qty', 'reorder_point_qty', 'reorder_qty', 'safety_stock_qty', 'shelf_life_days', 'lead_time_days']
  for (const k of nonNegative) {
    const v = f[k]
    if (typeof v !== 'string' || v.trim() === '') continue
    const n = toNumber(v)
    if (n === null) errors[k] = 'Must be a number'
    else if (n < 0) errors[k] = 'Cannot be negative'
  }
  const base = optId(f.unit_id)
  const seen = new Set<number>()
  f.unitLines.forEach((l, i) => {
    const id = optId(l.unit_id)
    if (!id) {
      errors[`unitLines.${l.key}`] = `Alternate unit ${i + 1}: pick a unit`
      return
    }
    if (id === base) {
      errors[`unitLines.${l.key}`] = `Alternate unit ${i + 1}: same as the base unit`
      return
    }
    if (seen.has(id)) {
      errors[`unitLines.${l.key}`] = `Alternate unit ${i + 1}: repeated unit`
      return
    }
    seen.add(id)
    const factor = toNumber(l.conversion_factor)
    if (factor === null || factor <= 0) errors[`unitLines.${l.key}`] = `Alternate unit ${i + 1}: conversion must be greater than zero`
  })
  f.openings.forEach((o, i) => {
    const qty = toNumber(o.opening_qty)
    const rate = toNumber(o.opening_valuation_rate)
    if (o.opening_qty.trim() !== '' && qty === null) errors[`openings.${o.key}`] = `Opening ${i + 1}: quantity must be a number`
    else if (qty !== null && qty !== 0 && !optId(o.unit_id)) errors[`openings.${o.key}`] = `Opening ${i + 1}: pick a unit`
    else if (o.opening_valuation_rate.trim() !== '' && (rate === null || rate < 0)) errors[`openings.${o.key}`] = `Opening ${i + 1}: rate cannot be negative`
  })
  return errors
}
