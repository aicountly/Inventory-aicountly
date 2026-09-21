import { describe, expect, it } from 'vitest'
import { buildImportPlan, parseCsv, parseStatus } from './stockCategoryImport'
import type { StockCategory } from '../../../services/masters'

/**
 * The import's whole promise is that the summary shown before the first write
 * is the truth about the file. These tests hold that promise: a row that will
 * be refused is listed as refused *before* anything is sent, a column
 * Inventory does not store is reported rather than swallowed, and a name that
 * already exists is caught here with the same case-insensitive rule the API
 * applies — so the reader does not learn it from a 409 half way through.
 */

const existing: StockCategory[] = [
  { stock_cat_id: 1, cat_name: 'Raw Material', cat_alias: 'RM', is_active: 1 },
]

describe('parseCsv', () => {
  it('reads quoted fields, embedded commas and doubled quotes', () => {
    expect(parseCsv('a,"b,c","say ""hi"""')).toEqual([['a', 'b,c', 'say "hi"']])
  })

  it('reads CRLF and LF alike, and drops the trailing newline', () => {
    expect(parseCsv('a,b\r\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
})

describe('parseStatus', () => {
  it('accepts the words and the flags', () => {
    expect(parseStatus('Active').isActive).toBe(1)
    expect(parseStatus('inactive').isActive).toBe(0)
    expect(parseStatus('0').isActive).toBe(0)
    expect(parseStatus('').isActive).toBe(1)
  })

  it('warns rather than silently guessing at a word it does not know', () => {
    const { isActive, issue } = parseStatus('archived')
    expect(isActive).toBe(1)
    expect(issue?.level).toBe('warning')
    expect(issue?.message).toContain('archived')
  })
})

describe('buildImportPlan', () => {
  it('plans the rows it can create', () => {
    const plan = buildImportPlan('Category Name,Alias,Status\nSpare Parts,SP,Active\n', existing)
    expect(plan.valid).toHaveLength(1)
    expect(plan.invalid).toHaveLength(0)
    expect(plan.valid[0]).toMatchObject({ name: 'Spare Parts', alias: 'SP', isActive: 1, line: 2 })
  })

  it('refuses a file with no category name column, and says which headers work', () => {
    const plan = buildImportPlan('Alias,Status\nSP,Active\n', existing)
    expect(plan.fileIssues[0]?.level).toBe('error')
    expect(plan.fileIssues[0]?.message).toContain('Category Name'.toLowerCase())
    expect(plan.rows).toHaveLength(0)
  })

  it('reports a column Inventory does not store instead of dropping it quietly', () => {
    const plan = buildImportPlan('Category Name,Description\nSpare Parts,Bits and pieces\n', existing)
    const warning = plan.fileIssues.find((i) => i.message.includes('Description'))
    expect(warning?.level).toBe('warning')
    expect(plan.valid).toHaveLength(1)
  })

  it('catches a name that already exists, case-insensitively', () => {
    const plan = buildImportPlan('Category Name\nraw material\n', existing)
    expect(plan.invalid).toHaveLength(1)
    expect(plan.invalid[0]?.issues[0]?.message).toContain('already exists')
  })

  it('catches the same category twice in one file and names the earlier line', () => {
    const plan = buildImportPlan('Category Name\nSpare Parts\nspare parts\n', existing)
    expect(plan.valid).toHaveLength(1)
    expect(plan.invalid).toHaveLength(1)
    expect(plan.invalid[0]?.issues[0]?.message).toContain('line 2')
  })

  it('refuses a row with no name, and one whose alias is too long', () => {
    const plan = buildImportPlan(`Category Name,Alias\n,SP\nLong Alias,${'x'.repeat(65)}\n`, existing)
    expect(plan.invalid).toHaveLength(2)
    expect(plan.invalid[0]?.issues[0]?.message).toContain('required')
    expect(plan.invalid[1]?.issues[0]?.message).toContain('64')
  })

  it('counts a blank line rather than skipping past it', () => {
    const plan = buildImportPlan('Category Name\nSpare Parts\n\nTrading Goods\n', existing)
    expect(plan.rows).toHaveLength(3)
    expect(plan.invalid).toHaveLength(1)
    expect(plan.invalid[0]?.issues[0]?.message).toContain('Blank line')
  })

  it('separates a warned row from a refused one', () => {
    const plan = buildImportPlan('Category Name,Status\nSpare Parts,archived\n', existing)
    expect(plan.invalid).toHaveLength(0)
    expect(plan.warned).toHaveLength(1)
    expect(plan.valid).toHaveLength(1)
  })
})
