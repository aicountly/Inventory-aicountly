import type { CsvColumn } from '../../../utils/csv'
import { toCsv } from '../../../utils/csv'
import { toNumber } from '../../../utils/format'

/**
 * Reading bills of materials out of a spreadsheet.
 *
 * Pure: parse, map, group, validate. Nothing here talks to the API, so every
 * rule below is testable without a network, and the dialog that drives it stays
 * a thin shell around these functions.
 *
 * The import is deliberately strict about item codes. A row naming a SKU this
 * company does not have is an ERROR, never a quiet skip and never an
 * auto-created item: an importer exists to stop a spreadsheet inventing master
 * data, and a bill built from an item nobody defined would be a production
 * instruction assembled from a typo.
 */

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

export interface ParsedSheet {
  headers: string[]
  rows: string[][]
}

/**
 * RFC-4180-ish CSV, and TSV.
 *
 * Quotes, escaped quotes and newlines inside a quoted field all have to work:
 * a component called `Bracket, 12" — left` is an ordinary thing to find in an
 * item master, and a naive `split(',')` turns that one row into three.
 */
export function parseDelimited(text: string): ParsedSheet {
  const clean = text.replace(/^﻿/, '')
  const delimiter = pickDelimiter(clean)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i]
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
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
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''))
  const [headers = [], ...body] = nonEmpty
  return { headers: headers.map((h) => h.trim()), rows: body }
}

function pickDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
  const tabs = (firstLine.match(/\t/g) ?? []).length
  const semis = (firstLine.match(/;/g) ?? []).length
  const commas = (firstLine.match(/,/g) ?? []).length
  if (tabs > commas && tabs >= semis) return '\t'
  if (semis > commas) return ';'
  return ','
}

/* -------------------------------------------------------------------------- */
/* Column mapping                                                              */
/* -------------------------------------------------------------------------- */

export type BomImportField =
  | 'bom_name'
  | 'finished_item_code'
  | 'component_item_code'
  | 'qty'
  | 'unit_symbol'
  | 'scrap_percent'
  | 'yield_qty'
  | 'line_kind'
  | 'status'

export interface BomImportFieldSpec {
  field: BomImportField
  label: string
  required: boolean
  hint: string
  /** Header spellings recognised without the user mapping anything. */
  aliases: string[]
}

export const BOM_IMPORT_FIELDS: readonly BomImportFieldSpec[] = [
  { field: 'bom_name', label: 'BOM name', required: true, hint: 'Rows sharing a name become one bill.', aliases: ['bom name', 'bom', 'name', 'bill', 'bill of materials'] },
  { field: 'finished_item_code', label: 'Finished item code', required: true, hint: 'The SKU of the item this bill produces.', aliases: ['finished item code', 'finished item', 'finished sku', 'product code', 'product sku'] },
  { field: 'component_item_code', label: 'Component item code', required: true, hint: 'The SKU of the component consumed.', aliases: ['component item code', 'component code', 'component', 'component sku', 'material code'] },
  { field: 'qty', label: 'Quantity', required: true, hint: 'Per yield of the finished item.', aliases: ['quantity', 'qty', 'required qty', 'component qty'] },
  { field: 'unit_symbol', label: 'Unit', required: false, hint: "Blank uses the component's base unit.", aliases: ['unit', 'uom', 'unit symbol'] },
  { field: 'scrap_percent', label: 'Scrap %', required: false, hint: 'The wastage uplift on the component. Blank is treated as zero.', aliases: ['wastage', 'wastage %', 'wastage percent', 'scrap', 'scrap %', 'scrap percent'] },
  { field: 'yield_qty', label: 'Yield', required: false, hint: 'Blank is treated as 1.', aliases: ['yield', 'yield qty', 'yield quantity', 'output'] },
  { field: 'line_kind', label: 'Line kind', required: false, hint: 'component, by_product or scrap. Blank is component.', aliases: ['line kind', 'kind', 'type', 'line type'] },
  { field: 'status', label: 'Status', required: false, hint: 'active or inactive. Blank imports as inactive.', aliases: ['status', 'active', 'is active'] },
]

export type BomImportMapping = Partial<Record<BomImportField, number>>

function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

/** Best-effort header match, so a well-formed sheet needs no mapping at all. */
export function autoMap(headers: string[]): BomImportMapping {
  const mapping: BomImportMapping = {}
  const used = new Set<number>()
  for (const spec of BOM_IMPORT_FIELDS) {
    const index = headers.findIndex(
      (h, i) => !used.has(i) && spec.aliases.includes(normaliseHeader(h)),
    )
    if (index >= 0) {
      mapping[spec.field] = index
      used.add(index)
    }
  }
  return mapping
}

export function missingRequiredFields(mapping: BomImportMapping): BomImportFieldSpec[] {
  return BOM_IMPORT_FIELDS.filter((s) => s.required && mapping[s.field] === undefined)
}

