/**
 * Reading a spreadsheet of brands, and deciding what is wrong with it before
 * anything is sent.
 *
 * Every function here is pure: text in, rows and problems out. Nothing touches
 * the network, so the whole validation story is unit-testable, and the dialog
 * that uses it can show the reader exactly what will happen before it happens.
 *
 * The split between what is checked here and what is checked by the server is
 * deliberate and is not a duplication:
 *
 *   here   — shape: a missing name, an over-long alias, the same name twice in
 *            one file. All knowable from the file alone.
 *   server — existence: a brand that is already in this company. Only the
 *            database knows that, and only at the moment of the insert; a
 *            browser-side check would be stale the instant another user typed.
 *
 * So a row that passes here is *submittable*, not *accepted*, and the results
 * summary reports what the API said row by row.
 */

/** Limits enforced by the API and the columns behind it (migration 010). */
export const BRAND_IMPORT_LIMITS = { brand_name: 255, brand_alias: 64, brand_code: 64 } as const

/** Above this the dialog refuses the file rather than firing a request a second for a minute. */
export const BRAND_IMPORT_MAX_ROWS = 500

export type BrandImportField = 'brand_name' | 'brand_alias' | 'brand_code' | 'description' | 'is_active'

export interface BrandImportFieldSpec {
  field: BrandImportField
  label: string
  required: boolean
  /** Header spellings that map to this field without the reader doing anything. */
  aliases: readonly string[]
}

export const BRAND_IMPORT_FIELDS: readonly BrandImportFieldSpec[] = [
  { field: 'brand_name', label: 'Brand name', required: true, aliases: ['brand name', 'brand', 'name', 'brand_name'] },
  { field: 'brand_alias', label: 'Alias', required: false, aliases: ['alias', 'short name', 'brand_alias', 'short'] },
  { field: 'brand_code', label: 'Brand code', required: false, aliases: ['code', 'brand code', 'brand_code', 'sku prefix'] },
  { field: 'description', label: 'Description', required: false, aliases: ['description', 'notes', 'remarks', 'about'] },
  { field: 'is_active', label: 'Status', required: false, aliases: ['status', 'active', 'is_active', 'is active'] },
]

/** Column index per field; -1 means "not in this file". */
export type BrandImportMapping = Record<BrandImportField, number>

export const EMPTY_MAPPING: BrandImportMapping = {
  brand_name: -1,
  brand_alias: -1,
  brand_code: -1,
  description: -1,
  is_active: -1,
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * The separator this file uses.
 *
 * Guessed from the first line rather than assumed: a CSV exported from a
 * spreadsheet in a European locale is semicolon-separated, and a file pasted
 * out of a spreadsheet is tab-separated. Whichever character appears most on
 * the header line wins; a tie falls back to the comma.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? ''
  const counts = [',', ';', '\t'].map((d) => ({ d, n: firstLine.split(d).length - 1 }))
  const best = counts.reduce((a, b) => (b.n > a.n ? b : a), counts[0])
  return best.n > 0 ? best.d : ','
}

/**
 * RFC 4180 enough for a spreadsheet export: quoted fields, `""` for a literal
 * quote inside one, newlines allowed inside quotes, CRLF or LF between rows.
 *
 * Hand-written rather than pulled in as a dependency: this is thirty lines, the
 * app ships no parser today, and adding one to read five columns would put a
 * package in the bundle for every screen that never imports anything.
 */
