/**
 * Editable draft of a document (what the form holds) and the pure conversions between it,
 * the API resource (DocumentService::hydrate) and the create / update payload
 * (DocumentService::create). Everything here is pure so it is unit-tested.
 */

import type { CreateDocumentLine, CreateDocumentPayload, DocumentLine, DocumentMetadata, InventoryDocument, LineSerial } from './types'
import type { DocumentTypeSpec } from './registry'
import { toNumber } from '../utils/format'

export interface UnitOption {
  unit_id: number
  unit_symbol: string | null
  unit_name?: string | null
  /** Base units per 1 of this unit. */
  conversion_factor: number
  is_default: boolean
}

export type LineOrigin = 'manual' | 'settlement' | 'bom' | 'count' | 'deferred'

export interface LineDraft {
  key: string
  item_id: number | null
  item_name: string
  item_sku: string | null
  track_batch: boolean
  track_serial: boolean
  units: UnitOption[]
  unit_id: number | null
  warehouse_id: number | null
  /** Transfer lines only: overrides the header source warehouse when set. */
  from_warehouse_id: number | null
  batch_id: number | null
  batch_no: string | null
  direction: 'in' | 'out' | null
  qty: string
  rate: string
  amount: string
  /** Per base unit. */
  valuation_rate: string
  book_qty: string
  physical_qty: string
  serials: LineSerial[]
  description: string
  origin: LineOrigin
  metadata: Record<string, unknown> | null
}

export interface HeaderDraft {
  document_type: string
  document_date: string
  document_no: string
  party_ref: string
  party_name: string
  from_warehouse_id: number | null
  to_warehouse_id: number | null
  /** UI only: pre-fills the warehouse of new lines. */
  default_warehouse_id: number | null
  stock_effect: string
  returnable: boolean
  expected_return_date: string
  reason_code: string
  movement_reason: string
  narration: string
  metadata: DocumentMetadata
}

let keySeq = 0

export function nextLineKey(): string {
  keySeq += 1
  return `l${Date.now().toString(36)}-${keySeq}`
}

/** Direction a fresh line gets for a type: fixed for fixed_* / status types, user-chosen for by_line. */
export function defaultDirection(spec: DocumentTypeSpec): 'in' | 'out' | null {
  switch (spec.lineMode) {
    case 'fixed_in':
      return 'in'
    case 'fixed_out':
      return 'out'
    case 'by_line':
      return spec.formKind === 'physical_count' ? null : 'out'
    default:
      return null
  }
}

export function newLine(spec: DocumentTypeSpec, partial: Partial<LineDraft> = {}): LineDraft {
  return {
    key: nextLineKey(),
    item_id: null,
    item_name: '',
    item_sku: null,
    track_batch: false,
    track_serial: false,
    units: [],
    unit_id: null,
    warehouse_id: null,
    from_warehouse_id: null,
    batch_id: null,
    batch_no: null,
    direction: defaultDirection(spec),
    qty: '',
    rate: '',
    amount: '',
    valuation_rate: '',
    book_qty: '',
    physical_qty: '',
    serials: [],
    description: '',
    origin: 'manual',
    metadata: null,
    ...partial,
  }
}

export function newHeader(spec: DocumentTypeSpec, today: string): HeaderDraft {
  return {
    document_type: spec.code,
    document_date: today,
    document_no: '',
    party_ref: '',
    party_name: '',
    from_warehouse_id: null,
    to_warehouse_id: null,
    default_warehouse_id: null,
    stock_effect: spec.stockEffects[0]?.value ?? '',
    returnable: false,
    expected_return_date: '',
    reason_code: '',
    movement_reason: '',
    narration: '',
    metadata: {},
  }
}

function numStr(v: unknown): string {
  const n = toNumber(v)
  return n === null ? '' : String(n)
}

/** Round like PHP round($x, 4) for the positive numbers used here. */
export function round4(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Number(`${Math.round(Number(`${n}e4`))}e-4`)
}

