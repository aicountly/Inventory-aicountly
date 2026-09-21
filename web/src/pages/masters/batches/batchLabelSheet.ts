/**
 * The printed batch label sheet.
 *
 * A pure HTML builder, handed to the same `printHtmlDocument` iframe every
 * other Aicountly sheet goes through (src/export/documentExport.ts) — this is
 * not a second printing mechanism, it is a second document for the one that
 * already exists. The tabular sheet builder could not be reused directly: a
 * label is a grid of small cards with a barcode, not a table of rows, and
 * bending a register sheet into one would have produced a worse label and a
 * worse register.
 *
 * What goes on a label is fixed by what the warehouse needs to read off a
 * carton: the company it belongs to, the item, the batch and lot, the two
 * dates, the quantity and where it is held — plus a scannable code, because a
 * label a human has to retype is a label that gets mistyped.
 */

import { escapeHtml } from '../../../export/sheetHtml'
import type { SheetIdentity } from '../../../export/sheetHtml'
import { code128BSvg } from './barcode128'
import { formatDate, formatQty } from '../../../utils/format'

export interface BatchLabel {
  batch_no: string
  lot_no?: string | null
  item_name?: string | null
  item_sku?: string | null
  mfg_date?: string | null
  expiry_date?: string | null
  on_hand?: number | null
  unit_symbol?: string | null
  warehouse_name?: string | null
}

export interface BatchLabelSheetOptions extends SheetIdentity {
  labels: readonly BatchLabel[]
  /** Labels per row. Three across A4 portrait is a common 63.5mm stock. */
  columns?: number
  /** Stamped in the footer so a reprint can be told from the original. */
  generatedAt?: string
}

function field(label: string, value: string | null | undefined): string {
  if (!value) return ''
  return `<div class="f"><span class="k">${escapeHtml(label)}</span><span class="v">${escapeHtml(value)}</span></div>`
}

function labelCard(label: BatchLabel, identity: SheetIdentity): string {
  const qty =
    label.on_hand === null || label.on_hand === undefined
      ? ''
      : `${formatQty(label.on_hand)}${label.unit_symbol ? ` ${label.unit_symbol}` : ''}`
  // An unencodable batch number still prints — the human-readable line under
  // the barcode is the fallback, and a label without a barcode beats no label.
  const barcode = code128BSvg(label.batch_no, { moduleMm: 0.3, heightMm: 11 })
  return `<article class="label">
    <header>
      <span class="co">${escapeHtml(identity.companyName ?? '')}</span>
      ${label.expiry_date ? `<span class="exp">EXP ${escapeHtml(formatDate(label.expiry_date))}</span>` : ''}
    </header>
    <h2>${escapeHtml(label.item_name ?? '—')}</h2>
    ${label.item_sku ? `<p class="sku">${escapeHtml(label.item_sku)}</p>` : ''}
    <div class="fields">
      ${field('Batch', label.batch_no)}
      ${field('Lot', label.lot_no ?? '')}
      ${field('Mfg', label.mfg_date ? formatDate(label.mfg_date) : '')}
      ${field('Qty', qty)}
      ${field('Warehouse', label.warehouse_name ?? '')}
    </div>
    <div class="code">${barcode}<span class="hr">${escapeHtml(label.batch_no)}</span></div>
  </article>`
}

/** The whole printable document. Deterministic: same input, same bytes. */
export function buildBatchLabelSheetHtml(options: BatchLabelSheetOptions): string {
  const { labels, columns = 3, generatedAt = '' } = options
  const cards = labels.map((label) => labelCard(label, options)).join('')
  const footer = [options.scopeLabel, generatedAt ? `Printed ${generatedAt}` : '']
    .filter(Boolean)
    .map((line) => escapeHtml(line))
    .join(' · ')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Batch labels</title>
<style>
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Nunito', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111827; background: #fff; }
  .sheet { display: grid; grid-template-columns: repeat(${Math.max(1, Math.min(4, columns))}, 1fr); gap: 4mm; }
  .label { border: 0.3mm solid #111827; border-radius: 2mm; padding: 3mm; page-break-inside: avoid; break-inside: avoid; display: flex; flex-direction: column; gap: 1.5mm; min-height: 46mm; }
  .label header { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; border-bottom: 0.2mm solid #d1d5db; padding-bottom: 1mm; }
  .co { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .exp { font-size: 7pt; font-weight: 700; }
  h2 { margin: 0; font-size: 9.5pt; line-height: 1.2; font-weight: 700; }
  .sku { margin: 0; font-size: 7pt; color: #4b5563; }
  .fields { display: grid; gap: 0.6mm; margin-top: auto; }
  .f { display: flex; gap: 1.5mm; font-size: 7.5pt; }
  .k { min-width: 16mm; color: #4b5563; text-transform: uppercase; font-size: 6.5pt; letter-spacing: 0.03em; padding-top: 0.3mm; }
  .v { font-weight: 700; word-break: break-word; }
  .code { margin-top: 1.5mm; text-align: center; }
  .code svg { display: block; margin: 0 auto; max-width: 100%; }
  .hr { display: block; font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; font-size: 7.5pt; letter-spacing: 0.08em; margin-top: 0.5mm; }
  footer { margin-top: 5mm; font-size: 7pt; color: #6b7280; text-align: center; }
  .empty { padding: 20mm; text-align: center; font-size: 10pt; color: #6b7280; }
</style></head>
<body>
  ${labels.length === 0 ? '<p class="empty">No batches selected.</p>' : `<div class="sheet">${cards}</div>`}
  ${footer ? `<footer>${footer}</footer>` : ''}
</body></html>`
}
