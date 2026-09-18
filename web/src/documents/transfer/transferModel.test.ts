import { describe, expect, it } from 'vitest'
import { specForCode } from '../registry'
import { newHeader, newLine } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import {
  availabilityRequests,
  computeLineStock,
  estimatedUnitValue,
  formatEstimate,
  hasReason,
  readRefs,
  stockKey,
  transferPayload,
  transferTotals,
  validateTransfer,
  writeRefs,
} from './transferModel'
import type { AvailabilityBuckets, LineStock } from './transferModel'

const SPEC = specForCode('STOCK_TRANSFER')!
const TODAY = '2026-09-18'

function header(patch: Partial<HeaderDraft> = {}): HeaderDraft {
  return { ...newHeader(SPEC, TODAY), from_warehouse_id: 1, to_warehouse_id: 2, reason_code: 'BRANCH_TRANSFER', movement_reason: 'Branch Transfer', ...patch }
}

function line(patch: Partial<LineDraft> = {}): LineDraft {
  return newLine(SPEC, {
    item_id: 10,
    item_name: 'Laptop Dell Inspiron 15',
    item_sku: 'PRD-001',
    unit_id: 5,
    units: [{ unit_id: 5, unit_symbol: 'Nos', unit_name: 'Numbers', conversion_factor: 1, is_default: true }],
    qty: '10',
    ...patch,
  })
}

function buckets(available: number, patch: Partial<AvailabilityBuckets> = {}): AvailabilityBuckets {
  return { on_hand: available, reserved: 0, committed: 0, available, in_transit: 0, expected: 0, ...patch }
}

function stockFor(lines: LineDraft[], h: HeaderDraft, index: [string, AvailabilityBuckets][]): Map<string, LineStock> {
  return computeLineStock(lines, h, new Map(index), new Set<number>())
}

const NO_STOCK = new Map<string, LineStock>()

describe('the header fields a transfer adds', () => {
  it('keeps the reference and arrival date in document metadata, not in a new column', () => {
    const meta = writeRefs({}, { referenceType: 'PURCHASE_RECEIPT', referenceNo: 'GRN-9', expectedArrivalDate: '2026-09-20' })
    expect(meta).toEqual({ reference_type: 'PURCHASE_RECEIPT', reference_no: 'GRN-9', expected_arrival_date: '2026-09-20' })
    expect(readRefs(meta)).toEqual({ referenceType: 'PURCHASE_RECEIPT', referenceNo: 'GRN-9', expectedArrivalDate: '2026-09-20' })
  })

  it('removes a key rather than storing an empty one', () => {
    const meta = writeRefs({ reference_no: 'GRN-9', bom_id: 4 }, { referenceType: '', referenceNo: '', expectedArrivalDate: '' })
    expect(meta).toEqual({ bom_id: 4 })
  })

  it('ignores an arrival date that is not a date', () => {
    expect(readRefs({ expected_arrival_date: 'soon' }).expectedArrivalDate).toBe('')
  })

  it('sends the reason in the columns the API already has', () => {
    const payload = transferPayload(header({ reason_code: 'damage_segregation', movement_reason: 'Quarantine' }), [line()], SPEC)
    expect(payload.reason_code).toBe('DAMAGE_SEGREGATION')
    expect(payload.movement_reason).toBe('Quarantine')
    expect(payload.from_warehouse_id).toBe(1)
    expect(payload.to_warehouse_id).toBe(2)
    expect(payload.lines).toHaveLength(1)
  })

  it('sends no reason at all rather than an empty string', () => {
    const payload = transferPayload(header({ reason_code: '', movement_reason: '' }), [line()], SPEC)
    expect(payload.reason_code).toBeNull()
    expect(payload.movement_reason).toBeNull()
  })

  it('treats "Other" as answered only once it is described', () => {
    expect(hasReason({ reason_code: 'OTHER', movement_reason: '' })).toBe(false)
    expect(hasReason({ reason_code: 'OTHER', movement_reason: 'Rebalancing' })).toBe(true)
    expect(hasReason({ reason_code: 'SAMPLE', movement_reason: '' })).toBe(true)
  })
})

