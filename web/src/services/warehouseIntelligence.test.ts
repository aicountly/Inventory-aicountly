import { describe, expect, it } from 'vitest'
import {
  WarehouseIntelligenceUnavailableError,
  answerLocally,
  toWarehouseFacts,
  warehouseIntelligenceService,
} from './warehouseIntelligence'
import type { WarehouseFact } from './warehouseIntelligence'
import type { Warehouse } from './masters'

/**
 * The one rule this service exists to keep: it never answers a question it
 * cannot answer from real figures.
 *
 * A fabricated "move 400 units from Pune to Delhi" is indistinguishable from a
 * computed one at a glance, and acting on it costs a real transfer. So a
 * question the local arithmetic does not cover, with no endpoint configured,
 * must reject — not improvise.
 */

const fact = (overrides: Partial<WarehouseFact> = {}): WarehouseFact => ({
  warehouse_id: 1,
  name: 'Main',
  code: null,
  type: 'standard',
  city: null,
  is_active: true,
  capacity: null,
  stockQty: 0,
  stockValue: null,
  utilisation: null,
  ...overrides,
})

describe('answerLocally', () => {
  it('names the fullest warehouse from the capacities it was given', () => {
    const answer = answerLocally('Which warehouse is closest to capacity?', [
      fact({ warehouse_id: 1, name: 'Main', capacity: 1000, stockQty: 300, utilisation: 30 }),
      fact({ warehouse_id: 2, name: 'Depot', capacity: 1000, stockQty: 900, utilisation: 90 }),
    ])
    expect(answer?.text).toContain('Depot')
    expect(answer?.warehouseIds).toEqual([2])
    expect(answer?.source).toBe('local')
  })

  it('says capacity is unconfigured instead of picking an arbitrary warehouse', () => {
    const answer = answerLocally('Which warehouse is closest to capacity?', [fact(), fact({ warehouse_id: 2 })])
    expect(answer?.text).toContain('No warehouse has a capacity configured')
    expect(answer?.warehouseIds).toBeUndefined()
  })

  it('reports negative stock, and reports its absence just as plainly', () => {
    expect(answerLocally('Which locations have negative stock?', [fact({ stockQty: -4 })])?.text).toContain('1 warehouse')
    expect(answerLocally('Which locations have negative stock?', [fact({ stockQty: 4 })])?.text).toContain('No warehouse')
  })

  it('counts only active warehouses as empty', () => {
    const answer = answerLocally('Which warehouses have no stock?', [
      fact({ warehouse_id: 1, name: 'Live', stockQty: 0 }),
      fact({ warehouse_id: 2, name: 'Retired', stockQty: 0, is_active: false }),
    ])
    expect(answer?.text).toContain('Live')
    expect(answer?.text).not.toContain('Retired')
  })

  it('returns null for a question it does not understand, rather than guessing', () => {
    expect(answerLocally('Should we open a warehouse in Nagpur next quarter?', [fact()])).toBeNull()
    expect(answerLocally('', [fact()])).toBeNull()
  })
})

describe('warehouseIntelligenceService.ask', () => {
  it('rejects an open-ended question when no assistant endpoint is configured', async () => {
    // No VITE_WAREHOUSE_AI_ENDPOINT is set in this environment, which is the
    // deployed state today.
    expect(warehouseIntelligenceService.isConfigured()).toBe(false)
    await expect(
      warehouseIntelligenceService.ask({ question: 'Suggest a stock redistribution plan', facts: [fact()] }),
    ).rejects.toBeInstanceOf(WarehouseIntelligenceUnavailableError)
  })

  it('still answers what the figures on screen can answer', async () => {
    const answer = await warehouseIntelligenceService.ask({
      question: 'Which locations have negative stock?',
      facts: [fact({ stockQty: -1 })],
    })
    expect(answer.source).toBe('local')
  })

  it('offers only prompts this screen can carry', () => {
    expect(warehouseIntelligenceService.suggestions().length).toBeGreaterThan(0)
  })
})

describe('toWarehouseFacts', () => {
  const warehouse: Warehouse = {
    warehouse_id: 9,
    warehouse_name: 'Pune',
    warehouse_code: 'PN',
    warehouse_group_id: null,
    parent_warehouse_id: null,
    warehouse_type: 'standard',
    is_default: 0,
    allow_negative: null,
    address: { city: 'Pune' },
    contact: null,
    bo_id: 0,
    is_active: 1,
    capacity_units: 1000,
    area: null,
    area_unit: null,
    latitude: null,
    longitude: null,
  }

  it('carries the live figures, not a second copy of the data', () => {
    const [built] = toWarehouseFacts([warehouse], () => ({ qty: 250, value: 5000 }))
    expect(built).toMatchObject({ warehouse_id: 9, city: 'Pune', stockQty: 250, stockValue: 5000 })
    expect(built.utilisation).toBeCloseTo(25, 5)
  })

  it('leaves utilisation null when the warehouse has no ceiling', () => {
    const [built] = toWarehouseFacts([{ ...warehouse, capacity_units: null }], () => ({ qty: 250, value: null }))
    expect(built.utilisation).toBeNull()
  })
})
