import { describe, expect, it } from 'vitest'
import { LABEL_SIZES, buildLabelSheetHtml } from './serialLabels'

const LABEL = { serialNo: 'SN-AP-MBP-00125', itemName: 'MacBook Pro 14"', sku: 'MBP14-M3P', warrantyUntil: '2028-04-15' }

describe('buildLabelSheetHtml', () => {
  it('prints the number under the barcode, so a smudged label is still usable', () => {
    const html = buildLabelSheetHtml({ labels: [LABEL] })
    expect(html).toContain('<svg')
    expect(html).toContain('SN-AP-MBP-00125')
  })

  it('escapes item names that contain markup characters', () => {
    const html = buildLabelSheetHtml({ labels: [{ ...LABEL, itemName: 'MacBook Pro 14" <b>' }] })
    expect(html).toContain('MacBook Pro 14&quot; &lt;b&gt;')
    expect(html).not.toContain('<b>')
  })

  it('still prints a label whose serial cannot be encoded, saying so', () => {
    // A missing barcode is an inconvenience; a wrong one is a mis-picked
    // shipment.
    const html = buildLabelSheetHtml({ labels: [{ serialNo: 'SN-№1' }] })
    expect(html).toContain('SN-№1')
    expect(html).toContain('No barcode')
    expect(html).not.toContain('<svg')
  })

  it('draws one label per serial at the requested geometry', () => {
    const html = buildLabelSheetHtml({ labels: [LABEL, { serialNo: 'SN-0002' }], size: 'small' })
    expect(html.match(/class="lbl"/g)).toHaveLength(2)
    expect(html).toContain(`width: ${LABEL_SIZES.small.width}mm`)
  })

  it('leaves out the warranty line and the company when asked to', () => {
    const html = buildLabelSheetHtml({ labels: [LABEL], companyName: 'Acme Ltd', showWarranty: false, showCompany: false })
    expect(html).not.toContain('Warranty')
    expect(html).not.toContain('Acme Ltd')
  })

  it('carries the company name when it is wanted', () => {
    const html = buildLabelSheetHtml({ labels: [LABEL], companyName: 'Acme Ltd' })
    expect(html).toContain('Acme Ltd')
    expect(html).toContain('Warranty 15 Apr 2028')
  })

  it('is a self-contained document with nothing to fetch', () => {
    // Labels are printed in a warehouse. Anything the document has to go and
    // get is something that can be missing when the printer is not.
    const html = buildLabelSheetHtml({ labels: [LABEL] })
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<link')
    expect(html).not.toContain('@import')
    expect(html).not.toContain('<img')
    // The one URL in the document is the SVG namespace, which is an identifier
    // and not an address anything is loaded from.
    expect(html.match(/https?:\/\//g)).toEqual(['http://'])
  })

  it('produces an empty sheet rather than throwing when nothing is selected', () => {
    expect(buildLabelSheetHtml({ labels: [] })).toContain('<div class="sheet"></div>')
  })
})
