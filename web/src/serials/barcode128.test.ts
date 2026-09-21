import { describe, expect, it } from 'vitest'
import {
  CODE128_PATTERNS,
  barcodePatternsAreWellFormed,
  code128Modules,
  code128Svg,
  encodeCode128B,
} from './barcode128'

describe('the Code 128 pattern table', () => {
  // A mistyped width makes an unscannable label that looks perfectly fine on
  // screen and on paper. Every pattern in the symbology is 11 modules wide
  // (the stop is 13) across exactly 6 bars and spaces (7 for the stop), so a
  // single-digit typo cannot satisfy both and this catches it at build time.
  it('is structurally sound', () => {
    expect(barcodePatternsAreWellFormed()).toEqual([])
  })

  it('has 107 entries, the last of which is the stop pattern', () => {
    expect(CODE128_PATTERNS).toHaveLength(107)
    expect(CODE128_PATTERNS[106]).toBe('2331112')
  })
})

describe('encodeCode128B', () => {
  it('computes the check digit by the spec formula, verifiable by hand', () => {
    // "CODE128": start B (104), then C O D E 1 2 8 as ASCII − 32, then the
    // modulo-103 weighted sum, then stop (106).
    //   104 + 1×35 + 2×47 + 3×36 + 4×37 + 5×17 + 6×18 + 7×24 = 850
    //   850 mod 103 = 26
    const codes = encodeCode128B('CODE128')
    expect(codes).toEqual([104, 35, 47, 36, 37, 17, 18, 24, 26, 106])
  })

  it('weights each character by its position, not merely by its value', () => {
    // Two strings with the same characters in a different order must not share
    // a check digit — that is the whole point of the weighting, and dropping
    // the multiplier is the easy way to break this silently.
    expect(encodeCode128B('AB')?.at(-2)).not.toBe(encodeCode128B('BA')?.at(-2))
  })

  it('encodes a serial with hyphens and digits', () => {
    const codes = encodeCode128B('SN-AP-MBP-00125')
    expect(codes?.[0]).toBe(104)
    expect(codes?.at(-1)).toBe(106)
    // start + 15 characters + check + stop
    expect(codes).toHaveLength(18)
    expect(codes?.at(-2)).toBeGreaterThanOrEqual(0)
    expect(codes?.at(-2)).toBeLessThan(103)
  })

  it('refuses a value it cannot encode rather than dropping characters', () => {
    // A barcode that scans as a different serial to the one printed under it
    // is worse than no barcode at all.
    expect(encodeCode128B('SN-№1')).toBeNull()
    expect(encodeCode128B('SN\n01')).toBeNull()
    expect(encodeCode128B('')).toBeNull()
  })
})

describe('code128Modules', () => {
  it('flattens to bar/space widths, starting and ending with a bar', () => {
    const modules = code128Modules('A')
    expect(modules).not.toBeNull()
    // start + 'A' + check + stop = 6 + 6 + 6 + 7 elements
    expect(modules).toHaveLength(25)
    // The stop pattern ends on a bar, which is what terminates the symbol.
    expect(modules?.length && modules.length % 2).toBe(1)
  })
})

describe('code128Svg', () => {
  it('draws bars only, in a viewBox wide enough for the quiet zones', () => {
    const svg = code128Svg('SN-0001', { moduleWidth: 2, height: 30, quietZone: 10 })
    expect(svg).toContain('<svg')
    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-label="Barcode SN-0001"')
    expect(svg).toContain('height="30"')
    const modules = code128Modules('SN-0001') as number[]
    const width = (modules.reduce((a, b) => a + b, 0) + 20) * 2
    expect(svg).toContain(`viewBox="0 0 ${width} 30"`)
  })

  it('returns null for a value the symbology cannot carry', () => {
    expect(code128Svg('SN-№1')).toBeNull()
  })

  it('escapes the serial in the label — this markup is injected as HTML', () => {
    // Code 128-B's own alphabet includes `"`, `<` and `&`, and the result is
    // written into a print document and into the preview with
    // dangerouslySetInnerHTML.
    const svg = code128Svg('SN"><script>&') as string
    expect(svg).toContain('aria-label="Barcode SN&quot;&gt;&lt;script&gt;&amp;"')
    expect(svg).not.toContain('<script>')
  })
})
