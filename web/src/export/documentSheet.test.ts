import { describe, expect, it, vi } from 'vitest'
import {
  COPY_SETS,
  buildDocumentSheet,
  defaultCopySet,
  documentColumns,
  documentTotals,
  readLine,
} from './documentSheet'
import type { InventoryDocument, PrintSnapshot } from '../documents/types'

function snapshot(overrides: Partial<PrintSnapshot> = {}): PrintSnapshot {
  return {
    snap_id: 9,
    document_id: 412,
    document_variant: 'delivery_challan',
    document_no: 'DC-000412',
    document_date: '2026-04-18',
    currency_code: 'INR',
    header_snapshot: { title: 'Delivery challan', vehicle_no: 'MH12AB1234' },
    source_dest_snapshot: {
      party_name: 'Northwind Traders',
      party_gstin: '27AAAPL1234C1ZV',
      from_warehouse_name: 'Pune Central',
    },
    item_lines_snapshot: [
      {
        item_name: 'Widget A',
        item_sku: 'WID-A',
        warehouse_name: 'Pune Central',
        batch_no: 'B-77',
        qty: 10,
        unit_symbol: 'Nos',
        rate: 120,
        amount: 1200,
        direction: 'out',
      },
      {
        item_name: 'Widget B',
        warehouse_name: 'Pune Central',
        qty: 4,
        unit_symbol: 'Nos',
        rate: 50,
        amount: 200,
        direction: 'out',
      },
    ],
    transport_snapshot: null,
    variant_extras_snapshot: null,
    footer_snapshot: { terms: 'Goods once sent are not returnable' },
    template_version: 'dc-v2',
    status: 'POSTED',
    created_at: '2026-04-18 11:04:00',
    ...overrides,
  }
}

function liveDocument(overrides: Partial<InventoryDocument> = {}): InventoryDocument {
  return {
    document_id: 412,
    document_uuid: 'u-412',
    cmp_id: 1,
    bo_id: 1,
    fy_id: 3,
    document_type: 'delivery_challan',
    document_type_label: 'Delivery challan',
    document_no: 'DC-000412',
    series_id: null,
    document_date: '2026-04-18',
    status: 'DRAFT',
    source_app: 'inventory',
    source_document_type: null,
    source_document_id: null,
    source_document_uuid: null,
    source_document_no: null,
    source_document_date: null,
    party_ref: 7,
    party_name: 'Northwind Traders',
    dest_party_ref: null,
    from_warehouse_id: 5,
    to_warehouse_id: null,
    dest_bo_id: null,
    stock_effect: null,
    returnable: null,
    expected_return_date: null,
    movement_reason: null,
    reason_code: null,
    narration: 'Urgent despatch',
    currency_code: 'INR',
    exchange_rate: 1,
    metadata: null,
    accounting_effects: [],
    reverses_document_id: null,
    reversed_by_document_id: null,
    approved_by: null,
    approved_at: null,
    posted_by: null,
    posted_at: null,
    cancelled_by: null,
    cancelled_at: null,
    cancel_reason: null,
    failure_reason: null,
    version: 1,
    created_by: null,
    created_at: null,
    updated_by: null,
    updated_at: null,
    lines: [
      {
        line_id: 1,
        document_id: 412,
        item_id: 33,
        item_label: 'Widget A',
        item_sku: 'WID-A',
        warehouse_id: 5,
        warehouse_name: null,
        dest_warehouse_id: null,
        location_id: null,
        batch_id: null,
        batch_no: null,
        unit_id: null,
        unit_symbol: 'Nos',
        direction: 'out',
        qty: 10,
        conversion_factor: 1,
        base_qty: 10,
        source_transaction_rate: 120,
        source_transaction_amount: 1200,
        valuation_rate: null,
        valuation_amount: null,
        valuation_method_applied: null,
        landed_cost_amount: null,
        book_qty: null,
        physical_qty: null,
        sort_order: 1,
        metadata: null,
        serials: [],
      },
    ],
    ...overrides,
  }
}

