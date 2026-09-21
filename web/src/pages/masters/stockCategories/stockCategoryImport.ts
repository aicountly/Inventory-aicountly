import type { StockCategory } from '../../../services/masters'
import { normaliseName } from './categoryReview'

/**
 * Reading a stock-category CSV, and saying exactly what will happen to each
 * line before anything is sent.
 *
 * There is no bulk-import endpoint on the Inventory API and this does not
 * invent one: a confirmed import replays the ordinary `POST
 * /v1/stock-categories` per row, so every line goes through the same
 * validation, the same uniqueness rule and the same audit entry as a category
 * typed into the form. What this module adds is the part a per-row POST cannot
 * give — a complete verdict on the file BEFORE the first write, so nobody
 * discovers on row 40 that rows 1 to 39 already landed.
 *
 * Nothing is dropped quietly. A line that cannot be created is listed with the
 * reason; a column Inventory does not store is reported as ignored rather than
 * silently discarded.
 *
 * Pure: no React, no DOM, no network.
 */

export type IssueLevel = 'error' | 'warning'

export interface ImportIssue {
  level: IssueLevel
  message: string
}

export interface ImportRow {
  /** 1-based line in the file, header included — what the reader sees in Excel. */
  line: number
  name: string
  alias: string | null
  isActive: number
  issues: ImportIssue[]
}

export interface ImportPlan {
  rows: ImportRow[]
  /** Rows with no error — the ones a confirmed import would create. */
  valid: ImportRow[]
  /** Valid rows that still have something worth reading. */
  warned: ImportRow[]
  invalid: ImportRow[]
  /** Problems with the file itself (no header, no name column, empty). */
  fileIssues: ImportIssue[]
  /** Headers that were read, in file order. */
  headers: string[]
}

/** The file the Download template button writes. */
export const IMPORT_TEMPLATE_HEADERS = ['Category Name', 'Alias', 'Status'] as const

export const IMPORT_TEMPLATE_CSV = `${IMPORT_TEMPLATE_HEADERS.join(',')}\nRaw Material,RM,Active\nFinished Goods,FG,Active\nPacking Material,PM,Inactive\n`

/**
 * RFC 4180 enough for a spreadsheet export: quoted fields, embedded commas,
 * doubled quotes, and CRLF or LF line endings.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let started = false

  const endField = () => {
    row.push(field)
    field = ''
    started = false
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
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
    if (ch === '"' && !started) {
      quoted = true
      started = true
      continue
    }
    if (ch === ',') {
      endField()
      continue
    }
    if (ch === '\r') continue
    if (ch === '\n') {
      endRow()
      continue
    }
    field += ch
    started = true
  }
  if (field !== '' || row.length > 0) endRow()

  // A trailing newline leaves one empty row; a blank line in the middle is the
  // reader's, and is reported rather than swallowed.
  while (rows.length > 0 && rows[rows.length - 1]?.every((c) => c.trim() === '')) rows.pop()
  return rows
}

const NAME_HEADERS = ['category name', 'category', 'name', 'cat_name', 'stock category']
const ALIAS_HEADERS = ['alias', 'cat_alias', 'short name', 'code']
const STATUS_HEADERS = ['status', 'is_active', 'active']
const IGNORED_HEADERS = ['description', 'notes', 'remarks', 'remark']

function headerIndex(headers: readonly string[], names: readonly string[]): number {
  return headers.findIndex((h) => names.includes(h))
}

/** '', 'active', '1', 'yes', 'true' → active. 'inactive', '0', 'no' → inactive. */
export function parseStatus(raw: string): { isActive: number; issue: ImportIssue | null } {
  const value = raw.trim().toLowerCase()
  if (value === '') return { isActive: 1, issue: null }
  if (['active', '1', 'yes', 'y', 'true'].includes(value)) return { isActive: 1, issue: null }
  if (['inactive', '0', 'no', 'n', 'false'].includes(value)) return { isActive: 0, issue: null }
  return {
    isActive: 1,
    issue: { level: 'warning', message: `Status "${raw.trim()}" was not understood — the category will be created Active.` },
  }
}

