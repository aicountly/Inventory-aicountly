/**
 * The pure half of the stock transfer workspace: what the header's extra fields
 * mean, how live stock is apportioned across the lines that draw on it, what
 * the summary adds up to, and which of those facts stop a post.
 *
 * Everything here is a function of the draft — no fetching, no React — so the
 * rules are unit-tested rather than clicked through. The draft shape itself is
 * the shared one (`documents/formModel`), and the payload is still built by
 * `toPayload`; this module only layers the transfer's own fields on top.
 */

import type { CreateDocumentPayload, DocumentMetadata } from '../types'
import type { DocumentTypeSpec } from '../registry'
import type { HeaderDraft, LineDraft } from '../formModel'
import { isBlankLine, lineBaseQty, round4, toPayload, conversionFactor } from '../formModel'
import { currencySymbol, formatMoney, toNumber } from '../../utils/format'
import { OTHER_REASON_CODE, reasonForCode } from './transferReasons'

/**
 * A stock transfer is not required to carry a reason by the API — `reason_code`
 * and `movement_reason` are nullable on every document type. This makes it an
 * entry rule for THIS screen only: the operator says why stock moved before it
 * moves. Flip it to false and the field goes back to optional everywhere,
 * including the asterisk and the post block. Nothing else depends on it.
 */
export const REASON_REQUIRED_TO_POST = true

/** Narration column is TEXT; this is an entry limit, matched by the counter. */
export const NARRATION_MAX = 500

// ---- header extras ------------------------------------------------------------------------

/**
 * The three fields the approved design adds to the header. They ride in
 * `metadata_json`, the column `inv_documents` already carries for exactly this
 * ("transport, packing marks …"), so no migration and no new table.
 *
 * `expected_arrival_date` deliberately does NOT reuse the `expected_return_date`
 * column: that one means "these goods are coming back to me" and drives job-work
 * and challan pending quantities. A transfer's arrival date is not a return.
 */
export interface TransferRefs {
  referenceType: string
  referenceNo: string
  expectedArrivalDate: string
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v)
}

export function readRefs(metadata: DocumentMetadata | null | undefined): TransferRefs {
  const m = metadata ?? {}
  return {
    referenceType: str(m.reference_type).trim(),
    referenceNo: str(m.reference_no).trim(),
    expectedArrivalDate: /^\d{4}-\d{2}-\d{2}$/.test(str(m.expected_arrival_date)) ? str(m.expected_arrival_date) : '',
  }
}

/** Writes the refs back, removing a key rather than storing an empty string. */
export function writeRefs(metadata: DocumentMetadata, refs: TransferRefs): DocumentMetadata {
  const next: DocumentMetadata = { ...metadata }
  const set = (key: string, value: string) => {
    if (value.trim()) next[key] = value.trim()
    else delete next[key]
  }
  set('reference_type', refs.referenceType)
  set('reference_no', refs.referenceNo)
  set('expected_arrival_date', refs.expectedArrivalDate)
  return next
}

/**
 * The create / update payload. `toPayload` builds everything a transfer already
 * had; the reason columns are added here because the shared builder only sends
 * them for types whose spec declares `reason`, and STOCK_TRANSFER's does not.
 */
export function transferPayload(
  header: HeaderDraft,
  lines: LineDraft[],
  spec: DocumentTypeSpec,
  options: { negativeOverride?: boolean } = {},
): CreateDocumentPayload {
  const payload = toPayload(header, lines, spec, options)
  const code = header.reason_code.trim().toUpperCase().slice(0, 32)
  payload.reason_code = code || null
  payload.movement_reason = header.movement_reason.trim().slice(0, 64) || null
  return payload
}

/** The label a reason renders as, whether it came from the catalogue or was typed. */
export function reasonLabel(header: Pick<HeaderDraft, 'reason_code' | 'movement_reason'>): string {
  const typed = header.movement_reason.trim()
  if (typed) return typed
  return reasonForCode(header.reason_code)?.label ?? header.reason_code.trim()
}