/** amount = qty × rate (4 dp); null when either is missing. */
export function lineAmount(qty: unknown, rate: unknown): number | null {
  const q = toNumber(qty)
  const r = toNumber(rate)
  if (q === null || r === null) return null
  return round4(q * r)
}

/** physical − book (4 dp); null until both are entered. */
export function countDifference(book: unknown, physical: unknown): number | null {
  const b = toNumber(book)
  const p = toNumber(physical)
  if (b === null || p === null) return null
  return round4(p - b)
}

export function conversionFactor(line: Pick<LineDraft, 'units' | 'unit_id'>): number {
  const u = line.units.find((x) => x.unit_id === line.unit_id)
  return u && u.conversion_factor > 0 ? u.conversion_factor : 1
}

/** Quantity in the item's base unit (what availability and negative-stock checks use). */
export function lineBaseQty(line: Pick<LineDraft, 'units' | 'unit_id' | 'qty'>): number {
  const q = toNumber(line.qty) ?? 0
  return round4(q * conversionFactor(line))
}

/**
 * Build the editable draft from a stored document. Transfer pairs (two stored lines per
 * entered line, tagged metadata.transfer_pair) collapse back into one editable line.
 */
export function draftFromDocument(doc: InventoryDocument, spec: DocumentTypeSpec): { header: HeaderDraft; lines: LineDraft[] } {
  const meta = (doc.metadata ?? {}) as DocumentMetadata
  const header: HeaderDraft = {
    document_type: doc.document_type,
    document_date: doc.document_date?.slice(0, 10) ?? '',
    document_no: doc.document_no ?? '',
    party_ref: doc.party_ref !== null && doc.party_ref !== undefined ? String(doc.party_ref) : '',
    party_name: doc.party_name ?? '',
    from_warehouse_id: doc.from_warehouse_id,
    to_warehouse_id: doc.to_warehouse_id,
    default_warehouse_id: null,
    stock_effect: doc.stock_effect ?? spec.stockEffects[0]?.value ?? '',
    returnable: !!doc.returnable,
    expected_return_date: doc.expected_return_date?.slice(0, 10) ?? '',
    reason_code: doc.reason_code ?? '',
    movement_reason: doc.movement_reason ?? '',
    narration: doc.narration ?? '',
    metadata: { ...meta },
  }
  const lines: LineDraft[] = []
  for (const l of doc.lines) {
    if (spec.lineMode === 'transfer') {
      const side = (l.metadata as { side?: string } | null)?.side
      if (side === 'in') continue
    }
    lines.push(lineFromStored(l, spec))
  }
  return { header, lines }
}

export function lineFromStored(l: DocumentLine, spec: DocumentTypeSpec): LineDraft {
  const units: UnitOption[] = l.unit_id
    ? [{ unit_id: l.unit_id, unit_symbol: l.unit_symbol ?? null, unit_name: l.unit_name ?? null, conversion_factor: toNumber(l.conversion_factor) ?? 1, is_default: true }]
    : []
  const isTransfer = spec.lineMode === 'transfer'
  const origin: LineOrigin = originFromMetadata(l.metadata)
  return {
    key: nextLineKey(),
    item_id: l.item_id,
    item_name: l.item_label ?? l.item_name ?? `Item #${l.item_id}`,
    item_sku: l.item_sku ?? null,
    track_batch: !!l.batch_id,
    track_serial: (l.serials?.length ?? 0) > 0,
    units,
    unit_id: l.unit_id,
    warehouse_id: isTransfer ? (l.dest_warehouse_id ?? null) : l.warehouse_id,
    from_warehouse_id: isTransfer ? l.warehouse_id : null,
    batch_id: l.batch_id,
    batch_no: l.batch_no ?? null,
    direction: spec.lineMode === 'by_line' ? (l.direction === 'in' || l.direction === 'out' ? l.direction : null) : defaultDirection(spec),
    qty: numStr(l.qty),
    rate: numStr(l.source_transaction_rate),
    amount: numStr(l.source_transaction_amount),
    valuation_rate: numStr(l.valuation_rate),
    book_qty: numStr(l.book_qty),
    physical_qty: numStr(l.physical_qty),
    serials: l.serials ?? [],
    description: l.description ?? '',
    origin,
    metadata: stripTransferMeta(l.metadata),
  }
}

