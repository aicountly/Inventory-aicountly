/**
 * Turning pasted text or a CSV file into candidate challan lines.
 *
 * Parsing only — nothing here touches an API, creates an item or adds a line.
 * The dialog resolves each parsed code against the live item search and shows
 * the reader what matched before a single line is added, because a paste that
 * silently invents stock movements is worse than no paste at all.
 *
 * Pure, and unit-tested: the formats a stores clerk actually pastes (a column
 * out of a spreadsheet, a two-column SKU/qty block, a CSV with a header row)
 * are the whole specification.
 */

export interface ParsedRow {
  /** Source line number, 1-based, for the preview table. */
  index: number
  /** SKU / barcode / item code as typed. */
  code: string
  /** Quantity as typed; '' when the row carried none. */
  qty: string
  warehouse: string
  batch: string
  serials: string[]
  /** Set when the row cannot be used at all (no code). */
  problem?: string
}

export interface ParseResult {
  rows: ParsedRow[]
  /** The delimiter that was used, for the preview caption. */
  delimiter: 'tab' | 'comma' | 'semicolon' | 'pipe' | 'none'
  /** True when the first line was read as column names rather than data. */
  headerRow: boolean
}

const DELIMITERS: { key: ParseResult['delimiter']; char: string }[] = [
  { key: 'tab', char: '\t' },
  { key: 'comma', char: ',' },
  { key: 'semicolon', char: ';' },
  { key: 'pipe', char: '|' },
]

/** Split one line on `delimiter`, honouring "quoted, fields" and doubled quotes. */
export function splitRow(line: string, delimiter: string): string[] {
  if (delimiter === '') return [line.trim()]
  const out: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === delimiter) {
      out.push(field.trim())
      field = ''
    } else {
      field += ch
    }
  }
  out.push(field.trim())
  return out
}

function detectDelimiter(lines: string[]): { key: ParseResult['delimiter']; char: string } {
  for (const candidate of DELIMITERS) {
    if (lines.some((l) => l.includes(candidate.char))) return candidate
  }
  return { key: 'none', char: '' }
}

const HEADER_ALIASES: Record<string, keyof Omit<ParsedRow, 'index' | 'problem' | 'serials'> | 'serials'> = {
  sku: 'code',
  code: 'code',
  item: 'code',
  'item code': 'code',
  'item sku': 'code',
  barcode: 'code',
  upc: 'code',
  qty: 'qty',
  quantity: 'qty',
  'qty.': 'qty',
  warehouse: 'warehouse',
  store: 'warehouse',
  'warehouse name': 'warehouse',
  batch: 'batch',
  'batch no': 'batch',
  'batch no.': 'batch',
  lot: 'batch',
  serial: 'serials',
  serials: 'serials',
  'serial no': 'serials',
  'serial nos': 'serials',
}

function headerMap(cells: string[]): Record<string, number> | null {
  const map: Record<string, number> = {}
  let hits = 0
  cells.forEach((cell, i) => {
    const alias = HEADER_ALIASES[cell.trim().toLowerCase().replace(/\s+/g, ' ')]
    if (alias && map[alias] === undefined) {
      map[alias] = i
      hits += 1
    }
  })
  // A header row has to name at least the code column; one stray "qty" in a
  // data row must not swallow the first item of a paste.
  return hits >= 1 && map.code !== undefined ? map : null
}

function splitSerials(value: string): string[] {
  return value
    .split(/[,;|\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Parse pasted text (or the contents of a CSV file) into candidate rows. */
export function parseItemText(text: string, options: { maxRows?: number } = {}): ParseResult {
  const maxRows = options.maxRows ?? 500
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '')
  if (lines.length === 0) return { rows: [], delimiter: 'none', headerRow: false }

  const delimiter = detectDelimiter(lines)
  const cellRows = lines.map((l) => splitRow(l, delimiter.char))
  const header = cellRows.length > 1 ? headerMap(cellRows[0]) : null
  const body = header ? cellRows.slice(1) : cellRows

  const rows: ParsedRow[] = []
  body.slice(0, maxRows).forEach((cells, i) => {
    const at = (key: string, fallback: number): string => {
      const idx = header ? header[key] : fallback
      return idx === undefined || idx < 0 ? '' : (cells[idx] ?? '').trim()
    }
    const code = at('code', 0)
    const serialsCell = at('serials', 4)
    const row: ParsedRow = {
      index: i + 1 + (header ? 1 : 0),
      code,
      qty: at('qty', 1),
      warehouse: at('warehouse', 2),
      batch: at('batch', 3),
      serials: serialsCell ? splitSerials(serialsCell) : [],
    }
    if (!code) row.problem = 'No item code on this row'
    rows.push(row)
  })

  return { rows, delimiter: delimiter.key, headerRow: header !== null }
}

/** `'1,200.50'` / `'12 nos'` → 1200.5 / 12; null when the cell holds no number. */
export function parseQty(value: string): number | null {
  const cleaned = value.replace(/,/g, '').replace(/[^\d.\-]/g, '').trim()
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** The sample a reader is shown when the dialog is empty. */
export const PASTE_EXAMPLE = 'SKU\tQTY\nDEL-14-001\t5\nWM-001\t10'
