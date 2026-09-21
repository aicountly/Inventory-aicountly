import { describe, expect, it } from 'vitest'
import type { BatchRow } from '../../services/lookupApi'
import { newHeader, newLine } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { specForCode } from '../registry'
import {
  applyBatchMapping,
  applyDirection,
  batchAdjustmentMetrics,
  batchCatalogKey,
  batchMapping,
  checkSummary,
  clearBatchMapping,
  issuesByLine,
  lineStatus,
  populatedLines,
  serialsSatisfied,
  tabCounts,
  validateBatchAdjustment,
  validationChecks,
} from './batchAdjustmentModel'
import type { BatchIssue, IssueCode } from './batchAdjustmentModel'

const SPEC = specForCode('BATCH_ADJUSTMENT')!

function header(patch: Partial<HeaderDraft> = {}): HeaderDraft {
  return { ...newHeader(SPEC, '2026-09-18'), default_warehouse_id: 1, ...patch }
}

function line(patch: Partial<LineDraft> = {}): LineDraft {
  return newLine(SPEC, {
    item_id: 10,
    item_name: 'Axle Assembly',
    item_sku: 'ITEM-AX45',
    track_batch: true,
    warehouse_id: 1,
    unit_id: 5,
    units: [{ unit_id: 5, unit_symbol: 'Nos', conversion_factor: 1, is_default: true }],
    direction: 'out',
    qty: '10',
    ...patch,
  })
}

/** An out line off BATCH-A onto BATCH-B. */
function outLine(patch: Partial<LineDraft> = {}): LineDraft {
  const base = line(patch)
  const from = { ...base, ...applyBatchMapping(base, 'from', { batch_id: 101, batch_no: 'BATCH-A' }) }
  return { ...from, ...applyBatchMapping(from, 'to', { batch_id: 102, batch_no: 'BATCH-B' }) }
}

/** Serials are dropped whenever a batch is set, so they go on after the mapping. */
function withSerials(l: LineDraft, serials: { serial_id: number; serial_no: string }[]): LineDraft {
  return { ...l, serials }
}

function batch(patch: Partial<BatchRow> = {}): BatchRow {
  return { batch_id: 101, item_id: 10, batch_no: 'BATCH-A', lot_no: null, mfg_date: null, expiry_date: null, status: 'active', stock: { on_hand: 120, reserved: 0, available: 120 }, ...patch }
}

function codes(issues: readonly BatchIssue[]): IssueCode[] {
  return issues.map((i) => i.code)
}

describe('the batch mapping a line carries', () => {
  it('puts the batch an out line leaves on the line itself and the destination in metadata', () => {
    const l = outLine()
    expect(l.batch_id).toBe(101)
    expect(batchMapping(l)).toEqual({ from_batch_id: 101, from_batch_no: 'BATCH-A', to_batch_id: 102, to_batch_no: 'BATCH-B' })
  })

  it('puts the batch an in line lands on on the line itself', () => {
    const base = { ...line({ direction: 'in' }) }
    const mapped = { ...base, ...applyBatchMapping(base, 'to', { batch_id: 102, batch_no: 'BATCH-B' }) }
    expect(mapped.batch_id).toBe(102)
    expect(batchMapping(mapped).to_batch_id).toBe(102)
  })

  it('moves the stored batch to the other end when the direction flips', () => {
    const flipped = { ...outLine(), ...applyDirection(outLine(), 'in') }
    expect(flipped.direction).toBe('in')
    expect(flipped.batch_id).toBe(102)
    expect(batchMapping(flipped)).toEqual({ from_batch_id: 101, from_batch_no: 'BATCH-A', to_batch_id: 102, to_batch_no: 'BATCH-B' })
  })

  it('drops the serials when the batch under them changes', () => {
    const mapped = withSerials(outLine(), [{ serial_id: 1, serial_no: 'SN1' }])
    const moved = { ...mapped, ...applyBatchMapping(mapped, 'from', { batch_id: 103, batch_no: 'BATCH-C' }) }
    expect(moved.serials).toEqual([])
  })

  it('clears both ends but keeps any other line metadata', () => {
    const tagged = { ...outLine(), metadata: { ...(outLine().metadata ?? {}), line_kind: 'component' } }
    const cleared = { ...tagged, ...clearBatchMapping(tagged) }
    expect(cleared.batch_id).toBeNull()
    expect(batchMapping(cleared)).toEqual({ from_batch_id: null, from_batch_no: null, to_batch_id: null, to_batch_no: null })
    expect(cleared.metadata).toEqual({ line_kind: 'component' })
  })

  it('keys the batch catalog by item and warehouse', () => {
    expect(batchCatalogKey(10, 2)).toBe('10:2')
    expect(batchCatalogKey(10, null)).toBe('10:0')
  })
})

