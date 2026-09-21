/**
 * The checks the Smart insights panel runs over a delivery challan.
 *
 * Every rule here is deterministic and reads only what the page actually holds:
 * the draft, the live availability results the form already fetched, the batch
 * rows the batch picker returned and the party context Inventory's own API
 * answered. Nothing is predicted, inferred or invented — there is no model
 * behind this panel, and a line it cannot verify produces no insight rather
 * than a guess.
 *
 * Pure, so the rule set is unit-tested rather than eyeballed.
 */

import type { AvailabilityCheckResult } from '../../services/stockApi'
import { shortBy } from '../../services/stockApi'
import { formatQty, toNumber } from '../../utils/format'
import type { HeaderDraft, LineDraft } from '../formModel'
import { isBlankLine, lineBaseQty } from '../formModel'
import type { TransportDetails } from './challanMeta'
import { transportIsEmpty } from './challanMeta'
import type { PartyContext } from '../../services/partyApi'

export type InsightTone = 'success' | 'warning' | 'info' | 'action' | 'danger'

export interface Insight {
  id: string
  tone: InsightTone
  message: string
  /** Draft line keys the insight is about, so the table can highlight them. */
  lineKeys?: string[]
  /** True when it must be fixed before the document can post. */
  blocking?: boolean
}

/** Expiry / batch facts the batch picker learned, keyed by draft line. */
export interface LineBatchFact {
  batch_no: string | null
  expiry_date: string | null
  available: number | null
}

export interface InsightInput {
  header: HeaderDraft
  lines: LineDraft[]
  availability: Record<string, AvailabilityCheckResult>
  checking: boolean
  batchFacts: Record<string, LineBatchFact>
  transport: TransportDetails
  party: PartyContext | null
  /** Today, ISO — passed in so the expiry rule is testable. */
  today: string
}

