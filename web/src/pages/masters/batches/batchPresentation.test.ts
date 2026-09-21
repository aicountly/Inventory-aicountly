import { describe, expect, it } from 'vitest'
import type { BatchSummary } from '../../../services/batchesApi'
import type { Batch } from '../../../services/masters'
import {
  batchHealth,
  batchStatusChip,
  daysUntil,
  expiryBand,
  expiryNote,
  expiryTimelineRows,
  healthSegments,
  itemInitials,
  itemSubtitle,
  resolveExpiryPreset,
  shiftIso,
  warehouseLabel,
} from './batchPresentation'

const TODAY = '2026-09-18'

function batch(over: Partial<Batch> = {}): Batch {
  return {
    batch_id: 1,
    item_id: 7,
    batch_no: 'BCH-2026-001',
    lot_no: 'LOT-4587',
    mfg_date: '2026-04-01',
    expiry_date: '2028-03-31',
    warranty_months: null,
    status: 'active',
    attributes: null,
    item_name: 'Paracetamol 500mg',
    item_sku: 'SKU-1',
    unit_symbol: 'pcs',
    ...over,
  }
}

describe('daysUntil', () => {
  it('counts whole days, and goes negative once the date has passed', () => {
    expect(daysUntil('2026-09-18', TODAY)).toBe(0)
    expect(daysUntil('2026-09-25', TODAY)).toBe(7)
    expect(daysUntil('2026-09-11', TODAY)).toBe(-7)
  })

  it('crosses a month, a year and a leap day without drifting', () => {
    expect(daysUntil('2026-10-18', TODAY)).toBe(30)
    expect(daysUntil('2027-09-18', TODAY)).toBe(365)
    // 2028 is a leap year, so the window through it is one day longer.
    expect(daysUntil('2028-09-18', '2027-09-18')).toBe(366)
  })

  it('is null rather than a guess for a missing or unparseable date', () => {
    expect(daysUntil(null, TODAY)).toBeNull()
    expect(daysUntil('', TODAY)).toBeNull()
    expect(daysUntil('31/03/2028', TODAY)).toBeNull()
    expect(daysUntil('not a date', TODAY)).toBeNull()
  })
})

describe('batchHealth', () => {
  it('reads expired from the calendar even while the stored status says active', () => {
    expect(batchHealth(batch({ expiry_date: '2026-09-17' }), TODAY)).toBe('expired')
  })

  it('honours an expired status with no expiry date at all', () => {
    expect(batchHealth(batch({ status: 'expired', expiry_date: null }), TODAY)).toBe('expired')
  })

  it('puts expiry ahead of a dormant status — an expired recall is still expired', () => {
    expect(batchHealth(batch({ status: 'recalled', expiry_date: '2026-01-01' }), TODAY)).toBe('expired')
  })

  it('calls quarantine, recall and closure inactive', () => {
    for (const status of ['quarantine', 'recalled', 'closed']) {
      expect(batchHealth(batch({ status }), TODAY)).toBe('inactive')
    }
  })

  it('treats the boundary of the warning window as expiring, and the day after as active', () => {
    expect(batchHealth(batch({ expiry_date: '2026-10-18' }), TODAY, 30)).toBe('expiring')
    expect(batchHealth(batch({ expiry_date: '2026-10-19' }), TODAY, 30)).toBe('active')
  })

  it('expires today rather than tomorrow: day zero is still expiring, not expired', () => {
    expect(batchHealth(batch({ expiry_date: TODAY }), TODAY)).toBe('expiring')
  })

  it('leaves a batch with no expiry date active', () => {
    expect(batchHealth(batch({ expiry_date: null }), TODAY)).toBe('active')
  })

  it('follows the window it is given rather than a hardcoded thirty days', () => {
    expect(batchHealth(batch({ expiry_date: '2026-12-01' }), TODAY, 30)).toBe('active')
    expect(batchHealth(batch({ expiry_date: '2026-12-01' }), TODAY, 90)).toBe('expiring')
  })
})

