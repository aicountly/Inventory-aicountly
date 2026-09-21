import { describe, expect, it } from 'vitest'
import {
  BRAND_IMPORT_LIMITS,
  EMPTY_MAPPING,
  autoMapColumns,
  brandImportTemplateCsv,
  buildImportRows,
  detectDelimiter,
  importRowPayload,
  parseActiveFlag,
  parseDelimited,
} from './brandImport'

describe('detectDelimiter', () => {
  it('reads the header line, not the whole file', () => {
    expect(detectDelimiter('a,b,c\n1;2;3;4;5;6')).toBe(',')
  })

  it('handles the European semicolon export and a pasted tab block', () => {
    expect(detectDelimiter('Brand;Alias\nApple;APPLE')).toBe(';')
    expect(detectDelimiter('Brand\tAlias\nApple\tAPPLE')).toBe('\t')
  })

  it('falls back to a comma for a single-column file', () => {
    expect(detectDelimiter('Brand\nApple')).toBe(',')
  })
})

describe('parseDelimited', () => {
  it('reads a plain CSV', () => {
    expect(parseDelimited('Brand,Alias\r\nApple,APPLE\r\nSony,SONY\r\n')).toEqual([
      ['Brand', 'Alias'],
      ['Apple', 'APPLE'],
      ['Sony', 'SONY'],
    ])
  })

  it('keeps a comma inside a quoted field', () => {
    const [, row] = parseDelimited('Brand,Description\nApple,"Phones, tablets and laptops"')
    expect(row).toEqual(['Apple', 'Phones, tablets and laptops'])
  })

  it('unescapes a doubled quote and keeps a newline inside quotes', () => {
    const [, row] = parseDelimited('Brand,Description\nApple,"Said ""hello""\nthen left"')
    expect(row[1]).toBe('Said "hello"\nthen left')
  })

  it('strips a UTF-8 BOM so the first header is still recognisable', () => {
    expect(parseDelimited('﻿Brand,Alias\nApple,APPLE')[0][0]).toBe('Brand')
  })

  it('drops blank lines rather than importing empty brands', () => {
    expect(parseDelimited('Brand\nApple\n\n\nSony\n')).toEqual([['Brand'], ['Apple'], ['Sony']])
  })
})

describe('autoMapColumns', () => {
  it('matches the spellings people actually use', () => {
    expect(autoMapColumns(['Brand Name', 'Short Name', 'Code', 'Notes', 'Status'])).toEqual({
      brand_name: 0,
      brand_alias: 1,
      brand_code: 2,
      description: 3,
      is_active: 4,
    })
  })

  it('ignores case, underscores and padding', () => {
    expect(autoMapColumns(['  BRAND_NAME ', 'IS ACTIVE']).brand_name).toBe(0)
    expect(autoMapColumns(['  BRAND_NAME ', 'IS ACTIVE']).is_active).toBe(1)
  })

  it('leaves a field unmatched rather than guessing at an unknown header', () => {
    const mapping = autoMapColumns(['Column 1', 'Column 2'])
    expect(mapping).toEqual(EMPTY_MAPPING)
  })

  it('never assigns one column to two fields', () => {
    const mapping = autoMapColumns(['name', 'name'])
    const used = Object.values(mapping).filter((i) => i >= 0)
    expect(new Set(used).size).toBe(used.length)
  })
})

describe('parseActiveFlag', () => {
  it('reads the words and the numbers', () => {
    for (const on of ['Active', 'active', '1', 'yes', 'Y', 'TRUE', 'enabled']) {
      expect(parseActiveFlag(on)).toBe(1)
    }
    for (const off of ['Inactive', '0', 'no', 'false', 'disabled']) {
      expect(parseActiveFlag(off)).toBe(0)
    }
  })

  it('defaults a blank cell to active, which is what the API does', () => {
    expect(parseActiveFlag('')).toBe(1)
    expect(parseActiveFlag('   ')).toBe(1)
  })
})

describe('buildImportRows', () => {
  const mapping = { brand_name: 0, brand_alias: 1, brand_code: 2, description: -1, is_active: -1 }

  it('numbers the rows as the reader sees them in the file', () => {
    const rows = buildImportRows([['Apple', 'APPLE', 'APL']], mapping)
    expect(rows[0].line).toBe(2)
  })

  it('blames the missing name and stops looking at that row', () => {
    const [row] = buildImportRows([['   ', 'X', 'Y']], mapping)
    expect(row.problem).toEqual({ field: 'brand_name', message: 'Brand name is required' })
  })

  it('catches an over-long value before the database does', () => {
    const long = 'x'.repeat(BRAND_IMPORT_LIMITS.brand_alias + 1)
    const [row] = buildImportRows([['Apple', long, '']], mapping)
    expect(row.problem?.field).toBe('brand_alias')
  })

  it('names the earlier line when a name repeats inside the file', () => {
    const rows = buildImportRows([['Apple', '', ''], ['apple', '', '']], mapping)
    expect(rows[0].problem).toBeNull()
    expect(rows[1].problem).toEqual({ field: 'brand_name', message: 'Same brand name as line 2' })
  })

  it('catches a repeated code but lets several rows leave it blank', () => {
    const rows = buildImportRows(
      [['A', '', 'X'], ['B', '', 'x'], ['C', '', ''], ['D', '', '']],
      mapping,
    )
    expect(rows[1].problem?.field).toBe('brand_code')
    expect(rows[2].problem).toBeNull()
    expect(rows[3].problem).toBeNull()
  })

  it('returns the broken rows too, so nothing disappears from the preview', () => {
    const rows = buildImportRows([['Apple', '', ''], ['', '', ''], ['Sony', '', '']], mapping)
    expect(rows).toHaveLength(3)
  })

  it('does not check whether a brand already exists — only the server can', () => {
    const [row] = buildImportRows([['Samsung', '', '']], mapping)
    expect(row.problem).toBeNull()
  })
})

describe('importRowPayload', () => {
  it('sends blanks as null rather than empty strings', () => {
    const [row] = buildImportRows([['Apple', '', '']], { ...EMPTY_MAPPING, brand_name: 0, brand_alias: 1, brand_code: 2 })
    expect(importRowPayload(row)).toEqual({
      brand_name: 'Apple',
      brand_alias: null,
      brand_code: null,
      description: null,
      is_active: 1,
    })
  })
})

describe('brandImportTemplateCsv', () => {
  it('is a file this module can read back', () => {
    const table = parseDelimited(brandImportTemplateCsv())
    const mapping = autoMapColumns(table[0])
    expect(mapping.brand_name).toBe(0)
    const rows = buildImportRows(table.slice(1), mapping)
    expect(rows.every((r) => r.problem === null)).toBe(true)
    expect(rows.map((r) => r.is_active)).toEqual([1, 0])
  })
})