export function hasReason(header: Pick<HeaderDraft, 'reason_code' | 'movement_reason'>): boolean {
  const code = header.reason_code.trim()
  if (!code) return false
  // "Other" is the open option: picking it is not yet saying anything, so the
  // description beside it is what makes the reason a reason.
  if (code.toUpperCase() === OTHER_REASON_CODE) return header.movement_reason.trim().length > 0
  return true
}

// ---- live stock ---------------------------------------------------------------------------

export interface AvailabilityBuckets {
  on_hand: number
  reserved: number
  committed: number
  available: number
  in_transit: number
  expected: number
}

export const ZERO_BUCKETS: AvailabilityBuckets = { on_hand: 0, reserved: 0, committed: 0, available: 0, in_transit: 0, expected: 0 }

/** Adds one balance row into a running cell (an item across every batch). */
export function addBuckets(a: AvailabilityBuckets | undefined, b: AvailabilityBuckets): AvailabilityBuckets {
  if (!a) return b
  return {
    on_hand: round4(a.on_hand + b.on_hand),
    reserved: round4(a.reserved + b.reserved),
    committed: round4(a.committed + b.committed),
    available: round4(a.available + b.available),
    in_transit: round4(a.in_transit + b.in_transit),
    expected: round4(a.expected + b.expected),
  }
}

/** Index key for one (item, warehouse, batch) cell. Batch 0 means "every batch". */
export function stockKey(itemId: number, warehouseId: number | null, batchId: number | null): string {
  return `${itemId}:${warehouseId ?? 0}:${batchId ?? 0}`
}

/** Where a line takes stock FROM: its own override, else the header source. */
export function sourceWarehouseFor(line: Pick<LineDraft, 'from_warehouse_id'>, header: Pick<HeaderDraft, 'from_warehouse_id'>): number | null {
  return line.from_warehouse_id ?? header.from_warehouse_id ?? null
}

/** Where a line puts stock: its own override, else the header destination. */
export function destinationWarehouseFor(line: Pick<LineDraft, 'warehouse_id'>, header: Pick<HeaderDraft, 'to_warehouse_id'>): number | null {
  return line.warehouse_id ?? header.to_warehouse_id ?? null
}

/**
 * The item ids to ask about, grouped by the warehouse they will be drawn from.
 *
 * One request per distinct source warehouse — almost always exactly one — rather
 * than one per row: `GET /v1/availability` already takes a list of items and
 * returns every bucket for each, so a twenty-line transfer costs one call.
 */
export function availabilityRequests(lines: LineDraft[], header: Pick<HeaderDraft, 'from_warehouse_id'>): { warehouseId: number; itemIds: number[] }[] {
  const byWarehouse = new Map<number, Set<number>>()
  for (const line of lines) {
    if (!line.item_id) continue
    const wh = sourceWarehouseFor(line, header)
    if (!wh) continue
    const set = byWarehouse.get(wh) ?? new Set<number>()
    set.add(line.item_id)
    byWarehouse.set(wh, set)
  }
  return [...byWarehouse.entries()]
    .map(([warehouseId, ids]) => ({ warehouseId, itemIds: [...ids].sort((a, b) => a - b) }))
    .sort((a, b) => a.warehouseId - b.warehouseId)
}

export type StockState = 'no_source' | 'no_item' | 'loading' | 'ready'

export interface LineStock {
  state: StockState
  buckets: AvailabilityBuckets
  /** Base units this line asks for. */
  required: number
  /** Base units every OTHER line asks of the same item, warehouse and batch. */
  requiredByOthers: number
  /** available − (required + requiredByOthers); negative means short. */
  headroom: number
  short: boolean
  /** Short by this much, in base units. 0 when not short. */
  shortBy: number
  /** Not short, but the line takes more than nine tenths of what is there. */
  tight: boolean
}

const TIGHT_RATIO = 0.9

/**
 * What each line can actually draw, given every other line drawing on the same
 * stock. Two rows of the same item from the same warehouse compete for one
 * balance, and a per-row check that ignores the other row passes both.
 */
