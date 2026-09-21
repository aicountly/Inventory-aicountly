import { describe, expect, it } from 'vitest'
import {
  applyLookup,
  baseUnitOf,
  draftFromDocument,
  duplicateRowNumber,
  isBlankRow,
  markDuplicates,
  newHeader,
  newRow,
  parseDelimitedSerials,
  parseSerialList,
  splitDelimited,
  summarise,
  toPayload,
  toPayloadLines,
  validateDraft,
} from './model'
import type { SerialRowDraft } from './model'
import { commonPrefix, pooled } from './resolver'
import type { SerialLookupRow } from '../../services/lookupApi'
import type { DocumentLine, InventoryDocument } from '../types'

/*
 * The contract this screen rests on: the grid is one row per serial, but the document it
 * posts is the same `by_line` shape every other type uses. If the folding in `toPayloadLines`
 * is wrong, the screen silently records the wrong quantity against the wrong warehouse — and
 * a serial adjustment is exactly the document an auditor reads later.
 */

function serial(over: Partial<SerialLookupRow> = {}): SerialLookupRow {
  return {
    serial_id: 1,
    item_id: 10,
    serial_no: 'SN-1',
    batch_id: null,
    warehouse_id: 3,
    location_id: null,
    status: 'in_stock',
    unit_cost: null,
    received_document_id: null,
    issued_document_id: null,
    warranty_until: null,
    item_name: 'Dell Latitude 5440',
    item_sku: 'DELL5440',
    warehouse_name: 'Main',
    warehouse_code: 'MN',
    batch_no: null,
    expiry_date: null,
    location_code: null,
    ...over,
  }
}

function resolvedRow(over: Partial<SerialRowDraft> = {}): SerialRowDraft {
  return newRow({
    serial_no: 'SN-1',
    serial_id: 1,
    item_id: 10,
    item_name: 'Dell Latitude 5440',
    unit_id: 7,
    conversion_factor: 1,
    warehouse_id: 3,
    direction: 'out',
    current_status: 'in_stock',
    check: 'ok',
    ...over,
  })
}

describe('folding serial rows into document lines', () => {
  it('collapses serials that share item, warehouse, batch and direction into one line', () => {
    const rows = [
      resolvedRow({ serial_id: 1, serial_no: 'SN-1' }),
      resolvedRow({ serial_id: 2, serial_no: 'SN-2' }),
      resolvedRow({ serial_id: 3, serial_no: 'SN-3' }),
    ]

    const lines = toPayloadLines(rows, null)

    expect(lines).toHaveLength(1)
    expect(lines[0].qty).toBe(3)
    expect(lines[0].serials).toEqual([1, 2, 3])
    expect(lines[0].item_id).toBe(10)
    expect(lines[0].warehouse_id).toBe(3)
    expect(lines[0].direction).toBe('out')
  })

  it('keeps the quantity equal to the number of serials, which is what the server checks', () => {
    const rows = [resolvedRow({ serial_id: 1, serial_no: 'A' }), resolvedRow({ serial_id: 2, serial_no: 'B' })]
    const [line] = toPayloadLines(rows, null)
    expect(line.serials).toHaveLength(line.qty)
  })

  it('splits on every field a line is keyed by', () => {
    const rows = [
      resolvedRow({ serial_id: 1, serial_no: 'A' }),
      resolvedRow({ serial_id: 2, serial_no: 'B', warehouse_id: 4 }),
      resolvedRow({ serial_id: 3, serial_no: 'C', direction: 'in' }),
      resolvedRow({ serial_id: 4, serial_no: 'D', batch_id: 99 }),
      resolvedRow({ serial_id: 5, serial_no: 'E', item_id: 11 }),
    ]

    expect(toPayloadLines(rows, null)).toHaveLength(5)
  })

  it('keeps a per-row remark on the line carrying that serial, never smeared over the group', () => {
    const rows = [
      resolvedRow({ serial_id: 1, serial_no: 'A' }),
      resolvedRow({ serial_id: 2, serial_no: 'B', remarks: 'Case cracked' }),
    ]

    const lines = toPayloadLines(rows, null)

    expect(lines).toHaveLength(2)
    expect(lines.find((l) => l.serials?.includes(2))?.description).toBe('Case cracked')
    expect(lines.find((l) => l.serials?.includes(1))?.description).toBeUndefined()
  })

  it('falls back to the header default warehouse when a row leaves it unset', () => {
    const [line] = toPayloadLines([resolvedRow({ warehouse_id: null })], 8)
    expect(line.warehouse_id).toBe(8)
  })

  it('drops blank rows and rows with no item', () => {
    const rows = [resolvedRow(), newRow(), newRow({ serial_no: 'TYPED-BUT-UNRESOLVED' })]
    expect(toPayloadLines(rows, null)).toHaveLength(1)
  })

  it('divides by the conversion factor so a non-base unit never overstates the quantity', () => {
    // A serial is one piece. On an item whose chosen unit is a box of 12, one serial is 1/12
    // of a box, and sending qty 1 would record twelve pieces for one scanned label.
    const [line] = toPayloadLines([resolvedRow({ conversion_factor: 12 })], null)
    expect(line.qty).toBeCloseTo(1 / 12, 4)
  })
})

