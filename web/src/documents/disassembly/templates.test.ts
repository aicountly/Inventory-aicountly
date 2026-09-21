import { describe, expect, it } from 'vitest'
import { parseImportText } from './templates'

describe('parseImportText', () => {
  it('reads comma, tab and semicolon separated rows', () => {
    expect(parseImportText('MB-001,1\nDP-001\t2\nKB-001;3').map((r) => [r.code, r.qty])).toEqual([
      ['MB-001', 1],
      ['DP-001', 2],
      ['KB-001', 3],
    ])
  })

  it('skips a spreadsheet header row', () => {
    expect(parseImportText('SKU,Qty\nMB-001,1')).toHaveLength(1)
  })

  it('skips blank lines and strips quotes', () => {
    const rows = parseImportText('\n"MB-001","2"\n\n')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ code: 'MB-001', qty: 2 })
  })

  it('leaves a missing quantity null rather than guessing', () => {
    expect(parseImportText('MB-001')[0].qty).toBeNull()
  })

  it('keeps the warehouse column when there is one', () => {
    expect(parseImportText('MB-001,1,MAIN')[0].warehouse).toBe('MAIN')
  })
})
