import { describe, expect, it } from 'vitest'
import { canEncodeCode39, code39Bars, code39Svg, code39Width, normaliseCode39 } from './batchBarcode'

/**
 * A label nobody can scan is worse than no label, and a wrong symbol is worse
 * again — it scans as a batch that exists. So the table is checked against the
 * two structural invariants that define Code 39 rather than against itself: a
 * typo in one of forty-four patterns fails here instead of at a loading bay.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%'

/**
 * The four that break the usual shape.
 *
 * Every other Code 39 character is two wide bars and one wide space; these are
 * zero wide bars and three wide spaces. Spelled out here because a reader (or a
 * future edit) will otherwise "fix" the table to match the majority.
 */
const SPACE_CODED = '$/+%'

/** 6 narrow + 3 wide, at a 3:1 ratio — the same for every character. */
const MODULES_PER_CHAR = 6 * 1 + 3 * 3

describe('the Code 39 alphabet', () => {
  it.each([...ALPHABET.replace(' ', '')])('character %s carries the right wide bars', (char) => {
    const bars = code39Bars(char)
    expect(bars).not.toBeNull()
    const list = bars as NonNullable<typeof bars>
    // The character sits between the start and stop delimiters.
    expect(list).toHaveLength(3 * 5)
    const middle = list.slice(5, 10)
    expect(middle.filter((b) => b.width === 3)).toHaveLength(SPACE_CODED.includes(char) ? 0 : 2)
  })

  it('is exactly as wide as the arithmetic says, for every character', () => {
    for (const char of ALPHABET.replace(' ', '')) {
      // start + char + stop = 3 characters and 2 inter-character gaps. Only a
      // 6-narrow / 3-wide split produces this width, which pins the spaces —
      // including the three-wide-space characters the test above allows for.
      expect(code39Width(char)).toBe(3 * MODULES_PER_CHAR + 2)
    }
  })

  it('carries a space inside a code, although a code cannot be only spaces', () => {
    expect(code39Width('BCH 001')).toBe(9 * MODULES_PER_CHAR + 8)
    expect(canEncodeCode39(' ')).toBe(false)
    expect(canEncodeCode39('   ')).toBe(false)
  })

  it('grows by one character and one gap for each character added', () => {
    expect(code39Width('AB')).toBe(code39Width('A') + MODULES_PER_CHAR + 1)
    expect(code39Width('BCH-2026-001')).toBe(14 * MODULES_PER_CHAR + 13)
  })

  it('draws bars and spaces alternately, starting and ending with a bar', () => {
    const bars = code39Bars('BCH-2026-001')
    expect(bars).not.toBeNull()
    const list = bars as NonNullable<typeof bars>
    expect(list[0].x).toBe(0)
    // 14 characters × 5 bars.
    expect(list).toHaveLength(14 * 5)
    // No two bars touch: a gap of at least one narrow module sits between them.
    for (let i = 1; i < list.length; i += 1) {
      expect(list[i].x).toBeGreaterThanOrEqual(list[i - 1].x + list[i - 1].width + 1)
    }
    const last = list[list.length - 1]
    expect(last.x + last.width).toBe(code39Width('BCH-2026-001'))
  })

  it('uses only narrow and wide elements at the declared ratio', () => {
    const widths = new Set((code39Bars('BCH-2026-001') ?? []).map((b) => b.width))
    expect([...widths].sort()).toEqual([1, 3])
  })
})

describe('what it will and will not encode', () => {
  it('upper-cases before encoding, so a lower-case batch number still scans', () => {
    expect(normaliseCode39(' bch-2026-001 ')).toBe('BCH-2026-001')
    expect(code39Bars('bch-2026-001')).toEqual(code39Bars('BCH-2026-001'))
  })

  it('refuses the delimiter, so a batch number cannot terminate its own symbol', () => {
    expect(canEncodeCode39('BCH*001')).toBe(false)
    expect(code39Bars('BCH*001')).toBeNull()
  })

  it('refuses characters the symbology cannot carry, rather than dropping them', () => {
    for (const bad of ['BCH#1', 'BCH_1', 'BATCH(1)', 'café', '']) {
      expect(canEncodeCode39(bad)).toBe(false)
      expect(code39Svg(bad)).toBe('')
    }
  })
})

describe('the SVG', () => {
  it('sizes its viewBox to the symbol and labels itself for a screen reader', () => {
    const svg = code39Svg('BCH-2026-001', { height: 34 })
    expect(svg).toContain(`viewBox="0 0 ${code39Width('BCH-2026-001')} 34"`)
    expect(svg).toContain('aria-label="Barcode BCH-2026-001"')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    // One rect per bar, all black — a tinted barcode is a barcode that fails.
    expect(svg.match(/<rect /g)).toHaveLength(14 * 5)
    expect(svg).not.toMatch(/fill="(?!#000)/)
  })
})