describe('batchStatusChip', () => {
  it('keeps the API’s own word for a dormant batch instead of a euphemism', () => {
    const chip = batchStatusChip(batch({ status: 'quarantine' }), TODAY)
    expect(chip.label).toBe('Quarantine')
    expect(chip.tone).toBe('neutral')
  })

  it('never leaves expiry to colour alone', () => {
    const expired = batchStatusChip(batch({ expiry_date: '2026-09-11' }), TODAY)
    expect(expired.label).toBe('Expired')
    expect(expired.srText).toBe('Expired 7 days ago')

    const soon = batchStatusChip(batch({ expiry_date: '2026-09-19' }), TODAY)
    expect(soon.label).toBe('Expiring soon')
    expect(soon.srText).toBe('Expires in 1 day')
  })

  it('reads Active for a healthy batch', () => {
    const chip = batchStatusChip(batch(), TODAY)
    expect(chip.label).toBe('Active')
    expect(chip.tone).toBe('success')
  })
})

describe('expiryBand and expiryNote', () => {
  it('bands a date by how much time is left', () => {
    expect(expiryBand(null)).toBe('none')
    expect(expiryBand(-1)).toBe('expired')
    expect(expiryBand(30)).toBe('critical')
    expect(expiryBand(31)).toBe('warning')
    expect(expiryBand(91)).toBe('caution')
    expect(expiryBand(181)).toBe('healthy')
  })

  it('writes the note the way a reader says it', () => {
    expect(expiryNote(null)).toBe('')
    expect(expiryNote(0)).toBe('today')
    expect(expiryNote(42)).toBe('in 42 d')
    expect(expiryNote(-3)).toBe('3 d ago')
  })
})

describe('resolveExpiryPreset', () => {
  it('stops "expired" at yesterday, so today is expiring rather than gone', () => {
    expect(resolveExpiryPreset('expired', TODAY)).toEqual({ expiry_to: '2026-09-17', has_expiry: '1' })
  })

  it('turns a window into a real date range', () => {
    expect(resolveExpiryPreset('d30', TODAY)).toEqual({ expiry_from: TODAY, expiry_to: '2026-10-18' })
    expect(resolveExpiryPreset('d90', TODAY)).toEqual({ expiry_from: TODAY, expiry_to: '2026-12-17' })
  })

  it('asks for the rows with no expiry date at all', () => {
    expect(resolveExpiryPreset('none', TODAY)).toEqual({ has_expiry: '0' })
  })

  it('adds nothing for "all" or "custom" — the date inputs carry a custom range', () => {
    expect(resolveExpiryPreset('', TODAY)).toEqual({})
    expect(resolveExpiryPreset('custom', TODAY)).toEqual({})
  })

  it('shifts across a month and a year boundary', () => {
    expect(shiftIso('2026-12-20', 30)).toBe('2027-01-19')
    expect(shiftIso('2026-03-01', -1)).toBe('2026-02-28')
  })
})

function summary(over: Partial<BatchSummary> = {}): BatchSummary {
  return {
    total: 248,
    active: 186,
    expiring_soon: 12,
    expired: 5,
    inactive: 45,
    total_on_hand: 12450,
    with_stock: 200,
    zero_stock: 48,
    previous_total: 221,
    comparison_days: 30,
    near_expiry_days: 30,
    by_status: { active: 198, quarantine: 20, recalled: 5, expired: 5, closed: 20 },
    expiry_buckets: {
      expired: 5,
      within_30: 12,
      days_31_90: 28,
      days_91_180: 46,
      beyond_180: 162,
      no_expiry: 0,
    },
    ...over,
  }
}