describe('the payload keeps the SERIAL_ADJUSTMENT contract', () => {
  it('sends the type, the reason pair and nothing a serial adjustment does not carry', () => {
    const header = { ...newHeader('2026-09-18'), reason_code: ' DAMAGE ', movement_reason: 'Audit', narration: ' note ' }
    const payload = toPayload(header, [resolvedRow()])

    expect(payload.document_type).toBe('SERIAL_ADJUSTMENT')
    expect(payload.document_date).toBe('2026-09-18')
    expect(payload.reason_code).toBe('DAMAGE')
    expect(payload.movement_reason).toBe('Audit')
    expect(payload.narration).toBe('note')
    expect(payload.document_no).toBeNull()
    // No party, no stock effect, no valuation rate: the type declares none of them.
    expect(payload.party_ref).toBeUndefined()
    expect(payload.stock_effect).toBeUndefined()
    expect(payload.from_warehouse_id).toBeUndefined()
  })

  it('sends a typed document number through untouched', () => {
    const payload = toPayload({ ...newHeader('2026-09-18'), document_no: 'SA-42' }, [resolvedRow()])
    expect(payload.document_no).toBe('SA-42')
  })
})

describe('validation refuses what the server would reject', () => {
  it('needs a date and at least one serial', () => {
    const result = validateDraft({ ...newHeader(''), document_date: '' }, [newRow()])
    expect(result.errors).toContain('Document date is required (YYYY-MM-DD).')
    expect(result.errors).toContain('Scan or add at least one serial number.')
  })

  it('needs a direction on every row, because by_line requires one', () => {
    const result = validateDraft(newHeader('2026-09-18'), [resolvedRow({ direction: null })])
    expect(result.rowIssues.map((i) => i.message)).toContain('Choose whether this serial goes in or out.')
  })

  it('blocks a serial that was typed but never matched', () => {
    const row = newRow({ serial_no: 'GHOST-1', check: 'error' })
    const result = validateDraft(newHeader('2026-09-18'), [row])
    expect(result.rowIssues[0].message).toMatch(/not found/i)
  })

  it('blocks the same serial twice and names the line it is already on', () => {
    const rows = [resolvedRow({ serial_no: 'SN-1', serial_id: 1 }), resolvedRow({ serial_no: 'SN-1', serial_id: 1 })]
    const result = validateDraft(newHeader('2026-09-18'), rows)
    expect(result.rowIssues.some((i) => i.row === 2 && /already on line 1/i.test(i.message))).toBe(true)
  })

  it('warns, but does not block, on a serial that is not in stock', () => {
    const result = validateDraft(newHeader('2026-09-18'), [resolvedRow({ current_status: 'issued' })])
    expect(result.rowIssues).toHaveLength(0)
    expect(result.warnings[0]).toMatch(/not in stock/i)
  })

  it('passes a well-formed draft', () => {
    const result = validateDraft(newHeader('2026-09-18'), [resolvedRow(), resolvedRow({ serial_id: 2, serial_no: 'SN-2' })])
    expect(result.errors).toEqual([])
    expect(result.rowIssues).toEqual([])
  })
})

describe('duplicate detection', () => {
  it('points at the first row a serial was claimed on, not the current one', () => {
    const rows = [resolvedRow({ serial_no: 'SN-9' }), resolvedRow({ serial_no: 'other' })]
    expect(duplicateRowNumber(rows, rows[1].key, 'SN-9')).toBe(1)
    expect(duplicateRowNumber(rows, rows[0].key, 'SN-9')).toBeNull()
  })

  it('ignores case, the way a scanner and a keyboard disagree about it', () => {
    const rows = [resolvedRow({ serial_no: 'sn-9' }), resolvedRow({ serial_no: 'x' })]
    expect(duplicateRowNumber(rows, rows[1].key, 'SN-9')).toBe(1)
  })

  it('clears the error on the survivor once the earlier duplicate is deleted', () => {
    const marked = markDuplicates([resolvedRow({ serial_no: 'A' }), resolvedRow({ serial_no: 'A' })])
    expect(marked[1].check).toBe('error')

    const afterDelete = markDuplicates(marked.slice(1))

    expect(afterDelete[0].check).toBe('ok')
    expect(afterDelete[0].message).toBeNull()
  })

  it('restores the not-in-stock warning rather than a clean tick when the duplicate goes', () => {
    const rows = markDuplicates([
      resolvedRow({ serial_no: 'A', current_status: 'issued' }),
      resolvedRow({ serial_no: 'A', current_status: 'issued' }),
    ])
    const afterDelete = markDuplicates(rows.slice(1))
    expect(afterDelete[0].check).toBe('warning')
    expect(afterDelete[0].message).toMatch(/issued/)
  })
})

