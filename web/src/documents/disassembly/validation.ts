/**
 * Everything the Disassembly screen refuses to post, and why.
 *
 * Pure: the caller hands in the draft plus the live facts it has already fetched (availability,
 * the company's negative-stock policy, the period lock, the financial year) and gets back a flat
 * list of issues. Each issue names the row and the field it belongs to, so the same list can be
 * rendered inline beside the control AND summarised at the top of the form — §24 of the brief
 * asks for both, and a toast alone loses the message the moment it fades.
 *
 * The server re-validates all of it. Nothing here is a substitute for that; it is only how the
 * user finds out before a round trip.
 */

import type { AvailabilityCheckResult } from '../../services/stockApi'
import { shortBy } from '../../services/stockApi'
import type { NegativeStockPolicy } from '../../services/settingsApi'
import { formatQty, toNumber } from '../../utils/format'
import { baseQtyOf, activeLines, duplicateComponentKeys } from './model'
import type { DisassemblyDraft } from './model'
import type { LineDraft } from '../formModel'

export type IssueSeverity = 'error' | 'warning'
export type IssueScope = 'header' | 'finished' | 'component'

export interface DisassemblyIssue {
  /** Stable within one validation pass — used as the React key. */
  id: string
  scope: IssueScope
  severity: IssueSeverity
  message: string
  /** Draft line the issue belongs to, when it belongs to one. */
  lineKey?: string
  /** Control inside that line (or header field name). */
  field?: string
}