describe('what the document adds up to', () => {
  it('counts only the lines the user has started', () => {
    const lines = [outLine(), newLine(SPEC)]
    expect(populatedLines(lines)).toHaveLength(1)
    expect(batchAdjustmentMetrics(lines, []).totalLines).toBe(1)
  })

  it('reads out, in, variance, batches and serial items off the draft', () => {
    const out = outLine()
    const inbound = { ...line({ direction: 'in', qty: '10', track_serial: true }) }
    const landed = { ...inbound, ...applyBatchMapping(inbound, 'to', { batch_id: 102, batch_no: 'BATCH-B' }) }
    const metrics = batchAdjustmentMetrics([out, landed], [])
    expect(metrics.totalQtyOut).toBe(10)
    expect(metrics.totalQtyIn).toBe(10)
    expect(metrics.variance).toBe(0)
    expect(metrics.affectedBatches).toBe(2)
    expect(metrics.serialTrackedItems).toBe(1)
  })

  it('calls an unbalanced document high risk and a warned one medium', () => {
    const lines = [outLine(), { ...line({ direction: 'in', qty: '5' }) }]
    const issues = validateBatchAdjustment({ header: header(), lines })
    expect(codes(issues)).toContain('UNBALANCED_QUANTITY')
    expect(batchAdjustmentMetrics(lines, issues).varianceRisk).toBe('high')

    // Balanced and fully mapped, but the in line posts to another warehouse — a warning, not an error.
    const inbound = line({ direction: 'in', qty: '10', warehouse_id: 2 })
    const withFrom = { ...inbound, ...applyBatchMapping(inbound, 'from', { batch_id: 101, batch_no: 'BATCH-A' }) }
    const balanced = [outLine(), { ...withFrom, ...applyBatchMapping(withFrom, 'to', { batch_id: 102, batch_no: 'BATCH-B' }) }]
    const warned = validateBatchAdjustment({ header: header(), lines: balanced })
    expect(codes(warned)).toEqual(['WAREHOUSE_MISMATCH'])
    expect(batchAdjustmentMetrics(balanced, warned).varianceRisk).toBe('medium')
  })

  it('counts a line with any issue as one exception, however many it carries', () => {
    const broken = line({ item_id: null, qty: '0' })
    const issues = validateBatchAdjustment({ header: header(), lines: [broken] })
    expect(issues.length).toBeGreaterThan(1)
    expect(batchAdjustmentMetrics([broken], issues).exceptionCount).toBe(1)
    expect(batchAdjustmentMetrics([broken], issues).readyLines).toBe(0)
  })
})

