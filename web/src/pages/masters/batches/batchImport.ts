/**
 * Parsing and validating an uploaded batch file, before a single row is sent.
 *
 * Pure so that the part that decides what is safe to write can be tested
 * exhaustively. The rule the whole import hangs on is at the bottom of this
 * file: a row with an error is NEVER sent. A partial import that silently drops
 * the rows it could not read is how a stock file ends up half-loaded with
 * nobody able to say which half.
 *
 * The server validates everything again — duplicate batch numbers per item,
 * the item's own batch-tracking flag, shelf-life defaulting, the expiry-after-
 * manufacture rule. Nothing here replaces that; it only saves the reader a
 * round trip per bad row.
 */

export interface ImportItemRef {
  item_id: number
  item_name: string
  item_sku?: string | null
  track_batch?: number | boolean
}

/** The columns an import can fill. `item` and `batch_no` are the only required ones. */
export const IMPORT_FIELDS = [
  { key: 'item', label: 'Item (name or SKU)', required: true },
  { key: 'batch_no', label: 'Batch number', required: true },
  { key: 'lot_no', label: 'Lot number', required: false },
  { key: 'mfg_date', label: 'Manufacturing date', required: false },
  { key: 'expiry_date', label: 'Expiry date', required: false },
  { key: 'warranty_months', label: 'Warranty (months)', required: false },
  { key: 'status', label: 'Status', required: false },
] as const

export type ImportField = (typeof IMPORT_FIELDS)[number]['key']

/** Header spellings that map to a field without the reader touching anything. */
const HEADER_ALIASES: Record<ImportField, string[]> = {
  item: ['item', 'item name', 'itemname', 'product', 'sku', 'item sku', 'item code', 'itemcode'],
  batch_no: ['batch', 'batch no', 'batch number', 'batchno', 'batch_no'],
  lot_no: ['lot', 'lot no', 'lot number', 'lotno', 'lot_no'],
  mfg_date: ['mfg', 'mfg date', 'manufactured', 'manufacturing date', 'manufacture date', 'mfg_date', 'made on'],
  expiry_date: ['expiry', 'expires', 'expiry date', 'expiration date', 'exp date', 'expiry_date', 'best before'],
  warranty_months: ['warranty', 'warranty months', 'warranty (months)', 'warranty_months'],
  status: ['status', 'batch status'],
}

const normalise = (value: string): string => value.trim().toLowerCase().replace(/[\s_-]+/g, ' ')

/**
 * A best guess at which column is which, by header text.
 *
 * A guess, not a decision: the mapping step shows what was matched and lets the
 * reader change any of it before anything is validated.
 */
export function autoMapColumns(headers: readonly string[]): Record<ImportField, number> {
  const mapping = {} as Record<ImportField, number>
  const taken = new Set<number>()
  for (const field of IMPORT_FIELDS) {
    const aliases = HEADER_ALIASES[field.key]
    const index = headers.findIndex((header, i) => !taken.has(i) && aliases.includes(normalise(header)))
    mapping[field.key] = index
    if (index >= 0) taken.add(index)
  }
  return mapping
}

/**
 * RFC 4180 CSV: quoted fields, doubled quotes inside them, and newlines that
 * only end a record when they are outside quotes.
 */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  // A byte-order mark would otherwise become part of the first header.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // A trailing newline leaves one empty record; so does a run of blank lines.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

/** `31/03/2028`, `31-03-2028` and `2028-03-31` all mean the same day here. */
export function normaliseDate(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const dmy = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  let year: number
  let month: number
  let day: number
  if (iso) {
    ;[, year, month, day] = [0, Number(iso[1]), Number(iso[2]), Number(iso[3])]
  } else if (dmy) {
    ;[, day, month, year] = [0, Number(dmy[1]), Number(dmy[2]), Number(dmy[3])]
  } else {
    return null
  }
  const stamp = Date.UTC(year, month - 1, day)
  const back = new Date(stamp)
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null
  return back.toISOString().slice(0, 10)
}

export type RowVerdict = 'valid' | 'warning' | 'error'

export interface ParsedImportRow {
  /** 1-based line in the uploaded file, so a message names what the reader sees. */
  line: number
  values: Record<ImportField, string>
  item: ImportItemRef | null
  verdict: RowVerdict
  messages: string[]
  payload: Record<string, unknown> | null
}

