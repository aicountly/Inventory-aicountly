/**
 * Turning a BOM explosion into editable draft lines, and keeping the user's own work when the
 * run is exploded again.
 *
 * Pure, so the rules that decide what survives a re-explosion are unit-tested rather than
 * discovered by a storekeeper losing twenty serial numbers to a changed quantity.
 */

import { lineBaseQty, newLine } from '../formModel'
import type { LineDraft, UnitOption } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import type { BomHeader } from '../bom'
import type { CreateDocumentLine } from '../types'
import type { ItemSearchRow } from '../../services/lookupApi'

/** Line identity across two explosions of the same BOM: the item and the part it plays. */
function identity(line: { item_id: number | null; metadata?: Record<string, unknown> | null }): string {
  const kind = (line.metadata?.line_kind as string | undefined) ?? 'component'
  const bomLineId = line.metadata?.bom_line_id ?? ''
  return `${line.item_id ?? 0}:${kind}:${bomLineId}`
}

/** The exploded payload as draft lines, named and unit-labelled from the BOM the server returned. */
export function draftsFromExplosion(lines: CreateDocumentLine[], bom: BomHeader, spec: DocumentTypeSpec): LineDraft[] {
  return lines.map((l, i) => {
    const bomLine = bom.lines.find((b) => b.item_id === l.item_id)
    const finished = (l.metadata as { line_kind?: string } | null)?.line_kind === 'finished' || l.item_id === bom.finished_item_id
    const name = finished ? (bom.finished_item_name ?? `Item #${l.item_id}`) : (bomLine?.item_name ?? `Item #${l.item_id}`)
    const symbol = finished ? (bom.yield_unit_symbol ?? null) : (bomLine?.unit_symbol ?? null)
    return newLine(spec, {
      key: `bom-${bom.bom_id}-${i}`,
      item_id: l.item_id,
      item_name: name,
      item_sku: finished ? (bom.finished_item_sku ?? null) : (bomLine?.item_sku ?? null),
      units: l.unit_id ? [{ unit_id: l.unit_id, unit_symbol: symbol, conversion_factor: 1, is_default: true }] : [],
      unit_id: l.unit_id ?? null,
      warehouse_id: l.warehouse_id ?? null,
      direction: l.direction ?? 'out',
      qty: String(l.qty),
      rate: l.rate ? String(l.rate) : '',
      amount: l.amount ? String(l.amount) : '',
      valuation_rate: l.valuation_rate ? String(l.valuation_rate) : '',
      origin: 'bom',
      metadata: l.metadata ?? null,
    })
  })
}

/**
 * Carry the operator's own choices across a re-explosion.
 *
 * A changed run quantity re-scales every line, but the warehouse someone picked because the
 * component is only stocked there, and the lot they allocated, are decisions about *this* run and
 * are not the BOM's to overwrite. Serial numbers are the exception: they are counted against the
 * line's base quantity and the server refuses a count that does not match, so they survive only
 * while the quantity is unchanged — silently keeping eight serials against a quantity of ten
 * would turn a re-scale into a post-time rejection.
 */
export function mergeAllocations(previous: LineDraft[], next: LineDraft[]): LineDraft[] {
  if (previous.length === 0) return next
  const byIdentity = new Map<string, LineDraft>()
  for (const line of previous) {
    const key = identity(line)
    if (!byIdentity.has(key)) byIdentity.set(key, line)
  }
  return next.map((line) => {
    const prior = byIdentity.get(identity(line))
    if (!prior) return line
    /*
     * A fresh explosion carries the BOM's unit with a conversion factor of 1; the line it
     * replaces was hydrated from the item master and knows the real factor. Comparing base
     * quantities across those two would report every re-explosion as a change, so the merged
     * unit set is resolved first and the comparison made against that.
     */
    const unitId = line.unit_id ?? prior.unit_id
    const priorKnowsUnit = prior.units.some((u) => u.unit_id === unitId)
    const units = prior.units.length > 0 && (priorKnowsUnit || prior.units.length > line.units.length) ? prior.units : line.units
    const sameQty = lineBaseQty(prior) === lineBaseQty({ units, unit_id: unitId, qty: line.qty })
    return {
      ...line,
      // Keep the draft key so React does not remount the row (and its open drawer) on a re-scale.
      key: prior.key,
      warehouse_id: prior.warehouse_id ?? line.warehouse_id,
      batch_id: prior.batch_id,
      batch_no: prior.batch_no,
      serials: sameQty ? prior.serials : [],
      units,
      unit_id: unitId,
      track_batch: prior.track_batch || line.track_batch,
      track_serial: prior.track_serial || line.track_serial,
      item_sku: line.item_sku ?? prior.item_sku,
      description: prior.description || line.description,
    }
  })
}

export function unitOptionsFor(row: Pick<ItemSearchRow, 'units' | 'unit_id' | 'unit_symbol'>): UnitOption[] {
  const out = (row.units ?? []).map((u) => ({
    unit_id: u.unit_id,
    unit_symbol: u.unit_symbol,
    unit_name: u.unit_name,
    conversion_factor: Number(u.conversion_factor) || 1,
    is_default: Number(u.is_default) === 1,
  }))
  if (out.length === 0 && row.unit_id) out.push({ unit_id: row.unit_id, unit_symbol: row.unit_symbol ?? null, unit_name: null, conversion_factor: 1, is_default: true })
  return out
}

/**
 * Fill in what the explosion does not carry: real unit conversion factors, the SKU, and whether
 * the item is batch- or serial-controlled.
 *
 * Without this the screen cannot know a component needs a lot number until the document fails on
 * the way in, and a line entered in boxes would be compared against availability as though a box
 * were a piece.
 */
export function hydrateDrafts(lines: LineDraft[], items: ItemSearchRow[]): LineDraft[] {
  if (items.length === 0) return lines
  const byId = new Map(items.map((i) => [i.item_id, i]))
  return lines.map((line) => {
    const item = line.item_id !== null ? byId.get(line.item_id) : undefined
    if (!item) return line
    const units = unitOptionsFor(item)
    return {
      ...line,
      item_sku: line.item_sku ?? item.item_sku,
      track_batch: Number(item.track_batch) === 1,
      track_serial: Number(item.track_serial) === 1,
      units: units.length > 0 ? units : line.units,
      unit_id: line.unit_id ?? units.find((u) => u.is_default)?.unit_id ?? null,
    }
  })
}
