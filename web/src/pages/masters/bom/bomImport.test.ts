import { describe, expect, it } from 'vitest'
import {
  autoMap,
  buildPlan,
  codesInPlan,
  issuesToCsv,
  missingRequiredFields,
  parseDelimited,
  resolvePlan,
  templateCsv,
  toCreatePayload,
} from './bomImport'
import type { ResolvedItem } from './bomImport'

const HEADER = 'BOM Name,Finished Item Code,Component Item Code,Quantity,Unit,Scrap %,Yield,Line Kind,Status'

function sheet(...rows: string[]) {
  return parseDelimited([HEADER, ...rows].join('\n'))
}

const ITEMS: ResolvedItem[] = [
  { item_id: 900, item_sku: 'CH-1', item_name: 'Office chair', is_active: 1 },
  { item_id: 1, item_sku: 'WS-1', item_name: 'Wooden seat', is_active: 1 },
  { item_id: 2, item_sku: 'ML-1', item_name: 'Metal leg', is_active: 1 },
]

describe('parseDelimited', () => {
  it('handles quoted fields, escaped quotes and embedded separators', () => {
    const parsed = parseDelimited('a,b\n"Bracket, 12"" left",2\n')
    expect(parsed.headers).toEqual(['a', 'b'])
    expect(parsed.rows).toEqual([['Bracket, 12" left', '2']])
  })

  it('reads a tab-separated sheet and strips a BOM marker', () => {
    const parsed = parseDelimited('﻿a\tb\n1\t2\n')
    expect(parsed.headers).toEqual(['a', 'b'])
    expect(parsed.rows).toEqual([['1', '2']])
  })

  it('drops blank lines and CRLF endings', () => {
    const parsed = parseDelimited('a,b\r\n1,2\r\n\r\n')
    expect(parsed.rows).toEqual([['1', '2']])
  })
})

describe('autoMap', () => {
  it('matches a well-formed sheet without the user mapping anything', () => {
    const mapping = autoMap(sheet().headers)
    expect(missingRequiredFields(mapping)).toEqual([])
    expect(mapping.bom_name).toBe(0)
    expect(mapping.scrap_percent).toBe(5)
  })

  it('reports what is still unmatched', () => {
    const mapping = autoMap(['BOM Name', 'Quantity'])
    expect(missingRequiredFields(mapping).map((f) => f.field)).toEqual([
      'finished_item_code',
      'component_item_code',
    ])
  })
})

describe('buildPlan', () => {
  const parsed = sheet(
    'Office chair,CH-1,WS-1,1,pc,0,1,component,active',
    'Office chair,CH-1,ML-1,4,pc,2.5,1,component,',
  )
  const mapping = autoMap(parsed.headers)

  it('groups rows sharing a name into one bill', () => {
    const plan = buildPlan(parsed, mapping)
    expect(plan.issues).toEqual([])
    expect(plan.drafts).toHaveLength(1)
    expect(plan.drafts[0]).toMatchObject({
      bomName: 'Office chair',
      finishedItemCode: 'CH-1',
      yieldQty: 1,
      active: true,
    })
    expect(plan.drafts[0].lines.map((l) => l.componentCode)).toEqual(['WS-1', 'ML-1'])
    expect(plan.drafts[0].lines[1].scrapPercent).toBe(2.5)
  })

  it('rejects a row with a missing code or an unparseable number, naming the sheet row', () => {
    const plan = buildPlan(
      sheet('Chair,CH-1,,1,pc,0,1,component,', 'Chair,CH-1,WS-1,many,pc,0,1,component,'),
      mapping,
    )
    expect(plan.issues.map((i) => [i.row, i.severity])).toEqual([
      [2, 'error'],
      [3, 'error'],
    ])
    expect(plan.issues[1].message).toContain('"many" is not a number')
  })

  it('refuses a bill whose components all have zero quantity', () => {
    const plan = buildPlan(sheet('Chair,CH-1,WS-1,0,pc,0,1,component,'), mapping)
    expect(plan.issues[0].message).toMatch(/no component line with a quantity greater than zero/)
  })

  it('warns rather than silently overriding when a later row disagrees', () => {
    const plan = buildPlan(
      sheet('Chair,CH-1,WS-1,1,pc,0,1,component,', 'Chair,CH-2,ML-1,4,pc,0,1,component,'),
      mapping,
    )
    expect(plan.issues[0].severity).toBe('warning')
    expect(plan.issues[0].message).toContain('"CH-1" is used')
    expect(plan.drafts[0].finishedItemCode).toBe('CH-1')
  })

  it('imports an unrecognised line kind as a component, and says so', () => {
    const plan = buildPlan(sheet('Chair,CH-1,WS-1,1,pc,0,1,widget,'), mapping)
    expect(plan.drafts[0].lines[0].lineKind).toBe('component')
    expect(plan.issues[0].message).toContain('not recognised')
  })

  it('rejects scrap outside 0–100', () => {
    const plan = buildPlan(sheet('Chair,CH-1,WS-1,1,pc,120,1,component,'), mapping)
    expect(plan.issues[0].message).toMatch(/between 0 and 100/)
  })
})