/** Days from `today` to `date`; null when either is not a plain ISO date. */
export function daysUntil(date: string | null | undefined, today: string): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date) || !/^\d{4}-\d{2}-\d{2}/.test(today)) return null
  const a = Date.parse(`${date.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${today.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((a - b) / 86_400_000)
}

/** Lines that name the same item in the same warehouse and batch more than once. */
export function duplicateLineKeys(lines: LineDraft[], defaultWarehouseId: number | null): string[] {
  const seen = new Map<string, string[]>()
  for (const line of lines) {
    if (isBlankLine(line) || line.item_id === null) continue
    const key = `${line.item_id}|${line.warehouse_id ?? defaultWarehouseId ?? 0}|${line.batch_id ?? 0}`
    const bucket = seen.get(key)
    if (bucket) bucket.push(line.key)
    else seen.set(key, [line.key])
  }
  return [...seen.values()].filter((keys) => keys.length > 1).flat()
}

const NEAR_EXPIRY_DAYS = 30

export function buildInsights(input: InsightInput): Insight[] {
  const { header, lines, availability, checking, batchFacts, transport, party, today } = input
  const active = lines.filter((l) => !isBlankLine(l))
  const out: Insight[] = []

  if (active.length === 0) {
    out.push({ id: 'no-lines', tone: 'warning', message: 'No items yet — search an item or scan a barcode to start the challan.', blocking: true })
  }

  if (!header.party_name.trim() && !toNumber(header.party_ref)) {
    out.push({ id: 'no-customer', tone: 'warning', message: 'No customer on the challan. Pick one so the dispatch can be matched to its invoice later.', blocking: true })
  } else if (!toNumber(header.party_ref)) {
    out.push({
      id: 'no-ledger',
      tone: 'info',
      message: 'This challan carries a customer name but no ledger id. Pending quantities are matched on the ledger id, so the invoice will not settle this challan automatically without one.',
    })
  }

  const missingItem = active.filter((l) => l.item_id === null).map((l) => l.key)
  if (missingItem.length) {
    out.push({ id: 'line-no-item', tone: 'danger', message: `${missingItem.length} line${missingItem.length === 1 ? ' has' : 's have'} no item picked.`, lineKeys: missingItem, blocking: true })
  }

  const badQty = active.filter((l) => l.item_id !== null && (toNumber(l.qty) ?? 0) <= 0).map((l) => l.key)
  if (badQty.length) {
    out.push({ id: 'line-no-qty', tone: 'danger', message: `${badQty.length} line${badQty.length === 1 ? '' : 's'} need${badQty.length === 1 ? 's' : ''} a quantity greater than zero.`, lineKeys: badQty, blocking: true })
  }

  const serialShort = active.filter((l) => l.track_serial && l.item_id !== null && lineBaseQty(l) > 0 && l.serials.length !== lineBaseQty(l))
  if (serialShort.length) {
    const first = serialShort[0]
    out.push({
      id: 'serials',
      tone: 'danger',
      message:
        serialShort.length === 1
          ? `${first.item_name || 'A serial-tracked item'}: ${first.serials.length} of ${formatQty(lineBaseQty(first))} serial numbers picked.`
          : `${serialShort.length} serial-tracked lines do not have a serial number for every unit.`,
      lineKeys: serialShort.map((l) => l.key),
      blocking: true,
    })
  }

  const batchMissing = active.filter((l) => l.track_batch && l.item_id !== null && l.batch_id === null).map((l) => l.key)
  if (batchMissing.length) {
    out.push({
      id: 'batch-missing',
      tone: 'warning',
      message: `${batchMissing.length} batch-tracked line${batchMissing.length === 1 ? ' has' : 's have'} no batch selected.`,
      lineKeys: batchMissing,
    })
  }

  const expired: string[] = []
  const nearExpiry: string[] = []
  for (const line of active) {
    const fact = batchFacts[line.key]
    const days = daysUntil(fact?.expiry_date, today)
    if (days === null) continue
    if (days < 0) expired.push(line.key)
    else if (days <= NEAR_EXPIRY_DAYS) nearExpiry.push(line.key)
  }
  if (expired.length) {
    out.push({ id: 'batch-expired', tone: 'danger', message: `${expired.length} line${expired.length === 1 ? '' : 's'} dispatch a batch whose expiry date has passed.`, lineKeys: expired })
  }
  if (nearExpiry.length) {
    out.push({ id: 'batch-near-expiry', tone: 'warning', message: `${nearExpiry.length} line${nearExpiry.length === 1 ? '' : 's'} use a batch expiring within ${NEAR_EXPIRY_DAYS} days.`, lineKeys: nearExpiry })
  }

  const duplicates = duplicateLineKeys(active, header.default_warehouse_id)
  if (duplicates.length) {
    out.push({ id: 'duplicates', tone: 'warning', message: 'The same item, warehouse and batch appears on more than one line. Merge them unless the split is deliberate.', lineKeys: duplicates })
  }

  const mixedWarehouse = new Set(active.filter((l) => l.item_id !== null).map((l) => l.warehouse_id ?? header.default_warehouse_id ?? 0))
  if (mixedWarehouse.size > 1) {
    out.push({ id: 'mixed-warehouse', tone: 'info', message: `Lines dispatch from ${mixedWarehouse.size} different warehouses. One challan, several stores — check that is intended.` })
  }

  const checked = active.filter((l) => l.item_id !== null && availability[l.key])
  const short = checked.filter((l) => !availability[l.key].ok)
  if (short.length) {
    const worst = short
      .map((l) => ({ line: l, by: shortBy(availability[l.key]) }))
      .sort((a, b) => b.by - a.by)[0]
    out.push({
      id: 'short-stock',
      tone: header.stock_effect === 'physical' ? 'danger' : 'warning',
      message:
        short.length === 1
          ? `${worst.line.item_name || 'One item'} is short by ${formatQty(worst.by)} in the selected warehouse.`
          : `${short.length} lines ask for more than is available; the largest shortfall is ${formatQty(worst.by)}.`,
      lineKeys: short.map((l) => l.key),
      blocking: false,
    })
  } else if (checked.length > 0 && checked.length === active.filter((l) => l.item_id !== null).length && !checking) {
    out.push({ id: 'stock-ok', tone: 'success', message: 'Every line is available in the warehouse it dispatches from.' })
  }

  if (header.returnable && !header.expected_return_date) {
    out.push({ id: 'return-date', tone: 'warning', message: 'The goods are expected back but no return date is set. Set one so the challan can be chased.' })
  }

  if (active.length > 0 && transportIsEmpty(transport)) {
    out.push({ id: 'transport', tone: 'info', message: 'No transport details yet. A vehicle or LR number on the challan is what the gate and the customer match the delivery against.' })
  }

  if (party && party.open_challan_documents > 0) {
    out.push({
      id: 'party-open',
      tone: 'info',
      message: `This customer already has ${formatQty(party.open_challan_qty)} unit${party.open_challan_qty === 1 ? '' : 's'} open on ${party.open_challan_documents} earlier challan${party.open_challan_documents === 1 ? '' : 's'}.`,
    })
  }

  out.push({
    id: 'effect',
    tone: 'action',
    message:
      header.stock_effect === 'physical'
        ? 'Posting moves the stock out now and records the quantity as pending against the customer until the invoice settles it.'
        : 'Posting opens a pending quantity only; the stock moves when the invoice settles this challan.',
  })

  return out
}

/** Insights that must be cleared before the document can post. */
export function blockingInsights(insights: Insight[]): Insight[] {
  return insights.filter((i) => i.blocking)
}
