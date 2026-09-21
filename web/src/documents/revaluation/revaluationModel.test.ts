import { describe, expect, it } from 'vitest'
import {
  activeLines,
  contextKey,
  countActiveFilters,
  EMPTY_LINE_FILTERS,
  filtersAreEmpty,
  impactDirection,
  isBlankRevaluationLine,
  lineImpact,
  newRevaluationDraft,
  newRevaluationLine,
  offendingLineKeys,
  revaluationDraftFromDocument,
  revaluationTotals,
  scopeWarehouseId,
  staleLines,
  toRevaluationPayload,
  validateRevaluation,
  visibleLines,
} from './revaluationModel'
import type { RevaluationDraft, RevaluationLine, StockContext, StockContextMap } from './revaluationModel'
import { specForCode } from '../registry'
import type { InventoryDocument } from '../types'

const REVAL = specForCode('REVALUATION')!

function ctx(partial: Partial<StockContext> & { itemId: number }): StockContext {
  return {
    warehouseId: null,
    onHandQty: null,
    currentUnitCost: null,
    method: 'FIFO',
    loading: false,
    error: null,
    fetchedAt: 1,
    ...partial,
  }
}

function draftWith(lines: RevaluationLine[], partial: Partial<RevaluationDraft> = {}): RevaluationDraft {
  return { ...newRevaluationDraft('2026-09-18'), defaultWarehouseId: 1, reasonCode: 'MARKET_PRICE', lines, ...partial }
}

const laptop = () => newRevaluationLine({ key: 'a', itemId: 10, itemName: 'Laptop Dell Inspiron', itemSku: 'LAP001', warehouseId: 1, unitId: 7, unitSymbol: 'Nos', newUnitCost: '46500' })
const chair = () => newRevaluationLine({ key: 'b', itemId: 11, itemName: 'Office Chair', itemSku: 'CHR001', warehouseId: 1, unitId: 7, unitSymbol: 'Nos', newUnitCost: '3950' })

describe('valuation scope', () => {
  it('mirrors ValuationEngine::scopeWarehouse', () => {
    expect(scopeWarehouseId('warehouse', 4)).toBe(4)
    expect(scopeWarehouseId('warehouse', null)).toBeNull()
    expect(scopeWarehouseId('company', 4)).toBeNull()
    expect(contextKey(10, 4)).toBe('10:4')
    expect(contextKey(10, null)).toBe('10:all')
  })
})

describe('impact', () => {
  it('is (new − current) × on hand, rounded once at the end', () => {
    expect(lineImpact('46500', 45000, 12)).toBe(18000)
    expect(lineImpact('3950', 4200, 25)).toBe(-6250)
    expect(lineImpact('4200', 4200, 25)).toBe(0)
    expect(lineImpact('0.1', 0.2, 3)).toBe(-0.3)
  })

  it('is unknown, never zero, while an input is missing', () => {
    expect(lineImpact('', 45000, 12)).toBeNull()
    expect(lineImpact('46500', null, 12)).toBeNull()
    expect(lineImpact('46500', 45000, null)).toBeNull()
    expect(impactDirection(null)).toBe('none')
    expect(impactDirection(0)).toBe('none')
    expect(impactDirection(-1)).toBe('decrease')
    expect(impactDirection(1)).toBe('increase')
  })

  it('totals increases, decreases and the net over the lines', () => {
    const contexts: StockContextMap = {
      '10:1': ctx({ itemId: 10, warehouseId: 1, onHandQty: 12, currentUnitCost: 45000 }),
      '11:1': ctx({ itemId: 11, warehouseId: 1, onHandQty: 25, currentUnitCost: 4200 }),
    }
    const totals = revaluationTotals(draftWith([laptop(), chair()]), contexts, 'warehouse')
    expect(totals).toMatchObject({ lines: 2, onHandQty: 37, increase: 18000, decrease: 6250, net: 11750, pending: 0, unchanged: 0 })
  })

  it('counts a line whose figures have not arrived as pending, not as zero', () => {
    const contexts: StockContextMap = { '10:1': ctx({ itemId: 10, warehouseId: 1, onHandQty: 12, currentUnitCost: null }) }
    const totals = revaluationTotals(draftWith([laptop()]), contexts, 'warehouse')
    expect(totals.pending).toBe(1)
    expect(totals.net).toBe(0)
  })

  it('reads the company-wide context when stock is valued company-wide', () => {
    const contexts: StockContextMap = {
      '10:all': ctx({ itemId: 10, onHandQty: 30, currentUnitCost: 45000 }),
      '10:1': ctx({ itemId: 10, warehouseId: 1, onHandQty: 12, currentUnitCost: 45000 }),
    }
    expect(revaluationTotals(draftWith([laptop()]), contexts, 'company').net).toBe(45000)
    expect(revaluationTotals(draftWith([laptop()]), contexts, 'warehouse').net).toBe(18000)
  })
})

describe('blank lines', () => {
  it('ignores a line that carries nothing', () => {
    const blank = newRevaluationLine()
    expect(isBlankRevaluationLine(blank)).toBe(true)
    expect(isBlankRevaluationLine(laptop())).toBe(false)
    expect(activeLines(draftWith([laptop(), blank]))).toHaveLength(1)
  })
})

