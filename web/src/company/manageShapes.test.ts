import { describe, expect, it } from 'vitest'
import { companyListTotal, formatFyLabel, parseBranchList, parseCompanyInfo, parseCompanyList, pickFyForDate, pickLatestFy, resolveAcsType, toIsoDate } from './manageShapes'

describe('parseCompanyList', () => {
  it('reads the Manage list envelope and maps ownership to acs_type', () => {
    const body = {
      success: '1',
      total: 2,
      data: [
        { comp_id: 12, company_name: 'Acme Ltd', comp_short_name: 'ACME', ownership: 'owner', comp_status: 1 },
        { comp_id: 15, company_name: 'Shared Co', ownership: 'shared' },
      ],
    }
    const rows = parseCompanyList(body)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ cmpId: 12, name: 'Acme Ltd', shortName: 'ACME', ownership: 'owner', acsType: 1, status: 1 })
    expect(rows[1]).toMatchObject({ cmpId: 15, ownership: 'shared', acsType: 0, status: null })
    expect(companyListTotal(body, rows)).toBe(2)
  })

  it('accepts bare arrays, nested companies and single objects; de-duplicates', () => {
    expect(parseCompanyList([{ cmp_id: 3, cmp_name: 'A' }, { cmp_id: 3, cmp_name: 'A again' }])).toHaveLength(1)
    expect(parseCompanyList({ data: { companies: [{ id: 9, name: 'Nine' }] } })[0]).toMatchObject({ cmpId: 9, name: 'Nine' })
    expect(parseCompanyList({ data: { comp_id: 4, comp_name: 'Solo' } })[0]).toMatchObject({ cmpId: 4, name: 'Solo' })
    expect(parseCompanyList({ items: [{ comp_id: 'x' }] })).toEqual([])
    expect(parseCompanyList(null)).toEqual([])
  })

  it('falls back to the row count for the total', () => {
    expect(companyListTotal({ data: [] }, [])).toBe(0)
    expect(companyListTotal({ meta: { total: '7' } }, [])).toBe(7)
  })
})

describe('resolveAcsType', () => {
  it('prefers explicit acs_type, then ownership, then is_creator', () => {
    expect(resolveAcsType({ acs_type: '1', ownership: 'shared' })).toBe(1)
    expect(resolveAcsType({ acs_type: 0, ownership: 'owner' })).toBe(0)
    expect(resolveAcsType({ ownership: 'Owner' })).toBe(1)
    expect(resolveAcsType({ ownership: 'delegated' })).toBe(0)
    expect(resolveAcsType({ is_creator: 'true' })).toBe(1)
    expect(resolveAcsType({})).toBeNull()
  })
})

describe('parseCompanyInfo', () => {
  const info = {
    success: '1',
    data: {
      comp_id: 12,
      cmp_id: 12,
      comp_name: 'Acme Ltd',
      fy_list: [
        { fy_id: 31, fy_start: '2025-04-01', fy_end: '2026-03-31', def_val_method: 'AVG' },
        { fy_id: 30, fy_start: '2024-04-01', fy_end: '2025-03-31' },
      ],
      branch_list: [
        { id: 5, name: 'Head Office' },
        { id: 6, name: 'Depot' },
      ],
    },
  }

  it('extracts name, FYs (latest first) and branches', () => {
    const parsed = parseCompanyInfo(info)
    expect(parsed.cmpId).toBe(12)
    expect(parsed.name).toBe('Acme Ltd')
    expect(parsed.fyList.map((f) => f.fyId)).toEqual([31, 30])
    expect(parsed.fyList[0]).toMatchObject({ start: '2025-04-01', end: '2026-03-31', label: 'FY 2025-26', defaultValuationMethod: 'AVG' })
    expect(parsed.branches).toEqual([
      { boId: 5, name: 'Head Office', isHeadOffice: false },
      { boId: 6, name: 'Depot', isHeadOffice: false },
    ])
  })

  it('tolerates the legacy field names', () => {
    const parsed = parseCompanyInfo({ financial_years: [{ comp_fy_id: 2, fy_beg_date: '2023-04-01 00:00:00', fy_end_date: '2024-03-31 00:00:00' }], branches: [{ bo_id: 1, hobo_name: 'HO', mark_ho: 1 }] })
    expect(parsed.fyList[0]).toMatchObject({ fyId: 2, start: '2023-04-01', end: '2024-03-31', label: 'FY 2023-24' })
    expect(parsed.branches[0]).toEqual({ boId: 1, name: 'HO', isHeadOffice: true })
  })

  it('picks the FY containing a date, else the latest', () => {
    const { fyList } = parseCompanyInfo(info)
    expect(pickFyForDate(fyList, '2024-12-15')?.fyId).toBe(30)
    expect(pickFyForDate(fyList, '2030-01-01')?.fyId).toBe(31)
    expect(pickLatestFy(fyList)?.fyId).toBe(31)
    expect(pickLatestFy([])).toBeNull()
  })
})

describe('parseBranchList', () => {
  it('reads /branch/list rows with head-office flag', () => {
    const rows = parseBranchList({ success: '1', data: [{ bo_id: 9, hobo_name: 'Mumbai', mark_ho: 1 }, { bo_id: 10, hobo_name: 'Pune', mark_ho: 0 }, { bo_id: 9, hobo_name: 'dup' }] })
    expect(rows).toEqual([
      { boId: 9, name: 'Mumbai', isHeadOffice: true },
      { boId: 10, name: 'Pune', isHeadOffice: false },
    ])
  })
})

describe('date helpers', () => {
  it('normalises dates without timezone shift', () => {
    expect(toIsoDate('2025-04-01 00:00:00')).toBe('2025-04-01')
    expect(toIsoDate('')).toBe('')
    expect(toIsoDate('not a date')).toBe('')
  })

  it('labels financial years', () => {
    expect(formatFyLabel('2025-04-01', '2026-03-31')).toBe('FY 2025-26')
    expect(formatFyLabel('2025-01-01', '2025-12-31')).toBe('FY 2025')
    expect(formatFyLabel('', '', 'FY #3')).toBe('FY #3')
  })
})