describe('the checks the screen runs before the server does', () => {
  it('asks for a document date and a warehouse', () => {
    const issues = validateBatchAdjustment({ header: header({ document_date: '', default_warehouse_id: null }), lines: [line({ warehouse_id: null })] })
    expect(codes(issues)).toContain('HEADER_DATE_REQUIRED')
    expect(codes(issues)).toContain('HEADER_WAREHOUSE_REQUIRED')
    expect(codes(issues)).toContain('WAREHOUSE_REQUIRED')
  })

  it('refuses an empty document', () => {
    expect(codes(validateBatchAdjustment({ header: header(), lines: [newLine(SPEC)] }))).toContain('NO_LINES')
  })

  it('refuses a zero, blank or negative quantity', () => {
    expect(codes(validateBatchAdjustment({ header: header(), lines: [outLine({ qty: '0' })] }))).toContain('ZERO_QUANTITY')
    expect(codes(validateBatchAdjustment({ header: header(), lines: [outLine({ qty: '' })] }))).toContain('QUANTITY_REQUIRED')
    expect(codes(validateBatchAdjustment({ header: header(), lines: [outLine({ qty: '-4' })] }))).toContain('NEGATIVE_QUANTITY')
  })

  it('asks a batch-tracked line which batch the quantity leaves', () => {
    expect(codes(validateBatchAdjustment({ header: header(), lines: [line()] }))).toContain('BATCH_REQUIRED')
  })

  it('warns when the current and revised batch are the same', () => {
    const same = outLine()
    const collapsed = { ...same, ...applyBatchMapping(same, 'to', { batch_id: 101, batch_no: 'BATCH-A' }) }
    expect(codes(validateBatchAdjustment({ header: header(), lines: [collapsed] }))).toContain('SAME_BATCH_MAPPING')
  })

  it('warns on a repeated item, warehouse and batch mapping', () => {
    const issues = validateBatchAdjustment({ header: header(), lines: [outLine(), outLine()] })
    expect(codes(issues)).toContain('DUPLICATE_MAPPING')
  })

  it('warns on a line that posts to a different warehouse from the document default', () => {
    expect(codes(validateBatchAdjustment({ header: header({ default_warehouse_id: 1 }), lines: [outLine({ warehouse_id: 2 })] }))).toContain('WAREHOUSE_MISMATCH')
  })

  it('asks for serials on a tracked line and refuses a count that does not match the quantity', () => {
    const tracked = outLine({ track_serial: true })
    expect(codes(validateBatchAdjustment({ header: header(), lines: [tracked] }))).toContain('MISSING_SERIALS')

    const short = withSerials(tracked, [{ serial_id: 1, serial_no: 'SN1' }])
    expect(codes(validateBatchAdjustment({ header: header(), lines: [short] }))).toContain('SERIAL_COUNT_MISMATCH')
  })

  it('refuses the same serial number on two lines', () => {
    const serials = [{ serial_id: 7, serial_no: 'SN7' }]
    const a = withSerials(outLine({ track_serial: true, qty: '1' }), serials)
    const b = withSerials(outLine({ track_serial: true, qty: '1' }), serials)
    expect(codes(validateBatchAdjustment({ header: header(), lines: [a, b] }))).toContain('DUPLICATE_SERIAL')
  })

  it('leaves batch stock, status and expiry alone until the batch list has loaded', () => {
    const lines = [outLine({ qty: '500' })]
    expect(codes(validateBatchAdjustment({ header: header(), lines }))).not.toContain('INSUFFICIENT_STOCK')

    const index = new Map([[batchCatalogKey(10, 1), [batch()]]])
    expect(codes(validateBatchAdjustment({ header: header(), lines, batchIndex: index }))).toContain('INSUFFICIENT_STOCK')
  })

  it('adds up every out line against the same batch before calling it short', () => {
    const index = new Map([[batchCatalogKey(10, 1), [batch({ stock: { on_hand: 15, reserved: 0, available: 15 } })]]])
    const one = validateBatchAdjustment({ header: header(), lines: [outLine({ qty: '10' })], batchIndex: index })
    expect(codes(one)).not.toContain('INSUFFICIENT_STOCK')

    const two = validateBatchAdjustment({ header: header(), lines: [outLine({ qty: '10' }), outLine({ qty: '10' })], batchIndex: index })
    expect(codes(two)).toContain('INSUFFICIENT_STOCK')
  })

  it('flags a blocked batch and one that expired before the document date', () => {
    const index = new Map([[batchCatalogKey(10, 1), [batch({ status: 'blocked', expiry_date: '2026-01-31' })]]])
    const issues = validateBatchAdjustment({ header: header(), lines: [outLine()], batchIndex: index })
    expect(codes(issues)).toContain('BLOCKED_BATCH')
    expect(codes(issues)).toContain('EXPIRED_BATCH')
  })

  it('passes a balanced, fully mapped reallocation with nothing but the pairing note', () => {
    const out = outLine()
    const inbound = line({ direction: 'in', qty: '10' })
    const withFrom = { ...inbound, ...applyBatchMapping(inbound, 'from', { batch_id: 101, batch_no: 'BATCH-A' }) }
    const landed = { ...withFrom, ...applyBatchMapping(withFrom, 'to', { batch_id: 102, batch_no: 'BATCH-B' }) }
    expect(validateBatchAdjustment({ header: header(), lines: [out, landed] })).toEqual([])
  })
})

