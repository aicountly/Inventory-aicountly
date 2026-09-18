import { describe, expect, it } from 'vitest'
import { newHeader, newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import { specForCode } from '../registry'
import {
  REASON_CHIPS,
  STOCK_JOURNAL_REASONS,
  buildWarnings,
  documentWarnings,
  highestLevel,
  journalTotals,
  reasonFor,
  reasonLabel,
  rowNeedsDeleteConfirm,
  validateJournal,
  warningsForLine,
} from './model'
import type { JournalWarning } from './model'
import type { AvailabilityCheckResult } from '../../services/stockApi'

/** A result shaped exactly as `POST /v1/availability/check` returns one. */
function avail(partial: Partial<AvailabilityCheckResult> & { ok: boolean; available: number }): AvailabilityCheckResult {
  return { index: 0, item_id: 1, requested: 10, on_hand: partial.available, ...partial }
}

const SPEC = specForCode('STOCK_JOURNAL')!
const TODAY = '2026-09-18'
const FY = { from: '2026-04-01', to: '2027-03-31' }

function line(partial: Partial<LineDraft> = {}): LineDraft {
  return newLine(SPEC, { item_id: 1, item_name: 'Widget', warehouse_id: 5, direction: 'out', qty: '10', ...partial })
}

function header(partial: Record<string, unknown> = {}) {
  return { ...newHeader(SPEC, TODAY), default_warehouse_id: 5, reason_code: 'DAMAGE', ...partial }
}

describe('reason codes', () => {
  it('stays inside the 32 characters the column holds', () => {
    for (const r of STOCK_JOURNAL_REASONS) expect(r.code.length).toBeLessThanOrEqual(32)
  })

  it('resolves a code case-insensitively and keeps an unknown one as typed', () => {
    expect(reasonFor('damage')?.label).toBe('Damage')
    expect(reasonFor('  TRANSFER ')?.code).toBe('TRANSFER')
    expect(reasonFor('CUSTOM_CODE')).toBeNull()
    expect(reasonLabel('CUSTOM_CODE')).toBe('CUSTOM_CODE')
    expect(reasonLabel('')).toBe('')
  })

  it('points every quick chip at a real reason code', () => {
    for (const chip of REASON_CHIPS) expect(reasonFor(chip.reasonCode)).not.toBeNull()
  })
})

describe('journalTotals', () => {
  it('sums in and out separately and nets them', () => {
    const t = journalTotals([
      line({ direction: 'in', qty: '10', rate: '5', amount: '50' }),
      line({ direction: 'out', qty: '4', rate: '5', amount: '20' }),
    ])
    expect(t.lines).toBe(2)
    expect(t.qtyIn).toBe(10)
    expect(t.qtyOut).toBe(4)
    expect(t.netQty).toBe(6)
    expect(t.valueIn).toBe(50)
    expect(t.valueOut).toBe(20)
    expect(t.netValue).toBe(30)
  })

  it('ignores blank rows', () => {
    expect(journalTotals([newLine(SPEC), newLine(SPEC)]).lines).toBe(0)
  })

  it('rounds like the server rather than accumulating float error', () => {
    const t = journalTotals([line({ direction: 'in', qty: '0.1' }), line({ direction: 'in', qty: '0.2' })])
    expect(t.qtyIn).toBe(0.3)
  })

  it('derives the amount when only qty and rate were typed', () => {
    expect(journalTotals([line({ direction: 'in', qty: '3', rate: '1.5', amount: '' })]).valueIn).toBe(4.5)
  })
})

describe('validateJournal', () => {
  it('accepts a complete single-line journal', () => {
    expect(validateJournal(header(), [line()], { posting: true, fyRange: FY })).toEqual([])
  })

  it('needs a reason code to post but not to save a draft', () => {
    const h = header({ reason_code: '' })
    expect(validateJournal(h, [line()], { posting: false, fyRange: FY })).toEqual([])
    expect(validateJournal(h, [line()], { posting: true, fyRange: FY }).map((e) => e.field)).toContain('reason_code')
  })

  it('refuses a date outside the selected financial year', () => {
    const errors = validateJournal(header({ document_date: '2026-01-05' }), [line()], { posting: true, fyRange: FY })
    expect(errors.some((e) => e.field === 'document_date')).toBe(true)
  })

  it('refuses a date inside a locked period only when posting', () => {
    const opts = { fyRange: FY, lockedUpto: '2026-09-30' }
    expect(validateJournal(header(), [line()], { ...opts, posting: false })).toEqual([])
    expect(validateJournal(header(), [line()], { ...opts, posting: true }).some((e) => e.field === 'document_date')).toBe(true)
  })

  it('requires an item, a direction, a warehouse and a positive quantity', () => {
    const errors = validateJournal(header(), [line({ item_id: null, direction: null, warehouse_id: null, qty: '0' })], {
      posting: true,
      fyRange: FY,
    })
    const messages = errors.map((e) => e.message).join(' ')
    expect(messages).toContain('pick an item')
    expect(messages).toContain('choose In or Out')
    expect(messages).toContain('pick a warehouse')
    expect(messages).toContain('greater than zero')
  })

  it('refuses an empty journal', () => {
    expect(validateJournal(header(), [newLine(SPEC)], { posting: true, fyRange: FY }).map((e) => e.field)).toContain('lines')
  })

  it('refuses the same serial on two lines', () => {
    const s = { serial_id: 7, serial_no: 'SN-7' }
    const errors = validateJournal(
      header(),
      [
        line({ track_serial: true, qty: '1', serials: [s] }),
        line({ track_serial: true, qty: '1', serials: [s] }),
      ],
      { posting: true, fyRange: FY },
    )
    expect(errors.some((e) => e.message.includes('already used on line 1'))).toBe(true)
  })

  it('refuses a serial count that does not match the quantity', () => {
    const errors = validateJournal(
      header(),
      [line({ track_serial: true, qty: '4', serials: [{ serial_id: 1, serial_no: 'A' }, { serial_id: 2, serial_no: 'B' }, { serial_id: 3, serial_no: 'C' }] })],
      { posting: true, fyRange: FY },
    )
    expect(errors.some((e) => e.message.includes('3 serial numbers selected for a base quantity of 4'))).toBe(true)
  })

  it('requires a batch on a batch-tracked line before posting', () => {
    const errors = validateJournal(header(), [line({ track_batch: true, batch_id: null })], { posting: true, fyRange: FY })
    expect(errors.some((e) => e.message.includes('batch tracked'))).toBe(true)
  })

  it('counts serials in base units, not entered units', () => {
    // One box of 12: the line needs 12 numbers, not 1.
    const boxed = line({
      track_serial: true,
      qty: '1',
      unit_id: 2,
      units: [{ unit_id: 2, unit_symbol: 'Box', conversion_factor: 12, is_default: true }],
      serials: [{ serial_id: 1, serial_no: 'A' }],
    })
    expect(validateJournal(header(), [boxed], { posting: true, fyRange: FY }).some((e) => e.message.includes('base quantity of 12'))).toBe(true)
  })
})

describe('buildWarnings', () => {
  const base = {
    knownWarehouseIds: [5],
    negativeStockPolicy: 'warn',
    fyRange: FY,
    lockedUpto: null,
    today: TODAY,
  }

  it('says nothing about a clean journal', () => {
    const w = buildWarnings({ ...base, header: header(), lines: [line({ rate: '10' })], availability: { k: avail({ ok: true, available: 100 }) } })
    expect(w.filter((x) => x.level !== 'info')).toEqual([])
  })

  it('warns on a short outward line and blocks it when the company blocks negative stock', () => {
    const l = line()
    const availability = { [l.key]: avail({ ok: false, available: 4 }) }
    const warn = buildWarnings({ ...base, header: header(), lines: [l], availability })
    expect(warn.find((w) => w.code === 'insufficient_stock')?.level).toBe('warning')

    const blocked = buildWarnings({ ...base, negativeStockPolicy: 'block', header: header(), lines: [l], availability })
    expect(blocked.find((w) => w.code === 'insufficient_stock')?.level).toBe('blocking')
    expect(blocked.find((w) => w.code === 'insufficient_stock')?.message).toContain('short by')
  })

  it('does not apply an availability check to an inward line', () => {
    const l = line({ direction: 'in', rate: '5' })
    const w = buildWarnings({ ...base, header: header(), lines: [l], availability: { [l.key]: avail({ ok: false, available: 0 }) } })
    expect(w.some((x) => x.code === 'insufficient_stock')).toBe(false)
  })

  it('blocks a locked period and warns outside the financial year', () => {
    const locked = buildWarnings({ ...base, lockedUpto: '2026-09-30', header: header(), lines: [line()], availability: {} })
    expect(locked.find((w) => w.code === 'period_locked')?.level).toBe('blocking')

    const outside = buildWarnings({ ...base, header: header({ document_date: '2026-01-01' }), lines: [line()], availability: {} })
    expect(outside.some((w) => w.code === 'outside_fy')).toBe(true)
  })

  it('warns when an inward line carries no rate at all', () => {
    const w = buildWarnings({ ...base, header: header(), lines: [line({ direction: 'in', rate: '' })], availability: {} })
    expect(w.some((x) => x.code === 'missing_rate')).toBe(true)
  })

  it('warns when a line points at a warehouse outside the allowed set', () => {
    const w = buildWarnings({ ...base, header: header(), lines: [line({ warehouse_id: 99, rate: '1' })], availability: {} })
    expect(w.some((x) => x.code === 'warehouse_unavailable')).toBe(true)
  })

  it('warns about an expired batch going out', () => {
    const w = buildWarnings({
      ...base,
      header: header(),
      lines: [line({ batch_no: 'B1', batch_expiry: '2026-01-01', rate: '1' })],
      availability: {},
    })
    expect(w.some((x) => x.code === 'batch_expired')).toBe(true)
  })

  it('separates document-level warnings from row-level ones', () => {
    const l = line()
    const all = buildWarnings({
      ...base,
      lockedUpto: '2026-09-30',
      header: header(),
      lines: [l],
      availability: { [l.key]: avail({ ok: false, available: 1 }) },
    })
    expect(documentWarnings(all).every((w) => !w.lineKey)).toBe(true)
    expect(warningsForLine(all, l.key).every((w) => w.lineKey === l.key)).toBe(true)
  })
})

describe('highestLevel', () => {
  const w = (level: JournalWarning['level']): JournalWarning => ({ level, code: 'x', message: 'x' })
  it('ranks blocking over warning over info', () => {
    expect(highestLevel([w('info'), w('blocking'), w('warning')])).toBe('blocking')
    expect(highestLevel([w('info'), w('warning')])).toBe('warning')
    expect(highestLevel([w('info')])).toBe('info')
    expect(highestLevel([])).toBeNull()
  })
})

describe('rowNeedsDeleteConfirm', () => {
  it('lets an untouched row go without a prompt', () => {
    expect(rowNeedsDeleteConfirm(newLine(SPEC))).toBe(false)
  })

  it('asks before discarding real work', () => {
    expect(rowNeedsDeleteConfirm(line())).toBe(true)
    expect(rowNeedsDeleteConfirm(newLine(SPEC, { qty: '5' }))).toBe(true)
    expect(rowNeedsDeleteConfirm(newLine(SPEC, { batch_id: 3 }))).toBe(true)
    expect(rowNeedsDeleteConfirm(newLine(SPEC, { description: 'note' }))).toBe(true)
  })
})
