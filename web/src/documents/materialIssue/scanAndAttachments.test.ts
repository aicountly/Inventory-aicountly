import { describe, expect, it } from 'vitest'
import type { ItemSearchRow } from '../../services/lookupApi'
import { resolveScan } from './BarcodeScanDialog'
import { ATTACHMENTS_AVAILABLE, rejectUnsupported } from './attachmentsApi'

function row(partial: Partial<ItemSearchRow>): ItemSearchRow {
  return {
    item_id: 1,
    item_name: 'Gear Shaft',
    item_alias: null,
    print_name: null,
    item_sku: null,
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
    ...partial,
  }
}

describe('resolveScan', () => {
  it('takes an exact SKU or barcode match over anything else', () => {
    const rows = [row({ item_id: 1, item_sku: 'GS-0011' }), row({ item_id: 2, item_sku: 'GS-001' })]
    expect(resolveScan('GS-001', rows)?.item_id).toBe(2)
    expect(resolveScan('gs-001', rows)?.item_id).toBe(2)
    expect(resolveScan('8901234567890', [row({ item_id: 3, item_upc: '8901234567890' })])?.item_id).toBe(3)
  })

  it('accepts a single result even without an exact match', () => {
    expect(resolveScan('GEAR', [row({ item_id: 9 })])?.item_id).toBe(9)
  })

  it('refuses to guess between several candidates', () => {
    // Issuing the wrong item is a stock error nobody catches until the count.
    const rows = [row({ item_id: 1, item_sku: 'A-1' }), row({ item_id: 2, item_sku: 'A-2' })]
    expect(resolveScan('A-', rows)).toBeNull()
  })

  it('has no answer for an empty code or an empty result set', () => {
    expect(resolveScan('', [row({ item_id: 1 })])).toBeNull()
    expect(resolveScan('   ', [row({ item_id: 1 })])).toBeNull()
    expect(resolveScan('A-1', [])).toBeNull()
  })
})

describe('attachments', () => {
  it('is still reported as unavailable', () => {
    // The panel renders a disabled control off this. Flipping it without the
    // endpoint would make the screen promise storage it does not have.
    expect(ATTACHMENTS_AVAILABLE).toBe(false)
  })

  it('rejects the wrong type and anything over 10 MB', () => {
    const file = (name: string, size: number) => {
      const f = new File(['x'], name)
      Object.defineProperty(f, 'size', { value: size })
      return f
    }
    const rejected = rejectUnsupported([
      file('approval.pdf', 1024),
      file('scan.png', 5 * 1024 * 1024),
      file('notes.exe', 10),
      file('huge.pdf', 11 * 1024 * 1024),
      file('noextension', 10),
    ])
    expect(rejected.map((r) => r.file)).toEqual(['notes.exe', 'huge.pdf', 'noextension'])
    expect(rejected[1].reason).toContain('over the 10 MB limit')
  })
})