describe('resolvePlan', () => {
  const parsed = sheet('Chair,CH-1,WS-1,1,pc,0,1,component,', 'Stool,CH-1,NOPE-9,1,pc,0,1,component,')
  const plan = buildPlan(parsed, autoMap(parsed.headers))

  it('asks for every distinct code once', () => {
    expect(codesInPlan(plan).sort()).toEqual(['CH-1', 'NOPE-9', 'WS-1'])
  })

  /*
   * A recipe missing one of its components is not a smaller recipe, it is a
   * wrong one — so the whole bill is held back rather than imported partially.
   */
  it('holds back the whole bill when a code does not resolve', () => {
    const resolved = resolvePlan(plan, ITEMS)
    expect(resolved.ready.map((d) => d.bomName)).toEqual(['Chair'])
    expect(resolved.issues[0].message).toContain('"NOPE-9" was not found')
  })

  it('treats a deactivated item as unresolved', () => {
    const resolved = resolvePlan(plan, [...ITEMS, { item_id: 9, item_sku: 'NOPE-9', item_name: 'Gone', is_active: 0 }])
    expect(resolved.ready.map((d) => d.bomName)).toEqual(['Chair'])
    expect(resolved.issues[0].message).toContain('is inactive')
  })

  it('matches codes without regard to case or padding', () => {
    const parsedUpper = sheet('Chair, ch-1 , ws-1 ,1,pc,0,1,component,')
    const planUpper = buildPlan(parsedUpper, autoMap(parsedUpper.headers))
    expect(resolvePlan(planUpper, ITEMS).ready).toHaveLength(1)
  })
})

describe('toCreatePayload', () => {
  const parsed = sheet('Chair,CH-1,WS-1,1,pc,0,1,component,', 'Chair,CH-1,ML-1,4,pc,2.5,1,component,')
  const draft = buildPlan(parsed, autoMap(parsed.headers)).drafts[0]

  it('maps codes to ids and keeps the sheet order', () => {
    expect(toCreatePayload(draft, ITEMS)).toEqual({
      bom_name: 'Chair',
      finished_item_id: 900,
      yield_qty: 1,
      is_active: 0,
      lines: [
        { item_id: 1, qty: 1, line_kind: 'component', scrap_percent: 0, sort_order: 0 },
        { item_id: 2, qty: 4, line_kind: 'component', scrap_percent: 2.5, sort_order: 1 },
      ],
    })
  })

  /*
   * An upload that activated forty manufacturing recipes the moment it landed
   * is one click away from a production run nobody reviewed.
   */
  it('imports inactive unless the sheet asks for active', () => {
    expect(toCreatePayload(draft, ITEMS).is_active).toBe(0)
    const active = sheet('Chair,CH-1,WS-1,1,pc,0,1,component,active')
    expect(toCreatePayload(buildPlan(active, autoMap(active.headers)).drafts[0], ITEMS).is_active).toBe(1)
  })
})

describe('the problem report and the blank template', () => {
  it('writes a file the user can read beside their sheet', () => {
    const csv = issuesToCsv([
      { row: 4, severity: 'error', message: 'Component "X-1" was not found in this company.', bomName: 'Chair', componentCode: 'X-1' },
    ])
    expect(csv.split('\r\n')[0]).toBe('Sheet row,Severity,BOM name,Component code,Problem')
    expect(csv).toContain('4,error,Chair,X-1,')
  })

  it('offers a template whose own header maps cleanly', () => {
    const parsed = parseDelimited(templateCsv())
    expect(missingRequiredFields(autoMap(parsed.headers))).toEqual([])
    // And its example row survives the plan builder without a complaint.
    expect(buildPlan(parsed, autoMap(parsed.headers)).issues).toEqual([])
  })
})