export function parseDelimited(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  // A UTF-8 BOM is invisible and would otherwise become part of the first header.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
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
    if (ch === '"' && field === '') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1
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
  // A trailing newline leaves one empty row; so does a blank line in the middle.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

/**
 * Guess which column is which from the header row.
 *
 * Only a guess — the dialog shows the result and lets it be changed. A file
 * whose first column is unheaded but obviously the name still has to be mapped
 * by hand, because importing 400 rows into the wrong field is much more
 * expensive than one dropdown.
 */
export function autoMapColumns(headers: readonly string[]): BrandImportMapping {
  const mapping: BrandImportMapping = { ...EMPTY_MAPPING }
  const seen = new Set<number>()
  for (const spec of BRAND_IMPORT_FIELDS) {
    const index = headers.findIndex((h, i) => !seen.has(i) && spec.aliases.includes(normaliseHeader(h)))
    if (index >= 0) {
      mapping[spec.field] = index
      seen.add(index)
    }
  }
  return mapping
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface BrandImportRow {
  /** 1-based line in the file as the reader sees it, header included. */
  line: number
  brand_name: string
  brand_alias: string
  brand_code: string
  description: string
  is_active: number
  /** The field to blame, and why. Null when the row is submittable. */
  problem: { field: BrandImportField; message: string } | null
}

/** `Active`, `1`, `yes`, `true` → 1. Anything else that was written → 0. Blank → 1. */
export function parseActiveFlag(raw: string): number {
  const v = raw.trim().toLowerCase()
  if (v === '') return 1
  return ['1', 'active', 'yes', 'y', 'true', 'enabled'].includes(v) ? 1 : 0
}

function cell(row: readonly string[], index: number): string {
  return index >= 0 ? (row[index] ?? '').trim() : ''
}

/**
 * Turn the data rows into records, and say what is wrong with each one.
 *
 * Every row comes back, including the broken ones: a preview that silently
 * dropped the rows it could not read would leave the reader counting lines to
 * work out which twelve of their four hundred never arrived.
 */
export function buildImportRows(
  dataRows: readonly (readonly string[])[],
  mapping: BrandImportMapping,
  /** Line number of the first data row — 2 when the file has a header. */
  firstLine = 2,
): BrandImportRow[] {
  const namesSeen = new Map<string, number>()
  const codesSeen = new Map<string, number>()

  return dataRows.map((raw, i) => {
    const row: BrandImportRow = {
      line: firstLine + i,
      brand_name: cell(raw, mapping.brand_name),
      brand_alias: cell(raw, mapping.brand_alias),
      brand_code: cell(raw, mapping.brand_code),
      description: cell(raw, mapping.description),
      is_active: parseActiveFlag(cell(raw, mapping.is_active)),
      problem: null,
    }

    if (row.brand_name === '') {
      row.problem = { field: 'brand_name', message: 'Brand name is required' }
      return row
    }
    if (row.brand_name.length > BRAND_IMPORT_LIMITS.brand_name) {
      row.problem = { field: 'brand_name', message: `Brand name must be ${BRAND_IMPORT_LIMITS.brand_name} characters or fewer` }
      return row
    }
    if (row.brand_alias.length > BRAND_IMPORT_LIMITS.brand_alias) {
      row.problem = { field: 'brand_alias', message: `Alias must be ${BRAND_IMPORT_LIMITS.brand_alias} characters or fewer` }
      return row
    }
    if (row.brand_code.length > BRAND_IMPORT_LIMITS.brand_code) {
      row.problem = { field: 'brand_code', message: `Brand code must be ${BRAND_IMPORT_LIMITS.brand_code} characters or fewer` }
      return row
    }

    const nameKey = row.brand_name.toLowerCase()
    const firstName = namesSeen.get(nameKey)
    if (firstName !== undefined) {
      row.problem = { field: 'brand_name', message: `Same brand name as line ${firstName}` }
      return row
    }
    namesSeen.set(nameKey, row.line)

    if (row.brand_code !== '') {
      const codeKey = row.brand_code.toLowerCase()
      const firstCode = codesSeen.get(codeKey)
      if (firstCode !== undefined) {
        row.problem = { field: 'brand_code', message: `Same brand code as line ${firstCode}` }
        return row
      }
      codesSeen.set(codeKey, row.line)
    }

    return row
  })
}

/** The body `POST /v1/brands` is called with. Blank optional fields are sent as null. */
export function importRowPayload(row: BrandImportRow): Record<string, unknown> {
  return {
    brand_name: row.brand_name,
    brand_alias: row.brand_alias || null,
    brand_code: row.brand_code || null,
    description: row.description || null,
    is_active: row.is_active,
  }
}

/** The starter file, so nobody has to guess the column names. */
export function brandImportTemplateCsv(): string {
  return [
    'Brand name,Alias,Brand code,Description,Status',
    'Example Brand,EXAMPLE,EXBRND,Shown on item labels and reports,Active',
    'Retired Brand,RETIRED,,No longer purchased,Inactive',
  ].join('\r\n')
}