export interface ValidationInput {
  draft: DisassemblyDraft
  /** Keyed by draft line key, from `useAvailability`. */
  availability: Record<string, AvailabilityCheckResult>
  /** From `GET /v1/settings`; null when the user may not read settings. */
  negativeStockPolicy: NegativeStockPolicy | null
  /** Holder of `stock.negative_override`. */
  canOverrideNegative: boolean
  /** User has ticked "post anyway". */
  overrideNegative: boolean
  /** Selected financial year, ISO dates; empty strings when unknown. */
  fyRange: { from: string; to: string }
  /** Latest unreleased period lock covering this branch, ISO date or null. */
  lockedUpto: string | null
  /** Warehouse ids this user may post to. Empty means "not loaded yet" and is not enforced. */
  allowedWarehouseIds: readonly number[]
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function qtyOf(line: LineDraft): number | null {
  return toNumber(line.qty)
}

function lineLabel(line: LineDraft, index: number): string {
  return line.item_name ? `${line.item_name}` : `Row ${index + 1}`
}

/** Every reason this draft cannot post, most structural first. */
export function validateDisassembly(input: ValidationInput): DisassemblyIssue[] {
  const { draft, availability } = input
  const issues: DisassemblyIssue[] = []
  const push = (issue: DisassemblyIssue) => issues.push(issue)

  // ---- header ----------------------------------------------------------------
  const date = draft.header.document_date
  if (!ISO_DATE.test(date)) {
    push({ id: 'date-required', scope: 'header', severity: 'error', field: 'document_date', message: 'Enter the document date.' })
  } else {
    if (input.fyRange.from && input.fyRange.to && (date < input.fyRange.from || date > input.fyRange.to)) {
      push({
        id: 'date-outside-fy',
        scope: 'header',
        severity: 'error',
        field: 'document_date',
        message: `The document date is outside the selected financial year (${input.fyRange.from} to ${input.fyRange.to}). Switch the year in the header or change the date.`,
      })
    }
    if (input.lockedUpto && date <= input.lockedUpto) {
      push({
        id: 'period-locked',
        scope: 'header',
        severity: 'error',
        field: 'document_date',
        message: `The period up to ${input.lockedUpto} is locked. Pick a later date or ask an administrator to release the lock.`,
      })
    }
  }
  if (draft.header.default_warehouse_id === null) {
    push({ id: 'warehouse-required', scope: 'header', severity: 'error', field: 'default_warehouse_id', message: 'Choose the default warehouse the document posts to.' })
  }
  if (draft.header.narration.length > 500) {
    push({ id: 'narration-length', scope: 'header', severity: 'error', field: 'narration', message: 'Narration is limited to 500 characters.' })
  }

  // ---- finished product ------------------------------------------------------
  const finished = activeLines(draft.finished)
  if (finished.length === 0) {
    push({ id: 'finished-required', scope: 'finished', severity: 'error', message: 'Pick the finished product you want to disassemble.' })
  }
  draft.finished.forEach((line, i) => {
    if (line.item_id === null && qtyOf(line) === null) return
    const label = lineLabel(line, i)
    if (line.item_id === null) {
      push({ id: `f-item-${line.key}`, scope: 'finished', severity: 'error', lineKey: line.key, field: 'item', message: `${label}: pick an item.` })
      return
    }
    const qty = qtyOf(line)
    if (qty === null || qty <= 0) {
      push({ id: `f-qty-${line.key}`, scope: 'finished', severity: 'error', lineKey: line.key, field: 'qty', message: `${label}: quantity to disassemble must be greater than zero.` })
    }
    if (line.warehouse_id === null) {
      push({ id: `f-wh-${line.key}`, scope: 'finished', severity: 'error', lineKey: line.key, field: 'warehouse', message: `${label}: choose the warehouse the stock is issued from.` })
    } else if (input.allowedWarehouseIds.length > 0 && !input.allowedWarehouseIds.includes(line.warehouse_id)) {
      push({ id: `f-wh-allowed-${line.key}`, scope: 'finished', severity: 'error', lineKey: line.key, field: 'warehouse', message: `${label}: you cannot post to that warehouse.` })
    }
    if (line.unit_id === null && line.units.length > 0) {
      push({ id: `f-unit-${line.key}`, scope: 'finished', severity: 'error', lineKey: line.key, field: 'unit', message: `${label}: choose a unit.` })
    }
    // Issuing a batch-tracked item without naming the batch would let the engine pick for you.
    if (line.track_batch && line.batch_id === null) {
      push({ id: `f-batch-${line.key}`, scope: 'finished', severity: 'error', lineKey: line.key, field: 'batch', message: `${label}: pick the batch being disassembled.` })
    }
    if (line.track_serial) {
      const need = baseQtyOf(line)
      if (line.serials.length === 0) {
        push({ id: `f-serial-${line.key}`, scope: 'finished', severity: 'error', lineKey: line.key, field: 'serials', message: `${label}: pick the ${formatQty(need, '0')} serial number(s) being disassembled.` })
      } else if (need > 0 && line.serials.length !== need) {
        push({ id: `f-serial-count-${line.key}`, scope: 'finished', severity: 'error', lineKey: line.key, field: 'serials', message: `${label}: ${line.serials.length} serial number(s) picked for a quantity of ${formatQty(need)}.` })
      }
      const unique = new Set(line.serials.map((s) => s.serial_id))
      if (unique.size !== line.serials.length) {
        push({ id: `f-serial-dupe-${line.key}`, scope: 'finished', severity: 'error', lineKey: line.key, field: 'serials', message: `${label}: the same serial number is selected twice.` })
      }
    }
    // Availability. The policy decides whether it blocks: a company that allows negative stock
    // has decided this is a warning, and hard-coding a block here would overrule its setting.
    const avail = availability[line.key]
    if (avail && !avail.ok) {
      const blocking = input.negativeStockPolicy === 'block' && !(input.canOverrideNegative && input.overrideNegative)
      push({
        id: `f-avail-${line.key}`,
        scope: 'finished',
        severity: blocking ? 'error' : 'warning',
        lineKey: line.key,
        field: 'qty',
        message: `${label}: only ${formatQty(avail.available)} available where this line posts — short by ${formatQty(shortBy(avail))}.`,
      })
    }
  })

  // ---- components ------------------------------------------------------------
  const components = activeLines(draft.components)
  if (components.length === 0) {
    push({ id: 'components-required', scope: 'component', severity: 'error', message: 'Add at least one component this product breaks into.' })
  }
  const dupes = duplicateComponentKeys(draft.components)
  draft.components.forEach((line, i) => {
    if (line.item_id === null && qtyOf(line) === null) return
    const label = lineLabel(line, i)
    if (line.item_id === null) {
      push({ id: `c-item-${line.key}`, scope: 'component', severity: 'error', lineKey: line.key, field: 'item', message: `${label}: pick an item.` })
      return
    }
    const qty = qtyOf(line)
    if (qty === null || qty <= 0) {
      push({ id: `c-qty-${line.key}`, scope: 'component', severity: 'error', lineKey: line.key, field: 'qty', message: `${label}: quantity produced must be greater than zero.` })
    }
    if (line.warehouse_id === null) {
      push({ id: `c-wh-${line.key}`, scope: 'component', severity: 'error', lineKey: line.key, field: 'warehouse', message: `${label}: choose the warehouse the component is received into.` })
    } else if (input.allowedWarehouseIds.length > 0 && !input.allowedWarehouseIds.includes(line.warehouse_id)) {
      push({ id: `c-wh-allowed-${line.key}`, scope: 'component', severity: 'error', lineKey: line.key, field: 'warehouse', message: `${label}: you cannot post to that warehouse.` })
    }
    if (line.unit_id === null && line.units.length > 0) {
      push({ id: `c-unit-${line.key}`, scope: 'component', severity: 'error', lineKey: line.key, field: 'unit', message: `${label}: choose a unit.` })
    }
    const rate = toNumber(line.valuation_rate)
    if (rate !== null && rate < 0) {
      push({ id: `c-cost-${line.key}`, scope: 'component', severity: 'error', lineKey: line.key, field: 'cost', message: `${label}: unit cost cannot be negative.` })
    }
    if (rate === null || rate === 0) {
      push({
        id: `c-cost-zero-${line.key}`,
        scope: 'component',
        severity: 'warning',
        lineKey: line.key,
        field: 'cost',
        message: `${label}: no unit cost — the component will be received at the cost the posting engine computes.`,
      })
    }
    if (line.track_serial) {
      const need = baseQtyOf(line)
      if (line.serials.length > 0 && need > 0 && line.serials.length !== need) {
        push({ id: `c-serial-count-${line.key}`, scope: 'component', severity: 'error', lineKey: line.key, field: 'serials', message: `${label}: ${line.serials.length} serial number(s) for a quantity of ${formatQty(need)}.` })
      } else if (line.serials.length === 0) {
        push({ id: `c-serial-${line.key}`, scope: 'component', severity: 'warning', lineKey: line.key, field: 'serials', message: `${label}: serial numbers are not assigned yet.` })
      }
    }
    if (dupes.has(line.key)) {
      push({
        id: `c-dupe-${line.key}`,
        scope: 'component',
        severity: 'warning',
        lineKey: line.key,
        field: 'item',
        message: `${label}: the same item, warehouse, batch and unit appears on more than one row. Merge them or change one.`,
      })
    }
  })

  return issues
}

export function errorsOf(issues: readonly DisassemblyIssue[]): DisassemblyIssue[] {
  return issues.filter((i) => i.severity === 'error')
}

export function warningsOf(issues: readonly DisassemblyIssue[]): DisassemblyIssue[] {
  return issues.filter((i) => i.severity === 'warning')
}

/** First message per (line, field) — what a control renders under itself. */
export function fieldErrors(issues: readonly DisassemblyIssue[]): Map<string, DisassemblyIssue> {
  const map = new Map<string, DisassemblyIssue>()
  for (const issue of issues) {
    if (!issue.lineKey || !issue.field) continue
    const key = `${issue.lineKey}:${issue.field}`
    const seen = map.get(key)
    if (!seen || (seen.severity === 'warning' && issue.severity === 'error')) map.set(key, issue)
  }
  return map
}

/** Header-level messages keyed by field name. */
export function headerErrors(issues: readonly DisassemblyIssue[]): Map<string, DisassemblyIssue> {
  const map = new Map<string, DisassemblyIssue>()
  for (const issue of issues) {
    if (issue.scope !== 'header' || !issue.field || map.has(issue.field)) continue
    map.set(issue.field, issue)
  }
  return map
}
