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
/**
 * The tokens in pasted text, in order, with nothing removed.
 *
 * Separate from `parseSerialInput` because the import preview needs the
 * repeats: a list that silently collapsed "SN-1" typed twice would import one
 * and leave the operator to wonder which line went missing.
 */
export function splitSerialInput(text: string): string[] {
  return text
    .split(/[\n\r,;\t]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

export function parseSerialInput(text: string): ParsedSerials {
  const serials: string[] = []
  const seen = new Set<string>()
  const dupSet = new Set<string>()
  const tooLong: string[] = []
  for (const s of splitSerialInput(text)) {
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

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

/**
 * Split delimited text into rows of cells, honouring quotes.
 *
 * Small on purpose — this reads a two- or three-column serial list, not an
 * arbitrary spreadsheet — but it does handle the three things that actually
 * break a naive `split(',')` on real files: a quoted field containing the
 * delimiter, a doubled quote inside a quoted field, and CRLF line endings out
 * of Excel.
 */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') {
      cell += ch
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/**
 * Comma or tab, whichever the first line has more of.
 *
 * A tab-separated paste out of a spreadsheet is at least as common as a saved
 * .csv, and asking the operator which one they have is asking them to look.
 */
export function detectDelimiter(text: string): ',' | '\t' | ';' {
  const line = text.split(/\r?\n/, 1)[0] ?? ''
  const counts: [',' | '\t' | ';', number][] = [
    [',', (line.match(/,/g) ?? []).length],
    ['\t', (line.match(/\t/g) ?? []).length],
    [';', (line.match(/;/g) ?? []).length],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}

/** The fields a serial import can carry per row. */
export type SerialImportField = 'serial_no' | 'warranty_until' | 'ignore'

export const SERIAL_IMPORT_FIELD_LABEL: Record<SerialImportField, string> = {
  serial_no: 'Serial number',
  warranty_until: 'Warranty until',
  ignore: 'Do not import',
}

/**
 * Guess which column is which from the header row.
 *
 * Only ever a starting point — the mapping is shown and editable, because a
 * column guessed wrongly and imported silently is 5,000 serials to undo.
 */
export function guessColumnMapping(header: readonly string[]): SerialImportField[] {
  return header.map((raw) => {
    const name = raw.trim().toLowerCase().replace(/[^a-z]+/g, '')
    if (name.includes('serial') || name === 'sn' || name === 'no' || name === 'number') return 'serial_no'
    if (name.includes('warranty') || name.includes('expiry') || name.includes('expires')) return 'warranty_until'
    return 'ignore'
  })
}

export type SerialImportState = 'ready' | 'duplicate_in_file' | 'too_long' | 'bad_warranty' | 'empty'

export interface SerialImportRow {
  /** 1-based line in the source, for the error list. */
  line: number
  serialNo: string
  warrantyUntil: string | null
  state: SerialImportState
}

export const SERIAL_IMPORT_STATE_LABEL: Record<SerialImportState, string> = {
  ready: 'Ready to import',
  duplicate_in_file: 'Repeated in this file',
  too_long: `Longer than ${SERIAL_MAX_LENGTH} characters`,
  bad_warranty: 'Warranty date is not YYYY-MM-DD',
  empty: 'No serial number in this row',
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Classify every row of a mapped file.
 *
 * Nothing is dropped: a row that cannot be imported still appears, with the
 * reason, so the operator can see that 4,998 of 5,000 went through and exactly
 * which two did not. "Already registered" is NOT decided here — only the server
 * knows that, and it reports it back per serial.
 */
export function classifyImportRows(
  rows: readonly (readonly string[])[],
  mapping: readonly SerialImportField[],
  options: { hasHeader?: boolean } = {},
): SerialImportRow[] {
  const serialAt = mapping.indexOf('serial_no')
  const warrantyAt = mapping.indexOf('warranty_until')
  const body = options.hasHeader ? rows.slice(1) : rows
  const offset = options.hasHeader ? 2 : 1
  const seen = new Set<string>()
  return body.map((cells, index) => {
    const line = index + offset
    const serialNo = serialAt >= 0 ? (cells[serialAt] ?? '').trim() : ''
    const warrantyRaw = warrantyAt >= 0 ? (cells[warrantyAt] ?? '').trim() : ''
    const warrantyUntil = warrantyRaw === '' ? null : warrantyRaw
    let state: SerialImportState = 'ready'
    if (serialNo === '') state = 'empty'
    else if (serialNo.length > SERIAL_MAX_LENGTH) state = 'too_long'
    else if (seen.has(serialNo)) state = 'duplicate_in_file'
    else if (warrantyUntil !== null && !ISO_DATE.test(warrantyUntil)) state = 'bad_warranty'
    if (state === 'ready') seen.add(serialNo)
    return { line, serialNo, warrantyUntil, state }
  })
}

/** Rows the import will actually send. */
export function importableRows(rows: readonly SerialImportRow[]): SerialImportRow[] {
  return rows.filter((r) => r.state === 'ready')
}

/** Counts for the summary strip above the preview table. */
export function importRowCounts(rows: readonly SerialImportRow[]): Record<SerialImportState, number> {
  const counts: Record<SerialImportState, number> = {
    ready: 0,
    duplicate_in_file: 0,
    too_long: 0,
    bad_warranty: 0,
    empty: 0,
  }
  for (const row of rows) counts[row.state] += 1
  return counts
}

/** The downloadable template, so the first import is not a guessing game. */
export const SERIAL_IMPORT_TEMPLATE = 'serial_no,warranty_until\nSN-0001,2028-04-15\nSN-0002,2028-04-15\nSN-0003,\n'