describe('what the reader sees', () => {
  it('chips a clean reallocation as changed and a same-batch line as a warning', () => {
    const out = outLine()
    expect(lineStatus(out, [])).toBe('changed')
    expect(lineStatus(out, [{ code: 'SAME_BATCH_MAPPING', severity: 'warning', lineKey: out.key, field: 'to_batch', message: '' }])).toBe('warning')
    expect(lineStatus(out, [{ code: 'ITEM_REQUIRED', severity: 'error', lineKey: out.key, field: 'item', message: '' }])).toBe('error')
    expect(lineStatus(out, [{ code: 'MISSING_SERIALS', severity: 'warning', lineKey: out.key, field: 'serials', message: '' }])).toBe('serial_required')
  })

  it('groups the issues into the rail’s checklist', () => {
    const issues = validateBatchAdjustment({ header: header(), lines: [outLine({ qty: '0' })] })
    const checks = validationChecks(issues)
    const quantity = checks.find((c) => c.id === 'quantity')!
    expect(quantity.status).toBe('issue')
    expect(checkSummary(quantity)).toBe('1 issue')
    expect(checks.find((c) => c.id === 'warehouse')!.status).toBe('passed')
    expect(checkSummary(checks.find((c) => c.id === 'warehouse')!)).toBe('Passed')
  })

  it('counts the tabs, and calls a line resolved once it was flagged and is clean', () => {
    const clean = outLine()
    const flagged = outLine({ key: 'was-broken', track_serial: true })
    const issues = validateBatchAdjustment({ header: header(), lines: [clean, flagged] })
    const counts = tabCounts([clean, flagged], issues, new Set(['was-broken']))
    expect(counts.all).toBe(2)
    expect(counts.exceptions).toBeGreaterThan(0)
    expect(counts.serials).toBe(1)
    expect(counts.resolved).toBe(0)

    const resolvedCounts = tabCounts([clean], [], new Set([clean.key]))
    expect(resolvedCounts.resolved).toBe(1)
  })

  it('knows when a serial-tracked line has the serials its quantity needs', () => {
    expect(serialsSatisfied(outLine())).toBe(true)
    expect(serialsSatisfied(outLine({ track_serial: true, qty: '2' }))).toBe(false)
    expect(serialsSatisfied(withSerials(outLine({ track_serial: true, qty: '2' }), [{ serial_id: 1, serial_no: 'A' }, { serial_id: 2, serial_no: 'B' }]))).toBe(true)
  })

  it('buckets issues by the line they belong to', () => {
    const l = outLine({ qty: '0' })
    const map = issuesByLine(validateBatchAdjustment({ header: header(), lines: [l] }))
    expect(map.get(l.key)?.length).toBe(1)
  })
})