function originFromMetadata(meta: Record<string, unknown> | null): LineOrigin {
  const kind = meta?.line_kind
  if (kind === 'component' || kind === 'by_product' || kind === 'finished') return 'bom'
  if (meta?.settlement_pending_id) return 'settlement'
  return 'manual'
}

function stripTransferMeta(meta: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!meta) return null
  const { transfer_pair: _pair, side: _side, ...rest } = meta
  return Object.keys(rest).length ? rest : null
}

export function isBlankLine(line: LineDraft): boolean {
  return line.item_id === null && line.qty.trim() === '' && line.book_qty.trim() === '' && line.physical_qty.trim() === ''
}

/** Validation the server would reject with 422 anyway — done first so the message is next to the field. */
export function validateDraft(header: HeaderDraft, lines: LineDraft[], spec: DocumentTypeSpec): string[] {
  const errors: string[] = []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(header.document_date)) errors.push('Document date is required (YYYY-MM-DD).')
  if (spec.lineMode === 'transfer') {
    if (!header.from_warehouse_id || !header.to_warehouse_id) errors.push('Source and destination warehouses are required for a stock transfer.')
    else if (header.from_warehouse_id === header.to_warehouse_id) errors.push('Source and destination warehouses must be different.')
  }
  if (header.returnable && header.expected_return_date && !/^\d{4}-\d{2}-\d{2}$/.test(header.expected_return_date)) {
    errors.push('Expected return date must be YYYY-MM-DD.')
  }
  if (spec.formKind === 'inward_challan' && header.stock_effect === 'settle_deferred' && !header.metadata.linked_source_document_id) {
    errors.push('Pick the deferred purchase this inward challan settles.')
  }
  const active = lines.filter((l) => !isBlankLine(l))
  if (active.length === 0) {
    errors.push(spec.formKind === 'physical_count' ? 'Load or add at least one item to count.' : 'At least one item line is required.')
  }
  let counted = 0
  active.forEach((l, i) => {
    const n = i + 1
    if (!l.item_id) errors.push(`Line ${n}: pick an item.`)
    if (spec.formKind === 'physical_count') {
      const diff = countDifference(l.book_qty, l.physical_qty)
      if (diff === null) errors.push(`Line ${n}: enter book and counted quantities.`)
      else if (diff !== 0) counted += 1
      return
    }
    const qty = toNumber(l.qty)
    if (qty === null || qty <= 0) errors.push(`Line ${n}: quantity must be greater than zero.`)
    if (spec.lineMode === 'by_line' && !l.direction) errors.push(`Line ${n}: choose in or out.`)
    if (spec.formKind === 'revaluation') {
      const rate = toNumber(l.valuation_rate)
      if (rate === null || rate <= 0) errors.push(`Line ${n}: enter the new unit cost.`)
    }
    if (spec.lineMode === 'transfer' && l.from_warehouse_id && l.warehouse_id && l.from_warehouse_id === l.warehouse_id) {
      errors.push(`Line ${n}: source and destination warehouses must differ.`)
    }
    if (l.track_serial && l.serials.length > 0 && qty !== null && l.serials.length !== lineBaseQty(l)) {
      errors.push(`Line ${n}: ${l.serials.length} serial number(s) picked for a base quantity of ${lineBaseQty(l)}.`)
    }
  })
  if (spec.formKind === 'physical_count' && active.length > 0 && counted === 0 && errors.length === 0) {
    errors.push('Every counted quantity equals the book quantity — there is nothing to adjust.')
  }
  return errors
}

function optNum(v: string): number | null {
  const n = toNumber(v)
  return n === null ? null : n
}

