/**
 * Batch labels, printed through the same pipeline as every other sheet in the
 * product: an HTML document handed to `printHtmlDocument`, which renders it in
 * an off-screen iframe and opens the browser's print dialog. No client-side PDF
 * library is pulled in for this, and nothing is faked — a label carries only
 * what the API returned for that batch.
 *
 * The letterhead (company name, registered office, GSTIN) is the shared
 * `SheetIdentity` every export uses, so a label and a printed register name the
 * same company in the same words.
 */

import { escapeHtml } from '../../../export/sheetHtml'
import type { SheetIdentity } from '../../../export/sheetHtml'
import { printHtmlDocument } from '../../../export/documentExport'
import type { Batch } from '../../../services/masters'
import { formatDate, formatQty } from '../../../utils/format'
import { canEncodeCode39, code39Svg, normaliseCode39 } from './batchBarcode'
import { warehouseLabel } from './batchPresentation'

/** Three across, eight down — a plain A4 label sheet, 65 × 37 mm cells. */
const SHEET_CSS = `
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Nunito', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: #111827;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 6mm;
    padding-bottom: 2mm;
    border-bottom: 1px solid #d1d5db;
    font-size: 10px;
    color: #6b7280;
  }
  .sheet-head strong { font-size: 12px; color: #111827; }
  .labels {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3mm;
  }
  .label {
    height: 37mm;
    padding: 2.5mm 3mm;
    border: 1px solid #9ca3af;
    border-radius: 2mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .label-company {
    font-size: 7px;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: #6b7280;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .label-item {
    margin-top: .5mm;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.2;
    max-height: 2.4em;
    overflow: hidden;
  }
  .label-meta {
    margin-top: 1mm;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: .5mm 2mm;
    font-size: 7.5px;
    color: #374151;
  }
  .label-meta span { display: block; color: #6b7280; }
  .label-meta strong { font-size: 8px; font-weight: 700; }
  .label-code { margin-top: 1mm; }
  .label-code .caption {
    margin-top: .5mm;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 8px;
    letter-spacing: .12em;
    text-align: center;
  }
  .label-code .no-symbol {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    font-weight: 700;
    text-align: center;
    padding: 2mm 0;
  }
  .empty { padding: 20mm; text-align: center; color: #6b7280; font-size: 12px; }
`

function metaCell(label: string, value: string): string {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
}

function labelHtml(batch: Batch, identity: SheetIdentity): string {
  const code = normaliseCode39(batch.batch_no)
  const unit = batch.unit_symbol ? ` ${batch.unit_symbol}` : ''
  const where = warehouseLabel(batch)
  const symbol = canEncodeCode39(batch.batch_no)
    ? `${code39Svg(batch.batch_no, { height: 34 })}<div class="caption">${escapeHtml(code)}</div>`
    : `<div class="no-symbol">${escapeHtml(batch.batch_no)}</div>`

  return `
    <article class="label">
      <div>
        <div class="label-company">${escapeHtml(identity.companyName ?? '')}</div>
        <div class="label-item">${escapeHtml(batch.item_name ?? `Item #${batch.item_id}`)}</div>
        <div class="label-meta">
          ${metaCell('Batch', batch.batch_no)}
          ${metaCell('Lot', batch.lot_no || '—')}
          ${metaCell('Mfg', formatDate(batch.mfg_date))}
          ${metaCell('Exp', formatDate(batch.expiry_date))}
          ${metaCell('On hand', batch.stock ? `${formatQty(batch.stock.on_hand)}${unit}` : '—')}
          ${metaCell('Warehouse', where ? `${where.name}${where.extra > 0 ? ` +${where.extra}` : ''}` : '—')}
        </div>
      </div>
      <div class="label-code">${symbol}</div>
    </article>
  `
}

export interface BatchLabelSheetOptions {
  batches: readonly Batch[]
  identity: SheetIdentity
  /** Printed in the sheet header — which filters produced this selection. */
  scopeNote?: string
  generatedAt?: string
}

/** The label sheet as a full HTML document. Exported so it can be tested. */
export function buildBatchLabelSheet({
  batches,
  identity,
  scopeNote,
  generatedAt,
}: BatchLabelSheetOptions): string {
  const stamp = generatedAt ?? new Date().toLocaleString('en-GB')
  const body = batches.length
    ? `<div class="labels">${batches.map((b) => labelHtml(b, identity)).join('')}</div>`
    : '<p class="empty">No batches were selected for labelling.</p>'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Batch labels${identity.companyName ? ` — ${escapeHtml(identity.companyName)}` : ''}</title>
<style>${SHEET_CSS}</style>
</head>
<body>
  <header class="sheet-head">
    <div>
      <strong>${escapeHtml(identity.companyName || 'Batch labels')}</strong>
      ${identity.gstin ? `<span> · GSTIN ${escapeHtml(identity.gstin)}</span>` : ''}
      ${identity.scopeLabel ? `<div>${escapeHtml(identity.scopeLabel)}</div>` : ''}
      ${scopeNote ? `<div>${escapeHtml(scopeNote)}</div>` : ''}
    </div>
    <div>${escapeHtml(String(batches.length))} label${batches.length === 1 ? '' : 's'} · ${escapeHtml(stamp)}</div>
  </header>
  ${body}
</body>
</html>`
}

/** Build the sheet and hand it to the browser. False when printing is blocked. */
export function printBatchLabels(options: BatchLabelSheetOptions): boolean {
  return printHtmlDocument(buildBatchLabelSheet(options))
}
