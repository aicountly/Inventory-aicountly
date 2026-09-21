import { describe, expect, it } from 'vitest'
import type { PendingRow } from '../../services/stockApi'
import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import { specForCode } from '../registry'
import {
  daysBetween,
  duplicateSerials,
  groupByDocument,
  jobWorkModeFor,
  lineAdvisories,
  parsePastedLines,
  pendingView,
  settlementProgress,
  smartWarnings,
  stockEffect,
  validateJobWork,
} from './jobWorkModel'

const JOB_WORK_IN = specForCode('JOB_WORK_IN')!
const JOB_WORK_OUT = specForCode('JOB_WORK_OUT')!
const TODAY = '2026-09-18'

/**
 * A row as the pending register serves it, with the fields the SERVER derives
 * (ageing, due date, lateness) computed here the way it computes them — so a
 * test that overrides one of them is overriding the server's answer, which is
 * exactly what the code under test is supposed to defer to.
 */
function pendingRow(partial: Partial<PendingRow> = {}): PendingRow {
  const documentDate = partial.document_date ?? '2026-09-08'
  const expected = partial.expected_return_date ?? null
  const dueDate = partial.due_date ?? expected
  const daysOverdue = dueDate !== null ? Math.max(0, -(daysBetween(TODAY, dueDate) ?? 0)) : 0
  const qtyOriginal = partial.qty_original ?? 100
  const qtySettled = partial.qty_settled ?? 0
  return {
    pending_id: 1,
    cmp_id: 1,
    fy_id: 7,
    document_id: 41,
    line_id: 91,
    pending_kind: 'job_work',
    direction: 'out',
    item_id: 90,
    item_name: 'Gear housing',
    item_sku: 'FG-001',
    hsn_sac: null,
    unit_id: 3,
    unit_symbol: 'Pcs',
    warehouse_id: 2,
    warehouse_name: 'Main',
    party_ref: 501,
    party_name: 'Shree Finishers',
    qty_original: qtyOriginal,
    qty_settled: qtySettled,
    qty_open: qtyOriginal - qtySettled,
    unit_cost: 250,
    pending_value: (qtyOriginal - qtySettled) * 250,
    document_no: 'JW-OUT-2026-0041',
    document_date: documentDate,
    document_type: 'JOB_WORK_OUT',
    document_status: 'POSTED',
    expected_return_date: expected,
    due_date: dueDate,
    has_expected_date: expected !== null,
    ageing_days: daysBetween(documentDate, TODAY) ?? 0,
    days_overdue: daysOverdue,
    is_overdue: daysOverdue > 0,
    settlement_status: qtySettled > 0 ? 'partial' : 'open',
    status: daysOverdue > 0 ? 'overdue' : qtySettled > 0 ? 'partial' : 'open',
    priority: 'medium',
    last_activity_at: null,
    ...partial,
  }
}

describe('job-work mode', () => {
  it('reads the direction from the document type', () => {
    expect(jobWorkModeFor('JOB_WORK_IN')).toBe('in')
    expect(jobWorkModeFor('job_work_out')).toBe('out')
    expect(jobWorkModeFor('STOCK_TRANSFER')).toBeNull()
    expect(jobWorkModeFor(null)).toBeNull()
  })
})

describe('days between two dates', () => {
  it('counts whole calendar days and signs them', () => {
    expect(daysBetween('2026-09-18', '2026-09-20')).toBe(2)
    expect(daysBetween('2026-09-20', '2026-09-18')).toBe(-2)
    expect(daysBetween('2026-09-18', '2026-09-18')).toBe(0)
  })

  it('is null when either end is missing or unreadable', () => {
    expect(daysBetween(null, '2026-09-18')).toBeNull()
    expect(daysBetween('2026-09-18', '')).toBeNull()
    expect(daysBetween('not a date', '2026-09-18')).toBeNull()
  })

  it('does not drift across a daylight-saving boundary', () => {
    // Read as local midnights these are 30.958… days apart and round to 31.
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31)
  })
})

