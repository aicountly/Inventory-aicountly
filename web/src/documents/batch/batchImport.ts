/**
 * Parsing for "Import from file".
 *
 * Inventory has no server-side line import for documents, and inventing one would mean a new
 * endpoint, a new payload and a second way for lines to reach a draft. What the operator actually
 * has is a spreadsheet, so this reads the spreadsheet: the text is parsed here, each row is
 * resolved against the item and batch lookups the screen already uses, and what lands in the draft
 * is ordinary editable lines. Nothing is posted that the operator has not seen on screen.
 */

export interface ImportRow {
  /** 1-based row number in the source, for the error messages. */
  row: number
  sku: string
  qty: string
  direction: 'in' | 'out' | null
  fromBatch: string
  toBatch: string
  note: string
}

export const IMPORT_COLUMNS = ['sku', 'qty', 'direction', 'from_batch', 'to_batch', 'note'] as const

export const IMPORT_TEMPLATE = 'sku,qty,direction,from_batch,to_batch,note\nITEM-AX45,10,out,BATCH-24-A,BATCH-24-B,Damaged stock\nITEM-AX45,10,in,BATCH-24-A,BATCH-24-B,Reallocated'

/** Most rows a single import may add, so a mis-pasted file cannot lock the tab up resolving it. */
export const IMPORT_ROW_LIMIT = 200

/** Split one delimited line, honouring double-quoted fields and doubled quotes inside them. */
export function splitDelimited(line: string, delimiter: string): string[] {
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
    if (ch === '"') quoted = true
    else if (ch === delimiter) {
      out.push(field)
      field = ''
    } else field += ch
  }
  out.push(field)
  return out.map((f) => f.trim())
}

function detectDelimiter(sample: string): string {
  const counts: Record<string, number> = { ',': 0, '\t': 0, ';': 0 }
  for (const ch of sample) if (ch in counts) counts[ch] += 1
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ',') as string
}

function normaliseHeader(cell: string): string {
  return cell.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '')
}

const HEADER_ALIASES: Record<string, (typeof IMPORT_COLUMNS)[number]> = {
  sku: 'sku',
  item: 'sku',
  item_code: 'sku',
  item_sku: 'sku',
  code: 'sku',
  barcode: 'sku',
  qty: 'qty',
  quantity: 'qty',
  direction: 'direction',
  dir: 'direction',
  from_batch: 'from_batch',
  current_batch: 'from_batch',
  batch_from: 'from_batch',
  from: 'from_batch',
  to_batch: 'to_batch',
  revised_batch: 'to_batch',
  batch_to: 'to_batch',
  to: 'to_batch',
  note: 'note',
  notes: 'note',
  description: 'note',
  remark: 'note',
  remarks: 'note',
}

function readDirection(raw: string): 'in' | 'out' | null {
  const v = raw.trim().toLowerCase()
  if (v === 'in' || v === 'i' || v === '+') return 'in'
  if (v === 'out' || v === 'o' || v === '-') return 'out'
  return null
}

/**
 * Rows out of pasted or uploaded text. A header line is used when one is recognisable; otherwise
 * the columns are read in the order `IMPORT_COLUMNS` declares.
 */
export function parseImportRows(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return []
  const delimiter = detectDelimiter(lines[0])

  const firstCells = splitDelimited(lines[0], delimiter)
  const mapped = firstCells.map((cell) => HEADER_ALIASES[normaliseHeader(cell)])
  /*
   * A header is only a header when it names at least two distinct columns AND holds no bare
   * number. Without the second half a first data row is eaten: `ITEM-1` normalises to `item`,
   * which is an alias of `sku`, so a headerless file would silently lose its first line.
   */
  const named = new Set(mapped.filter(Boolean))
  const hasNumber = firstCells.some((cell) => /^\d+(\.\d+)?$/.test(cell))
  const hasHeader = named.size >= 2 && named.has('sku') && !hasNumber

  const order: ((typeof IMPORT_COLUMNS)[number] | undefined)[] = hasHeader ? mapped : [...IMPORT_COLUMNS]
  const body = hasHeader ? lines.slice(1) : lines

  const rows: ImportRow[] = []
  body.forEach((line, i) => {
    if (rows.length >= IMPORT_ROW_LIMIT) return
    const cells = splitDelimited(line, delimiter)
    const pick = (column: (typeof IMPORT_COLUMNS)[number]): string => {
      const at = order.indexOf(column)
      return at >= 0 ? (cells[at] ?? '') : ''
    }
    const sku = pick('sku')
    const qty = pick('qty')
    if (!sku && !qty) return
    rows.push({
      row: i + (hasHeader ? 2 : 1),
      sku,
      qty: qty.replace(/[^\d.]/g, ''),
      direction: readDirection(pick('direction')),
      fromBatch: pick('from_batch'),
      toBatch: pick('to_batch'),
      note: pick('note'),
    })
  })
  return rows
}
