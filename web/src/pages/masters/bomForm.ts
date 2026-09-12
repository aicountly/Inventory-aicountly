import type { PickedItem } from '../../components/ItemPicker'
import type { Bom, BomLine, BomLineKind } from '../../services/masters'
import { toNumber } from '../../utils/format'

/** Pure draft ↔ payload helpers for the bill-of-materials form. */

export interface BomHeaderDraft {
  bom_name: string
  finished: PickedItem | null
  yield_qty: string
  yield_unit_id: string
  is_active: boolean
}

export interface BomLineDraft {
  key: string
  line_kind: BomLineKind
  item: PickedItem | null
  qty: string
  unit_id: string
  scrap_percent: string
}

let keySeq = 0
export function nextKey(prefix = 'l'): string {
  keySeq += 1
  return `${prefix}${keySeq}`
}

export function emptyHeader(): BomHeaderDraft {
  return { bom_name: '', finished: null, yield_qty: '1', yield_unit_id: '', is_active: true }
}

export function newLine(kind: BomLineKind = 'component'): BomLineDraft {
  return { key: nextKey(), line_kind: kind, item: null, qty: kind === 'component' ? '1' : '0', unit_id: '', scrap_percent: '0' }
}

export function headerFromBom(bom: Bom): BomHeaderDraft {
  return {
    bom_name: bom.bom_name,
    finished: { item_id: bom.finished_item_id, item_name: bom.finished_item_name ?? `#${bom.finished_item_id}`, item_sku: bom.finished_item_sku, unit_id: bom.finished_item_unit_id ?? null },
    yield_qty: String(bom.yield_qty ?? 1),
    yield_unit_id: bom.yield_unit_id ? String(bom.yield_unit_id) : '',
    is_active: Number(bom.is_active) === 1,
  }
}

export function linesFromBom(lines: BomLine[]): BomLineDraft[] {
  return lines.map((l) => ({
    key: nextKey(),
    line_kind: (['component', 'by_product', 'scrap'] as BomLineKind[]).includes(l.line_kind as BomLineKind) ? (l.line_kind as BomLineKind) : 'component',
    item: { item_id: l.item_id, item_name: l.item_name ?? `#${l.item_id}`, item_sku: l.item_sku, unit_id: l.unit_id, unit_symbol: l.unit_symbol },
    qty: String(l.qty ?? 0),
    unit_id: l.unit_id ? String(l.unit_id) : '',
    scrap_percent: String(l.scrap_percent ?? 0),
  }))
}

export interface BomValidation {
  header: Partial<Record<keyof BomHeaderDraft, string>>
  lines: Record<string, string>
  general: string | null
}

export function validateBom(header: BomHeaderDraft, lines: BomLineDraft[]): BomValidation {
  const v: BomValidation = { header: {}, lines: {}, general: null }
  if (!header.bom_name.trim()) v.header.bom_name = 'Name is required'
  if (!header.finished) v.header.finished = 'Pick the finished item'
  const yieldQty = toNumber(header.yield_qty)
  if (yieldQty === null || yieldQty <= 0) v.header.yield_qty = 'Yield must be greater than zero'
  if (lines.length === 0) v.general = 'Add at least one component line.'
  let hasComponentQty = false
  for (const [i, l] of lines.entries()) {
    const label = `Line ${i + 1}`
    if (!l.item) {
      v.lines[l.key] = `${label}: pick an item`
      continue
    }
    const qty = toNumber(l.qty)
    if (qty === null || qty < 0) {
      v.lines[l.key] = `${label}: quantity cannot be negative`
      continue
    }
    const scrap = toNumber(l.scrap_percent) ?? 0
    if (scrap < 0 || scrap > 100) {
      v.lines[l.key] = `${label}: scrap must be between 0 and 100`
      continue
    }
    if (l.line_kind === 'component' && header.finished && l.item.item_id === header.finished.item_id) {
      v.lines[l.key] = `${label}: the finished item cannot be its own component`
      continue
    }
    if (l.line_kind === 'component' && qty > 0) hasComponentQty = true
  }
  if (lines.length > 0 && !hasComponentQty && Object.keys(v.lines).length === 0) v.general = 'At least one component line needs a quantity greater than zero.'
  return v
}

export function isBomValid(v: BomValidation): boolean {
  return Object.keys(v.header).length === 0 && Object.keys(v.lines).length === 0 && v.general === null
}

export function bomPayload(header: BomHeaderDraft, lines: BomLineDraft[]): Record<string, unknown> {
  return {
    bom_name: header.bom_name.trim(),
    finished_item_id: header.finished?.item_id ?? null,
    yield_qty: toNumber(header.yield_qty) ?? 1,
    yield_unit_id: toNumber(header.yield_unit_id) || null,
    is_active: header.is_active ? 1 : 0,
    lines: lines.map((l, i) => ({
      item_id: l.item?.item_id ?? null,
      qty: toNumber(l.qty) ?? 0,
      unit_id: toNumber(l.unit_id) || null,
      line_kind: l.line_kind,
      scrap_percent: toNumber(l.scrap_percent) ?? 0,
      sort_order: i,
    })),
  }
}