describe('the summary', () => {
  it('counts the lines that carry something', () => {
    const lines = [line(), line({ item_id: 11, qty: '100' }), newLine(SPEC)]
    expect(transferTotals(lines, null).items).toBe(2)
  })

  it('adds the quantities as they were entered', () => {
    const lines = [line({ qty: '10' }), line({ item_id: 11, qty: '100' }), line({ item_id: 12, qty: '35' })]
    expect(transferTotals(lines, null).quantity).toBe(145)
  })

  it('values each line at quantity × the inventory unit cost', () => {
    const rates = new Map([[10, 50000]])
    const totals = transferTotals([line({ qty: '10' })], rates)
    expect(totals.value).toBe(500000)
    expect(formatEstimate(totals.value, 'INR')).toBe('₹ 5,00,000.00')
  })

  it('values an alternate unit at its base-unit cost', () => {
    const l = line({
      qty: '2',
      unit_id: 7,
      units: [
        { unit_id: 5, unit_symbol: 'Nos', unit_name: null, conversion_factor: 1, is_default: true },
        { unit_id: 7, unit_symbol: 'Box', unit_name: null, conversion_factor: 12, is_default: false },
      ],
    })
    const rates = new Map([[10, 100]])
    // 2 boxes = 24 base units at 100 each.
    expect(transferTotals([l], rates).value).toBe(2400)
    expect(estimatedUnitValue(l, rates)).toBe(1200)
  })

  it('withholds the value entirely when the profile may not see valuation', () => {
    const totals = transferTotals([line()], null)
    expect(totals.value).toBeNull()
    expect(formatEstimate(totals.value, 'INR')).toBe('—')
  })

  it('prints an amount without a symbol when the base currency cannot be read', () => {
    expect(formatEstimate(1284.5, null)).toBe('1,284.50')
  })

  it('leaves an unpriced line out of the estimate and says how many', () => {
    const rates = new Map([[10, 50]])
    const totals = transferTotals([line(), line({ item_id: 99 })], rates)
    expect(totals.items).toBe(2)
    expect(totals.valuedLines).toBe(1)
    expect(totals.value).toBe(500)
  })
})

describe('live stock at the source', () => {
  it('asks once per source warehouse, not once per line', () => {
    const h = header()
    const lines = [line(), line({ item_id: 11 }), line({ item_id: 12, from_warehouse_id: 4 })]
    expect(availabilityRequests(lines, h)).toEqual([
      { warehouseId: 1, itemIds: [10, 11] },
      { warehouseId: 4, itemIds: [12] },
    ])
  })

  it('follows the header source when it changes', () => {
    const lines = [line()]
    expect(availabilityRequests(lines, header({ from_warehouse_id: 1 }))).toEqual([{ warehouseId: 1, itemIds: [10] }])
    expect(availabilityRequests(lines, header({ from_warehouse_id: 9 }))).toEqual([{ warehouseId: 9, itemIds: [10] }])
  })

  it('asks nothing while no source warehouse is chosen', () => {
    expect(availabilityRequests([line()], header({ from_warehouse_id: null }))).toEqual([])
  })

  it('counts every line drawing on the same stock against one balance', () => {
    const h = header()
    const lines = [line({ qty: '6' }), line({ qty: '6' })]
    const stock = stockFor(lines, h, [[stockKey(10, 1, null), buckets(10)]])
    expect(stock.get(lines[0].key)?.short).toBe(true)
    expect(stock.get(lines[0].key)?.shortBy).toBe(2)
    expect(stock.get(lines[0].key)?.requiredByOthers).toBe(6)
  })

  it('reads a batch line against that batch, not the whole item', () => {
    const h = header()
    const l = line({ batch_id: 77, batch_no: 'BCH-1', qty: '5' })
    const stock = stockFor([l], h, [
      [stockKey(10, 1, null), buckets(500)],
      [stockKey(10, 1, 77), buckets(3)],
    ])
    expect(stock.get(l.key)?.buckets.available).toBe(3)
    expect(stock.get(l.key)?.short).toBe(true)
  })

  it('says "no source" rather than "nothing there" before a warehouse is chosen', () => {
    const h = header({ from_warehouse_id: null })
    const l = line()
    expect(stockFor([l], h, []).get(l.key)?.state).toBe('no_source')
  })

  it('treats a missing balance row as nothing on hand once the answer has landed', () => {
    const l = line()
    const stock = computeLineStock([l], header(), new Map(), new Set())
    expect(stock.get(l.key)?.state).toBe('ready')
    expect(stock.get(l.key)?.short).toBe(true)
  })

  it('waits rather than crying short while the warehouse is still being read', () => {
    const l = line()
    const stock = computeLineStock([l], header(), new Map(), new Set([1]))
    expect(stock.get(l.key)?.state).toBe('loading')
    expect(stock.get(l.key)?.short).toBe(false)
  })
})

