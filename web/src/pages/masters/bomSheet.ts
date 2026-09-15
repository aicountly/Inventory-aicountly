/**
 * The printed bill of materials.
 *
 * A BOM is a master, not a document: there is no snapshot to print, so there is
 * nothing for `documents/printDocument.ts` to fall back from. What it IS is a
 * header and a table of lines, which is the shape `export/exportActions.ts`
 * already prints on letterheaded paper for every register and every master list
 * in this app. So the sheet is built here as a tabular payload and handed to
 * `ListSheetActions` — the same CSV / Excel / PDF / Print set, the same
 * letterhead from `useExportIdentity`, the same Ctrl+P. No third print path.
 *
 * Two things this module deliberately does NOT do:
 *
 *  - It does not total the quantity column. A bill can hold a component in kg,
 *    another in litres and a third in pieces; adding them produces a number
 *    that is wrong in every unit. The counts that ARE safe (how many component,
 *    by-product and scrap lines) go in the summary cards instead, and a footer
 *    note says why there is no total.
 *  - It carries no rate, cost or value. A BOM in Inventory holds quantities;
 *    what a component costs is valuation, resolved per layer when a production
 *    run consumes it, and a costed BOM printed today would be a price list
 *    nobody priced.
 *
 * All pure — no React, no DOM — so the arithmetic on the paper is testable
 * without rendering the page.
 */

import { componentQty } from '../../documents/bom'
import type { Bom, BomLine, BomLineKind } from '../../services/masters'
import type { ExportableColumn } from '../../registers/registerCells'
import type { SheetSummaryCard } from '../../export/sheetHtml'
import { formatDateTime, formatQty } from '../../utils/format'

/** One printed line. Pre-resolved so the sheet and the CSV cannot disagree. */
export interface BomSheetRow {
  line_no: number
  kind: string
  item: string
  sku: string
  qty: number
  unit: string
  scrap_percent: number
  effective_qty: number
}

const KIND_LABELS: Record<BomLineKind, string> = {
  component: 'Component',
  by_product: 'By-product',
  scrap: 'Scrap',
}

function kindOf(line: BomLine): BomLineKind {
  const kind = line.line_kind as BomLineKind
  return kind in KIND_LABELS ? kind : 'component'
}

/**
 * The columns, in the order they are printed.
 *
 * `format` is set on every numeric column rather than left to
 * `registerCells.cellFormat()` to infer: `scrap_percent` and `effective_qty`
 * are quantities, and the fallback for a right-aligned column it cannot
 * classify is plain text — "4" beside "4.0000" on the same sheet.
 */
export const BOM_SHEET_COLUMNS: readonly ExportableColumn<BomSheetRow>[] = [
  { key: 'line_no', header: '#', align: 'right', format: 'int' },
  { key: 'kind', header: 'Kind' },
  { key: 'item', header: 'Item' },
  { key: 'sku', header: 'SKU' },
  { key: 'qty', header: 'Quantity', align: 'right', format: 'qty' },
  { key: 'unit', header: 'Unit' },
  { key: 'scrap_percent', header: 'Scrap %', align: 'right', format: 'qty' },
  { key: 'effective_qty', header: 'Effective qty', align: 'right', format: 'qty' },
]

export interface BomSheet {
  title: string
  description: string
  rows: BomSheetRow[]
  metaLines: string[]
  summaryCards: SheetSummaryCard[]
  footerNotes: string[]
  /** Filename stem, before the company and the date `ListSheetActions` adds. */
  filenameBase: string
}

/** `Chair (CH-1)`, or `#10` for a bill whose finished item did not come back. */
function itemLabel(name: string | null | undefined, sku: string | null | undefined, id: number): string {
  const base = name && name.trim() !== '' ? name : `#${id}`
  return sku && sku.trim() !== '' ? `${base} (${sku})` : base
}

/** `2 Nos`, or `2` when the bill has no unit symbol to print. */
function qtyWithUnit(qty: unknown, symbol: string | null | undefined): string {
  const text = formatQty(qty, '0')
  return symbol && symbol.trim() !== '' ? `${text} ${symbol}` : text
}

