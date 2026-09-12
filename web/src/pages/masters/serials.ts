/** Pure helpers for the serial number screens. */

export const SERIAL_MAX_LENGTH = 128
export const SERIAL_BULK_MAX = 5000

export interface ParsedSerials {
  /** Unique, trimmed, in first-seen order. */
  serials: string[]
  /** Values that appeared more than once (each listed once). */
  duplicates: string[]
  /** Values longer than the API accepts. */
  tooLong: string[]
}

/**
 * Split pasted text into serial numbers. Newlines, commas, semicolons and tabs
 * all separate; surrounding whitespace is dropped; repeats are reported, not
 * sent twice.
 */
export function parseSerialInput(text: string): ParsedSerials {
  const serials: string[] = []
  const seen = new Set<string>()
  const dupSet = new Set<string>()
  const tooLong: string[] = []
  for (const raw of text.split(/[\n\r,;\t]+/)) {
    const s = raw.trim()
    if (!s) continue
    if (s.length > SERIAL_MAX_LENGTH) {
      if (!tooLong.includes(s)) tooLong.push(s)
      continue
    }
    if (seen.has(s)) {
      dupSet.add(s)
      continue
    }
    seen.add(s)
    serials.push(s)
  }
  return { serials, duplicates: [...dupSet], tooLong }
}

export interface SerialRange {
  prefix: string
  suffix: string
  start: number
  end: number
  /** Minimum digits, zero-padded. 0 = no padding. */
  pad: number
}

/** `SN-0001` … `SN-0100`; empty when the range is invalid or too large. */
export function generateSerialRange(range: SerialRange, max = SERIAL_BULK_MAX): string[] {
  const start = Math.floor(range.start)
  const end = Math.floor(range.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return []
  if (end - start + 1 > max) return []
  const out: string[] = []
  for (let n = start; n <= end; n += 1) {
    const digits = range.pad > 0 ? String(n).padStart(range.pad, '0') : String(n)
    out.push(`${range.prefix}${digits}${range.suffix}`)
  }
  return out
}
