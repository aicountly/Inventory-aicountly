/**
 * Code 128-B, as SVG.
 *
 * A warehouse label with the number printed on it but no barcode is a label
 * somebody has to key in, which is the error this whole module exists to
 * remove. Encoding it here rather than adding a barcode package is a deliberate
 * trade: the symbology is a fixed published table and about sixty lines of
 * arithmetic, and the alternative was a dependency in the bundle of every
 * screen for the sake of one print dialog.
 *
 * Code 128-B covers ASCII 32–126 — letters, digits, hyphens, slashes, the
 * manufacturer formats real serials actually use. A character outside that
 * range cannot be encoded, and `encodeCode128B` returns null rather than
 * dropping it: a barcode that scans as a DIFFERENT serial to the one printed
 * beneath it is the one outcome this file may not produce.
 */

/**
 * The 107 patterns, as bar/space module widths.
 *
 * Index 0–102 are the data characters, 103–105 the start codes, 106 the stop.
 * Each pattern alternates bar, space, bar, … and every one is 11 modules wide
 * (the stop is 13). `barcodePatternsAreWellFormed` asserts both, which is what
 * makes a typo in this table a failing test rather than an unscannable label.
 */
export const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

const START_B = 104
const STOP = 106

/**
 * The code values for a string: start, the characters, the check digit, stop.
 *
 * Null when any character is outside Code 128-B's range, so the caller can fall
 * back to printing the number alone instead of a barcode that means something
 * else.
 */
export function encodeCode128B(value: string): number[] | null {
  if (value === '') return null
  const codes: number[] = [START_B]
  for (const char of value) {
    const point = char.codePointAt(0) ?? -1
    if (point < 32 || point > 126) return null
    codes.push(point - 32)
  }
  // Modulo-103 weighted sum: the start code counts once, then each character
  // by its 1-based position.
  let checksum = START_B
  for (let i = 1; i < codes.length; i += 1) checksum += codes[i] * i
  codes.push(checksum % 103)
  codes.push(STOP)
  return codes
}

/** The bar/space widths for a value, flattened — bar first, then alternating. */
export function code128Modules(value: string): number[] | null {
  const codes = encodeCode128B(value)
  if (!codes) return null
  const widths: number[] = []
  for (const code of codes) {
    for (const digit of CODE128_PATTERNS[code]) widths.push(Number(digit))
  }
  return widths
}

const ATTRIBUTE_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ATTRIBUTE_ESCAPES[ch] ?? ch)
}

export interface BarcodeSvgOptions {
  /** Width of one module in user units. */
  moduleWidth?: number
  height?: number
  /** Blank margin at each end, in modules. The spec asks for at least 10. */
  quietZone?: number
}

/**
 * A standalone `<svg>` for a value, or null when it cannot be encoded.
 *
 * Deliberately plain markup with no external reference: it is written into a
 * print document that has to render with no network and no stylesheet of ours.
 */
export function code128Svg(value: string, options: BarcodeSvgOptions = {}): string | null {
  const modules = code128Modules(value)
  if (!modules) return null
  const moduleWidth = options.moduleWidth ?? 1
  const height = options.height ?? 40
  const quiet = options.quietZone ?? 10
  const total = modules.reduce((sum, n) => sum + n, 0) + quiet * 2
  const rects: string[] = []
  let x = quiet
  modules.forEach((width, index) => {
    // Even indexes are bars, odd ones the spaces between them.
    if (index % 2 === 0) rects.push(`<rect x="${x * moduleWidth}" y="0" width="${width * moduleWidth}" height="${height}"/>`)
    x += width
  })
  const svgWidth = total * moduleWidth
  // The serial goes into an attribute, and Code 128-B's own alphabet includes
  // `"`, `<` and `&`. This markup is written into a print document and into the
  // preview with dangerouslySetInnerHTML, so it is escaped here rather than at
  // each call site — one of which would eventually forget.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${height}" width="${svgWidth}" height="${height}" role="img" aria-label="Barcode ${escapeAttribute(value)}" preserveAspectRatio="none" shape-rendering="crispEdges" fill="#000">${rects.join('')}</svg>`
}

/** Structural check over the table — exported so the test can assert it. */
export function barcodePatternsAreWellFormed(): string[] {
  const problems: string[] = []
  if (CODE128_PATTERNS.length !== 107) problems.push(`expected 107 patterns, found ${CODE128_PATTERNS.length}`)
  CODE128_PATTERNS.forEach((pattern, index) => {
    const isStop = index === 106
    const expectedLength = isStop ? 7 : 6
    const expectedModules = isStop ? 13 : 11
    if (pattern.length !== expectedLength) problems.push(`pattern ${index} has ${pattern.length} elements, expected ${expectedLength}`)
    if (!/^[1-4]+$/.test(pattern)) problems.push(`pattern ${index} has an element outside 1–4`)
    const sum = [...pattern].reduce((total, digit) => total + Number(digit), 0)
    if (sum !== expectedModules) problems.push(`pattern ${index} is ${sum} modules wide, expected ${expectedModules}`)
  })
  return problems
}
