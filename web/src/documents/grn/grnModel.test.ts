import { describe, expect, it } from 'vitest'
import {
  GRN_TAGS,
  duplicateSerials,
  grnAlerts,
  grnTotals,
  hasBlockingAlert,
  overReceivedLines,
  poLink,
  poMatchStatus,
  stockImpact,
  toggleTag,
  validateGrn,
} from './grnModel'
import { newHeader, newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import { specForCode } from '../registry'

const GRN = specForCode('INWARD_CHALLAN')!
const TODAY = '2026-09-18'
const FY = { from: '2026-04-01', to: '2027-03-31' }

const units = [{ unit_id: 1, unit_symbol: 'Nos', conversion_factor: 1, is_default: true }, { unit_id: 2, unit_symbol: 'Box', conversion_factor: 10, is_default: false }]

function line(partial: Partial<LineDraft> = {}): LineDraft {
  return newLine(GRN, { item_id: 10, item_name: 'Item', units, unit_id: 1, warehouse_id: 1, qty: '1', ...partial })
}

function header(partial: Partial<ReturnType<typeof newHeader>> = {}) {
  return { ...newHeader(GRN, TODAY), party_ref: '1042', party_name: 'Adani Enterprises Limited', default_warehouse_id: 1, ...partial }
}

describe('tags', () => {
  it('toggles a tag on and off without touching the others', () => {
    expect(toggleTag([], 'Direct GRN')).toEqual(['Direct GRN'])
    expect(toggleTag(['Direct GRN', 'Sample Goods'], 'Direct GRN')).toEqual(['Sample Goods'])
    expect(GRN_TAGS).toContain('Against Purchase Order')
  })
})

describe('stockImpact', () => {
  it('names what each stock effect does', () => {
    expect(stockImpact('challan_only').tone).toBe('pending')
    expect(stockImpact('challan_only').label).toBe('Pending')
    expect(stockImpact('physical').tone).toBe('receives')
    expect(stockImpact('settle_deferred').tone).toBe('settles')
    // An effect the server may add later still reads as the safe, non-moving default.
    expect(stockImpact('something_new').tone).toBe('pending')
  })
})

describe('grnTotals', () => {
  it('adds the entered quantities and amounts and ignores blank lines', () => {
    const totals = grnTotals([
      line({ qty: '10', rate: '52000', amount: '520000' }),
      line({ qty: '200', rate: '450', amount: '90000' }),
      line({ qty: '50', rate: '320' }),
      newLine(GRN),
    ])
    expect(totals.items).toBe(3)
    expect(totals.quantity).toBe(260)
    // The third line has no stored amount, so it is computed from qty × rate.
    expect(totals.amount).toBe(626000)
    expect(totals.incomplete).toBe(0)
  })

  it('counts a line with a quantity but no item as incomplete', () => {
    expect(grnTotals([line({ item_id: null, qty: '4' })]).incomplete).toBe(1)
  })
})

describe('purchase-order matching', () => {
  const linked = (qty: string, open: number) => line({ qty, metadata: { po_line_id: 'PO-1/1', po_no: 'PO-1', po_qty_open: open } })

  it('reads the link back out of the line metadata', () => {
    expect(poLink(linked('5', 10))).toEqual({ poLineId: 'PO-1/1', poNo: 'PO-1', qtyOpen: 10, pendingId: null })
    expect(poLink(line()).poLineId).toBeNull()
  })

  it('classifies received against open', () => {
    expect(poMatchStatus(linked('10', 10))).toBe('matched')
    expect(poMatchStatus(linked('4', 10))).toBe('partial')
    expect(poMatchStatus(linked('12', 10))).toBe('excess')
    expect(poMatchStatus(line({ qty: '3' }))).toBe('unlinked')
  })

  it('lists the over-received lines', () => {
    const rows = [linked('12', 10), linked('2', 10), line({ qty: '99' })]
    expect(overReceivedLines(rows)).toHaveLength(1)
  })
})

describe('duplicateSerials', () => {
  it('finds a serial used on two lines, case-insensitively', () => {
    const rows = [
      line({ serials: [{ serial_id: 1, serial_no: 'SN-1' }, { serial_id: 2, serial_no: 'SN-2' }] }),
      line({ serials: [{ serial_id: 3, serial_no: 'sn-1' }] }),
    ]
    expect(duplicateSerials(rows)).toEqual(['sn-1'])
  })
})

describe('grnAlerts', () => {
  it('confirms batches when every batch-tracked line has one', () => {
    const alerts = grnAlerts({ header: header(), lines: [line({ track_batch: true, batch_id: 7, batch_no: 'B-1' })], today: TODAY, fyRange: FY })
    expect(alerts.find((a) => a.id === 'batch-ok')?.tone).toBe('success')
    expect(hasBlockingAlert(alerts)).toBe(false)
  })

  it('blocks on a missing batch and names the line', () => {
    const missing = line({ track_batch: true })
    const alerts = grnAlerts({ header: header(), lines: [missing], today: TODAY, fyRange: FY })
    const alert = alerts.find((a) => a.id === 'batch-missing')
    expect(alert?.tone).toBe('danger')
    expect(alert?.lineKeys).toEqual([missing.key])
    expect(hasBlockingAlert(alerts)).toBe(true)
  })

  it('blocks when the serial count does not match the base quantity', () => {
    const short = line({ track_serial: true, qty: '3', serials: [{ serial_id: 1, serial_no: 'SN-1' }] })
    const alerts = grnAlerts({ header: header(), lines: [short], today: TODAY, fyRange: FY })
    expect(alerts.find((a) => a.id === 'serial-count')?.tone).toBe('danger')
  })

  it('warns about over-receipt and past expiry without blocking', () => {
    const rows = [
      line({ qty: '12', metadata: { po_line_id: 'PO-1/1', po_no: 'PO-1', po_qty_open: 10 } }),
      line({ expiry_date: '2020-01-01' }),
    ]
    const alerts = grnAlerts({ header: header(), lines: rows, today: TODAY, fyRange: FY })
    expect(alerts.find((a) => a.id === 'po-excess')?.tone).toBe('warning')
    expect(alerts.find((a) => a.id === 'expiry-past')?.tone).toBe('warning')
    expect(hasBlockingAlert(alerts)).toBe(false)
  })

  it('says stock stays pending on a challan-only receipt and moves on a physical one', () => {
    const pending = grnAlerts({ header: header(), lines: [line()], today: TODAY, fyRange: FY })
    expect(pending.find((a) => a.id === 'stock-pending')).toBeTruthy()
    const physical = grnAlerts({ header: header({ stock_effect: 'physical' }), lines: [line()], today: TODAY, fyRange: FY })
    expect(physical.find((a) => a.id === 'stock-physical')).toBeTruthy()
  })

  it('flags a document date outside the financial year', () => {
    const alerts = grnAlerts({ header: header({ document_date: '2025-01-01' }), lines: [line()], today: TODAY, fyRange: FY })
    expect(alerts.find((a) => a.id === 'fy-range')?.tone).toBe('danger')
  })

  it('notes an unlinked supplier ledger', () => {
    const alerts = grnAlerts({ header: header({ party_ref: '' }), lines: [line()], today: TODAY, fyRange: FY })
    expect(alerts.find((a) => a.id === 'supplier-unlinked')?.tone).toBe('warning')
  })
})

describe('validateGrn', () => {
  it('passes a complete receipt', () => {
    expect(validateGrn(header(), [line({ qty: '10' })], { spec: GRN, fyRange: FY })).toEqual([])
  })

  it('keeps the shared draft rules', () => {
    const errors = validateGrn(header(), [line({ qty: '0' })], { spec: GRN, fyRange: FY })
    expect(errors.some((e) => e.includes('quantity must be greater than zero'))).toBe(true)
  })

  it('requires a batch on a batch-tracked line', () => {
    const errors = validateGrn(header(), [line({ track_batch: true, item_name: 'Cement' })], { spec: GRN, fyRange: FY })
    expect(errors.some((e) => e.includes('batch-tracked'))).toBe(true)
  })

  it('requires one serial per base unit, through the unit conversion', () => {
    const errors = validateGrn(header(), [line({ track_serial: true, unit_id: 2, qty: '1', serials: [{ serial_id: 1, serial_no: 'SN-1' }] })], { spec: GRN, fyRange: FY })
    expect(errors.some((e) => e.includes('serial number(s) captured for 10'))).toBe(true)
  })

  it('rejects a date outside the financial year and a serial used twice', () => {
    const rows = [
      line({ serials: [{ serial_id: 1, serial_no: 'SN-1' }] }),
      line({ serials: [{ serial_id: 1, serial_no: 'SN-1' }] }),
    ]
    const errors = validateGrn(header({ document_date: '2030-01-01' }), rows, { spec: GRN, fyRange: FY })
    expect(errors.some((e) => e.includes('financial year'))).toBe(true)
    expect(errors.some((e) => e.includes('more than one line'))).toBe(true)
  })

  it('does not refuse an over-receipt — it is reported, not blocked', () => {
    const rows = [line({ qty: '12', metadata: { po_line_id: 'PO-1/1', po_qty_open: 10 } })]
    expect(validateGrn(header(), rows, { spec: GRN, fyRange: FY })).toEqual([])
  })
})