describe('an open job-work quantity', () => {
  it('reports what is out, how old it is and how much is back', () => {
    const view = pendingView(pendingRow({ qty_settled: 40, qty_open: 60 }), TODAY)
    expect(view.sent).toBe(100)
    expect(view.received).toBe(40)
    expect(view.open).toBe(60)
    expect(view.ageDays).toBe(10)
    expect(view.completion).toBeCloseTo(0.4)
    expect(view.state).toBe('partial')
  })

  it('is late only once a return was promised', () => {
    const nothingPromised = pendingView(pendingRow(), TODAY)
    expect(nothingPromised.dueInDays).toBeNull()
    expect(nothingPromised.state).toBe('open')

    const late = pendingView(pendingRow({ expected_return_date: '2026-09-14' }), TODAY)
    expect(late.dueInDays).toBe(-4)
    expect(late.state).toBe('overdue')

    const dueToday = pendingView(pendingRow({ expected_return_date: TODAY }), TODAY)
    expect(dueToday.state).toBe('due')

    const dueLater = pendingView(pendingRow({ expected_return_date: '2026-09-25' }), TODAY)
    expect(dueLater.state).toBe('open')
  })

  it('takes the register\u2019s word for lateness, promise or no promise', () => {
    // The due date is a POLICY: with nothing promised the register measures
    // against the company grace period, which the browser cannot know. Deriving
    // it here would make the drawer and the register disagree about one row.
    const byPolicy = pendingView(
      pendingRow({ expected_return_date: null, due_date: '2026-09-12', has_expected_date: false, days_overdue: 6, is_overdue: true, status: 'overdue' }),
      TODAY,
    )
    expect(byPolicy.state).toBe('overdue')
    expect(byPolicy.hasExpectedDate).toBe(false)
    expect(byPolicy.expectedReturnDate).toBeNull()
    expect(byPolicy.dueDate).toBe('2026-09-12')
  })

  it('prefers the ageing the server counted over its own arithmetic', () => {
    const view = pendingView(pendingRow({ ageing_days: 3 }), TODAY)
    expect(view.ageDays).toBe(3)
  })

  it('still answers from the dates when a payload carries no derived fields', () => {
    const bare = { ...pendingRow({ expected_return_date: '2026-09-14' }) } as Record<string, unknown>
    delete bare.ageing_days
    delete bare.is_overdue
    delete bare.due_date
    delete bare.has_expected_date
    const view = pendingView(bare as unknown as PendingRow, TODAY)
    expect(view.ageDays).toBe(10)
    expect(view.state).toBe('overdue')
    expect(view.hasExpectedDate).toBe(true)
  })

  it('never reports a negative open quantity', () => {
    const view = pendingView(pendingRow({ qty_settled: 120, qty_open: -20 }), TODAY)
    expect(view.open).toBe(0)
  })
})

describe('grouping by the dispatch', () => {
  const views = [
    pendingView(pendingRow({ pending_id: 1, item_id: 90, qty_original: 100, qty_settled: 40, qty_open: 60 }), TODAY),
    pendingView(pendingRow({ pending_id: 2, item_id: 91, item_name: 'Shaft', qty_original: 50, qty_settled: 0, qty_open: 50, expected_return_date: '2026-09-10' }), TODAY),
    pendingView(pendingRow({ pending_id: 3, document_id: 42, document_no: 'JW-OUT-2026-0042', qty_original: 20, qty_settled: 0, qty_open: 20 }), TODAY),
  ]

  it('adds a dispatch up and keeps its lines', () => {
    const groups = groupByDocument(views)
    const first = groups.find((g) => g.documentId === 41)!
    expect(first.rows).toHaveLength(2)
    expect(first.sent).toBe(150)
    expect(first.received).toBe(40)
    expect(first.open).toBe(110)
    expect(first.completion).toBeCloseTo(40 / 150)
  })

  it('is as late as its latest line, and puts the late one first', () => {
    const groups = groupByDocument(views)
    expect(groups[0].documentId).toBe(41)
    expect(groups[0].state).toBe('overdue')
    expect(groups[1].state).toBe('open')
  })

  it('totals a selection for the completion meter', () => {
    expect(settlementProgress(views)).toEqual({ sent: 170, received: 40, open: 130, percent: 24 })
  })
})

describe('what posting will do to stock', () => {
  const line = (partial: Partial<LineDraft>) => newLine(JOB_WORK_IN, partial)

  it('splits a dispatch out of available stock without removing it', () => {
    const rows = stockEffect('out', [newLine(JOB_WORK_OUT, { item_id: 1, qty: '25' })])
    expect(rows).toEqual([
      { key: 'with_worker', label: 'With job worker', qty: 25, direction: 'in' },
      { key: 'available', label: 'Available to sell', qty: 25, direction: 'out' },
    ])
  })

  it('brings finished goods on hand and releases what the worker held', () => {
    const rows = stockEffect(
      'in',
      [line({ item_id: 1, qty: '10', direction: 'in' }), line({ item_id: 2, qty: '40', direction: 'out', origin: 'settlement' })],
      [
        { pending_id: 1, qty: 40, settlement_type: 'consumed' },
        { pending_id: 2, qty: 15, settlement_type: 'returned' },
      ],
    )
    expect(rows).toEqual([
      { key: 'received', label: 'Finished goods on hand', qty: 10, direction: 'in' },
      { key: 'with_worker', label: 'With job worker', qty: 55, direction: 'out' },
      { key: 'returned', label: 'Available again', qty: 15, direction: 'in' },
      { key: 'consumed', label: 'Issued to the job (consumed)', qty: 40, direction: 'out' },
    ])
  })

  it('never claims a return adds stock on hand', () => {
    const rows = stockEffect('in', [], [{ pending_id: 1, qty: 15, settlement_type: 'returned' }])
    expect(rows.some((r) => r.label.includes('on hand'))).toBe(false)
  })

  it('says nothing about an empty draft', () => {
    expect(stockEffect('out', [])).toEqual([])
    expect(stockEffect('in', [], [])).toEqual([])
  })
})