function lineToPayload(l: LineDraft, spec: DocumentTypeSpec, header: HeaderDraft): CreateDocumentLine {
  const out: CreateDocumentLine = {
    item_id: l.item_id ?? 0,
    warehouse_id: l.warehouse_id ?? (spec.lineMode === 'transfer' ? header.to_warehouse_id : header.default_warehouse_id) ?? null,
    unit_id: l.unit_id,
    qty: toNumber(l.qty) ?? 0,
    batch_id: l.batch_id,
  }
  if (spec.lineMode === 'transfer') {
    out.from_warehouse_id = l.from_warehouse_id ?? header.from_warehouse_id ?? null
  }
  if (spec.lineMode === 'by_line' && l.direction) out.direction = l.direction
  if (spec.formKind === 'physical_count') {
    out.qty = 0
    out.book_qty = optNum(l.book_qty)
    out.physical_qty = optNum(l.physical_qty)
  }
  const rate = optNum(l.rate)
  const amount = optNum(l.amount) ?? lineAmount(l.qty, l.rate)
  if (rate !== null) out.rate = rate
  if (amount !== null) out.amount = amount
  const vr = optNum(l.valuation_rate)
  if (vr !== null) out.valuation_rate = vr
  if (l.serials.length) out.serials = l.serials.map((s) => s.serial_id)
  if (l.description.trim()) out.description = l.description.trim()
  if (l.metadata && Object.keys(l.metadata).length) out.metadata = l.metadata
  return out
}

/** The create / update payload. Blank lines are dropped; the caller validates first. */
export function toPayload(header: HeaderDraft, lines: LineDraft[], spec: DocumentTypeSpec, options: { negativeOverride?: boolean } = {}): CreateDocumentPayload {
  const payload: CreateDocumentPayload = {
    document_type: spec.code,
    document_date: header.document_date,
    document_no: header.document_no.trim() || null,
    narration: header.narration.trim() || null,
    lines: lines.filter((l) => !isBlankLine(l)).map((l) => lineToPayload(l, spec, header)),
  }
  if (spec.party) {
    const ref = toNumber(header.party_ref)
    payload.party_ref = ref !== null && ref > 0 ? Math.floor(ref) : null
    payload.party_name = header.party_name.trim() || null
  }
  if (spec.lineMode === 'transfer') {
    payload.from_warehouse_id = header.from_warehouse_id
    payload.to_warehouse_id = header.to_warehouse_id
  }
  if (spec.stockEffects.length) payload.stock_effect = header.stock_effect || spec.stockEffects[0].value
  if (spec.returnable) {
    payload.returnable = header.returnable
    payload.expected_return_date = header.returnable && header.expected_return_date ? header.expected_return_date : null
  }
  if (spec.reason) {
    payload.reason_code = header.reason_code.trim() || null
    payload.movement_reason = header.movement_reason.trim() || null
  }
  const meta = cleanMetadata(header.metadata)
  if (meta) payload.metadata = meta
  if (options.negativeOverride) payload.negative_override = true
  return payload
}

function cleanMetadata(meta: DocumentMetadata): DocumentMetadata | null {
  const out: DocumentMetadata = {}
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return Object.keys(out).length ? out : null
}

export interface DraftTotals {
  lines: number
  qtyIn: number
  qtyOut: number
  amount: number
}

export function draftTotals(lines: LineDraft[], spec: DocumentTypeSpec): DraftTotals {
  const t: DraftTotals = { lines: 0, qtyIn: 0, qtyOut: 0, amount: 0 }
  for (const l of lines) {
    if (isBlankLine(l)) continue
    t.lines += 1
    const qty = spec.formKind === 'physical_count' ? Math.abs(countDifference(l.book_qty, l.physical_qty) ?? 0) : (toNumber(l.qty) ?? 0)
    let dir = l.direction
    if (spec.formKind === 'physical_count') {
      const d = countDifference(l.book_qty, l.physical_qty) ?? 0
      dir = d > 0 ? 'in' : d < 0 ? 'out' : null
    }
    if (dir === 'in') t.qtyIn = round4(t.qtyIn + qty)
    else if (dir === 'out') t.qtyOut = round4(t.qtyOut + qty)
    const amount = toNumber(l.amount) ?? lineAmount(l.qty, l.rate) ?? 0
    t.amount = round4(t.amount + amount)
  }
  return t
}
