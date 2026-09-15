import { describe, expect, it } from 'vitest'
import { parseCompanyAddress, parseCompanyGstin, parseCompanyInfo } from './manageShapes'

/**
 * The letterhead fields Manage sends with `companyinfo`.
 *
 * A printed challan or register carries the registered office and the GSTIN.
 * Manage has grown several shapes for both over the years, and a payload it
 * cannot read degrades to nothing rather than to a half-address.
 */

describe('parseCompanyAddress', () => {
  it('reads a free-text block, one line per line', () => {
    expect(parseCompanyAddress({ data: { ro_address: '12 MG Road\n  Indiranagar  \n\nBengaluru 560038' } })).toEqual([
      '12 MG Road',
      'Indiranagar',
      'Bengaluru 560038',
    ])
  })

  it('reads a structured address object', () => {
    const lines = parseCompanyAddress({
      data: {
        address: { addr1: '12 MG Road', addr2: 'Indiranagar', city: 'Bengaluru', state_name: 'Karnataka', pincode: '560038', country_name: 'India' },
      },
    })
    expect(lines).toEqual(['12 MG Road, Indiranagar', 'Bengaluru, Karnataka, 560038', 'India'])
  })

  it('reads flat ro_ fields left on the root', () => {
    expect(
      parseCompanyAddress({ data: { ro_addr1: 'Plot 4, Phase II', ro_city: 'Pune', ro_pincode: '411057' } }),
    ).toEqual(['Plot 4, Phase II', 'Pune, 411057'])
  })

  it('drops a master id Manage left where a state name belongs', () => {
    expect(parseCompanyAddress({ data: { address: { addr1: 'Plot 4', city: 'Pune', state: 27 } } })).toEqual([
      'Plot 4',
      'Pune',
    ])
  })

  it('keeps the flat root fields the nested object does not carry', () => {
    // Manage sends both shapes at once for companies migrated mid-life: a
    // premises line in `address`, the city and PIN still on the root. Dropping
    // the root half prints a letterhead with no town on it.
    expect(
      parseCompanyAddress({
        data: { ro_city: 'Pune', ro_pincode: '411057', address: { addr1: 'Plot 4' } },
      }),
    ).toEqual(['Plot 4', 'Pune, 411057'])
  })

  it('is empty rather than half an address when Manage sends none', () => {
    expect(parseCompanyAddress({ data: { cmp_id: 9, comp_name: 'Acme Ltd' } })).toEqual([])
    expect(parseCompanyAddress(null)).toEqual([])
  })

  it('does not call a lone master field a registered office', () => {
    // Every company row carries a state and a country whether or not Manage
    // holds an address, so one of them on its own is not one.
    expect(parseCompanyAddress({ data: { country_name: 'India' } })).toEqual([])
    expect(parseCompanyAddress({ data: { state: 'Karnataka' } })).toEqual([])
    expect(parseCompanyAddress({ data: { state: 'Karnataka', country_name: 'India' } })).toEqual([])
    expect(parseCompanyAddress({ data: { address: { country_name: 'India' } } })).toEqual([])
  })

  it('accepts a locality carrying a PIN, which is a postal identity', () => {
    expect(parseCompanyAddress({ data: { ro_city: 'Pune', ro_pincode: '411057' } })).toEqual([
      'Pune, 411057',
    ])
  })
})

describe('parseCompanyGstin', () => {
  it('accepts every spelling Manage uses', () => {
    for (const key of ['gstin', 'gst_no', 'gst_number', 'company_gstin', 'comp_gstin', 'cmp_gstin']) {
      expect(parseCompanyGstin({ data: { [key]: '29AABCU9603R1ZJ' } })).toBe('29AABCU9603R1ZJ')
    }
  })

  it('looks inside a nested company object', () => {
    expect(parseCompanyGstin({ data: { company: { gstin: '27AAACI1195H1Z0' } } })).toBe('27AAACI1195H1Z0')
  })

  it('is empty for an unregistered company', () => {
    expect(parseCompanyGstin({ data: { comp_name: 'Acme Ltd' } })).toBe('')
  })
})

describe('parseCompanyInfo', () => {
  it('surfaces the letterhead alongside the financial years', () => {
    const info = parseCompanyInfo({
      data: {
        cmp_id: 9,
        comp_name: 'Acme Ltd',
        gstin: '29AABCU9603R1ZJ',
        ro_address: '12 MG Road\nBengaluru 560038',
        fy_list: [{ fy_id: 5, fy_start: '2026-04-01', fy_end: '2027-03-31' }],
        branch_list: [{ bo_id: 3, bo_name: 'North', mark_ho: 1 }],
      },
    })
    expect(info.name).toBe('Acme Ltd')
    expect(info.gstin).toBe('29AABCU9603R1ZJ')
    expect(info.addressLines).toEqual(['12 MG Road', 'Bengaluru 560038'])
    expect(info.fyList).toHaveLength(1)
    expect(info.branches).toHaveLength(1)
  })
})