describe('smart warnings', () => {
  const base = { mode: 'in' as const, lines: [] as LineDraft[], selected: [], settlements: [], availability: {}, today: TODAY }

  it('calls out a settlement bigger than what is still open', () => {
    const view = pendingView(pendingRow({ qty_settled: 80, qty_open: 20 }), TODAY)
    const [warning] = smartWarnings({
      ...base,
      selected: [view],
      settlements: [{ pending_id: 1, qty: 50, settlement_type: 'consumed' }],
    })
    expect(warning.blocking).toBe(true)
    expect(warning.message).toContain('50')
    expect(warning.message).toContain('20')
  })

  it('accepts a settlement that exactly clears the open quantity', () => {
    const view = pendingView(pendingRow({ qty_settled: 80, qty_open: 20 }), TODAY)
    expect(
      smartWarnings({ ...base, selected: [view], settlements: [{ pending_id: 1, qty: 20, settlement_type: 'consumed' }] }),
    ).toEqual([])
  })

  it('says how late the material is without blocking on it', () => {
    const view = pendingView(pendingRow({ expected_return_date: '2026-09-14' }), TODAY)
    const [warning] = smartWarnings({ ...base, selected: [view] })
    expect(warning.blocking).toBe(false)
    expect(warning.message).toContain('4 days')
  })

  it('names a short line on a dispatch', () => {
    const line = newLine(JOB_WORK_OUT, { key: 'k1', item_id: 5, item_name: 'Shaft', qty: '30' })
    const [warning] = smartWarnings({
      ...base,
      mode: 'out',
      lines: [line],
      availability: { k1: { index: 0, item_id: 5, requested: 30, available: 12, on_hand: 12, ok: false, short_by: 18 } },
    })
    expect(warning.message).toContain('short by 18')
    expect(warning.tone).toBe('danger')
  })

  it('blocks a serial used on two lines', () => {
    const a = newLine(JOB_WORK_IN, { key: 'a', item_id: 1, serials: [{ serial_id: 7, serial_no: 'SN-007' }] })
    const b = newLine(JOB_WORK_IN, { key: 'b', item_id: 1, serials: [{ serial_id: 7, serial_no: 'SN-007' }] })
    expect(duplicateSerials([a, b])).toEqual(['SN-007'])
    const [warning] = smartWarnings({ ...base, lines: [a, b] })
    expect(warning.blocking).toBe(true)
    expect(warning.message).toContain('SN-007')
  })

  it('flags a batch that is about to expire, and one that already has', () => {
    const soon = newLine(JOB_WORK_IN, { key: 's', item_id: 1, item_name: 'Resin', batch_no: 'B-2408', metadata: { batch_expiry_date: '2026-09-25' } })
    const gone = newLine(JOB_WORK_IN, { key: 'g', item_id: 1, item_name: 'Resin', batch_no: 'B-2312', metadata: { batch_expiry_date: '2026-09-01' } })
    const messages = smartWarnings({ ...base, lines: [soon, gone] })
    expect(messages[0].message).toContain('expires in 7 days')
    expect(messages[1].message).toContain('expired 17 days ago')
    expect(messages[1].tone).toBe('danger')
  })

  it('leaves a batch well inside its life alone', () => {
    const fine = newLine(JOB_WORK_IN, { key: 'f', item_id: 1, metadata: { batch_expiry_date: '2027-01-01' } })
    expect(smartWarnings({ ...base, lines: [fine] })).toEqual([])
  })
})

