import { describe, expect, it } from 'vitest'
import { generateSerialRange, parseSerialInput } from './serials'

describe('parseSerialInput', () => {
  it('splits on newlines, commas, semicolons and tabs and trims', () => {
    expect(parseSerialInput(' A1 \nB2,C3;D4\tE5\r\n').serials).toEqual(['A1', 'B2', 'C3', 'D4', 'E5'])
  })

  it('reports repeats once and keeps first-seen order', () => {
    const parsed = parseSerialInput('X\nY\nX\nZ\nY\nX')
    expect(parsed.serials).toEqual(['X', 'Y', 'Z'])
    expect(parsed.duplicates).toEqual(['X', 'Y'])
  })

  it('sets aside values longer than the API accepts', () => {
    const long = 'L'.repeat(129)
    const parsed = parseSerialInput(`ok\n${long}`)
    expect(parsed.serials).toEqual(['ok'])
    expect(parsed.tooLong).toEqual([long])
  })

  it('handles empty input', () => {
    expect(parseSerialInput('')).toEqual({ serials: [], duplicates: [], tooLong: [] })
  })
})

describe('generateSerialRange', () => {
  it('pads and wraps with prefix and suffix', () => {
    expect(generateSerialRange({ prefix: 'SN-', suffix: '/A', start: 8, end: 11, pad: 4 })).toEqual(['SN-0008/A', 'SN-0009/A', 'SN-0010/A', 'SN-0011/A'])
    expect(generateSerialRange({ prefix: '', suffix: '', start: 1, end: 2, pad: 0 })).toEqual(['1', '2'])
  })

  it('rejects invalid or oversized ranges', () => {
    expect(generateSerialRange({ prefix: '', suffix: '', start: 5, end: 4, pad: 0 })).toEqual([])
    expect(generateSerialRange({ prefix: '', suffix: '', start: -1, end: 4, pad: 0 })).toEqual([])
    expect(generateSerialRange({ prefix: '', suffix: '', start: 1, end: 10, pad: 0 }, 5)).toEqual([])
  })
})
