/**
 * Stock Journal: the pure half of the screen.
 *
 * Reason codes, the quick chips over them, the contextual warning engine and the
 * derived totals. Everything here is a pure function of the draft so it is unit
 * tested without a DOM, and so the screen never keeps a derived number in state.
 *
 * The draft shape itself is `documents/formModel` — a Stock Journal is an
 * ordinary `by_line` document and posts through the same payload builder as the
 * other twenty types. Nothing in this file forks that contract.
 */

import { countDifference, isBlankLine, lineAmount, lineBaseQty, round4 } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { shortBy } from '../../services/stockApi'
import { formatQty, toNumber } from '../../utils/format'

/* -------------------------------------------------------------------------- */
/* Reason codes                                                               */
/* -------------------------------------------------------------------------- */

export interface ReasonCodeOption {
  /** Stored verbatim in `inv_documents.reason_code` (varchar 32). */
  code: string
  label: string
  hint: string
}

/**
 * The reason codes a stock journal offers.
 *
 * Inventory has no reason-code master: `reason_code` is a free 32-character
 * column on the document (DocumentService::create), which is why the old screen
 * showed a bare text box and why this list cannot pretend to be an API read.
 * It is a curated catalogue of the adjustments a stock journal actually books,
 * and the field stays open — `ReasonCodeSelect` accepts any code the user types,
 * so codes already on posted documents keep round-tripping unchanged.
 */
export const STOCK_JOURNAL_REASONS: readonly ReasonCodeOption[] = [
  { code: 'DAMAGE', label: 'Damage', hint: 'Stock damaged and no longer sellable.' },
  { code: 'BREAKAGE', label: 'Breakage', hint: 'Stock broken in handling or storage.' },
  { code: 'TRANSFER', label: 'Transfer', hint: 'Movement between two warehouses booked as one journal.' },
  { code: 'RECLASSIFICATION', label: 'Reclassification', hint: 'Same goods, different item, batch or warehouse.' },
  { code: 'SHORTAGE', label: 'Shortage', hint: 'Less stock found than the books show.' },
  { code: 'EXCESS', label: 'Excess', hint: 'More stock found than the books show.' },
  { code: 'COUNT_ADJUSTMENT', label: 'Stock count adjustment', hint: 'Correction arising from a physical count.' },
  { code: 'OPENING_CORRECTION', label: 'Opening correction', hint: 'Correction to an opening balance, where the period permits it.' },
  { code: 'OTHER', label: 'Other', hint: 'Anything the codes above do not describe — say what in the movement reason.' },
]

const REASON_BY_CODE = new Map(STOCK_JOURNAL_REASONS.map((r) => [r.code, r]))

export function reasonFor(code: string | null | undefined): ReasonCodeOption | null {
  if (!code) return null
  return REASON_BY_CODE.get(code.trim().toUpperCase()) ?? null
}

/** Label for a code, including one this catalogue does not know. */
export function reasonLabel(code: string | null | undefined): string {
  if (!code || !code.trim()) return ''
  return reasonFor(code)?.label ?? code.trim()
}

export interface ReasonChip {
  label: string
  reasonCode: string
  /** Pre-fills the movement reason when it is still empty. */
  movementReason: string
}

/**
 * The chips under the narration. Each one only fills the header in — a chip
 * never adds a line and never posts, because "Damage / Breakage" is a statement
 * about why stock moved, not an instruction to move it.
 */
export const REASON_CHIPS: readonly ReasonChip[] = [
  { label: 'Transfer between warehouses', reasonCode: 'TRANSFER', movementReason: 'Warehouse transfer' },
  { label: 'Damage / Breakage', reasonCode: 'DAMAGE', movementReason: 'Damaged in transit' },
  { label: 'Reclassification', reasonCode: 'RECLASSIFICATION', movementReason: 'Reclassified stock' },
  { label: 'Stock Count Adjustment', reasonCode: 'COUNT_ADJUSTMENT', movementReason: 'Physical count correction' },
  { label: 'Opening Balance', reasonCode: 'OPENING_CORRECTION', movementReason: 'Opening balance correction' },
  { label: 'Others', reasonCode: 'OTHER', movementReason: '' },
]

/* -------------------------------------------------------------------------- */
/* Totals                                                                     */
/* -------------------------------------------------------------------------- */