export function computeLineStock(
  lines: LineDraft[],
  header: Pick<HeaderDraft, 'from_warehouse_id'>,
  index: ReadonlyMap<string, AvailabilityBuckets>,
  pending: ReadonlySet<number>,
): Map<string, LineStock> {
  const demand = new Map<string, number>()
  for (const line of lines) {
    if (!line.item_id) continue
    const wh = sourceWarehouseFor(line, header)
    if (!wh) continue
    const key = stockKey(line.item_id, wh, line.batch_id)
    demand.set(key, round4((demand.get(key) ?? 0) + lineBaseQty(line)))
  }

  const out = new Map<string, LineStock>()
  for (const line of lines) {
    const wh = sourceWarehouseFor(line, header)
    if (!line.item_id) {
      out.set(line.key, { state: 'no_item', buckets: ZERO_BUCKETS, required: 0, requiredByOthers: 0, headroom: 0, short: false, shortBy: 0, tight: false })
      continue
    }
    if (!wh) {
      out.set(line.key, { state: 'no_source', buckets: ZERO_BUCKETS, required: 0, requiredByOthers: 0, headroom: 0, short: false, shortBy: 0, tight: false })
      continue
    }
    const key = stockKey(line.item_id, wh, line.batch_id)
    const buckets = index.get(key)
    const required = lineBaseQty(line)
    if (!buckets) {
      const state: StockState = pending.has(wh) ? 'loading' : 'ready'
      // Nothing came back for this cell: the balance row does not exist, which
      // is zero on hand, not "unknown". Treated as ready so a line against an
      // empty warehouse says so instead of spinning for ever.
      out.set(line.key, {
        state,
        buckets: ZERO_BUCKETS,
        required,
        requiredByOthers: round4((demand.get(key) ?? 0) - required),
        headroom: state === 'ready' ? round4(-required) : 0,
        short: state === 'ready' && required > 0,
        shortBy: state === 'ready' ? required : 0,
        tight: false,
      })
      continue
    }
    const total = demand.get(key) ?? required
    const headroom = round4(buckets.available - total)
    const short = headroom < -0.0001
    out.set(line.key, {
      state: 'ready',
      buckets,
      required,
      requiredByOthers: round4(total - required),
      headroom,
      short,
      shortBy: short ? round4(-headroom) : 0,
      tight: !short && buckets.available > 0 && total > 0 && total / buckets.available >= TIGHT_RATIO,
    })
  }
  return out
}

// ---- totals -------------------------------------------------------------------------------

export interface TransferTotals {
  /** Lines carrying an item or a quantity. */
  items: number
  /** Sum of the quantities as entered, in each line's own unit. */
  quantity: number
  /** Qty × the item's valuation rate, in base units. Null when no line is priced. */
  value: number | null
  /** How many of `items` contributed to `value`. */
  valuedLines: number
}

/**
 * The right rail's figures. `value` is an ESTIMATE from the valuation rates the
 * report endpoint serves; what the transfer actually posts at is decided by the
 * valuation engine when it posts, layer by layer.
 */
export function transferTotals(lines: LineDraft[], rates: ReadonlyMap<number, number> | null): TransferTotals {
  let items = 0
  let quantity = 0
  let value = 0
  let valuedLines = 0
  for (const line of lines) {
    if (isBlankLine(line)) continue
    items += 1
    quantity = round4(quantity + (toNumber(line.qty) ?? 0))
    const lineValue = estimatedLineValue(line, rates)
    if (lineValue !== null) {
      value = round4(value + lineValue)
      valuedLines += 1
    }
  }
  return { items, quantity, value: rates === null || valuedLines === 0 ? null : value, valuedLines }
}

/** Base quantity × the item's unit cost. Null when the rate is unknown or hidden. */
export function estimatedLineValue(line: LineDraft, rates: ReadonlyMap<number, number> | null): number | null {
  if (rates === null || line.item_id === null) return null
  const rate = rates.get(line.item_id)
  if (rate === undefined) return null
  return round4(lineBaseQty(line) * rate)
}