describe('folding a looked-up serial into a row', () => {
  it('fills the item, warehouse, batch and status from the API response', () => {
    const row = applyLookup(newRow(), serial({ batch_id: 5, batch_no: 'B-5' }), null)
    expect(row.item_id).toBe(10)
    expect(row.item_name).toBe('Dell Latitude 5440')
    expect(row.item_sku).toBe('DELL5440')
    expect(row.warehouse_id).toBe(3)
    expect(row.batch_no).toBe('B-5')
    expect(row.current_status).toBe('in_stock')
    expect(row.check).toBe('ok')
  })

  it('takes the serial number the API returned, not the one that was typed', () => {
    const row = applyLookup(newRow({ serial_no: 'sn-1' }), serial({ serial_no: 'SN-1' }), null)
    expect(row.serial_no).toBe('SN-1')
  })

  it('flags a serial that is not stock-bearing', () => {
    const row = applyLookup(newRow(), serial({ status: 'scrapped' }), null)
    expect(row.check).toBe('warning')
    expect(row.message).toMatch(/scrapped/)
  })

  it('flags a duplicate above every other note', () => {
    const row = applyLookup(newRow(), serial({ status: 'scrapped' }), 2)
    expect(row.check).toBe('error')
    expect(row.message).toBe('Already added on line 2.')
  })
})

describe('the base unit a serial row posts in', () => {
  it('prefers the unit the item master marks as base', () => {
    const unit = baseUnitOf({
      unit_id: 2,
      unit_symbol: 'Box',
      units: [
        { unit_id: 2, is_default: 1, conversion_factor: 12, uom_role: 'purchase', unit_symbol: 'Box', unit_name: 'Box' },
        { unit_id: 1, is_default: 0, conversion_factor: 1, uom_role: 'base', unit_symbol: 'Pcs', unit_name: 'Pieces' },
      ],
    })
    expect(unit.unit_id).toBe(1)
    expect(unit.conversion_factor).toBe(1)
  })

  it('falls back to a factor of one when no unit declares the base role', () => {
    const unit = baseUnitOf({
      unit_id: 2,
      unit_symbol: 'Box',
      units: [
        { unit_id: 2, is_default: 1, conversion_factor: 6, uom_role: null, unit_symbol: 'Box', unit_name: 'Box' },
        { unit_id: 3, is_default: 0, conversion_factor: 1, uom_role: null, unit_symbol: 'Pcs', unit_name: 'Pieces' },
      ],
    })
    expect(unit.unit_id).toBe(3)
  })

  it('falls back to the item unit when there is no unit table at all', () => {
    expect(baseUnitOf({ unit_id: 4, unit_symbol: 'Nos', units: [] })).toEqual({ unit_id: 4, conversion_factor: 1 })
  })
})

describe('reading a stored document back into the grid', () => {
  function line(over: Partial<DocumentLine> = {}): DocumentLine {
    return {
      line_id: 1,
      document_id: 1,
      item_id: 10,
      item_name: 'Dell Latitude 5440',
      item_sku: 'DELL5440',
      warehouse_id: 3,
      warehouse_name: 'Main',
      dest_warehouse_id: null,
      location_id: null,
      batch_id: null,
      unit_id: 7,
      direction: 'out',
      qty: 2,
      conversion_factor: 1,
      base_qty: 2,
      source_transaction_rate: null,
      source_transaction_amount: null,
      valuation_rate: null,
      valuation_amount: null,
      valuation_method_applied: null,
      landed_cost_amount: null,
      book_qty: null,
      physical_qty: null,
      sort_order: 0,
      metadata: null,
      serials: [
        { serial_id: 1, serial_no: 'SN-1' },
        { serial_id: 2, serial_no: 'SN-2' },
      ],
      ...over,
    }
  }

  function document(lines: DocumentLine[]): InventoryDocument {
    return {
      document_date: '2026-09-18',
      document_no: 'SA-1',
      reason_code: 'DAMAGE',
      movement_reason: 'Audit',
      narration: 'note',
      lines,
    } as unknown as InventoryDocument
  }

  it('expands one line of two serials into two rows', () => {
    const { rows, header } = draftFromDocument(document([line()]))
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.serial_no)).toEqual(['SN-1', 'SN-2'])
    expect(rows.every((r) => r.qty === 1)).toBe(true)
    expect(header.reason_code).toBe('DAMAGE')
  })

  it('round-trips: expanding then folding gives back the line it started from', () => {
    const { rows, header } = draftFromDocument(document([line()]))
    const [folded] = toPayloadLines(rows, header.default_warehouse_id)
    expect(folded.qty).toBe(2)
    expect(folded.serials).toEqual([1, 2])
    expect(folded.item_id).toBe(10)
    expect(folded.direction).toBe('out')
  })

  it('keeps the quantity of a stored line that carries no serials at all', () => {
    const { rows } = draftFromDocument(document([line({ serials: [], qty: 5, base_qty: 5 })]))
    expect(rows).toHaveLength(1)
    expect(rows[0].qty).toBe(5)
    expect(toPayloadLines(rows, null)[0].qty).toBe(5)
  })
})

