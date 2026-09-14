/**
 * One inventory document, turned into a printable sheet.
 *
 * The rule this file exists to enforce:
 *
 *   **When a document has a print snapshot, the sheet is built from the
 *   snapshot and from nothing else.**
 *
 * A snapshot is captured when the document is posted and is immutable
 * thereafter. It carries the item name, the warehouse name, the batch number
 * and the rate *as they were at posting time*. Resolving any of those through
 * the live masters instead — `warehouseName(line.warehouse_id)`, a fresh item
 * lookup, today's valuation rate — would mean that renaming a warehouse, fixing
 * a typo in an item, or revaluing a batch silently rewrites a challan that was
 * printed, signed and sent with a lorry six months ago. Two prints of the same
 * document would not match, and the one in the customer's file would be the
 * one that no longer exists anywhere in the system.
 *
 * So: the snapshot path reads snapshot fields only. The live path — used when
 * no snapshot was captured, which is every unposted document — may resolve
 * through masters, because there is nothing immutable to contradict, and the
 * sheet says plainly which of the two it is.
 *
 * Pure. No React, no DOM, no network — the whole file is unit-tested.
 */

import type { InventoryDocument, PrintSnapshot } from '../documents/types'
import type { ExportColumn, ExportRow } from './exportColumns'
import type { SheetBlock, SheetPair } from './sheetHtml'
import { formatDate, formatMoney, formatQty, humanize, toNumber } from '../utils/format'

export type DocumentSheetSource = 'snapshot' | 'live'

type Row = Record<string, unknown>

/** Keys the variant may use for the document's own printed title. */
const TITLE_KEYS = ['title', 'document_title', 'variant_label'] as const