export interface ValidateOptions {
  rows: readonly string[][]
  mapping: Record<ImportField, number>
  /** Items resolved by name or SKU — the lookup is the caller's job. */
  itemsByKey: Map<string, ImportItemRef>
  statuses: readonly string[]
  /** First data line's number in the file (2 when the first line is a header). */
  firstLine?: number
}

/**
 * Turn parsed cells into what will actually be posted, with everything wrong
 * about a row attached to it.
 *
 * A `warning` row is still imported — an unknown status falls back to `active`,
 * an unreadable warranty is dropped — because none of those change which batch
 * the row is. An `error` row is not, and the caller is told why.
 */
export function validateImportRows({
  rows,
  mapping,
  itemsByKey,
  statuses,
  firstLine = 2,
}: ValidateOptions): ParsedImportRow[] {
  const seen = new Map<string, number>()

  return rows.map((cells, index) => {
    const line = firstLine + index
    const cell = (field: ImportField): string => {
      const at = mapping[field]
      return at >= 0 && at < cells.length ? String(cells[at] ?? '').trim() : ''
    }
    const values = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, cell(f.key)])) as Record<ImportField, string>
    /*
     * Errors and warnings are collected separately and the verdict derived at
     * the end, rather than a flag flipped as we go: the payload below is built
     * only when `errors` is empty, and that is the single place the "never send
     * a broken row" rule is enforced.
     */
    const errors: string[] = []
    const warnings: string[] = []
    const fail = (message: string) => errors.push(message)
    const warn = (message: string) => warnings.push(message)

    const itemKey = normalise(values.item)
    const item = itemKey ? (itemsByKey.get(itemKey) ?? null) : null
    if (!values.item) fail('Item is required.')
    else if (!item) fail(`No active item matches “${values.item}”.`)
    else if (item.track_batch !== undefined && !Number(item.track_batch)) {
      fail(`“${item.item_name}” is not batch-tracked, so it cannot carry batches.`)
    }

    if (!values.batch_no) fail('Batch number is required.')
    else if (values.batch_no.length > 64) fail('Batch number is longer than 64 characters.')

    if (values.lot_no.length > 64) warn('Lot number is longer than 64 characters and will be trimmed.')

    const mfg = values.mfg_date ? normaliseDate(values.mfg_date) : null
    if (values.mfg_date && !mfg) fail(`Manufacturing date “${values.mfg_date}” is not a date.`)
    const expiry = values.expiry_date ? normaliseDate(values.expiry_date) : null
    if (values.expiry_date && !expiry) fail(`Expiry date “${values.expiry_date}” is not a date.`)
    if (mfg && expiry && expiry < mfg) fail('Expiry date is before the manufacturing date.')

    let warranty: number | null = null
    if (values.warranty_months) {
      const parsed = Number(values.warranty_months)
      if (!Number.isFinite(parsed) || parsed < 0) warn('Warranty is not a number and will be left empty.')
      else warranty = Math.round(parsed)
    }

    let status = values.status ? values.status.trim().toLowerCase().replace(/\s+/g, '_') : 'active'
    if (!statuses.includes(status)) {
      if (values.status) warn(`Status “${values.status}” is not a batch status — importing as Active.`)
      status = 'active'
    }

    // Two rows for the same item and batch number cannot both be created; the
    // server would reject the second, so it is caught here where the reader can
    // still fix the file.
    if (item && values.batch_no) {
      const key = `${item.item_id}::${values.batch_no.toLowerCase()}`
      const earlier = seen.get(key)
      if (earlier !== undefined) fail(`Duplicate of line ${earlier} — same item and batch number.`)
      else seen.set(key, line)
    }

    const verdict: RowVerdict = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'valid'
    const messages = [...errors, ...warnings]

    const payload =
      errors.length > 0 || !item
        ? null
        : {
            item_id: item.item_id,
            batch_no: values.batch_no.slice(0, 64),
            lot_no: values.lot_no ? values.lot_no.slice(0, 64) : null,
            mfg_date: mfg,
            expiry_date: expiry,
            warranty_months: warranty,
            status,
          }

    return { line, values, item, verdict, messages, payload }
  })
}

export interface ImportTally {
  valid: number
  warning: number
  error: number
  importable: number
}

export function tallyRows(rows: readonly ParsedImportRow[]): ImportTally {
  const tally: ImportTally = { valid: 0, warning: 0, error: 0, importable: 0 }
  for (const row of rows) {
    tally[row.verdict] += 1
    // The whole safety rule, in one line: only rows with no error are sent.
    if (row.verdict !== 'error') tally.importable += 1
  }
  return tally
}
