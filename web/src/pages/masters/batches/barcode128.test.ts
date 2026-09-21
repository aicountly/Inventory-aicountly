import { describe, expect, it } from 'vitest'
import { code128BGeometry, code128BSvg, code128BSymbols, code128Pattern, isCode128BEncodable } from './barcode128'

describe('the Code 128 pattern table', () => {
  /*
   * The table is 107 transcribed constants, and a single mistyped digit would
   * produce a barcode that scans as a different batch. These are the standard's
   * own invariants, so a typo cannot survive them silently.
   */
  it('has 107 symbols', () => {
    expect(code128Pattern(106)).not.toBe('')
    expect(code128Pattern(107)).toBe('')
  })

  it('makes every data symbol 11 modules over six runs, and the stop 13 over seven', () => {
    for (let symbol = 0; symbol <= 105; symbol += 1) {
      const pattern = code128Pattern(symbol)
      const widths = [...pattern].map(Number)
      expect(widths, `symbol ${symbol}`).toHaveLength(6)
      expect(widths.every((w) => w >= 1 && w <= 4), `symbol ${symbol}`).toBe(true)
      expect(widths.reduce((a, b) => a + b, 0), `symbol ${symbol}`).toBe(11)
    }
    const stop = [...code128Pattern(106)].map(Number)
    expect(stop).toHaveLength(7)
    expect(stop.reduce((a, b) => a + b, 0)).toBe(13)
  })

  it('keeps the even bar-parity every Code 128 symbol has', () => {
    for (let symbol = 0; symbol <= 105; symbol += 1) {
      const widths = [...code128Pattern(symbol)].map(Number)
      const bars = widths[0] + widths[2] + widths[4]
      expect(bars % 2, `symbol ${symbol}`).toBe(0)
    }
  })

  it('has no duplicate patterns', () => {
    const seen = new Set<string>()
    for (let symbol = 0; symbol <= 106; symbol += 1) seen.add(code128Pattern(symbol))
    expect(seen.size).toBe(107)
  })
})

describe('code128BSymbols', () => {
  it('wraps the data in start B, the modulo-103 check and stop', () => {
    // The standard's worked example: "Wikipedia" in subset B checks to 88.
    expect(code128BSymbols('Wikipedia')).toEqual([104, 55, 73, 75, 73, 80, 69, 68, 73, 65, 88, 106])
  })

  it('encodes a batch number', () => {
    const symbols = code128BSymbols('BCH-2026-001')
    expect(symbols?.[0]).toBe(104)
    expect(symbols?.at(-1)).toBe(106)
    expect(symbols).toHaveLength(12 + 3)
    // 'B' is 66 - 32 = 34, and the check symbol is always in 0..102.
    expect(symbols?.[1]).toBe(34)
    expect(symbols?.at(-2)).toBeGreaterThanOrEqual(0)
    expect(symbols?.at(-2)).toBeLessThan(103)
  })

  it('refuses text subset B cannot carry rather than mangling it', () => {
    expect(isCode128BEncodable('BCH-1')).toBe(true)
    expect(isCode128BEncodable('')).toBe(false)
    expect(isCode128BEncodable('café')).toBe(false)
    expect(isCode128BEncodable('line\nbreak')).toBe(false)
    expect(code128BSymbols('café')).toBeNull()
  })
})

describe('code128BSvg', () => {
  it('starts and ends with a bar, and spans the encoded width', () => {
    const geometry = code128BGeometry('BCH-2026-001')
    expect(geometry).not.toBeNull()
    // Start + 12 data + check = 14 symbols of 11 modules, plus a 13-module stop.
    expect(geometry?.modules).toBe(14 * 11 + 13)
    expect(geometry?.bars[0]).toEqual({ x: 0, width: 2 })
  })

  it('renders an svg sized in millimetres with the value as its label', () => {
    const svg = code128BSvg('BCH-2026-001', { moduleMm: 0.33, heightMm: 12 })
    expect(svg).toContain('<svg')
    expect(svg).toContain('aria-label="Barcode BCH-2026-001"')
    expect(svg).toContain('height="12mm"')
    expect(svg.match(/<rect/g)?.length).toBe(code128BGeometry('BCH-2026-001')?.bars.length)
  })

  it('returns nothing it cannot encode, so the caller can fall back to text', () => {
    expect(code128BSvg('café')).toBe('')
  })
})