/* -------------------------------------------------------------------------- */
/* Grouping and validation                                                     */
/* -------------------------------------------------------------------------- */

export interface BomImportIssue {
  /** 1-based, counting the header as row 1 — what the spreadsheet shows. */
  row: number
  severity: 'error' | 'warning'
  message: string
  bomName: string
  componentCode: string
}

export interface BomImportLineDraft {
  row: number
  componentCode: string
  qty: number
  unitSymbol: string
  scrapPercent: number
  lineKind: 'component' | 'by_product' | 'scrap'
}

export interface BomImportDraft {
  bomName: string
  finishedItemCode: string
  yieldQty: number
  active: boolean
  lines: BomImportLineDraft[]
  /** Every sheet row that fed this bill, for the error report. */
  rows: number[]
}

export interface BomImportPlan {
  drafts: BomImportDraft[]
  issues: BomImportIssue[]
}

const LINE_KINDS = ['component', 'by_product', 'scrap'] as const

/**
 * Sheet rows → one draft per BOM name.
 *
 * Header-level values (the finished item, the yield, the status) are taken from
 * the FIRST row of each group, and a later row disagreeing is reported as a
 * warning rather than silently overriding: two different finished items under
 * one bill name is a mistake worth seeing before 40 bills are created.
 */
export function buildPlan(sheet: ParsedSheet, mapping: BomImportMapping): BomImportPlan {
  const issues: BomImportIssue[] = []
  const byName = new Map<string, BomImportDraft>()
  const cell = (row: string[], field: BomImportField): string => {
    const index = mapping[field]
    return index === undefined ? '' : (row[index] ?? '').trim()
  }

  sheet.rows.forEach((row, i) => {
    const rowNumber = i + 2
    const bomName = cell(row, 'bom_name')
    const componentCode = cell(row, 'component_item_code')
    const add = (severity: BomImportIssue['severity'], message: string) =>
      issues.push({ row: rowNumber, severity, message, bomName, componentCode })

    if (!bomName) {
      add('error', 'BOM name is missing.')
      return
    }
    const finishedItemCode = cell(row, 'finished_item_code')
    if (!finishedItemCode) {
      add('error', 'Finished item code is missing.')
      return
    }
    if (!componentCode) {
      add('error', 'Component item code is missing.')
      return
    }

    const qty = toNumber(cell(row, 'qty'))
    if (qty === null) {
      add('error', `Quantity "${cell(row, 'qty')}" is not a number.`)
      return
    }
    if (qty < 0) {
      add('error', 'Quantity cannot be negative.')
      return
    }

    const scrapRaw = cell(row, 'scrap_percent').replace('%', '')
    const scrapPercent = scrapRaw === '' ? 0 : toNumber(scrapRaw)
    if (scrapPercent === null || scrapPercent < 0 || scrapPercent > 100) {
      add('error', 'Scrap % must be a number between 0 and 100.')
      return
    }

    const kindRaw = cell(row, 'line_kind').toLowerCase().replace(/[\s-]+/g, '_')
    const lineKind = (LINE_KINDS as readonly string[]).includes(kindRaw)
      ? (kindRaw as BomImportLineDraft['lineKind'])
      : 'component'
    if (kindRaw && lineKind !== kindRaw) {
      add('warning', `Line kind "${kindRaw}" is not recognised — imported as a component.`)
    }

    const yieldRaw = cell(row, 'yield_qty')
    const yieldQty = yieldRaw === '' ? 1 : toNumber(yieldRaw)
    if (yieldQty === null || yieldQty <= 0) {
      add('error', 'Yield must be a number greater than zero.')
      return
    }

    const statusRaw = cell(row, 'status').toLowerCase()
    const active = statusRaw === 'active' || statusRaw === '1' || statusRaw === 'yes' || statusRaw === 'true'

    const key = bomName.toLowerCase()
    const existing = byName.get(key)
    if (!existing) {
      byName.set(key, {
        bomName,
        finishedItemCode,
        yieldQty,
        active,
        lines: [{ row: rowNumber, componentCode, qty, unitSymbol: cell(row, 'unit_symbol'), scrapPercent, lineKind }],
        rows: [rowNumber],
      })
      return
    }
    if (existing.finishedItemCode.toLowerCase() !== finishedItemCode.toLowerCase()) {
      add('warning', `Finished item differs from the first row of "${bomName}" — "${existing.finishedItemCode}" is used.`)
    }
    if (existing.lines.some((l) => l.componentCode.toLowerCase() === componentCode.toLowerCase() && l.lineKind === lineKind)) {
      add('warning', `"${componentCode}" appears more than once in "${bomName}" — both lines are imported.`)
    }
    existing.lines.push({ row: rowNumber, componentCode, qty, unitSymbol: cell(row, 'unit_symbol'), scrapPercent, lineKind })
    existing.rows.push(rowNumber)
  })

  // A bill with no component carrying a quantity is refused by the API, so it
  // is caught here rather than after the first half of the file has imported.
  for (const draft of byName.values()) {
    if (!draft.lines.some((l) => l.lineKind === 'component' && l.qty > 0)) {
      issues.push({
        row: draft.rows[0],
        severity: 'error',
        message: `"${draft.bomName}" has no component line with a quantity greater than zero.`,
        bomName: draft.bomName,
        componentCode: '',
      })
    }
  }

  return { drafts: [...byName.values()], issues }
}