export function buildImportPlan(text: string, existing: readonly StockCategory[]): ImportPlan {
  const table = parseCsv(text)
  const fileIssues: ImportIssue[] = []

  if (table.length === 0) {
    return { rows: [], valid: [], warned: [], invalid: [], headers: [], fileIssues: [{ level: 'error', message: 'The file is empty.' }] }
  }

  const headers = (table[0] ?? []).map((h) => h.trim())
  const lowered = headers.map((h) => h.toLowerCase())
  const nameAt = headerIndex(lowered, NAME_HEADERS)
  const aliasAt = headerIndex(lowered, ALIAS_HEADERS)
  const statusAt = headerIndex(lowered, STATUS_HEADERS)

  if (nameAt === -1) {
    fileIssues.push({
      level: 'error',
      message: `No category name column. The first row must name one of: ${NAME_HEADERS.join(', ')}.`,
    })
    return { rows: [], valid: [], warned: [], invalid: [], headers, fileIssues }
  }

  for (let i = 0; i < lowered.length; i += 1) {
    const header = lowered[i] ?? ''
    if (header === '') continue
    if (i === nameAt || i === aliasAt || i === statusAt) continue
    if (IGNORED_HEADERS.includes(header)) {
      fileIssues.push({
        level: 'warning',
        message: `"${headers[i]}" is not part of Inventory's stock category master, so that column will not be imported.`,
      })
    } else {
      fileIssues.push({ level: 'warning', message: `Column "${headers[i]}" is not recognised and will be ignored.` })
    }
  }

  // Both maps hold the NORMALISED name, because the API's uniqueness rule is
  // case-insensitive: "raw material" would be refused against "Raw Material".
  const existingNames = new Map<string, string>()
  for (const row of existing) {
    const key = normaliseName(row.cat_name)
    if (key !== '') existingNames.set(key, String(row.cat_name ?? ''))
  }
  const seenInFile = new Map<string, number>()

  const rows: ImportRow[] = []
  for (let r = 1; r < table.length; r += 1) {
    const cells = table[r] ?? []
    const line = r + 1
    if (cells.every((c) => c.trim() === '')) {
      // A blank line is not an error, but it is not silence either.
      rows.push({ line, name: '', alias: null, isActive: 1, issues: [{ level: 'error', message: 'Blank line — nothing to create.' }] })
      continue
    }

    const issues: ImportIssue[] = []
    const name = (cells[nameAt] ?? '').trim()
    const alias = aliasAt === -1 ? '' : (cells[aliasAt] ?? '').trim()
    const { isActive, issue: statusIssue } = parseStatus(statusAt === -1 ? '' : (cells[statusAt] ?? ''))
    if (statusIssue) issues.push(statusIssue)

    if (name === '') {
      issues.push({ level: 'error', message: 'Category name is required.' })
    } else if (name.length > 255) {
      issues.push({ level: 'error', message: 'Category name is longer than 255 characters.' })
    }
    if (alias.length > 64) {
      issues.push({ level: 'error', message: 'Alias is longer than 64 characters.' })
    }

    const key = normaliseName(name)
    if (key !== '') {
      const existingName = existingNames.get(key)
      if (existingName !== undefined) {
        issues.push({ level: 'error', message: `"${existingName}" already exists in this company.` })
      }
      const firstLine = seenInFile.get(key)
      if (firstLine !== undefined) {
        issues.push({ level: 'error', message: `Same category as line ${firstLine}.` })
      } else {
        seenInFile.set(key, line)
      }
    }

    rows.push({ line, name, alias: alias === '' ? null : alias, isActive, issues })
  }

  if (rows.length === 0) fileIssues.push({ level: 'error', message: 'The file has a header row but no data rows.' })

  const invalid = rows.filter((r) => r.issues.some((i) => i.level === 'error'))
  const valid = rows.filter((r) => !r.issues.some((i) => i.level === 'error'))
  const warned = valid.filter((r) => r.issues.length > 0)

  return { rows, valid, warned, invalid, headers, fileIssues }
}
