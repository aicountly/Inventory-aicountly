import { describe, expect, it } from 'vitest'
import { buildBatchLabelSheetHtml } from './batchLabelSheet'

const IDENTITY = { companyName: 'Acme Ltd', scopeLabel: 'Acme Ltd · FY 2026-27 · All branches' }

const LABEL = {
  batch_no: 'BCH-2026-001',
  lot_no: 'LOT-4587',
  item_name: 'Paracetamol 500mg',
  item_sku: 'MED-PARA-500',
  mfg_date: '2026-04-01',
  expiry_date: '2028-03-31',
  on_hand: 1250,
  unit_symbol: 'pcs',
  warehouse_name: 'Main Warehouse',
}

describe('buildBatchLabelSheetHtml', () => {
  it('prints everything the warehouse reads off the carton', () => {
    const html = buildBatchLabelSheetHtml({ ...IDENTITY, labels: [LABEL] })
    expect(html).toContain('Acme Ltd')
    expect(html).toContain('Paracetamol 500mg')
    expect(html).toContain('MED-PARA-500')
    expect(html).toContain('BCH-2026-001')
    expect(html).toContain('LOT-4587')
    expect(html).toContain('01 Apr 2026')
    expect(html).toContain('EXP 31 Mar 2028')
    expect(html).toContain('1,250 pcs')
    expect(html).toContain('Main Warehouse')
  })

  it('carries a scannable barcode beside the human-readable number', () => {
    const html = buildBatchLabelSheetHtml({ ...IDENTITY, labels: [LABEL] })
    expect(html).toContain('aria-label="Barcode BCH-2026-001"')
    expect(html).toContain('<span class="hr">BCH-2026-001</span>')
  })

  it('still prints a label whose batch number cannot be encoded', () => {
    const html = buildBatchLabelSheetHtml({ ...IDENTITY, labels: [{ ...LABEL, batch_no: 'BÊTA-1' }] })
    expect(html).not.toContain('<svg')
    expect(html).toContain('BÊTA-1')
  })

  it('leaves out fields the batch does not have rather than printing a dash', () => {
    const html = buildBatchLabelSheetHtml({
      ...IDENTITY,
      labels: [{ batch_no: 'B-1', item_name: 'Widget' }],
    })
    expect(html).not.toContain('>Lot<')
    expect(html).not.toContain('>Mfg<')
    expect(html).not.toContain('EXP')
  })

  it('escapes text that would otherwise close a tag', () => {
    const html = buildBatchLabelSheetHtml({
      ...IDENTITY,
      labels: [{ batch_no: 'B-1', item_name: '<script>alert(1)</script>' }],
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('says so instead of printing an empty grid', () => {
    const html = buildBatchLabelSheetHtml({ ...IDENTITY, labels: [] })
    expect(html).toContain('No batches selected.')
  })

  it('stamps the scope and the print time in the footer', () => {
    const html = buildBatchLabelSheetHtml({ ...IDENTITY, labels: [LABEL], generatedAt: '21 Sep 2026, 09:00' })
    expect(html).toContain('FY 2026-27')
    expect(html).toContain('Printed 21 Sep 2026, 09:00')
  })
})