/** Header keys already shown elsewhere on the sheet; not repeated as pairs. */
const HEADER_SUPPRESS = new Set<string>([
  ...TITLE_KEYS,
  'document_no',
  'document_date',
  'company_name',
  'cmp_id',
  'bo_id',
  'fy_id',
  'document_id',
  'snap_id',
  'template_version',
])

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'object') return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function first(row: Row, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function isDateLike(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
}

function cell(value: number | string, textValue: string) {
  return { value, text: textValue }
}

/* ---------------------------------------------------------------- columns */

const ITEM_KEYS = ['item_name', 'item_print_name', 'item_label', 'description', 'name'] as const
const SKU_KEYS = ['item_sku', 'sku', 'item_code'] as const
const WAREHOUSE_KEYS = ['warehouse_name', 'mc_name', 'warehouse', 'godown_name'] as const
const BATCH_KEYS = ['batch_no', 'batch', 'batch_number'] as const
const EXPIRY_KEYS = ['expiry_date', 'expiry'] as const
const QTY_KEYS = ['qty', 'quantity', 'base_qty'] as const
const UNIT_KEYS = ['unit_symbol', 'unit', 'uom', 'unit_name'] as const
const RATE_KEYS = ['rate', 'unit_rate', 'source_transaction_rate', 'valuation_rate'] as const
const AMOUNT_KEYS = ['amount', 'line_amount', 'source_transaction_amount', 'valuation_amount'] as const
const HSN_KEYS = ['hsn_sac', 'hsn', 'sac'] as const

interface LineView {
  item: string
  sku: string
  hsn: string
  warehouse: string
  batch: string
  expiry: string
  qty: number | null
  qtyText: string
  rate: number | null
  amount: number | null
  direction: string
}

/**
 * One line, read the same way whichever side it came from.
 *
 * The snapshot writer has used several field names over its template versions,
 * so each value is probed across the aliases it has actually been written
 * under. A missing key yields blank — never a lookup against a live master.
 */
export function readLine(raw: Row): LineView {
  const qty = toNumber(first(raw, QTY_KEYS))
  const unit = text(first(raw, UNIT_KEYS))
  const direction = text(raw.direction)
  return {
    item: text(first(raw, ITEM_KEYS)),
    sku: text(first(raw, SKU_KEYS)),
    hsn: text(first(raw, HSN_KEYS)),
    warehouse: text(first(raw, WAREHOUSE_KEYS)),
    batch: text(first(raw, BATCH_KEYS)),
    expiry: isDateLike(first(raw, EXPIRY_KEYS)) ? formatDate(first(raw, EXPIRY_KEYS), '') : '',
    qty,
    qtyText: qty === null ? '' : `${formatQty(qty, '')}${unit ? ` ${unit}` : ''}`,
    rate: toNumber(first(raw, RATE_KEYS)),
    amount: toNumber(first(raw, AMOUNT_KEYS)),
    direction: direction && direction !== 'none' ? direction : '',
  }
}

/**
 * The columns this document actually needs.
 *
 * A stock transfer has no rates; a physical verification has no batches. Always
 * printing all seven columns leaves the reader three empty ones to scan past,
 * so a column appears only when some line fills it.
 */
export function documentColumns(lines: readonly LineView[]): ExportColumn[] {
  const has = (pick: (l: LineView) => unknown) => lines.some((l) => {
    const v = pick(l)
    return v !== '' && v !== null && v !== undefined
  })

  const columns: ExportColumn[] = [
    { key: 'sr', label: '#', format: 'int', align: 'right', excelWidth: 5, pdfWeight: 3 },
    { key: 'item', label: 'Item', format: 'text', align: 'left', excelWidth: 38, pdfWeight: 30 },
  ]
  if (has((l) => l.hsn)) {
    columns.push({ key: 'hsn', label: 'HSN/SAC', format: 'text', align: 'left', excelWidth: 12, pdfWeight: 9 })
  }
  if (has((l) => l.warehouse)) {
    columns.push({ key: 'warehouse', label: 'Warehouse', format: 'text', align: 'left', excelWidth: 22, pdfWeight: 16 })
  }
  if (has((l) => l.batch)) {
    columns.push({ key: 'batch', label: 'Batch', format: 'text', align: 'left', excelWidth: 16, pdfWeight: 11 })
  }
  if (has((l) => l.expiry)) {
    columns.push({ key: 'expiry', label: 'Expiry', format: 'date', align: 'left', excelWidth: 13, pdfWeight: 10 })
  }
  columns.push({ key: 'qty', label: 'Qty', format: 'qty', align: 'right', excelWidth: 14, pdfWeight: 11 })
  if (has((l) => l.rate)) {
    columns.push({ key: 'rate', label: 'Rate', format: 'amount', align: 'right', excelWidth: 15, pdfWeight: 12 })
  }
  if (has((l) => l.amount)) {
    columns.push({ key: 'amount', label: 'Amount', format: 'amount', align: 'right', excelWidth: 17, pdfWeight: 14 })
  }
  return columns
}

function lineRow(line: LineView, index: number): ExportRow {
  const itemText = [line.item, line.sku].filter(Boolean).join(' · ')
  return {
    sr: cell(index + 1, String(index + 1)),
    item: cell(itemText, itemText),
    hsn: cell(line.hsn, line.hsn),
    warehouse: cell(line.warehouse, line.warehouse),
    batch: cell(line.batch, line.batch),
    expiry: cell(line.expiry, line.expiry),
    qty: cell(
      line.qty ?? '',
      line.qtyText + (line.direction ? ` (${line.direction})` : ''),
    ),
    rate: cell(line.rate ?? '', line.rate === null ? '' : formatMoney(line.rate, '')),
    amount: cell(line.amount ?? '', line.amount === null ? '' : formatMoney(line.amount, '')),
  }
}

/**
 * The document's own total.
 *
 * Unlike a register — where the page on screen is a slice and the total must
 * come from the server — a document carries all of its lines, so summing them
 * here *is* the whole figure.
 */
export function documentTotals(
  columns: readonly ExportColumn[],
  lines: readonly LineView[],
): ExportRow | null {
  const wantsAmount = columns.some((c) => c.key === 'amount')
  const amounts = lines.map((l) => l.amount).filter((n): n is number => n !== null)
  if (!wantsAmount || amounts.length === 0) return null
  const total = Math.round(amounts.reduce((s, n) => s + n, 0) * 100) / 100
  const row: ExportRow = {}
  for (const col of columns) row[col.key] = cell('', '')
  row.amount = cell(total, formatMoney(total, ''))
  return row
}

/* ------------------------------------------------------------------ sheet */

export interface DocumentSheetBody {
  source: DocumentSheetSource
  /** `DELIVERY_CHALLAN` — drives the default copy set. */
  documentCode: string
  title: string
  documentNo: string
  documentDate: string
  headerPairs: SheetPair[]
  blocks: SheetBlock[]
  columns: ExportColumn[]
  rows: ExportRow[]
  totalsRow: ExportRow | null
  totalsLabel: string
  footerPairs: SheetPair[]
  footerNotes: string[]
  /** Says, on the page, where the figures came from. */
  provenance: string
  /** Slug for the downloaded PDF. */
  filenameBase: string
}

export interface DocumentSheetInput {
  snapshot: PrintSnapshot | null
  live: InventoryDocument | null
  /**
   * Master lookup for the LIVE path only. It is deliberately not consulted when
   * a snapshot exists — see the file docblock.
   */
  warehouseName?: (id: number | null) => string
  /** `delivery_challan` → `Delivery challan`, for the live path's title. */
  typeLabel?: (code: string) => string
}

function pairsFrom(source: Row | null | undefined, suppress: ReadonlySet<string>): SheetPair[] {
  if (!source) return []
  return Object.entries(source)
    .filter(([key, value]) => !suppress.has(key) && text(value) !== '')
    .map(([key, value]) => ({
      label: humanize(key),
      value: isDateLike(value) ? formatDate(value, '') : text(value),
    }))
}

function slug(parts: readonly (string | number | null | undefined)[]): string {
  return (
    parts
      .filter((p) => p !== null && p !== undefined && p !== '')
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'document'
  )
}

/**
 * Build the sheet, snapshot first.
 *
 * Returns `null` only when neither a snapshot nor a live document was supplied.
 */
export function buildDocumentSheet(input: DocumentSheetInput): DocumentSheetBody | null {
  const { snapshot, live } = input
  if (snapshot) return fromSnapshot(snapshot)
  if (live) return fromLive(live, input)
  return null
}

function fromSnapshot(snap: PrintSnapshot): DocumentSheetBody {
  const header: Row = snap.header_snapshot ?? {}
  const sourceDest: Row = snap.source_dest_snapshot ?? {}
  const transport: Row = snap.transport_snapshot ?? {}
  const extras: Row = snap.variant_extras_snapshot ?? {}
  const footer: Row = snap.footer_snapshot ?? {}

  const title =
    text(first(header, TITLE_KEYS)) || humanize(snap.document_variant) || 'Inventory document'

  const lines = (snap.item_lines_snapshot ?? []).map(readLine)
  const columns = documentColumns(lines)
  const rows = lines.map(lineRow)

  // Party and warehouses come from the snapshot's own source/destination block.
  // Nothing here is looked up: these strings are the ones captured at posting.
  const blocks: SheetBlock[] = []
  const party = text(first(sourceDest, ['party_name', 'party', 'consignee_name', 'customer_name', 'supplier_name']))
  if (party) {
    blocks.push({
      label: text(first(sourceDest, ['party_role', 'party_type'])) || 'Party',
      value: party,
      lines: [
        text(first(sourceDest, ['party_gstin', 'gstin'])) ? `GSTIN: ${text(first(sourceDest, ['party_gstin', 'gstin']))}` : '',
        text(first(sourceDest, ['party_address', 'address'])),
      ].filter(Boolean),
    })
  }
  const fromWh = text(first(sourceDest, ['from_warehouse_name', 'source_warehouse_name', 'from_warehouse']))
  if (fromWh) blocks.push({ label: 'From', value: fromWh })
  const toWh = text(first(sourceDest, ['to_warehouse_name', 'dest_warehouse_name', 'to_warehouse']))
  if (toWh) blocks.push({ label: 'To', value: toWh })
  const transportPairs = pairsFrom(transport, new Set())
  if (transportPairs.length) {
    blocks.push({
      label: 'Transport',
      value: transportPairs[0].value,
      lines: transportPairs.slice(1).map((p) => `${p.label}: ${p.value}`),
    })
  }

  const usedSourceDest = new Set<string>([
    'party_name', 'party', 'consignee_name', 'customer_name', 'supplier_name',
    'party_role', 'party_type', 'party_gstin', 'gstin', 'party_address', 'address',
    'from_warehouse_name', 'source_warehouse_name', 'from_warehouse',
    'to_warehouse_name', 'dest_warehouse_name', 'to_warehouse',
  ])

  const documentNo = snap.document_no ?? ''
  return {
    source: 'snapshot',
    documentCode: snap.document_variant,
    title,
    documentNo,
    documentDate: formatDate(snap.document_date, ''),
    headerPairs: [
      ...(snap.currency_code && snap.currency_code !== 'INR'
        ? [{ label: 'Currency', value: snap.currency_code }]
        : []),
      ...(snap.status ? [{ label: 'Status', value: humanize(snap.status) }] : []),
    ],
    blocks,
    columns,
    rows,
    totalsRow: documentTotals(columns, lines),
    totalsLabel: 'Total',
    footerPairs: [
      ...pairsFrom(header, HEADER_SUPPRESS),
      ...pairsFrom(sourceDest, usedSourceDest),
      ...pairsFrom(extras, new Set()),
      ...pairsFrom(footer, new Set()),
    ],
    footerNotes: [],
    provenance: `Immutable print snapshot captured ${formatDate(snap.created_at, snap.created_at)} · template ${snap.template_version}`,
    filenameBase: slug([title, documentNo || snap.document_id]),
  }
}

function fromLive(doc: InventoryDocument, input: DocumentSheetInput): DocumentSheetBody {
  const warehouseName = input.warehouseName ?? (() => '')
  const typeLabel = input.typeLabel ?? humanize

  const lines = (doc.lines ?? []).map((l) =>
    readLine({
      item_name: l.item_label ?? l.item_print_name ?? l.item_name,
      item_sku: l.item_sku,
      hsn_sac: l.hsn_sac,
      // Live only: the document is not posted, so there is no captured name to
      // contradict and the current master is the best answer available.
      warehouse_name: l.warehouse_name ?? warehouseName(l.warehouse_id),
      batch_no: l.batch_no,
      expiry_date: l.expiry_date,
      qty: l.qty,
      unit_symbol: l.unit_symbol,
      rate: l.source_transaction_rate ?? l.valuation_rate,
      amount: l.source_transaction_amount ?? l.valuation_amount,
      direction: l.direction,
    }),
  )
  const columns = documentColumns(lines)

  const blocks: SheetBlock[] = []
  if (doc.party_name) blocks.push({ label: 'Party', value: doc.party_name })
  if (doc.from_warehouse_id) {
    blocks.push({ label: 'From', value: warehouseName(doc.from_warehouse_id) })
  }
  if (doc.to_warehouse_id) {
    blocks.push({ label: 'To', value: warehouseName(doc.to_warehouse_id) })
  }

  const title = doc.document_type_label ?? typeLabel(doc.document_type)
  const documentNo = doc.document_no ?? `#${doc.document_id}`
  return {
    source: 'live',
    documentCode: doc.document_type,
    title,
    documentNo,
    documentDate: formatDate(doc.document_date, ''),
    headerPairs: [
      { label: 'Status', value: humanize(doc.status) },
      ...(doc.currency_code && doc.currency_code !== 'INR'
        ? [{ label: 'Currency', value: doc.currency_code }]
        : []),
    ],
    blocks,
    columns,
    rows: lines.map(lineRow),
    totalsRow: documentTotals(columns, lines),
    totalsLabel: 'Total',
    footerPairs: [
      ...(doc.source_document_no
        ? [{ label: 'Source document', value: doc.source_document_no }]
        : []),
      ...(doc.movement_reason ? [{ label: 'Reason', value: humanize(doc.movement_reason) }] : []),
      ...(doc.narration ? [{ label: 'Narration', value: doc.narration }] : []),
    ],
    footerNotes: [],
    provenance:
      'No print snapshot was captured for this document — printed from the live record, which can still change.',
    filenameBase: slug([title, documentNo]),
  }
}

/* ------------------------------------------------------------------ copies */

/**
 * Copy captions for a goods movement.
 *
 * A challan leaves the gate in three parts: the consignee keeps one, the
 * transporter carries one, the consignor files one. Printing the same sheet
 * three times leaves nobody able to say which copy is theirs, so the caption is
 * part of the document.
 */
export const GOODS_MOVEMENT_COPIES = [
  'Original for Consignee',
  'Duplicate for Transporter',
  'Triplicate for Consignor',
] as const

export const TWO_PART_COPIES = ['Original', 'Duplicate'] as const

export type CopySetId = 'single' | 'two' | 'goods'

export const COPY_SETS: Record<CopySetId, readonly string[]> = {
  single: [],
  two: TWO_PART_COPIES,
  goods: GOODS_MOVEMENT_COPIES,
}

export const COPY_SET_LABELS: Record<CopySetId, string> = {
  single: 'One copy',
  two: 'Original + Duplicate',
  goods: 'Consignee + Transporter + Consignor',
}

/**
 * Document types whose paper physically travels with the goods. Everything
 * else — a stock journal, a revaluation — is an internal record and prints once.
 */
const TRAVELS_WITH_GOODS = new Set([
  'DELIVERY_CHALLAN',
  'STOCK_TRANSFER',
  'JOB_WORK_OUT',
  'JOB_WORK_IN',
  'INWARD_CHALLAN',
  'PACKING',
])

/** The copy set a document type defaults to. */
export function defaultCopySet(documentCode: string | null | undefined): CopySetId {
  const code = String(documentCode ?? '').toUpperCase().replace(/[\s-]+/g, '_')
  return TRAVELS_WITH_GOODS.has(code) ? 'goods' : 'single'
}