describe('buildDocumentSheet — snapshot immutability', () => {
  it('prefers the snapshot even when a live document is also supplied', () => {
    const sheet = buildDocumentSheet({ snapshot: snapshot(), live: liveDocument() })!
    expect(sheet.source).toBe('snapshot')
    expect(sheet.provenance).toContain('Immutable print snapshot')
    expect(sheet.provenance).toContain('dc-v2')
  })

  /**
   * The architectural requirement: a snapshot print must not consult a live
   * master, or renaming a warehouse silently rewrites a challan that was
   * already signed and sent.
   */
  it('never resolves a master when a snapshot exists', () => {
    const warehouseName = vi.fn(() => 'RENAMED WAREHOUSE')
    const sheet = buildDocumentSheet({
      snapshot: snapshot(),
      live: liveDocument(),
      warehouseName,
    })!
    expect(warehouseName).not.toHaveBeenCalled()
    const printed = sheet.rows.map((r) => r.warehouse.text)
    expect(printed).toEqual(['Pune Central', 'Pune Central'])
    expect(JSON.stringify(sheet)).not.toContain('RENAMED WAREHOUSE')
  })

  it('reprints identically after the item master is amended', () => {
    const snap = snapshot()
    const before = buildDocumentSheet({ snapshot: snap, live: null })!
    // The item was renamed and revalued in the masters after posting.
    const amendedLive = liveDocument({
      lines: [
        {
          ...liveDocument().lines[0],
          item_label: 'Widget A (discontinued)',
          source_transaction_rate: 999,
          source_transaction_amount: 9990,
        },
      ],
    })
    const after = buildDocumentSheet({ snapshot: snap, live: amendedLive })!
    expect(after.rows).toEqual(before.rows)
    expect(after.totalsRow).toEqual(before.totalsRow)
    expect(after.rows[0].item.text).toBe('Widget A · WID-A')
    expect(after.rows[0].rate.text).toBe('120.00')
  })

  it('carries the party, warehouse and terms captured at posting time', () => {
    const sheet = buildDocumentSheet({ snapshot: snapshot(), live: null })!
    expect(sheet.blocks.find((b) => b.value === 'Northwind Traders')?.lines).toContain(
      'GSTIN: 27AAAPL1234C1ZV',
    )
    expect(sheet.blocks.map((b) => b.label)).toContain('From')
    expect(sheet.footerPairs).toContainEqual({
      label: 'Terms',
      value: 'Goods once sent are not returnable',
    })
  })

  it('does not repeat the title or the document number as footer pairs', () => {
    const sheet = buildDocumentSheet({ snapshot: snapshot(), live: null })!
    expect(sheet.title).toBe('Delivery challan')
    expect(sheet.footerPairs.map((p) => p.label)).not.toContain('Title')
    expect(sheet.footerPairs).toContainEqual({ label: 'Vehicle no', value: 'MH12AB1234' })
  })

  it('names the variant when the snapshot carries no title', () => {
    const sheet = buildDocumentSheet({
      snapshot: snapshot({ header_snapshot: null, document_variant: 'stock_transfer' }),
      live: null,
    })!
    expect(sheet.title).toBe('Stock transfer')
  })
})

describe('buildDocumentSheet — live fallback', () => {
  it('falls back to the live document and says so on the page', () => {
    const sheet = buildDocumentSheet({ snapshot: null, live: liveDocument() })!
    expect(sheet.source).toBe('live')
    expect(sheet.provenance).toContain('No print snapshot was captured')
    expect(sheet.provenance).toContain('can still change')
  })

  it('resolves the warehouse through the live master, because nothing was captured', () => {
    const warehouseName = vi.fn((id: number | null) => (id === 5 ? 'Pune Central' : ''))
    const sheet = buildDocumentSheet({ snapshot: null, live: liveDocument(), warehouseName })!
    expect(warehouseName).toHaveBeenCalledWith(5)
    expect(sheet.rows[0].warehouse.text).toBe('Pune Central')
    expect(sheet.blocks.find((b) => b.label === 'From')?.value).toBe('Pune Central')
  })

  it('carries the narration and the status', () => {
    const sheet = buildDocumentSheet({ snapshot: null, live: liveDocument() })!
    expect(sheet.headerPairs).toContainEqual({ label: 'Status', value: 'Draft' })
    expect(sheet.footerPairs).toContainEqual({ label: 'Narration', value: 'Urgent despatch' })
  })

  it('returns null when there is nothing at all to print', () => {
    expect(buildDocumentSheet({ snapshot: null, live: null })).toBeNull()
  })
})

