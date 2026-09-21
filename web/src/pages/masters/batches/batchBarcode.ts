/**
 * Code 39, as SVG.
 *
 * A batch label is useless without a symbol a scanner can read, and the two
 * honest ways to get one are a font or an encoder. Code 39 is the encoder worth
 * writing: 44 fixed nine-element patterns, no checksum, no mode switching, and
 * every handheld scanner in a warehouse reads it out of the box. It covers
 * `0-9 A-Z - . space $ / + %`, which is every batch and lot number this API will
 * accept once it is upper-cased.
 *
 * Deliberately NOT a dependency. Pulling a barcode library into the bundle for
 * one label sheet would cost more than these forty lines, and this way the
 * encoding is unit tested rather than trusted.
 *
 * Anything the symbology cannot carry returns null, and the caller prints the
 * human-readable number alone rather than a symbol that scans as the wrong
 * thing.
 */

/** bar/space/bar… — nine elements per character, three of them wide. */
const PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn',
  '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn',
}

/** Uppercased and stripped to what Code 39 can carry. */
export function normaliseCode39(value: string): string {
  return String(value ?? '').trim().toUpperCase()
}

export function canEncodeCode39(value: string): boolean {
  const text = normaliseCode39(value)
  return text.length > 0 && [...text].every((c) => c in PATTERNS && c !== '*')
}

export interface Code39Bar {
  /** Distance from the left edge, in narrow-module units. */
  x: number
  width: number
}

/** The black bars of the symbol, left to right, in module units. */
export function code39Bars(value: string, wideRatio = 3): Code39Bar[] | null {
  if (!canEncodeCode39(value)) return null
  const chars = ['*', ...normaliseCode39(value), '*']
  const bars: Code39Bar[] = []
  let x = 0
  chars.forEach((char, index) => {
    const pattern = PATTERNS[char]
    for (let i = 0; i < pattern.length; i += 1) {
      const width = pattern[i] === 'w' ? wideRatio : 1
      // Even indexes are bars, odd indexes are the spaces between them.
      if (i % 2 === 0) bars.push({ x, width })
      x += width
    }
    // One narrow space between characters; none after the stop character.
    if (index < chars.length - 1) x += 1
  })
  return bars
}

/** Total width of the symbol in module units — the SVG's viewBox width. */
export function code39Width(value: string, wideRatio = 3): number {
  const bars = code39Bars(value, wideRatio)
  if (!bars) return 0
  const last = bars[bars.length - 1]
  return last.x + last.width
}

/**
 * The symbol as a standalone `<svg>` string, sized in CSS units by the caller.
 *
 * Returns an empty string for anything Code 39 cannot carry, so a label falls
 * back to the printed number instead of a symbol that scans as something else.
 */
export function code39Svg(value: string, options: { height?: number; wideRatio?: number } = {}): string {
  const wideRatio = options.wideRatio ?? 3
  const bars = code39Bars(value, wideRatio)
  if (!bars) return ''
  const height = options.height ?? 40
  const width = code39Width(value, wideRatio)
  const rects = bars
    .map((b) => `<rect x="${b.x}" y="0" width="${b.width}" height="${height}" fill="#000"/>`)
    .join('')
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" role="img" aria-label="Barcode ${normaliseCode39(value)}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`
}
