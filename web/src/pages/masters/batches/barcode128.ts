/**
 * Code 128-B as an SVG path — the barcode on a printed batch label.
 *
 * Written out rather than pulled in: the only thing this screen needs is a
 * linear symbology over a batch number, and a barcode package is tens of
 * kilobytes of encoder for every symbology there is. The encoding is a table
 * and a weighted modulo, both fixed by the standard (ISO/IEC 15417), and both
 * covered by tests.
 *
 * Subset B on purpose: it covers every printable ASCII character, which is
 * exactly the character set `inv_batches.batch_no` is validated to, and it does
 * not need the subset switching that makes a mixed encoder worth a dependency.
 * A batch number carrying a character outside that range is refused rather than
 * silently mangled — a label that scans as the wrong batch is worse than a
 * label with no barcode on it.
 */

/**
 * The 107 symbol patterns, each a run-length string of module widths starting
 * with a bar: `212222` is a 2-wide bar, 1-wide space, 2, 2, 2, 2. Every symbol
 * is 11 modules wide; the stop pattern (106) is 13.
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
] as const

const START_B = 104
const STOP = 106

/** Exposed for the table's own invariants; not meaningful on its own. */
export function code128Pattern(symbol: number): string {
  return PATTERNS[symbol] ?? ''
}

export function isCode128BEncodable(value: string): boolean {
  return value.length > 0 && [...value].every((ch) => {
    const code = ch.charCodeAt(0)
    return code >= 32 && code <= 126
  })
}

/**
 * The symbol values for `value`: start, the data, the modulo-103 check symbol
 * and stop. Returns null when the text cannot be carried by subset B.
 */
export function code128BSymbols(value: string): number[] | null {
  if (!isCode128BEncodable(value)) return null
  const data = [...value].map((ch) => ch.charCodeAt(0) - 32)
  let sum = START_B
  data.forEach((symbol, i) => {
    sum += symbol * (i + 1)
  })
  return [START_B, ...data, sum % 103, STOP]
}

export interface Code128Svg {
  /** Total width in modules — multiply by the module width to size the image. */
  modules: number
  /** `<rect>` runs, in modules: x offset and width of each black bar. */
  bars: { x: number; width: number }[]
}

/** The bar geometry, in modules, for `value`. Null when it cannot be encoded. */
export function code128BGeometry(value: string): Code128Svg | null {
  const symbols = code128BSymbols(value)
  if (!symbols) return null
  const bars: { x: number; width: number }[] = []
  let x = 0
  for (const symbol of symbols) {
    const pattern = PATTERNS[symbol]
    for (let i = 0; i < pattern.length; i += 1) {
      const width = Number(pattern[i])
      // Even index = bar, odd = space. Only the bars are drawn.
      if (i % 2 === 0) bars.push({ x, width })
      x += width
    }
  }
  return { modules: x, bars }
}

export interface Code128SvgOptions {
  /** Module width in millimetres. 0.33mm is a common label-printer minimum. */
  moduleMm?: number
  heightMm?: number
  /** Quiet zone either side, in modules. The standard asks for at least 10. */
  quietModules?: number
}

/**
 * A standalone `<svg>` string for `value`, or an empty string when the text
 * cannot be encoded — the caller prints the human-readable number either way.
 */
export function code128BSvg(value: string, options: Code128SvgOptions = {}): string {
  const { moduleMm = 0.33, heightMm = 12, quietModules = 10 } = options
  const geometry = code128BGeometry(value)
  if (!geometry) return ''
  const total = geometry.modules + quietModules * 2
  const rects = geometry.bars
    .map((bar) => `<rect x="${bar.x + quietModules}" y="0" width="${bar.width}" height="10" />`)
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} 10" preserveAspectRatio="none" ` +
    `width="${(total * moduleMm).toFixed(2)}mm" height="${heightMm}mm" role="img" ` +
    `aria-label="Barcode ${value}"><g fill="#000">${rects}</g></svg>`
  )
}
