/**
 * Turning a bill of materials into a disassembly.
 *
 * A BOM is written for the forward operation: these components go in, this finished item comes
 * out. Disassembly runs it backwards, so the arithmetic is the same scale factor and the
 * directions are reversed — but two of the line kinds do NOT simply flip:
 *
 *  - **scrap** is what the forward run destroys. Nothing comes back from breaking the finished
 *    item apart, so scrap lines are dropped.
 *  - **by-products** are outputs of the forward run, which makes them inputs of the reverse one.
 *    A disassembly recovers what is inside the finished item, not what was consumed alongside
 *    it, so they are dropped too and reported, never silently.
 *  - **scrap %** on a component is the forward wastage allowance: you issue 105 to build with
 *    100. Recovering 105 from a teardown would invent stock, so the uplift is not applied.
 *
 * The caller hydrates the resulting rows against `POST /v1/items/bulk-lookup` for real units and
 * batch / serial flags — this module never guesses them.
 */

import { round4 } from '../formModel'
import type { BomHeader, BomLine } from '../bom'
import { scaleFactor } from '../bom'

export interface BomComponentPlan {
  item_id: number
  item_name: string | null
  item_sku: string | null
  unit_id: number | null
  unit_symbol: string | null
  /** Per one BOM yield. */
  bom_qty: number
  /** Recovered at the entered parent quantity. */
  qty: number
  bom_line_id: number | null
}

export interface BomDisassemblyPlan {
  bom_id: number
  bom_name: string
  finished_item_id: number
  finished_item_name: string | null
  finished_item_sku: string | null
  yield_qty: number
  yield_unit_id: number | null
  yield_unit_symbol: string | null
  /** parentQty / yield_qty, the factor every recovered quantity is scaled by. */
  scale: number
  components: BomComponentPlan[]
  /** Line kinds this BOM carries that a disassembly does not recover, for the notice. */
  skipped: { by_product: number; scrap: number; zero: number }
}

function kindOf(line: BomLine): string {
  return String(line.line_kind ?? 'component')
}

/** Component lines only — what a teardown can actually put back on the shelf. */
export function recoverableLines(bom: Pick<BomHeader, 'lines'>): BomLine[] {
  return (bom.lines ?? []).filter((l) => l.item_id && kindOf(l) === 'component')
}

export function planFromBom(bom: BomHeader, parentQty: number): BomDisassemblyPlan {
  const scale = scaleFactor(parentQty, Number(bom.yield_qty) || 1)
  const components: BomComponentPlan[] = []
  const skipped = { by_product: 0, scrap: 0, zero: 0 }
  for (const line of bom.lines ?? []) {
    const kind = kindOf(line)
    if (!line.item_id) continue
    if (kind === 'scrap') {
      skipped.scrap += 1
      continue
    }
    if (kind === 'by_product') {
      skipped.by_product += 1
      continue
    }
    const bomQty = Number(line.qty) || 0
    const qty = round4(bomQty * scale)
    if (qty <= 0) {
      skipped.zero += 1
      continue
    }
    components.push({
      item_id: line.item_id,
      item_name: line.item_name ?? null,
      item_sku: line.item_sku ?? null,
      unit_id: line.unit_id ? Number(line.unit_id) : null,
      unit_symbol: line.unit_symbol ?? null,
      bom_qty: bomQty,
      qty,
      bom_line_id: line.bom_line_id ?? null,
    })
  }
  return {
    bom_id: bom.bom_id,
    bom_name: bom.bom_name,
    finished_item_id: bom.finished_item_id,
    finished_item_name: bom.finished_item_name ?? null,
    finished_item_sku: bom.finished_item_sku ?? null,
    yield_qty: Number(bom.yield_qty) || 0,
    yield_unit_id: bom.yield_unit_id ?? null,
    yield_unit_symbol: bom.yield_unit_symbol ?? null,
    scale: Math.round(scale * 1e6) / 1e6,
    components,
    skipped,
  }
}

/** The sentence the BOM dialog prints about what it will not bring back. */
export function skippedNotice(plan: BomDisassemblyPlan): string | null {
  const parts: string[] = []
  if (plan.skipped.by_product > 0) parts.push(`${plan.skipped.by_product} by-product line${plan.skipped.by_product === 1 ? '' : 's'}`)
  if (plan.skipped.scrap > 0) parts.push(`${plan.skipped.scrap} scrap line${plan.skipped.scrap === 1 ? '' : 's'}`)
  if (plan.skipped.zero > 0) parts.push(`${plan.skipped.zero} line${plan.skipped.zero === 1 ? '' : 's'} that scale to zero`)
  if (parts.length === 0) return null
  return `${parts.join(' and ')} on this bill of materials ${parts.length === 1 ? 'is' : 'are'} not recovered by a disassembly and will not be added.`
}
