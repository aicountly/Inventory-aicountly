/**
 * Reads a pasted or uploaded CSV of "what is moving" into rows the import
 * drawer then resolves against the real item master.
 *
 * Nothing here looks anything up or invents an item: it turns text into
 * `{ code, qty }` pairs and says which lines it could not read. The codes are
 * matched against `GET /v1/items/search` afterwards, so an import can only ever
 * add items that exist.
 */

export interface ParsedCsvRow {
  /** 1-based line number in the file, for the error list. */
  lineNo: number
  code: string
  qty: number
  batchNo: string | null
}

export interface ParsedCsv {
  rows: ParsedCsvRow[]
  errors: { lineNo: number; message: string }[]
}

const HEADER_HINTS = ['item', 'sku', 'code', 'barcode', 'product']

/** Splits one CSV line, honouring double quotes and doubled quotes inside them. */
export function splitCsvLine(line: string): string[] {
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
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === ',' || ch === ';' || ch === '\t') {
      out.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  out.push(field)
  return out.map((f) => f.trim())
}

export function parseLinesCsv(text: string): ParsedCsv {
  const rows: ParsedCsvRow[] = []
  const errors: ParsedCsv['errors'] = []
  const lines = text.split(/\r?\n/)

  lines.forEach((raw, i) => {
    const lineNo = i + 1
    if (!raw.trim()) return
    const cells = splitCsvLine(raw)
    const code = (cells[0] ?? '').trim()
    if (!code) {
      errors.push({ lineNo, message: 'No item code in the first column.' })
      return
    }
    // A header row is skipped rather than reported: every spreadsheet writes one.
    const qtyText = (cells[1] ?? '').trim()
    const isHeader = rows.length === 0 && errors.length === 0 && HEADER_HINTS.some((h) => code.toLowerCase().includes(h)) && !/^\d/.test(qtyText)
    if (isHeader) return

    const qty = Number(qtyText.replace(/,/g, ''))
    if (!qtyText) {
      errors.push({ lineNo, message: `“${code}” has no quantity.` })
      return
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push({ lineNo, message: `“${code}” has an unusable quantity (${qtyText}).` })
      return
    }
    rows.push({ lineNo, code, qty, batchNo: (cells[2] ?? '').trim() || null })
  })

  return { rows, errors }
}
