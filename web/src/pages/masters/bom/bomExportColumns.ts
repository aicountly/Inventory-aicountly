import type { ExportableColumn } from '../../../registers/registerCells'
import type { Bom, BomLine } from '../../../services/masters'
import { formatDateTime, formatQty, humanize } from '../../../utils/format'
import { BOM_STATUS_LABEL, bomCode, bomStatus } from './bomPresentation'

/**
 * What the CSV, the spreadsheet, the PDF and the letterheaded print sheet write.
 *
 * Every column that is COMPUTED or NESTED on screen declares its own resolver
 * here. Without one the exporter falls back to `row[key]`, and a column whose
 * cell was assembled in React — the component chips, the status badge, the
 * "updated by" pair — comes out blank in the file under a header promising a
 * value. A reader who files that PDF has a document that contradicts the screen
 * it was printed from.
 */

export const BOM_LIST_EXPORT_COLUMNS: readonly ExportableColumn<Bom>[] = [
  { key: 'bom_code', csvHeader: 'BOM code', csv: (r) => bomCode(r) },
  { key: 'bom_name', csvHeader: 'BOM name', csv: (r) => r.bom_name },
  {
    key: 'finished_item_name',
    csvHeader: 'Finished item',
    csv: (r) => r.finished_item_name ?? `#${r.finished_item_id}`,
  },
  { key: 'finished_item_sku', csvHeader: 'Finished item code', csv: (r) => r.finished_item_sku ?? '' },
  { key: 'finished_item_group_name', csvHeader: 'Item group', csv: (r) => r.finished_item_group_name ?? '' },
  {
    key: 'component_count',
    csvHeader: 'Components',
    align: 'right',
    csv: (r) => r.component_count ?? r.line_count ?? 0,
  },
  {
    // The screen writes "1 pc"; the sheet needs a number a reader can total,
    // with the unit in its own column beside it.
    key: 'yield_qty',
    csvHeader: 'Yield',
    align: 'right',
    format: 'qty',
    csv: (r) => r.yield_qty ?? '',
  },
  { key: 'yield_unit_symbol', csvHeader: 'Yield unit', csv: (r) => r.yield_unit_symbol ?? '' },
  { key: 'is_active', csvHeader: 'Status', csv: (r) => BOM_STATUS_LABEL[bomStatus(r)] },
  { key: 'updated_at', csvHeader: 'Updated', csv: (r) => formatDateTime(r.updated_at) },
  {
    key: 'updated_by',
    csvHeader: 'Updated by',
    csv: (r) => r.updated_by_name ?? r.updated_by ?? '',
  },
]

/** One bill's own lines, for the detail sheet and the printed BOM report. */
export const BOM_LINE_EXPORT_COLUMNS: readonly ExportableColumn<BomLine>[] = [
  { key: 'line_kind', csvHeader: 'Kind', csv: (l) => humanize(l.line_kind) },
  { key: 'item_name', csvHeader: 'Item', csv: (l) => l.item_name ?? `#${l.item_id}` },
  { key: 'item_sku', csvHeader: 'Item code', csv: (l) => l.item_sku ?? '' },
  { key: 'qty', csvHeader: 'Quantity', align: 'right', format: 'qty', csv: (l) => l.qty ?? '' },
  { key: 'unit_symbol', csvHeader: 'Unit', csv: (l) => l.unit_symbol ?? '' },
  {
    key: 'scrap_percent',
    csvHeader: 'Wastage %',
    align: 'right',
    format: 'qty',
    csv: (l) => l.scrap_percent ?? 0,
  },
  {
    // Derived on screen from quantity and wastage, so it MUST resolve itself.
    key: 'gross_qty',
    csvHeader: 'Gross quantity',
    align: 'right',
    format: 'qty',
    csv: (l) => Number((Number(l.qty) * (1 + (Number(l.scrap_percent) || 0) / 100)).toFixed(4)),
  },
]

/** The figures the printed BOM report carries under its letterhead. */
export function bomSheetMetaLines(bom: Bom): string[] {
  return [
    `BOM code: ${bomCode(bom)}`,
    `Finished item: ${bom.finished_item_name ?? `#${bom.finished_item_id}`}${bom.finished_item_sku ? ` (${bom.finished_item_sku})` : ''}`,
    `Yield: ${formatQty(bom.yield_qty)}${bom.yield_unit_symbol ? ` ${bom.yield_unit_symbol}` : ''}`,
    `Status: ${BOM_STATUS_LABEL[bomStatus(bom)]}`,
    `Last updated: ${formatDateTime(bom.updated_at)}${bom.updated_by_name ? ` by ${bom.updated_by_name}` : ''}`,
  ]
}