describe('validation', () => {
  const contexts: StockContextMap = {
    '10:1': ctx({ itemId: 10, warehouseId: 1, onHandQty: 12, currentUnitCost: 45000 }),
    '11:1': ctx({ itemId: 11, warehouseId: 1, onHandQty: 25, currentUnitCost: 4200 }),
  }

  it('passes a complete document', () => {
    expect(validateRevaluation(draftWith([laptop(), chair()]), contexts, { forPost: true, scope: 'warehouse' })).toEqual([])
  })

  it('asks for the header fields a revaluation cannot do without', () => {
    const draft = draftWith([laptop()], { documentDate: '', defaultWarehouseId: null, reasonCode: '' })
    const fields = validateRevaluation(draft, contexts, { forPost: true, scope: 'warehouse' }).map((i) => i.field)
    expect(fields).toContain('documentDate')
    expect(fields).toContain('defaultWarehouseId')
    expect(fields).toContain('reasonCode')
  })

  it('holds the date inside the selected financial year and outside a locked period', () => {
    const early = validateRevaluation(draftWith([laptop()], { documentDate: '2025-01-01' }), contexts, { forPost: true, scope: 'warehouse', fyRange: { from: '2026-04-01', to: '2027-03-31' } })
    expect(early.some((i) => i.field === 'documentDate')).toBe(true)
    const locked = validateRevaluation(draftWith([laptop()], { documentDate: '2026-06-30' }), contexts, { forPost: true, scope: 'warehouse', lockedUptoDate: '2026-06-30' })
    expect(locked.some((i) => i.message.includes('locked'))).toBe(true)
  })

  it('refuses a new cost that is missing, not a number, or not above zero', () => {
    const cases = ['', 'abc', '0', '-5']
    for (const value of cases) {
      const issues = validateRevaluation(draftWith([{ ...laptop(), newUnitCost: value }]), contexts, { forPost: true, scope: 'warehouse' })
      expect(issues.some((i) => i.lineKey === 'a')).toBe(true)
    }
  })

  it('leaves the new cost alone when only saving a draft', () => {
    const issues = validateRevaluation(draftWith([{ ...laptop(), newUnitCost: '' }]), contexts, { forPost: false, scope: 'warehouse' })
    expect(issues).toEqual([])
  })

  it('refuses a line with no stock to revalue', () => {
    const empty: StockContextMap = { '10:1': ctx({ itemId: 10, warehouseId: 1, onHandQty: 0, currentUnitCost: 45000 }) }
    const issues = validateRevaluation(draftWith([laptop()]), empty, { forPost: true, scope: 'warehouse' })
    expect(issues.some((i) => i.message.includes('no stock on hand'))).toBe(true)
  })

  it('catches a second line that would re-price the same layers', () => {
    const twice = draftWith([laptop(), { ...laptop(), key: 'c' }])
    expect(validateRevaluation(twice, contexts, { forPost: true, scope: 'warehouse' }).some((i) => i.lineKey === 'c')).toBe(true)
  })

  it('treats two warehouses as the same scope when stock is valued company-wide', () => {
    const wide: StockContextMap = { '10:all': ctx({ itemId: 10, onHandQty: 30, currentUnitCost: 45000 }) }
    const twoWarehouses = draftWith([laptop(), { ...laptop(), key: 'c', warehouseId: 2 }])
    const duplicate = (scope: 'company' | 'warehouse', map: StockContextMap) =>
      validateRevaluation(twoWarehouses, map, { forPost: true, scope }).some((i) => i.lineKey === 'c' && i.message.includes('already on line 1'))
    expect(duplicate('company', wide)).toBe(true)
    expect(duplicate('warehouse', { ...contexts, '10:2': ctx({ itemId: 10, warehouseId: 2, onHandQty: 4, currentUnitCost: 45000 }) })).toBe(false)
  })

  it('reports the keys of the lines it blames', () => {
    const issues = validateRevaluation(draftWith([{ ...laptop(), newUnitCost: '' }, chair()]), contexts, { forPost: true, scope: 'warehouse' })
    expect([...offendingLineKeys(issues)]).toEqual(['a'])
  })
})

describe('staleness', () => {
  const before: StockContextMap = { '10:1': ctx({ itemId: 10, warehouseId: 1, onHandQty: 12, currentUnitCost: 45000 }) }

  it('sees nothing when the figures have not moved', () => {
    expect(staleLines(draftWith([laptop()]), before, before, 'warehouse')).toEqual([])
  })

  it('reports a quantity or a cost that moved under the preview', () => {
    const after: StockContextMap = { '10:1': ctx({ itemId: 10, warehouseId: 1, onHandQty: 15, currentUnitCost: 45000 }) }
    const moved = staleLines(draftWith([laptop()]), before, after, 'warehouse')
    expect(moved).toHaveLength(1)
    expect(moved[0]).toMatchObject({ key: 'a', previousQty: 12, currentQty: 15 })
  })
})