describe('what stops a transfer', () => {
  const base = { stock: NO_STOCK, negativeStockPolicy: null, posting: true } as const

  it('refuses the same warehouse on both sides', () => {
    const issues = validateTransfer({ ...base, header: header({ to_warehouse_id: 1 }), lines: [line()] })
    expect(issues.map((i) => i.id)).toContain('same_warehouse')
    expect(issues.find((i) => i.id === 'same_warehouse')?.message).toMatch(/cannot be the same/i)
  })

  it('asks for both warehouses', () => {
    const issues = validateTransfer({ ...base, header: header({ from_warehouse_id: null, to_warehouse_id: null }), lines: [line()] })
    expect(issues.map((i) => i.id)).toEqual(expect.arrayContaining(['from_missing', 'to_missing']))
  })

  it('refuses a date outside the selected financial year', () => {
    const issues = validateTransfer({ ...base, header: header({ document_date: '2025-01-01' }), lines: [line()], fyRange: { from: '2026-04-01', to: '2027-03-31' } })
    expect(issues.map((i) => i.id)).toContain('date_outside_fy')
  })

  it('refuses an arrival date before the document date', () => {
    const h = header({ metadata: { expected_arrival_date: '2026-09-01' } })
    expect(validateTransfer({ ...base, header: h, lines: [line()] }).map((i) => i.id)).toContain('arrival_before_document')
  })

  it('asks why the stock is moving before it will post', () => {
    const h = header({ reason_code: '', movement_reason: '' })
    expect(validateTransfer({ ...base, header: h, lines: [line()] }).map((i) => i.id)).toContain('reason_missing')
    // …but never before it will save a draft, which the API accepts without one.
    expect(validateTransfer({ ...base, posting: false, header: h, lines: [line()] }).map((i) => i.id)).not.toContain('reason_missing')
  })

  it('needs at least one item', () => {
    expect(validateTransfer({ ...base, header: header(), lines: [] }).map((i) => i.id)).toContain('no_lines')
  })

  it('needs a quantity above zero on every line', () => {
    const l = line({ qty: '0' })
    expect(validateTransfer({ ...base, header: header(), lines: [l] }).some((i) => i.id === `line_qty_${l.key}`)).toBe(true)
  })

  it('needs the batch on a batch-tracked item before posting, but not to save a draft', () => {
    const l = line({ track_batch: true })
    const h = header()
    expect(validateTransfer({ ...base, header: h, lines: [l] }).some((i) => i.id === `line_batch_${l.key}`)).toBe(true)
    expect(validateTransfer({ ...base, posting: false, header: h, lines: [l] }).some((i) => i.id === `line_batch_${l.key}`)).toBe(false)
  })

  it('needs one serial per base unit on a serial-tracked item', () => {
    const none = line({ track_serial: true, qty: '2' })
    expect(validateTransfer({ ...base, header: header(), lines: [none] }).some((i) => i.id === `line_serials_${none.key}`)).toBe(true)

    const partial = line({ track_serial: true, qty: '10', serials: [{ serial_id: 1, serial_no: 'SN-1' }] })
    const issue = validateTransfer({ ...base, header: header(), lines: [partial] }).find((i) => i.id === `line_serial_count_${partial.key}`)
    expect(issue?.message).toMatch(/1 of 10 serial numbers selected/)
  })

  it('refuses the same serial on two lines', () => {
    const serial = { serial_id: 7, serial_no: 'SN-7' }
    const a = line({ track_serial: true, qty: '1', serials: [serial] })
    const b = line({ track_serial: true, qty: '1', serials: [serial] })
    expect(validateTransfer({ ...base, header: header(), lines: [a, b] }).some((i) => i.id === 'serial_dup_7')).toBe(true)
  })

  it('blocks a shortfall only when the company blocks negative stock, and only on posting', () => {
    const h = header()
    const l = line({ qty: '10' })
    const stock = stockFor([l], h, [[stockKey(10, 1, null), buckets(4)]])

    const blocked = validateTransfer({ header: h, lines: [l], stock, negativeStockPolicy: 'block', posting: true })
    expect(blocked.find((i) => i.id === `line_short_${l.key}`)?.level).toBe('error')

    const warned = validateTransfer({ header: h, lines: [l], stock, negativeStockPolicy: 'warn', posting: true })
    expect(warned.find((i) => i.id === `line_short_${l.key}`)?.level).toBe('warning')

    // Settings unreadable: the server does the blocking, so this only warns.
    const unknown = validateTransfer({ header: h, lines: [l], stock, negativeStockPolicy: null, posting: true })
    expect(unknown.find((i) => i.id === `line_short_${l.key}`)?.level).toBe('warning')

    const draft = validateTransfer({ header: h, lines: [l], stock, negativeStockPolicy: 'block', posting: false })
    expect(draft.find((i) => i.id === `line_short_${l.key}`)?.level).toBe('warning')
  })

  it('warns about an expired batch without blocking the post', () => {
    const l = line({ batch_id: 4, batch_no: 'OLD' })
    const issues = validateTransfer({ ...base, header: header(), lines: [l], batchExpiry: new Map([[l.key, '2026-01-31']]) })
    const issue = issues.find((i) => i.id === `line_expired_${l.key}`)
    expect(issue?.level).toBe('warning')
    expect(issue?.always).toBe(true)
  })

  it('refuses a row that moves stock back into the warehouse it came from', () => {
    const l = line({ from_warehouse_id: 3, warehouse_id: 3 })
    expect(validateTransfer({ ...base, header: header(), lines: [l] }).some((i) => i.id === `line_same_wh_${l.key}`)).toBe(true)
  })

  it('passes a complete transfer', () => {
    const h = header()
    const l = line({ qty: '5' })
    const stock = stockFor([l], h, [[stockKey(10, 1, null), buckets(25)]])
    expect(validateTransfer({ header: h, lines: [l], stock, negativeStockPolicy: 'block', posting: true })).toEqual([])
  })
})
