/**
 * Barcode labels for a set of serial numbers, as a print document.
 *
 * Built as standalone HTML and handed to `printHtmlDocument`, the same pipeline
 * every register's print sheet uses — so labels come out of the browser's own
 * print dialog with the paper size and printer the operator already has
 * selected, and no part of the app's stylesheet can reach in and shift a label
 * by a millimetre.
 *
 * Every label carries the number in human-readable form UNDER the barcode. That
 * is not decoration: a scanner that will not read a smudged label is a daily
 * event in a warehouse, and the operator has to be able to key it instead.
 */

import { escapeHtml } from '../export/sheetHtml'
import { code128Svg } from './barcode128'
import { formatDate } from '../utils/format'

export type LabelSize = 'small' | 'medium' | 'large'

export interface SerialLabel {
  serialNo: string
  itemName?: string | null
  sku?: string | null
  warrantyUntil?: string | null
}

export interface LabelSheetOptions {
  labels: readonly SerialLabel[]
  companyName?: string
  size?: LabelSize
  showWarranty?: boolean
  showCompany?: boolean
}

interface SizeSpec {
  /** Millimetres. */
  width: number
  height: number
  label: string
  perSheet: string
  barcodeHeight: number
  serialFontPt: number
}

/**
 * Three stock label geometries, in millimetres on A4.
 *
 * Sized to the sheets an Indian MSME actually buys rather than to arbitrary
 * pixel counts, and laid out with `mm` so the print is the same on any screen.
 */
export const LABEL_SIZES: Record<LabelSize, SizeSpec> = {
  small: { width: 38, height: 21, label: '38 × 21 mm', perSheet: '65 per A4 sheet', barcodeHeight: 24, serialFontPt: 6.5 },
  medium: { width: 63, height: 34, label: '63 × 34 mm', perSheet: '24 per A4 sheet', barcodeHeight: 38, serialFontPt: 8 },
  large: { width: 99, height: 57, label: '99 × 57 mm', perSheet: '10 per A4 sheet', barcodeHeight: 56, serialFontPt: 11 },
}

function labelHtml(label: SerialLabel, spec: SizeSpec, options: LabelSheetOptions): string {
  const serial = label.serialNo
  // Null when the serial carries a character Code 128-B cannot hold. The label
  // still prints — with the number and no barcode — because a missing barcode
  // is an inconvenience and a wrong one is a mis-picked shipment.
  const barcode = code128Svg(serial, { moduleWidth: 1, height: spec.barcodeHeight, quietZone: 10 })
  const lines: string[] = []
  if (options.showCompany !== false && options.companyName) {
    lines.push(`<div class="lbl-company">${escapeHtml(options.companyName)}</div>`)
  }
  if (label.itemName) {
    lines.push(`<div class="lbl-item">${escapeHtml(label.itemName)}${label.sku ? ` <span class="lbl-sku">${escapeHtml(label.sku)}</span>` : ''}</div>`)
  }
  lines.push(`<div class="lbl-code">${barcode ?? '<span class="lbl-nobarcode">No barcode — key the number</span>'}</div>`)
  lines.push(`<div class="lbl-serial">${escapeHtml(serial)}</div>`)
  if (options.showWarranty !== false && label.warrantyUntil) {
    lines.push(`<div class="lbl-warranty">Warranty ${escapeHtml(formatDate(label.warrantyUntil))}</div>`)
  }
  return `<div class="lbl">${lines.join('')}</div>`
}

/**
 * The whole document. Deterministic and self-contained: no network reference,
 * no script, nothing that can fail between the button and the paper.
 */
export function buildLabelSheetHtml(options: LabelSheetOptions): string {
  const spec = LABEL_SIZES[options.size ?? 'medium']
  const labels = options.labels.map((label) => labelHtml(label, spec, options)).join('')
  const title = `Serial labels — ${options.labels.length}`
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 6mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Helvetica Neue", Arial, sans-serif; color: #000; background: #fff; }
  .sheet { display: flex; flex-wrap: wrap; gap: 2mm; align-content: flex-start; }
  .lbl {
    width: ${spec.width}mm; height: ${spec.height}mm;
    padding: 1.5mm; overflow: hidden;
    border: 0.2mm dashed #bbb;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; page-break-inside: avoid; break-inside: avoid;
  }
  .lbl-company { font-size: ${(spec.serialFontPt * 0.75).toFixed(1)}pt; font-weight: 700; letter-spacing: .02em; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .lbl-item { font-size: ${(spec.serialFontPt * 0.8).toFixed(1)}pt; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .lbl-sku { color: #444; }
  .lbl-code { flex: 0 0 auto; width: 100%; display: flex; justify-content: center; }
  .lbl-code svg { width: 100%; height: ${(spec.barcodeHeight / 4).toFixed(1)}mm; }
  .lbl-nobarcode { font-size: ${(spec.serialFontPt * 0.7).toFixed(1)}pt; color: #666; }
  .lbl-serial { font-family: "Courier New", monospace; font-size: ${spec.serialFontPt}pt; font-weight: 700; letter-spacing: .04em; max-width: 100%; overflow: hidden; white-space: nowrap; }
  .lbl-warranty { font-size: ${(spec.serialFontPt * 0.7).toFixed(1)}pt; color: #333; }
  /* The cut guides are for the screen preview; on paper they would print on
     the label itself, which is not what a die-cut sheet needs. */
  @media print { .lbl { border-color: transparent; } }
</style></head>
<body><div class="sheet">${labels}</div></body></html>`
}
