/**
 * What the toolbar and the row actions do to the list of lines.
 *
 * Pure: every function takes the current lines and returns the next ones, so
 * "duplicating a row drops its serial numbers" and "scanning the same item twice
 * adds one to its quantity" are unit tests rather than click-throughs. The
 * workspace only decides WHEN to call them.
 */

import type { ItemSearchRow } from '../../services/lookupApi'
import { isBlankLine, newLine, nextLineKey } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import { unitOptionsFrom } from '../LineEditor'

/** The fields an item search row contributes to a line. */
export function itemPatch(row: ItemSearchRow): Partial<LineDraft> {
  const units = unitOptionsFrom(row)
  const def = units.find((u) => u.is_default) ?? units[0]
  return {
    item_id: row.item_id,
    item_name: row.print_name || row.item_name,
    item_sku: row.item_sku,
    track_batch: Number(row.track_batch) === 1,
    track_serial: Number(row.track_serial) === 1,
    units,
    unit_id: def?.unit_id ?? row.unit_id ?? null,
    // A batch and a serial belong to the item that was there before.
    batch_id: null,
    batch_no: null,
    serials: [],
  }
}

/** Everything the item contributed, taken back off the line. */
export const CLEARED_ITEM: Partial<LineDraft> = {
  item_id: null,
  item_name: '',
  item_sku: null,
  track_batch: false,
  track_serial: false,
  units: [],
  unit_id: null,
  batch_id: null,
  batch_no: null,
  serials: [],
}

export function lineFromItem(spec: DocumentTypeSpec, row: ItemSearchRow, qty: string, description = ''): LineDraft {
  return newLine(spec, { ...itemPatch(row), qty, description })
}

/**
 * A copy of the row directly under it.
 *
 * The batch comes along — it is the same stock, and the availability check counts
 * both rows against it. The serial numbers do not: a serial is one physical
 * thing, and it cannot be on two lines of the same transfer.
 */
export function duplicateLineAt(lines: LineDraft[], key: string): LineDraft[] {
  const index = lines.findIndex((l) => l.key === key)
  if (index < 0) return lines
  const copy: LineDraft = { ...lines[index], key: nextLineKey(), serials: [] }
  return [...lines.slice(0, index + 1), copy, ...lines.slice(index + 1)]
}

/** Appends picked items, dropping the empty row they were added from. */
export function appendItems(spec: DocumentTypeSpec, lines: LineDraft[], rows: readonly ItemSearchRow[]): LineDraft[] {
  return [...lines.filter((l) => !isBlankLine(l)), ...rows.map((row) => lineFromItem(spec, row, '1'))]
}

/**
 * A scan lands on the row the item is already on, as one more of it.
 *
 * Except when the item is serial tracked: those are counted one serial at a time,
 * and a quantity bumped past the serials already picked would just fail to post.
 */
export function scanIntoLines(spec: DocumentTypeSpec, lines: LineDraft[], row: ItemSearchRow): LineDraft[] {
  const serialTracked = Number(row.track_serial) === 1
  const index = serialTracked ? -1 : lines.findIndex((l) => l.item_id === row.item_id)
  if (index >= 0) {
    const next = String((Number(lines[index].qty) || 0) + 1)
    return lines.map((l, i) => (i === index ? { ...l, qty: next } : l))
  }
  return [...lines.filter((l) => !isBlankLine(l)), lineFromItem(spec, row, '1')]
}

export interface ImportedLine {
  row: ItemSearchRow
  qty: number
  batchNo: string | null
}

/**
 * Imported rows become ordinary lines the operator can still edit. A batch
 * number from the file is kept as a note, not applied: the batch that actually
 * gets issued is chosen on the row, against live stock.
 */
export function importIntoLines(spec: DocumentTypeSpec, lines: LineDraft[], imported: readonly ImportedLine[]): LineDraft[] {
  return [
    ...lines.filter((l) => !isBlankLine(l)),
    ...imported.map((i) => lineFromItem(spec, i.row, String(i.qty), i.batchNo ? `Batch from import: ${i.batchNo}` : '')),
  ]
}

/**
 * Source and destination change places, on the header and on every row override.
 *
 * Batches and serials are cleared: they were chosen out of the warehouse that is
 * now the destination, so nothing about them still holds. The caller asks first
 * when there is anything to lose.
 */
export function swapHeader(header: HeaderDraft): HeaderDraft {
  return { ...header, from_warehouse_id: header.to_warehouse_id, to_warehouse_id: header.from_warehouse_id }
}

export function swapLines(lines: LineDraft[]): LineDraft[] {
  return lines.map((l) => ({
    ...l,
    from_warehouse_id: l.warehouse_id,
    warehouse_id: l.from_warehouse_id,
    batch_id: null,
    batch_no: null,
    serials: [],
  }))
}

/** True when a swap would throw away work: a batch or a serial has been picked. */
export function swapWouldClearAllocations(lines: readonly LineDraft[]): boolean {
  return lines.some((l) => l.batch_id !== null || l.serials.length > 0)
}
