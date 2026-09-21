import { describe, expect, it, vi } from 'vitest'
import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import { parseClause, parsePrompt, serverAssistEnabled, suggestLocally } from './assistant'
import type { LocalAssistContext } from './assistant'

const WAREHOUSES: FormOptionWarehouse[] = [
  { warehouse_id: 5, warehouse_name: 'Main', warehouse_code: 'WH-MAIN', warehouse_type: 'store', is_default: 1, bo_id: 0 },
  { warehouse_id: 6, warehouse_name: 'Branch 2', warehouse_code: 'WH2', warehouse_type: 'store', is_default: 0, bo_id: 0 },
]

function item(name = 'Item ABC', id = 11): ItemSearchRow {
  return {
    item_id: id,
    item_name: name,
    item_alias: null,
    print_name: null,
    item_sku: 'ABC',
    item_upc: null,
    hsn_sac: null,
    mrp: null,
    unit_id: 1,
    unit_symbol: 'Nos',
    track_batch: 0,
    track_serial: 0,
    valuation_method: null,
    default_warehouse_id: null,
    units: [],
  }
}

const ctx = (findItem: LocalAssistContext['findItem'] = vi.fn(async () => item())) => ({
  warehouses: WAREHOUSES,
  defaultWarehouseId: 5,
  findItem,
})

describe('serverAssistEnabled', () => {
  it('is off until VITE_INVENTORY_AI_PATH names an endpoint, so nothing fires a 404', () => {
    // The same seam the masters' AI panels read — not a second flag of our own.
    expect(serverAssistEnabled()).toBe(false)
  })
})

describe('parseClause', () => {
  it('reads a transfer with both warehouses', () => {
    const c = parseClause('Transfer 10 units of Item ABC from Main to Branch 2 due to damage')
    expect(c).toMatchObject({ kind: 'transfer', quantity: 10, itemText: 'Item ABC', fromWarehouse: 'Main', toWarehouse: 'Branch 2', remarks: 'damage' })
  })

  it('reads an outward movement', () => {
    expect(parseClause('write off 5 of Item ABC')).toMatchObject({ kind: 'out', quantity: 5, itemText: 'Item ABC' })
  })

  it('reads an inward movement', () => {
    expect(parseClause('receive 20 of Item ABC into Main')).toMatchObject({ kind: 'in', quantity: 20 })
  })

  it('treats a bare destination as inward', () => {
    expect(parseClause('12 of Item ABC to Branch 2')?.kind).toBe('in')
  })

  it('refuses a clause with no quantity rather than guessing one', () => {
    expect(parseClause('move some widgets around')).toBeNull()
    expect(parseClause('')).toBeNull()
  })

  it('refuses a zero or negative quantity', () => {
    expect(parseClause('write off 0 of Item ABC')).toBeNull()
    expect(parseClause('write off -3 of Item ABC')).toBeNull()
  })

  it('reads a decimal quantity and a unit word', () => {
    expect(parseClause('issue 2.5 kg of Item ABC')).toMatchObject({ quantity: 2.5, itemText: 'Item ABC' })
  })

  it('splits several movements out of one prompt', () => {
    const parsed = parsePrompt('Write off 5 of Item ABC. Receive 3 of Item XYZ into Main')
    expect(parsed).toHaveLength(2)
    expect(parsed[0].kind).toBe('out')
    expect(parsed[1].kind).toBe('in')
  })
})

describe('suggestLocally', () => {
  it('turns a transfer into a matched out / in pair', async () => {
    const res = await suggestLocally('Transfer 10 units of Item ABC from Main to Branch 2 due to damage', ctx())
    expect(res.source).toBe('device')
    expect(res.suggestions).toHaveLength(2)
    expect(res.suggestions[0]).toMatchObject({ direction: 'out', warehouse_id: 5, quantity: 10, remarks: 'damage' })
    expect(res.suggestions[1]).toMatchObject({ direction: 'in', warehouse_id: 6, quantity: 10 })
  })

  it('always says the draft was made on this device and needs checking', async () => {
    const res = await suggestLocally('write off 5 of Item ABC', ctx())
    expect(res.warnings.join(' ')).toContain('Check every line before posting')
  })

  it('reports an item it could not resolve instead of dropping the line', async () => {
    const res = await suggestLocally('write off 5 of Nonexistent', ctx(vi.fn(async () => null)))
    expect(res.suggestions).toEqual([])
    expect(res.warnings.join(' ')).toContain('No item found')
  })

  it('falls back to the default warehouse and says which name it could not find', async () => {
    const res = await suggestLocally('write off 5 of Item ABC from Nowhere', ctx())
    expect(res.suggestions[0].warehouse_id).toBe(5)
    expect(res.warnings.join(' ')).toContain('No warehouse called')
  })

  it('refuses a transfer whose two ends are the same warehouse', async () => {
    const res = await suggestLocally('Transfer 4 of Item ABC from Main to Main', ctx())
    expect(res.suggestions).toEqual([])
    expect(res.warnings.join(' ')).toContain('same')
  })

  it('explains itself when it cannot read the prompt at all', async () => {
    const res = await suggestLocally('do the needful', ctx())
    expect(res.suggestions).toEqual([])
    expect(res.warnings[0]).toContain('Transfer 10 units of ABC')
  })

  it('never returns a quantity or an item it was not given', async () => {
    const find = vi.fn(async () => item('Real Item', 99))
    const res = await suggestLocally('issue 7 of whatever', ctx(find))
    expect(res.suggestions.every((s) => s.item_id === 99)).toBe(true)
    expect(res.suggestions.every((s) => s.quantity === 7)).toBe(true)
    // Nothing is priced by guesswork — the rate stays for the user or the server.
    expect(res.suggestions.every((s) => s.rate === null)).toBe(true)
  })
})