describe('the running summary', () => {
  it('counts rows, unique serials and the lines the document will actually post', () => {
    const rows = [
      resolvedRow({ serial_id: 1, serial_no: 'A' }),
      resolvedRow({ serial_id: 2, serial_no: 'B' }),
      resolvedRow({ serial_id: 3, serial_no: 'C', warehouse_id: 4 }),
      newRow(),
    ]

    const s = summarise(rows, null)

    expect(s.serialLines).toBe(3)
    expect(s.uniqueSerials).toBe(3)
    expect(s.documentLines).toBe(2)
    expect(s.items).toBe(1)
    expect(s.warehouses).toBe(2)
    expect(s.outCount).toBe(3)
  })

  it('counts rows that need attention', () => {
    const s = summarise([resolvedRow(), resolvedRow({ serial_no: 'B', check: 'warning' }), resolvedRow({ serial_no: 'C', check: 'error' })], null)
    expect(s.needsAttention).toBe(2)
  })

  it('reads zero off an untouched form', () => {
    const s = summarise([newRow()], null)
    expect(s).toMatchObject({ serialLines: 0, uniqueSerials: 0, documentLines: 0, needsAttention: 0 })
  })
})

describe('parsing a pasted or imported list', () => {
  it('splits on newlines, commas, semicolons and tabs', () => {
    expect(parseSerialList('A\nB,C;D\tE').serials).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('reports repeats once instead of adding them twice', () => {
    const parsed = parseSerialList('A\nB\na\nB')
    expect(parsed.serials).toEqual(['A', 'B'])
    expect(parsed.duplicates).toEqual(['a', 'B'])
  })

  it('rejects anything longer than the column can hold', () => {
    const parsed = parseSerialList(`ok\n${'x'.repeat(129)}`)
    expect(parsed.serials).toEqual(['ok'])
    expect(parsed.tooLong).toHaveLength(1)
  })

  it('ignores blank lines and surrounding whitespace', () => {
    expect(parseSerialList('  A  \n\n\n  B  \n').serials).toEqual(['A', 'B'])
  })

  it('reads the serial column out of a CSV with a header row', () => {
    const csv = 'Item Code,Serial Number,Remarks\nDELL5440,SN-1,ok\nDELL5440,SN-2,\n'
    expect(parseDelimitedSerials(csv).serials).toEqual(['SN-1', 'SN-2'])
  })

  it('reads a bare scanner dump with no header as one serial per line', () => {
    expect(parseDelimitedSerials('SN-1\nSN-2\n').serials).toEqual(['SN-1', 'SN-2'])
  })

  it('honours quotes around a value containing the delimiter', () => {
    expect(splitDelimited('a,"b,c",d', ',')).toEqual(['a', 'b,c', 'd'])
    expect(splitDelimited('a,"say ""hi""",c', ',')).toEqual(['a', 'say "hi"', 'c'])
  })

  it('reads a tab-separated file', () => {
    expect(parseDelimitedSerials('Serial\tRemarks\nSN-1\tok\n').serials).toEqual(['SN-1'])
  })
})

describe('the batch lookup shortcut', () => {
  it('finds the prefix a scanner block shares', () => {
    expect(commonPrefix(['DELL-10001', 'DELL-10002', 'DELL-10003'])).toBe('DELL-1000')
  })

  it('gives up when the values share nothing', () => {
    expect(commonPrefix(['ABC', 'XYZ'])).toBe('')
    expect(commonPrefix([])).toBe('')
  })

  it('never lets more than the pool size run at once, and keeps input order', async () => {
    let live = 0
    let peak = 0
    const out = await pooled([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      live += 1
      peak = Math.max(peak, live)
      await Promise.resolve()
      live -= 1
      return n * 2
    })
    expect(peak).toBeLessThanOrEqual(3)
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16])
  })
})

describe('blank rows', () => {
  it('is blank with nothing typed and not blank once a serial is', () => {
    expect(isBlankRow(newRow())).toBe(true)
    expect(isBlankRow(newRow({ serial_no: 'A' }))).toBe(false)
    expect(isBlankRow(newRow({ item_id: 3 }))).toBe(false)
  })
})