/* -------------------------------------------------------------------------- */
/* Resolving codes                                                             */
/* -------------------------------------------------------------------------- */

export interface ResolvedItem {
  item_id: number
  item_sku: string | null
  item_name: string
  is_active?: number
}

/** Every distinct SKU the plan names, for one bulk lookup. */
export function codesInPlan(plan: BomImportPlan): string[] {
  const codes = new Set<string>()
  for (const draft of plan.drafts) {
    codes.add(draft.finishedItemCode)
    for (const line of draft.lines) codes.add(line.componentCode)
  }
  return [...codes]
}

export interface ResolvedPlan {
  /** Drafts whose every code resolved — these are what gets imported. */
  ready: BomImportDraft[]
  /** Drafts held back, with the reason against the row that caused it. */
  issues: BomImportIssue[]
}

/**
 * Hold back any bill naming a code this company does not have, or an item that
 * has been deactivated.
 *
 * Partial import of a bill is not an option: a recipe missing one of its
 * components is not a smaller recipe, it is a wrong one.
 */
export function resolvePlan(plan: BomImportPlan, items: ResolvedItem[]): ResolvedPlan {
  const bySku = new Map<string, ResolvedItem>()
  for (const item of items) {
    const sku = item.item_sku?.trim().toLowerCase()
    if (sku) bySku.set(sku, item)
  }
  const issues: BomImportIssue[] = []
  const ready: BomImportDraft[] = []

  for (const draft of plan.drafts) {
    const problems: BomImportIssue[] = []
    const check = (code: string, row: number, what: string) => {
      const item = bySku.get(code.trim().toLowerCase())
      if (!item) {
        problems.push({ row, severity: 'error', message: `${what} "${code}" was not found in this company.`, bomName: draft.bomName, componentCode: code })
        return
      }
      if (item.is_active === 0) {
        problems.push({ row, severity: 'error', message: `${what} "${code}" is inactive.`, bomName: draft.bomName, componentCode: code })
      }
    }
    check(draft.finishedItemCode, draft.rows[0], 'Finished item')
    for (const line of draft.lines) check(line.componentCode, line.row, 'Component')

    if (problems.length > 0) {
      issues.push(...problems)
      continue
    }
    ready.push(draft)
  }

  return { ready, issues }
}

/**
 * A draft → the `POST /v1/bill-of-materials` body.
 *
 * Imported bills are INACTIVE unless the sheet says otherwise: a file that
 * silently activated 40 manufacturing recipes the moment it was uploaded is one
 * upload away from a production run nobody reviewed.
 */
export function toCreatePayload(
  draft: BomImportDraft,
  items: ResolvedItem[],
): Record<string, unknown> {
  const bySku = new Map(items.filter((i) => i.item_sku).map((i) => [i.item_sku!.trim().toLowerCase(), i]))
  const id = (code: string) => bySku.get(code.trim().toLowerCase())?.item_id ?? null
  return {
    bom_name: draft.bomName,
    finished_item_id: id(draft.finishedItemCode),
    yield_qty: draft.yieldQty,
    is_active: draft.active ? 1 : 0,
    lines: draft.lines.map((line, i) => ({
      item_id: id(line.componentCode),
      qty: line.qty,
      line_kind: line.lineKind,
      scrap_percent: line.scrapPercent,
      sort_order: i,
    })),
  }
}

/* -------------------------------------------------------------------------- */
/* Error report                                                                */
/* -------------------------------------------------------------------------- */

const ISSUE_COLUMNS: CsvColumn<BomImportIssue>[] = [
  { header: 'Sheet row', value: (i) => (i.row > 0 ? i.row : '') },
  { header: 'Severity', value: (i) => i.severity },
  { header: 'BOM name', value: (i) => i.bomName },
  { header: 'Component code', value: (i) => i.componentCode },
  { header: 'Problem', value: (i) => i.message },
]

/** The rejected rows, as a file the user can fix and re-upload. */
export function issuesToCsv(issues: readonly BomImportIssue[]): string {
  return toCsv(issues, ISSUE_COLUMNS)
}

/** The header row of a blank import sheet — what "download the template" writes. */
export function templateCsv(): string {
  const header = BOM_IMPORT_FIELDS.map((f) => f.label).join(',')
  const example = [
    'Office chair - standard',
    'ITM-CH-001',
    'ITM-WS-010',
    '1',
    'pc',
    '0',
    '1',
    'component',
    'inactive',
  ].join(',')
  return `${header}\n${example}\n`
}