/** The unit cost expressed per ENTERED unit, for the "(₹ x each)" caption. */
export function estimatedUnitValue(line: LineDraft, rates: ReadonlyMap<number, number> | null): number | null {
  if (rates === null || line.item_id === null) return null
  const rate = rates.get(line.item_id)
  if (rate === undefined) return null
  return round4(rate * conversionFactor(line))
}

// ---- validation ---------------------------------------------------------------------------

export type IssueLevel = 'error' | 'warning'

export interface TransferIssue {
  id: string
  level: IssueLevel
  message: string
  /** Set when the issue belongs to one row. */
  lineKey?: string
  field?: 'document_date' | 'from_warehouse_id' | 'to_warehouse_id' | 'reason' | 'lines'
  /**
   * Show this before the user has tried to save anything.
   *
   * Most errors are "you have not finished yet" and shouting them at an empty
   * form is noise. A shortfall or an expired batch is different: it is news
   * about the world, not about the form, and the moment it is known is the
   * moment it is worth knowing.
   */
  always?: boolean
}

export interface ValidateOptions {
  header: HeaderDraft
  lines: LineDraft[]
  stock: ReadonlyMap<string, LineStock>
  /** From company settings; null when the user may not read them. */
  negativeStockPolicy: 'allow' | 'warn' | 'block' | null
  /** The selected financial year, to catch a date the server will refuse. */
  fyRange?: { from: string; to: string }
  /** Expiry date of the batch picked on a line, when it is known. */
  batchExpiry?: ReadonlyMap<string, string | null>
  /** Post-time rules only. A draft may be incomplete; the server allows it. */
  posting: boolean
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Every reason this transfer would be refused, or should be looked at twice.
 *
 * Errors block the button they belong to; warnings never do — the server holds
 * the last word on stock, and a warning that blocks is a frontend rule wearing
 * the server's authority. Nothing here replaces a server-side check: the API
 * re-validates the same ground, and it is the API that decides.
 */
export function validateTransfer({ header, lines, stock, negativeStockPolicy, fyRange, batchExpiry, posting }: ValidateOptions): TransferIssue[] {
  const issues: TransferIssue[] = []
  const push = (id: string, level: IssueLevel, message: string, extra: Partial<TransferIssue> = {}) => {
    issues.push({ id, level, message, ...extra })
  }

  if (!ISO_DATE.test(header.document_date)) {
    push('date_missing', 'error', 'Pick the date this transfer happened.', { field: 'document_date' })
  } else if (fyRange?.from && fyRange?.to && (header.document_date < fyRange.from || header.document_date > fyRange.to)) {
    push('date_outside_fy', 'error', `The document date is outside the selected financial year (${fyRange.from} to ${fyRange.to}).`, { field: 'document_date' })
  }

  if (!header.from_warehouse_id) push('from_missing', 'error', 'Choose the warehouse the stock leaves.', { field: 'from_warehouse_id' })
  if (!header.to_warehouse_id) push('to_missing', 'error', 'Choose the warehouse the stock arrives at.', { field: 'to_warehouse_id' })
  if (header.from_warehouse_id && header.to_warehouse_id && header.from_warehouse_id === header.to_warehouse_id) {
    push('same_warehouse', 'error', 'Source and destination cannot be the same warehouse.', { field: 'to_warehouse_id' })
  }

  const expected = readRefs(header.metadata).expectedArrivalDate
  if (expected && ISO_DATE.test(header.document_date) && expected < header.document_date) {
    push('arrival_before_document', 'error', 'Expected arrival cannot be before the document date.', { field: 'document_date' })
  }

  if (posting && REASON_REQUIRED_TO_POST && !hasReason(header)) {
    push('reason_missing', 'error', header.reason_code.trim() ? 'Describe the transfer reason beside "Other".' : 'Pick why this stock is moving.', { field: 'reason' })
  }

  if (header.narration.length > NARRATION_MAX) {
    push('narration_long', 'error', `Narration is limited to ${NARRATION_MAX} characters.`)
  }

  const active = lines.filter((l) => !isBlankLine(l))
  if (active.length === 0) {
    push('no_lines', 'error', 'Add at least one item to transfer.', { field: 'lines' })
  }

  const serialOwner = new Map<number, string>()

  active.forEach((line, i) => {
    const n = i + 1
    const at = (msg: string) => `Line ${n}: ${msg}`
    if (!line.item_id) {
      push(`line_item_${line.key}`, 'error', at('pick an item.'), { lineKey: line.key })
      return
    }
    const qty = toNumber(line.qty)
    if (qty === null || qty <= 0) {
      push(`line_qty_${line.key}`, 'error', at('quantity must be more than zero.'), { lineKey: line.key })
    }
    if (line.from_warehouse_id && line.warehouse_id && line.from_warehouse_id === line.warehouse_id) {
      push(`line_same_wh_${line.key}`, 'error', at('this row moves stock to the warehouse it came from.'), { lineKey: line.key })
    }

    if (posting && line.track_batch && line.batch_id === null) {
      push(`line_batch_${line.key}`, 'error', at(`${line.item_name || 'this item'} is batch tracked — pick the batch being moved.`), { lineKey: line.key })
    }
    if (posting && line.track_serial) {
      const need = lineBaseQty(line)
      if (line.serials.length === 0 && need > 0) {
        push(`line_serials_${line.key}`, 'error', at(`select ${need} serial number${need === 1 ? '' : 's'}.`), { lineKey: line.key })
      } else if (need > 0 && line.serials.length !== need) {
        push(`line_serial_count_${line.key}`, 'error', at(`${line.serials.length} of ${need} serial numbers selected.`), { lineKey: line.key })
      }
    }
    // A serial is one physical thing; two rows cannot both move it.
    for (const serial of line.serials) {
      const owner = serialOwner.get(serial.serial_id)
      if (owner && owner !== line.key) {
        push(`serial_dup_${serial.serial_id}`, 'error', at(`serial ${serial.serial_no ?? serial.serial_id} is already on another row.`), { lineKey: line.key })
      } else {
        serialOwner.set(serial.serial_id, line.key)
      }
    }

    const expiry = batchExpiry?.get(line.key) ?? null
    if (expiry && ISO_DATE.test(header.document_date) && expiry < header.document_date) {
      push(`line_expired_${line.key}`, 'warning', at(`the selected batch expired on ${expiry}.`), { lineKey: line.key, always: true })
    }

    const s = stock.get(line.key)
    if (s && s.state === 'ready' && s.short) {
      const where = line.batch_no ? `batch ${line.batch_no}` : 'the source warehouse'
      const detail = s.requiredByOthers > 0 ? ' once the other rows drawing on it are counted' : ''
      const message = at(`${line.item_name || 'this item'} is short by ${s.shortBy} in ${where}${detail}.`)
      // The policy is the company's, read from settings; when it cannot be read
      // this stays a warning and the server does the blocking, which it does
      // anyway — a post into negative stock comes back as negative_stock_blocked.
      //
      // A shortfall never blocks a DRAFT: the server saves one happily, and a
      // draft raised today for stock arriving tomorrow is ordinary work.
      const level: IssueLevel = posting && negativeStockPolicy === 'block' ? 'error' : 'warning'
      push(`line_short_${line.key}`, level, message, { lineKey: line.key, always: true })
    }
  })

  return issues
}

export function blockingIssues(issues: readonly TransferIssue[]): TransferIssue[] {
  return issues.filter((i) => i.level === 'error')
}

export function issuesForLine(issues: readonly TransferIssue[], lineKey: string): TransferIssue[] {
  return issues.filter((i) => i.lineKey === lineKey)
}

// ---- presentation ---------------------------------------------------------------------------

/**
 * An estimated amount with the company's own currency symbol, Indian digit
 * grouping (the app's `formatMoney`) and — when the base currency cannot be
 * read — no symbol at all rather than a guessed one.
 */
export function formatEstimate(value: number | null, currencyCode: string | null, empty = '—'): string {
  if (value === null) return empty
  const amount = formatMoney(value, empty)
  if (amount === empty) return empty
  return currencyCode ? `${currencySymbol(currencyCode)} ${amount}` : amount
}