export interface JournalTotals {
  lines: number
  /** Entered quantity, by direction. */
  qtyIn: number
  qtyOut: number
  netQty: number
  valueIn: number
  valueOut: number
  netValue: number
}

/**
 * The running figures under the grid.
 *
 * Quantities are summed as entered, not converted to base units: the column the
 * reader is adding up is the Qty column. Values use the same `qty × rate` the
 * row shows, at the same 4-decimal rounding the server applies, so the footer
 * and the rows can never disagree.
 *
 * Nothing here is sent to the server — DocumentPostingService computes the
 * authoritative quantities and values on post. These are for the person typing.
 */
export function journalTotals(lines: readonly LineDraft[]): JournalTotals {
  const t: JournalTotals = { lines: 0, qtyIn: 0, qtyOut: 0, netQty: 0, valueIn: 0, valueOut: 0, netValue: 0 }
  for (const line of lines) {
    if (isBlankLine(line)) continue
    t.lines += 1
    const qty = toNumber(line.qty) ?? 0
    const amount = toNumber(line.amount) ?? lineAmount(line.qty, line.rate) ?? 0
    if (line.direction === 'in') {
      t.qtyIn = round4(t.qtyIn + qty)
      t.valueIn = round4(t.valueIn + amount)
    } else if (line.direction === 'out') {
      t.qtyOut = round4(t.qtyOut + qty)
      t.valueOut = round4(t.valueOut + amount)
    }
  }
  t.netQty = round4(t.qtyIn - t.qtyOut)
  t.netValue = round4(t.valueIn - t.valueOut)
  return t
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export type ValidationScope = 'header' | 'line'

export interface JournalError {
  scope: ValidationScope
  /** Header field name, for anchoring the message under the input. */
  field?: 'document_date' | 'document_no' | 'reason_code' | 'default_warehouse_id' | 'lines'
  /** Draft line key, for anchoring the message on the row. */
  lineKey?: string
  message: string
}

export interface ValidateOptions {
  /** Posting asks for more than saving a draft does. */
  posting: boolean
  /** Selected financial year, ISO dates; '' when not known yet. */
  fyRange?: { from: string; to: string }
  /** `locked_upto_date` for the branch, when a lock is in force. */
  lockedUpto?: string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * What the screen refuses to send.
 *
 * Deliberately a subset of what the server refuses: DocumentService and
 * DocumentPostingService validate every one of these again, plus the things only
 * the database can know (current stock under a lock, period locks, warehouse
 * access). This exists so the message lands next to the field instead of
 * arriving as a 422 banner — it is never the authority.
 */
export function validateJournal(
  header: HeaderDraft,
  lines: readonly LineDraft[],
  options: ValidateOptions,
): JournalError[] {
  const errors: JournalError[] = []
  const { posting, fyRange, lockedUpto } = options

  if (!ISO_DATE.test(header.document_date)) {
    errors.push({ scope: 'header', field: 'document_date', message: 'Enter the document date.' })
  } else {
    if (fyRange?.from && header.document_date < fyRange.from) {
      errors.push({ scope: 'header', field: 'document_date', message: `The date is before the selected financial year starts (${fyRange.from}).` })
    }
    if (fyRange?.to && header.document_date > fyRange.to) {
      errors.push({ scope: 'header', field: 'document_date', message: `The date is after the selected financial year ends (${fyRange.to}).` })
    }
    if (posting && lockedUpto && header.document_date <= lockedUpto) {
      errors.push({ scope: 'header', field: 'document_date', message: `The period is locked up to ${lockedUpto}. Pick a later date or release the lock.` })
    }
  }

  if (posting && !header.reason_code.trim()) {
    errors.push({ scope: 'header', field: 'reason_code', message: 'Pick the reason this stock is being adjusted.' })
  }

  const active = lines.filter((l) => !isBlankLine(l))
  if (active.length === 0) {
    errors.push({ scope: 'header', field: 'lines', message: 'Add at least one stock journal line.' })
    return errors
  }

  const seenSerials = new Map<number, number>()
  active.forEach((line, i) => {
    const n = i + 1
    const at = (message: string): JournalError => ({ scope: 'line', lineKey: line.key, message: `Line ${n}: ${message}` })

    if (!line.item_id) errors.push(at('pick an item.'))
    if (!line.direction) errors.push(at('choose In or Out.'))
    if (line.warehouse_id === null) errors.push(at('pick a warehouse.'))

    const qty = toNumber(line.qty)
    if (qty === null || qty <= 0) errors.push(at('quantity must be greater than zero.'))

    const rate = toNumber(line.rate)
    if (rate !== null && rate < 0) errors.push(at('rate cannot be negative.'))

    // Serials are identity, not a count: one number is one physical unit, so the
    // base quantity is exactly how many the line needs.
    if (line.track_serial && line.serials.length > 0) {
      const required = lineBaseQty(line)
      if (required > 0 && line.serials.length !== required) {
        errors.push(at(`${line.serials.length} serial number${line.serials.length === 1 ? '' : 's'} selected for a base quantity of ${formatQty(required)}.`))
      }
    }
    if (posting && line.track_serial && line.serials.length === 0 && (qty ?? 0) > 0) {
      errors.push(at('this item is serial tracked — select the serial numbers.'))
    }
    if (posting && line.track_batch && line.batch_id === null) {
      errors.push(at('this item is batch tracked — select a batch.'))
    }

    for (const s of line.serials) {
      const firstSeen = seenSerials.get(s.serial_id)
      if (firstSeen !== undefined && firstSeen !== n) {
        errors.push(at(`serial ${s.serial_no ?? `#${s.serial_id}`} is already used on line ${firstSeen}.`))
      } else if (firstSeen === undefined) {
        seenSerials.set(s.serial_id, n)
      }
    }
  })

  return errors
}

/** The subset of errors anchored to one row, for the inline message under it. */
export function errorsForLine(errors: readonly JournalError[], lineKey: string): JournalError[] {
  return errors.filter((e) => e.lineKey === lineKey)
}

export function errorForField(errors: readonly JournalError[], field: NonNullable<JournalError['field']>): string | null {
  return errors.find((e) => e.scope === 'header' && e.field === field)?.message ?? null
}

/* -------------------------------------------------------------------------- */
/* Contextual warnings                                                        */
/* -------------------------------------------------------------------------- */

export type WarningLevel = 'info' | 'warning' | 'blocking'

export interface JournalWarning {
  level: WarningLevel
  code: string
  message: string
  /** Set when the warning belongs to one row. */
  lineKey?: string
}

export interface WarningInput {
  header: HeaderDraft
  lines: readonly LineDraft[]
  availability: Record<string, AvailabilityCheckResult>
  /** Warehouse ids the profile may post to; a line outside it is flagged. */
  knownWarehouseIds: readonly number[]
  negativeStockPolicy: 'allow' | 'warn' | 'block' | string
  fyRange?: { from: string; to: string }
  lockedUpto?: string | null
  /** Today, so an expiry check does not need a clock. */
  today: string
}

/**
 * Everything worth saying about the draft that is not an outright refusal.
 *
 * Levels mean what they say: `blocking` is something the server will reject,
 * `warning` is something the user probably did not intend, `info` is a fact
 * worth knowing. The screen renders them inline — beside the row that caused
 * one — rather than as a toast, because a toast about line 7 of 40 is unusable.
 */
export function buildWarnings(input: WarningInput): JournalWarning[] {
  const { header, lines, availability, knownWarehouseIds, negativeStockPolicy, fyRange, lockedUpto, today } = input
  const out: JournalWarning[] = []
  const known = new Set(knownWarehouseIds)

  if (lockedUpto && header.document_date && header.document_date <= lockedUpto) {
    out.push({
      level: 'blocking',
      code: 'period_locked',
      message: `The document date falls inside a locked period (locked up to ${lockedUpto}). Posting will be refused.`,
    })
  }

  if (header.document_date && fyRange?.from && fyRange?.to && (header.document_date < fyRange.from || header.document_date > fyRange.to)) {
    out.push({
      level: 'warning',
      code: 'outside_fy',
      message: `The document date is outside the selected financial year (${fyRange.from} to ${fyRange.to}).`,
    })
  }

  for (const line of lines) {
    if (isBlankLine(line)) continue
    const label = line.item_name || (line.item_id ? `Item #${line.item_id}` : 'This line')

    if (line.warehouse_id !== null && known.size > 0 && !known.has(line.warehouse_id)) {
      out.push({
        level: 'warning',
        code: 'warehouse_unavailable',
        lineKey: line.key,
        message: `${label}: the selected warehouse is not active for this branch, or is outside your warehouse access.`,
      })
    }

    if (line.direction === 'out') {
      const result = availability[line.key]
      if (result && !result.ok) {
        const short = shortBy(result)
        const blocked = negativeStockPolicy === 'block'
        out.push({
          level: blocked ? 'blocking' : 'warning',
          code: 'insufficient_stock',
          lineKey: line.key,
          message: `${label}: only ${formatQty(result.available)} available, short by ${formatQty(short)}.${blocked ? ' This company blocks negative stock.' : ' Posting will take stock negative.'}`,
        })
      } else if (result && result.ok && result.available > 0) {
        const needed = lineBaseQty(line)
        // "Nearly all of it" is worth a word before it is posted, not after.
        if (needed > 0 && needed / result.available >= 0.9) {
          out.push({
            level: 'info',
            code: 'low_stock_after',
            lineKey: line.key,
            message: `${label}: this leaves ${formatQty(round4(result.available - needed))} in the selected warehouse.`,
          })
        }
      }
    }

    if (line.direction === 'in' && toNumber(line.rate) === null && toNumber(line.valuation_rate) === null) {
      out.push({
        level: 'warning',
        code: 'missing_rate',
        lineKey: line.key,
        message: `${label}: an inward line with no rate is brought into stock at zero value.`,
      })
    }

    if (line.batch_expiry && line.direction === 'out' && line.batch_expiry < today) {
      out.push({
        level: 'warning',
        code: 'batch_expired',
        lineKey: line.key,
        message: `${label}: batch ${line.batch_no ?? ''} expired on ${line.batch_expiry}.`.replace('  ', ' '),
      })
    }
  }

  return out
}

export function warningsForLine(warnings: readonly JournalWarning[], lineKey: string): JournalWarning[] {
  return warnings.filter((w) => w.lineKey === lineKey)
}

/** Warnings that belong to the document rather than to one row. */
export function documentWarnings(warnings: readonly JournalWarning[]): JournalWarning[] {
  return warnings.filter((w) => !w.lineKey)
}

export function highestLevel(warnings: readonly JournalWarning[]): WarningLevel | null {
  if (warnings.some((w) => w.level === 'blocking')) return 'blocking'
  if (warnings.some((w) => w.level === 'warning')) return 'warning'
  if (warnings.some((w) => w.level === 'info')) return 'info'
  return null
}

/* -------------------------------------------------------------------------- */
/* Column settings                                                            */
/* -------------------------------------------------------------------------- */

/** Columns the reader may hide. Item, quantity and direction are not optional. */
export type OptionalColumn = 'batch' | 'unit' | 'rate' | 'amount' | 'remarks' | 'availability'

export const OPTIONAL_COLUMNS: readonly { key: OptionalColumn; label: string; hint: string }[] = [
  { key: 'batch', label: 'Batch / Serial', hint: 'Tracking selection for batch and serial items.' },
  { key: 'unit', label: 'Unit', hint: 'Stock unit, and alternate units where configured.' },
  { key: 'rate', label: 'Rate', hint: 'Valuation rate per unit.' },
  { key: 'amount', label: 'Amount', hint: 'Quantity × rate.' },
  { key: 'remarks', label: 'Remarks', hint: 'Per-line note.' },
  { key: 'availability', label: 'Availability', hint: 'Live stock for outward lines.' },
]

export type ColumnVisibility = Record<OptionalColumn, boolean>

export const DEFAULT_COLUMNS: ColumnVisibility = {
  batch: true,
  unit: true,
  rate: true,
  amount: true,
  remarks: true,
  availability: true,
}

/* -------------------------------------------------------------------------- */
/* Misc helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Whether deleting the row needs a confirmation. An untouched row is just an
 * empty slot; one carrying an item, a quantity or a tracking selection is work.
 */
export function rowNeedsDeleteConfirm(line: LineDraft): boolean {
  if (line.item_id !== null) return true
  if (line.serials.length > 0 || line.batch_id !== null) return true
  return line.qty.trim() !== '' || line.rate.trim() !== '' || line.description.trim() !== ''
}

/** A stock journal is a `by_line` document; this keeps the assumption in one place. */
export function isStockJournal(spec: DocumentTypeSpec): boolean {
  return spec.code === 'STOCK_JOURNAL'
}

/** Re-exported so the screen imports its arithmetic from one place. */
export { countDifference, lineAmount, lineBaseQty, round4 }
