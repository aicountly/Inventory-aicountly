/**
 * Client mirror of BomService (server-php) so a production run can be previewed and re-scaled
 * without a round trip, and so the PRODUCTION payload shape is identical either way:
 *
 *   scale         = production_qty / max(0.0001, yield_qty)
 *   component OUT = round(bom_qty × scale × (1 + scrap% / 100), 4)   (skipped when <= 0)
 *   by-product IN = same arithmetic, direction in, zero cost
 *   scrap lines   = informational, no movement
 *   finished IN   = round(production_qty, 4) at finished_rate, valuation_rate per BASE unit
 *
 * The API endpoint `POST /v1/bill-of-materials/{id}/explode` runs the same arithmetic server-side
 * with the item's real unit conversion; this mirror is the fallback and the preview.
 */

import type { CreateDocumentLine, CreateDocumentPayload, DocumentMetadata } from './types'
import { round4 } from './formModel'

export type BomLineKind = 'component' | 'by_product' | 'scrap'

export interface BomLine {
  bom_line_id?: number
  item_id: number
  qty: number
  unit_id?: number | null
  line_kind?: BomLineKind | string
  scrap_percent?: number
  item_name?: string | null
  item_sku?: string | null
  unit_symbol?: string | null
}

export interface BomHeader {
  bom_id: number
  bom_name: string
  finished_item_id: number
  finished_item_name?: string | null
  finished_item_sku?: string | null
  yield_qty: number
  yield_unit_id: number | null
  yield_unit_symbol?: string | null
  is_active: number | boolean
  lines: BomLine[]
}

export function scaleFactor(productionQty: number, yieldQty: number): number {
  return productionQty / Math.max(0.0001, yieldQty)
}

export function componentQty(bomQty: number, scale: number, scrapPercent = 0): number {
  const uplift = 1 + Math.max(0, scrapPercent) / 100
  return round4(bomQty * scale * uplift)
}

/** Rate per entered unit → rate per base unit. */
export function baseUnitRate(rate: number, factor: number): number {
  return round4(rate / (factor > 0 ? factor : 1))
}

/** Mirrors BomService::scaleLines: component OUT lines, by-product IN lines, then the finished IN line. */
export function scaleBomLines(bom: BomHeader, productionQty: number, warehouseId: number | null, finishedRate: number, finishedFactor = 1): CreateDocumentLine[] {
  const scale = scaleFactor(productionQty, bom.yield_qty || 1)
  const wh = warehouseId !== null && warehouseId > 0 ? warehouseId : null
  const out: CreateDocumentLine[] = []
  for (const line of bom.lines ?? []) {
    const kind = (line.line_kind ?? 'component') as string
    if (!line.item_id || kind === 'scrap') continue
    const qty = componentQty(Number(line.qty) || 0, scale, kind === 'component' ? Number(line.scrap_percent ?? 0) : 0)
    if (qty <= 0) continue
    out.push({
      item_id: line.item_id,
      unit_id: line.unit_id ? Number(line.unit_id) : null,
      warehouse_id: wh,
      qty,
      rate: 0,
      amount: 0,
      direction: kind === 'by_product' ? 'in' : 'out',
      metadata: { bom_line_id: line.bom_line_id ?? null, line_kind: kind, bom_qty: Number(line.qty) || 0, scale: Math.round(scale * 1e6) / 1e6 },
    })
  }
  const finishedQty = round4(productionQty)
  const rate = round4(Math.max(0, finishedRate))
  out.push({
    item_id: bom.finished_item_id,
    unit_id: bom.yield_unit_id ? Number(bom.yield_unit_id) : null,
    warehouse_id: wh,
    qty: finishedQty,
    rate,
    amount: round4(finishedQty * rate),
    valuation_rate: rate > 0 ? baseUnitRate(rate, finishedFactor) : null,
    direction: 'in',
    metadata: { line_kind: 'finished', bom_id: bom.bom_id, scale: Math.round(scale * 1e6) / 1e6 },
  })
  return out
}

/** Mirrors BomService::productionPayload. */
export function productionPayload(bom: BomHeader, productionQty: number, warehouseId: number | null, finishedRate: number, header: Partial<CreateDocumentPayload> = {}, finishedFactor = 1): CreateDocumentPayload {
  const lines = scaleBomLines(bom, productionQty, warehouseId, finishedRate, finishedFactor)
  const meta: DocumentMetadata = {
    ...(header.metadata ?? {}),
    bom_id: bom.bom_id,
    production_qty: round4(productionQty),
    finished_rate: round4(finishedRate),
    warehouse_id: warehouseId,
  }
  return { ...header, document_type: 'PRODUCTION', document_date: header.document_date ?? '', lines, metadata: meta }
}
