import { describe, expect, it } from 'vitest'
import {
  deriveInsights,
  getStockHealth,
  isStockTracked,
  itemInitials,
  itemSubtitle,
  primaryInsight,
  reorderThreshold,
  trackingFlags,
} from './itemsModel'
import type { ItemListRow, ItemsSummary } from '../../services/items'

function item(over: Partial<ItemListRow> = {}): ItemListRow {
  return {
    item_id: 1,
    item_name: 'Ballpoint Pens',
    item_alias: 'Pen',
    print_name: null,
    item_type: 'stock',
    item_sku: null,
    item_upc: null,
    hsn_sac: '960810',
    mrp: null,
    unit_id: 5,
    stock_cat_id: 3,
    item_grp_id: 1,
    brand_id: null,
    valuation_method: 'FIFO',
    track_batch: 0,
    track_serial: 0,
    track_expiry: 0,
    is_active: 1,
    updated_at: '2026-07-07T15:08:00',
    created_at: '2026-07-07T15:08:00',
    unit_symbol: 'DOZ',
    unit_name: 'Dozen',
    grp_name: 'General',
    cat_name: 'Raw Material',
    brand_name: null,
    ...over,
  }
}

function summary(over: Partial<ItemsSummary> = {}): ItemsSummary {
  return {
    total: 0,
    active: 0,
    inactive: 0,
    stock_tracked: 0,
    in_stock: 0,
    low_stock: 0,
    out_of_stock: 0,
    negative_stock: 0,
    needs_attention: 0,
    missing_hsn: 0,
    missing_barcode: 0,
    missing_sku: 0,
    inactive_with_stock: 0,
    ...over,
  }
}

const stock = (on_hand: number) => ({ on_hand, available: on_hand, reserved: 0 })

describe('reorderThreshold', () => {
  it('prefers the reorder point over the minimum stock level', () => {
    expect(reorderThreshold(item({ reorder_point_qty: 20, min_stock_qty: 5 }))).toBe(20)
  })

  it('falls back to the minimum stock level', () => {
    expect(reorderThreshold(item({ reorder_point_qty: null, min_stock_qty: 5 }))).toBe(5)
  })

  it('treats zero as "no threshold", not as a threshold of zero', () => {
    // Otherwise every item in the catalogue turns amber the moment it empties,
    // which is what "out of stock" already says.
    expect(reorderThreshold(item({ reorder_point_qty: 0, min_stock_qty: 0 }))).toBeNull()
  })

  it('reads numeric strings, the way the API sends NUMERIC columns', () => {
    expect(reorderThreshold(item({ reorder_point_qty: '12.5000' }))).toBe(12.5)
  })
})

describe('getStockHealth', () => {
  it('flags negative stock as critical', () => {
    const health = getStockHealth(item({ stock: stock(-1) }))
    expect(health.key).toBe('negative')
    expect(health.tone).toBe('danger')
  })

  it('separates out-of-stock from negative', () => {
    expect(getStockHealth(item({ stock: stock(0) })).key).toBe('out')
  })

  it('is low at exactly the reorder level, not only below it', () => {
    expect(getStockHealth(item({ stock: stock(5), reorder_point_qty: 5 })).key).toBe('low')
  })

  it('is healthy above the reorder level', () => {
    expect(getStockHealth(item({ stock: stock(6), reorder_point_qty: 5 })).key).toBe('healthy')
  })

  it('is healthy with stock and no reorder policy at all', () => {
    expect(getStockHealth(item({ stock: stock(120) })).key).toBe('healthy')
  })

  it('never calls a service item out of stock', () => {
    // A service holds no quantity. Counting it "out" would be an alarm about
    // nothing, on every service item in the catalogue.
    const health = getStockHealth(item({ item_type: 'service', stock: stock(0) }))
    expect(health.key).toBe('untracked')
    expect(health.tone).toBe('neutral')
  })

  it('distinguishes "stock not loaded" from "no stock"', () => {
    // The list can be fetched without with_stock=1. That is a missing figure,
    // not a zero, and must not render as a red badge.
    const health = getStockHealth(item({ stock: undefined }))
    expect(health.key).toBe('untracked')
    expect(health.onHand).toBeNull()
  })
})

describe('isStockTracked', () => {
  it('is true only for stock items', () => {
    expect(isStockTracked(item())).toBe(true)
    expect(isStockTracked(item({ item_type: 'service' }))).toBe(false)
    expect(isStockTracked(item({ item_type: 'non_stock' }))).toBe(false)
  })
})

describe('itemInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(itemInitials('Ballpoint Pens')).toBe('BP')
  })

  it('handles a single word', () => {
    expect(itemInitials('Marker')).toBe('M')
  })

  it('keeps whole code points rather than half a surrogate pair', () => {
    expect(itemInitials('😀 Widget')).toBe('😀W')
  })

  it('falls back rather than rendering an empty tile', () => {
    expect(itemInitials('   ')).toBe('—')
  })
})

describe('itemSubtitle', () => {
  it('joins the alias and the category', () => {
    expect(itemSubtitle(item())).toBe('Pen · Raw Material')
  })

  it('drops the separator when only one part exists', () => {
    expect(itemSubtitle(item({ item_alias: null }))).toBe('Raw Material')
    expect(itemSubtitle(item({ item_alias: null, cat_name: null }))).toBe('')
  })
})

describe('trackingFlags', () => {
  it('lists the flags that are on, in screen order', () => {
    expect(trackingFlags(item({ track_batch: 1, track_expiry: 1 }))).toEqual(['Batch', 'Expiry'])
  })

  it('is empty when nothing is tracked', () => {
    expect(trackingFlags(item())).toEqual([])
  })
})

describe('deriveInsights', () => {
  it('says nothing at all when there is nothing to report', () => {
    // The strip must never invent a line so it has something to show.
    expect(deriveInsights(summary())).toEqual([])
    expect(deriveInsights(null)).toEqual([])
  })

  it('reports negative stock as critical, with the filter that proves it', () => {
    const [first] = deriveInsights(summary({ negative_stock: 1 }))
    expect(first.severity).toBe('critical')
    expect(first.filter).toEqual({ stock_status: 'negative' })
    expect(first.title).toContain('1 item')
  })

  it('pluralises the count', () => {
    const [first] = deriveInsights(summary({ negative_stock: 3 }))
    expect(first.title).toContain('3 items')
  })

  it('puts critical findings before warnings and suggestions', () => {
    const list = deriveInsights(summary({ missing_hsn: 90, low_stock: 4, negative_stock: 1 }))
    expect(list.map((i) => i.severity)).toEqual(['critical', 'warning', 'info'])
    expect(primaryInsight(list)?.id).toBe('negative-stock')
  })

  it('ranks by count within a severity', () => {
    const list = deriveInsights(summary({ low_stock: 2, out_of_stock: 9 }))
    expect(list.map((i) => i.id)).toEqual(['out-of-stock', 'low-stock'])
  })

  it('flags stock stranded on a deactivated item', () => {
    const ids = deriveInsights(summary({ inactive_with_stock: 2 })).map((i) => i.id)
    expect(ids).toContain('inactive-with-stock')
  })

  it('returns null for the primary insight of an empty list', () => {
    expect(primaryInsight([])).toBeNull()
  })
})