/**
 * The lines, in their stored order, with the effective quantity spelled out.
 *
 * `componentQty` is the same helper `scaleBomLines` uses to build a production
 * document, called at scale 1, so the "Effective qty" on the paper is the
 * quantity a one-yield run will actually move — not a second implementation of
 * the scrap uplift that can drift from the one that posts stock. The uplift
 * applies to components only, exactly as it does there: a by-product or scrap
 * line's percentage is not a consumption allowance.
 */
export function bomSheetRows(lines: readonly BomLine[]): BomSheetRow[] {
  return lines.map((line, i) => {
    const kind = kindOf(line)
    const qty = Number(line.qty) || 0
    const scrap = Number(line.scrap_percent) || 0
    return {
      line_no: i + 1,
      kind: KIND_LABELS[kind],
      item: line.item_name && line.item_name.trim() !== '' ? line.item_name : `#${line.item_id}`,
      sku: line.item_sku ?? '',
      qty,
      scrap_percent: kind === 'component' ? scrap : 0,
      unit: line.unit_symbol ?? '',
      effective_qty: componentQty(qty, 1, kind === 'component' ? scrap : 0),
    }
  })
}

/**
 * Everything the printed sheet says about one saved bill of materials.
 *
 * `bom` is the record as the server returned it, never the form draft: a sheet
 * built from unsaved edits would look like the bill and not be it. The footer
 * says so rather than leaving the reader to find out.
 */
export function buildBomSheet(bom: Bom): BomSheet {
  const lines = bom.lines ?? []
  const rows = bomSheetRows(lines)
  const active = Number(bom.is_active) === 1
  const counts: Record<BomLineKind, number> = { component: 0, by_product: 0, scrap: 0 }
  for (const line of lines) counts[kindOf(line)] += 1

  const summaryCards: SheetSummaryCard[] = [
    // An inactive bill still prints — a superseded recipe is exactly the thing
    // an auditor asks for — but the paper has to say it is not in use, and the
    // tone is what carries that onto a black-and-white page.
    {
      label: 'Status',
      value: active ? 'Active' : 'Inactive',
      hint: active ? 'Available for production' : 'Not available for production',
      tone: active ? 'default' : 'warn',
    },
    { label: 'Yield', value: qtyWithUnit(bom.yield_qty, bom.yield_unit_symbol), hint: 'per run' },
    { label: 'Components', value: String(counts.component) },
  ]
  if (counts.by_product > 0) summaryCards.push({ label: 'By-products', value: String(counts.by_product) })
  if (counts.scrap > 0) summaryCards.push({ label: 'Scrap lines', value: String(counts.scrap) })

  const footerNotes = [
    `Quantities are per one run of this bill — ${qtyWithUnit(bom.yield_qty, bom.yield_unit_symbol)} of ${itemLabel(bom.finished_item_name, bom.finished_item_sku, bom.finished_item_id)}.`,
    'Effective quantity applies the line’s scrap percentage, and is what a production run of one yield consumes. Scrap applies to component lines only.',
    'Quantities are not totalled: lines can be in different units.',
    'Printed from the saved bill of materials — unsaved changes on screen are not included.',
  ]
  if (!active) {
    footerNotes.unshift('This bill of materials is inactive and cannot be selected for a new production run.')
  }

  return {
    title: bom.bom_name,
    description: 'Bill of materials',
    rows,
    metaLines: [
      `Finished item: ${itemLabel(bom.finished_item_name, bom.finished_item_sku, bom.finished_item_id)}`,
      `Yield: ${qtyWithUnit(bom.yield_qty, bom.yield_unit_symbol)} per run`,
      `Bill: #${bom.bom_id}`,
      `Last updated: ${formatDateTime(bom.updated_at ?? bom.created_at, '—')}`,
    ],
    summaryCards,
    footerNotes,
    filenameBase: `bill-of-materials-${bom.bom_id}`,
  }
}