describe('payload', () => {
  const contexts: StockContextMap = {
    '10:1': ctx({ itemId: 10, warehouseId: 1, onHandQty: 12, currentUnitCost: 45000 }),
    '11:1': ctx({ itemId: 11, warehouseId: 1, onHandQty: 25, currentUnitCost: 4200 }),
  }

  it('sends the new cost as the valuation rate and the on-hand quantity as qty', () => {
    const draft = draftWith([{ ...laptop(), remarks: 'Market price revised' }, chair()], { documentNo: '', movementReason: 'Market price change', narration: 'Quarterly review' })
    const payload = toRevaluationPayload(draft, REVAL, contexts, 'warehouse')
    expect(payload.document_type).toBe('REVALUATION')
    expect(payload.document_no).toBeNull()
    expect(payload.reason_code).toBe('MARKET_PRICE')
    expect(payload.movement_reason).toBe('Market price change')
    expect(payload.narration).toBe('Quarterly review')
    expect(payload.lines).toHaveLength(2)
    expect(payload.lines[0]).toMatchObject({ item_id: 10, warehouse_id: 1, unit_id: 7, qty: 12, valuation_rate: 46500, description: 'Market price revised' })
    expect(payload.lines[1]).toMatchObject({ item_id: 11, warehouse_id: 1, qty: 25, valuation_rate: 3950 })
  })

  it('carries no batch or serial: a revaluation re-prices every layer of the item', () => {
    const payload = toRevaluationPayload(draftWith([laptop()]), REVAL, contexts, 'warehouse')
    expect(payload.lines[0].batch_id).toBeNull()
    expect(payload.lines[0].serials).toBeUndefined()
  })

  it('drops blank lines', () => {
    const payload = toRevaluationPayload(draftWith([laptop(), newRevaluationLine()]), REVAL, contexts, 'warehouse')
    expect(payload.lines).toHaveLength(1)
  })

  it('rebuilds the draft from a stored document', () => {
    const doc = {
      document_id: 5,
      document_date: '2026-09-18T00:00:00',
      document_no: 'REV-1',
      reason_code: 'DAMAGE',
      movement_reason: 'Water damage',
      narration: 'Godown 2 leak',
      lines: [
        { line_id: 1, item_id: 10, item_label: 'Laptop', item_sku: 'LAP001', warehouse_id: 1, unit_id: 7, unit_symbol: 'Nos', conversion_factor: 1, valuation_rate: 39000, description: 'Damaged', serials: [], batch_id: null, hsn_sac: '8471' },
      ],
    } as unknown as InventoryDocument
    const draft = revaluationDraftFromDocument(doc)
    expect(draft).toMatchObject({ documentDate: '2026-09-18', documentNo: 'REV-1', reasonCode: 'DAMAGE', movementReason: 'Water damage', defaultWarehouseId: 1 })
    expect(draft.lines[0]).toMatchObject({ itemId: 10, itemName: 'Laptop', itemSku: 'LAP001', hsnSac: '8471', warehouseId: 1, newUnitCost: '39000', remarks: 'Damaged' })
  })
})

describe('display filters', () => {
  const contexts: StockContextMap = {
    '10:1': ctx({ itemId: 10, warehouseId: 1, onHandQty: 12, currentUnitCost: 45000 }),
    '11:1': ctx({ itemId: 11, warehouseId: 1, onHandQty: 0, currentUnitCost: 4200 }),
  }
  const lines = [laptop(), chair()]

  it('starts empty', () => {
    expect(filtersAreEmpty(EMPTY_LINE_FILTERS)).toBe(true)
    expect(countActiveFilters({ ...EMPTY_LINE_FILTERS, show: 'on_hand', search: 'lap' })).toBe(2)
  })

  it('narrows by stock, impact sign and text without touching the document', () => {
    expect(visibleLines(lines, contexts, 'warehouse', { ...EMPTY_LINE_FILTERS, show: 'on_hand' }).map((l) => l.key)).toEqual(['a'])
    expect(visibleLines(lines, contexts, 'warehouse', { ...EMPTY_LINE_FILTERS, show: 'zero_stock' }).map((l) => l.key)).toEqual(['b'])
    expect(visibleLines(lines, contexts, 'warehouse', { ...EMPTY_LINE_FILTERS, show: 'increase' }).map((l) => l.key)).toEqual(['a'])
    expect(visibleLines(lines, contexts, 'warehouse', { ...EMPTY_LINE_FILTERS, search: 'CHR' }).map((l) => l.key)).toEqual(['b'])
    expect(visibleLines(lines, contexts, 'warehouse', EMPTY_LINE_FILTERS)).toHaveLength(2)
  })

  it('keeps a line whose quantity has not arrived out of the zero-stock bucket', () => {
    const pending: StockContextMap = { '10:1': ctx({ itemId: 10, warehouseId: 1, onHandQty: null, currentUnitCost: null, loading: true }) }
    expect(visibleLines([laptop()], pending, 'warehouse', { ...EMPTY_LINE_FILTERS, show: 'on_hand' })).toHaveLength(1)
    expect(visibleLines([laptop()], pending, 'warehouse', { ...EMPTY_LINE_FILTERS, show: 'zero_stock' })).toHaveLength(0)
  })
})