describe('healthSegments', () => {
  it('keeps a fixed order and fixed colours, whatever the sizes are', () => {
    const segments = healthSegments(summary())
    expect(segments.map((s) => s.key)).toEqual(['active', 'expiring', 'expired', 'inactive'])
    expect(segments[0].arcClass).toBe('text-primary')
    expect(segments[2].dotClass).toBe('bg-red-500')
  })

  it('closes the circle: the arcs sum to 100% and each starts where the last ended', () => {
    const segments = healthSegments(summary())
    const total = segments.reduce((acc, s) => acc + s.percent, 0)
    expect(total).toBeCloseTo(100, 6)
    expect(segments[0].offset).toBe(0)
    expect(segments[1].offset).toBeCloseTo(segments[0].percent, 6)
    expect(segments[3].offset + segments[3].percent).toBeCloseTo(100, 6)
  })

  it('keeps a zero state in the legend but draws no arc for it', () => {
    const segments = healthSegments(summary({ expired: 0, active: 191 }))
    const expired = segments.find((s) => s.key === 'expired')
    expect(expired?.value).toBe(0)
    expect(expired?.percent).toBe(0)
  })

  it('draws nothing at all rather than dividing by zero on an empty company', () => {
    const segments = healthSegments(summary({ total: 0, active: 0, expiring_soon: 0, expired: 0, inactive: 0 }))
    expect(segments.every((s) => s.percent === 0)).toBe(true)
  })

  it('renders the legend with zeroes before the summary lands', () => {
    expect(healthSegments(null).map((s) => s.value)).toEqual([0, 0, 0, 0])
  })
})

describe('expiryTimelineRows', () => {
  it('scales each bar against the biggest bucket, not against the total', () => {
    const rows = expiryTimelineRows(summary().expiry_buckets)
    const biggest = rows.find((r) => r.key === 'beyond_180')
    expect(biggest?.scale).toBe(100)
    const within30 = rows.find((r) => r.key === 'within_30')
    // 12 of 162 — and never invisible, so an urgent band stays on screen.
    expect(within30?.scale).toBeCloseTo((12 / 162) * 100, 6)
    expect(within30?.scale).toBeGreaterThanOrEqual(4)
  })

  it('shows the four standing bands and hides the optional ones when empty', () => {
    const rows = expiryTimelineRows(summary().expiry_buckets)
    expect(rows.map((r) => r.key)).toEqual(['expired', 'within_30', 'days_31_90', 'days_91_180', 'beyond_180'])
  })

  it('surfaces "no expiry date" only when some batch has none', () => {
    const rows = expiryTimelineRows({ ...summary().expiry_buckets, expired: 0, no_expiry: 9 })
    expect(rows.map((r) => r.key)).toContain('no_expiry')
    expect(rows.map((r) => r.key)).not.toContain('expired')
  })

  it('has nothing to draw before the summary lands', () => {
    expect(expiryTimelineRows(null)).toEqual([])
  })
})

describe('row helpers', () => {
  it('names the warehouse holding most of the batch and counts the rest', () => {
    const row = batch({
      warehouse_count: 3,
      warehouses: [
        { warehouse_id: 1, warehouse_name: 'Main Warehouse', warehouse_code: 'MW', on_hand: 900 },
        { warehouse_id: 2, warehouse_name: 'Delhi', warehouse_code: null, on_hand: 350 },
      ],
    })
    expect(warehouseLabel(row)).toEqual({ name: 'Main Warehouse', extra: 2 })
  })

  it('is null when no balance was ever recorded', () => {
    expect(warehouseLabel(batch({ warehouses: [] }))).toBeNull()
    expect(warehouseLabel(batch())).toBeNull()
  })

  it('falls back through category, group and SKU for the item’s second line', () => {
    expect(itemSubtitle(batch({ stock_category_name: 'Medicine', item_group_name: 'Pharma' }))).toBe('Medicine')
    expect(itemSubtitle(batch({ item_group_name: 'Pharma' }))).toBe('Pharma')
    expect(itemSubtitle(batch({ item_sku: 'SKU-9' }))).toBe('SKU-9')
    expect(itemSubtitle(batch({ item_sku: null }))).toBe('')
  })

  it('builds initials instead of inventing an item image', () => {
    expect(itemInitials('Paracetamol 500mg')).toBe('P5')
    expect(itemInitials('Dettol')).toBe('DE')
    expect(itemInitials(null)).toBe('—')
    expect(itemInitials('   ')).toBe('—')
  })
})