describe('line advisories', () => {
  it('mentions an unallocated batch or serial without calling it an error', () => {
    const batch = newLine(JOB_WORK_IN, { key: 'b', item_id: 1, item_name: 'Resin', track_batch: true })
    const serial = newLine(JOB_WORK_IN, { key: 's', item_id: 2, item_name: 'Board', track_serial: true })
    const notes = lineAdvisories([batch, serial])
    expect(notes.map((n) => n.blocking)).toEqual([false, false])
    expect(notes[0].message).toContain('batch tracked')
    expect(notes[1].message).toContain('serialised')
  })
})

describe('validation', () => {
  const header = (partial: Partial<Parameters<typeof validateJobWork>[0]> = {}) => ({
    document_date: TODAY,
    party_ref: '501',
    default_warehouse_id: 2,
    returnable: false,
    expected_return_date: '',
    ...partial,
  })
  const received = (partial: Partial<LineDraft> = {}) =>
    newLine(JOB_WORK_IN, { item_id: 90, qty: '10', direction: 'in', valuation_rate: '610', ...partial })

  it('accepts a complete receipt', () => {
    expect(validateJobWork(header(), [received()], 'in').ok).toBe(true)
  })

  it('insists on a job worker — a dispatch nobody holds can never be settled', () => {
    const result = validateJobWork(header({ party_ref: '' }), [received()], 'in')
    expect(result.ok).toBe(false)
    expect(result.fields['jw-job-worker']).toBeTruthy()
    expect(result.messages).toContain('Job worker is required.')
  })

  it('insists on a warehouse, and words it for the direction', () => {
    expect(validateJobWork(header({ default_warehouse_id: null }), [received()], 'in').messages).toContain('Warehouse is required.')
    expect(validateJobWork(header({ default_warehouse_id: null }), [newLine(JOB_WORK_OUT, { item_id: 1, qty: '5' })], 'out').messages).toContain(
      'Source warehouse is required.',
    )
  })

  it('refuses goods coming back with no unit cost, and points at the row', () => {
    const line = received({ valuation_rate: '' })
    const result = validateJobWork(header(), [line], 'in')
    expect(result.messages).toContain('Line 1: enter the unit cost of the goods coming back.')
    expect(result.lineKeys.has(line.key)).toBe(true)
  })

  it('leaves the consumed material to the valuation engine', () => {
    const consumed = newLine(JOB_WORK_IN, { item_id: 91, qty: '120', direction: 'out', origin: 'settlement' })
    expect(validateJobWork(header(), [received(), consumed], 'in').ok).toBe(true)
  })

  it('wants a quantity above zero and an item on every line', () => {
    const noItem = newLine(JOB_WORK_OUT, { qty: '5' })
    const noQty = newLine(JOB_WORK_OUT, { item_id: 3, qty: '0' })
    const result = validateJobWork(header(), [noItem, noQty], 'out')
    expect(result.messages).toContain('Line 1: pick an item.')
    expect(result.messages).toContain('Line 2: quantity must be greater than zero.')
  })

  it('wants at least one line', () => {
    expect(validateJobWork(header(), [], 'out').messages).toContain('Add at least one item to send.')
    expect(validateJobWork(header(), [], 'in').messages).toContain('Add at least one item to receive.')
  })

  it('checks the serial count against the base quantity', () => {
    const line = received({ qty: '3', serials: [{ serial_id: 1, serial_no: 'A' }] })
    expect(validateJobWork(header(), [line], 'in').messages.join(' ')).toContain('1 serial number(s) for a base quantity of 3')
  })

  it('is no stricter than the server: an unallocated batch still saves', () => {
    const line = received({ track_batch: true, batch_id: null })
    expect(validateJobWork(header(), [line], 'in').ok).toBe(true)
  })
})

describe('pasting spreadsheet rows', () => {
  it('reads tab-separated cells in the template order', () => {
    expect(parsePastedLines('FG-001\t50\t250\tAUTO-01\tFirst lot')).toEqual([
      { code: 'FG-001', qty: '50', rate: '250', batch: 'AUTO-01', remarks: 'First lot' },
    ])
  })

  it('reads commas too, and tolerates quotes and short rows', () => {
    expect(parsePastedLines('"FG-002",25')).toEqual([{ code: 'FG-002', qty: '25', rate: '', batch: '', remarks: '' }])
  })

  it('drops a pasted header row but keeps a first row that is real', () => {
    expect(parsePastedLines('Item code,Qty\nFG-001,50')).toHaveLength(1)
    expect(parsePastedLines('FG-001,50\nFG-002,25')).toHaveLength(2)
  })

  it('ignores blank lines and rows with no code', () => {
    expect(parsePastedLines('\nFG-001,50\n\n,10\n')).toEqual([{ code: 'FG-001', qty: '50', rate: '', batch: '', remarks: '' }])
  })
})