describe('documentColumns', () => {
  it('drops the columns no line fills', () => {
    const lines = [
      readLine({ item_name: 'A', qty: 2, unit_symbol: 'Nos' }),
      readLine({ item_name: 'B', qty: 3, unit_symbol: 'Nos' }),
    ]
    expect(documentColumns(lines).map((c) => c.key)).toEqual(['sr', 'item', 'qty'])
  })

  it('adds batch, expiry, rate and amount once a line carries them', () => {
    const lines = [
      readLine({ item_name: 'A', qty: 2, batch_no: 'B1', expiry_date: '2027-01-31', rate: 5, amount: 10 }),
    ]
    expect(documentColumns(lines).map((c) => c.key)).toEqual([
      'sr', 'item', 'batch', 'expiry', 'qty', 'rate', 'amount',
    ])
  })

  it('right-aligns every numeric column', () => {
    const cols = documentColumns([readLine({ item_name: 'A', qty: 1, rate: 2, amount: 2 })])
    expect(cols.filter((c) => ['qty', 'rate', 'amount', 'sr'].includes(c.key)).every((c) => c.align === 'right')).toBe(true)
  })
})

describe('readLine', () => {
  it('probes the aliases a snapshot template may have written', () => {
    const line = readLine({ description: 'Legacy name', quantity: 7, unit_rate: 3, line_amount: 21 })
    expect(line.item).toBe('Legacy name')
    expect(line.qty).toBe(7)
    expect(line.rate).toBe(3)
    expect(line.amount).toBe(21)
  })

  it('never invents a value for a key the snapshot does not carry', () => {
    const line = readLine({ item_name: 'A' })
    expect(line.warehouse).toBe('')
    expect(line.qty).toBeNull()
    expect(line.rate).toBeNull()
    expect(line.amount).toBeNull()
  })

  it('shows the movement direction beside the quantity, but not "none"', () => {
    expect(readLine({ qty: 1, direction: 'out' }).direction).toBe('out')
    expect(readLine({ qty: 1, direction: 'none' }).direction).toBe('')
  })
})

describe('documentTotals', () => {
  it('totals the document’s own lines — it holds all of them', () => {
    const lines = [readLine({ item_name: 'A', qty: 1, amount: 1200 }), readLine({ item_name: 'B', qty: 1, amount: 200 })]
    const cols = documentColumns(lines)
    expect(documentTotals(cols, lines)?.amount).toEqual({ value: 1400, text: '1,400.00' })
  })

  it('has no totals row when the document carries no values', () => {
    const lines = [readLine({ item_name: 'A', qty: 1 })]
    expect(documentTotals(documentColumns(lines), lines)).toBeNull()
  })
})

describe('copy sets', () => {
  it('gives paper that travels with the goods three captioned copies', () => {
    for (const code of ['DELIVERY_CHALLAN', 'STOCK_TRANSFER', 'JOB_WORK_OUT', 'INWARD_CHALLAN', 'PACKING']) {
      expect(defaultCopySet(code)).toBe('goods')
    }
    expect(COPY_SETS.goods).toHaveLength(3)
    expect(COPY_SETS.goods[1]).toContain('Transporter')
  })

  it('prints an internal record once', () => {
    for (const code of ['STOCK_JOURNAL', 'REVALUATION', 'WRITE_OFF', 'PHYSICAL_ADJUSTMENT']) {
      expect(defaultCopySet(code)).toBe('single')
    }
    expect(COPY_SETS.single).toHaveLength(0)
  })

  it('matches the snapshot variant however it is cased', () => {
    expect(defaultCopySet('delivery_challan')).toBe('goods')
    expect(defaultCopySet('Delivery-Challan')).toBe('goods')
    expect(defaultCopySet(null)).toBe('single')
  })

  it('carries the document code so the default can be chosen', () => {
    expect(buildDocumentSheet({ snapshot: snapshot(), live: null })!.documentCode).toBe('delivery_challan')
    expect(buildDocumentSheet({ snapshot: null, live: liveDocument() })!.documentCode).toBe('delivery_challan')
  })
})
