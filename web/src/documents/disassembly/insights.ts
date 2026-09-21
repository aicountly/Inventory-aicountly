/**
 * The "AI Insights" card, derived from the document on screen.
 *
 * Every line it prints is computed from real state — the availability the API just returned, the
 * BOM that was loaded, the batch and serial flags of the items picked, the costs the valuation
 * read gave back. None of it is a fixed list of reassuring sentences: a card that says "no batch
 * shortages detected" on a document it never checked is worse than no card, because a reader who
 * trusts it once will trust it when it is wrong.
 *
 * It is deliberately deterministic rather than model-generated. Aicountly has no inventory
 * assistant endpoint yet (see `assistant.ts`); when one arrives its suggestions are additive and
 * clearly badged, and these checks keep working whether or not it answers.
 */

import { formatQty, toNumber } from '../../utils/format'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { shortBy } from '../../services/stockApi'
import { activeLines, baseQtyOf } from './model'
import type { DisassemblyDraft } from './model'

export type InsightTone = 'ok' | 'warn' | 'risk' | 'info' | 'pending'

export interface Insight {
  id: string
  tone: InsightTone
  text: string
}

export interface InsightInput {
  draft: DisassemblyDraft
  availability: Record<string, AvailabilityCheckResult>
  checkingAvailability: boolean
  /** BOM the components were loaded from, when they were. */
  bomName: string | null
  /** Bills of materials found for the finished item (null = not looked up yet). */
  bomsForParent: number | null
  /** Unit costs are still being read. */
  costsLoading: boolean
  /** Items whose current cost the valuation read could not give. */
  itemsWithoutCost: number
}

export function buildInsights(input: InsightInput): Insight[] {
  const { draft } = input
  const out: Insight[] = []
  const finished = activeLines(draft.finished).filter((l) => l.item_id !== null)
  const components = activeLines(draft.components).filter((l) => l.item_id !== null)

  // --- availability -----------------------------------------------------------
  const checked = finished.filter((l) => input.availability[l.key])
  const short = checked.filter((l) => !input.availability[l.key].ok)
  if (finished.length === 0) {
    out.push({ id: 'availability', tone: 'pending', text: 'Pick the finished product to check its availability in real time.' })
  } else if (input.checkingAvailability && checked.length === 0) {
    out.push({ id: 'availability', tone: 'pending', text: 'Checking availability…' })
  } else if (short.length > 0) {
    const worst = short[0]
    out.push({
      id: 'availability',
      tone: 'risk',
      text: `${worst.item_name || 'One line'} is short by ${formatQty(shortBy(input.availability[worst.key]))}${short.length > 1 ? ` (${short.length} lines short)` : ''}.`,
    })
  } else if (checked.length > 0) {
    out.push({ id: 'availability', tone: 'ok', text: `Stock confirmed for ${checked.length === 1 ? 'the finished product' : `all ${checked.length} finished lines`} in real time.` })
  } else {
    out.push({ id: 'availability', tone: 'pending', text: 'Enter a quantity to check availability.' })
  }

  // --- bill of materials ------------------------------------------------------
  if (input.bomName) {
    out.push({ id: 'bom', tone: 'ok', text: `Components were loaded from ${input.bomName} and stay editable.` })
  } else if (finished.length === 0) {
    out.push({ id: 'bom', tone: 'info', text: 'A bill of materials for the finished product can fill the components for you.' })
  } else if (input.bomsForParent === null) {
    out.push({ id: 'bom', tone: 'pending', text: 'Looking for a bill of materials for this item…' })
  } else if (input.bomsForParent > 0) {
    out.push({ id: 'bom', tone: 'info', text: `${input.bomsForParent} bill${input.bomsForParent === 1 ? '' : 's'} of materials found for this item — load it to fill the components.` })
  } else {
    out.push({ id: 'bom', tone: 'info', text: 'No bill of materials for this item; add the recovered components manually.' })
  }

  // --- batches ----------------------------------------------------------------
  const batchOut = finished.filter((l) => l.track_batch)
  const batchMissing = batchOut.filter((l) => l.batch_id === null)
  const batchComponents = components.filter((l) => l.track_batch)
  if (batchOut.length === 0 && batchComponents.length === 0) {
    out.push({ id: 'batch', tone: 'info', text: 'No batch-controlled item on this document.' })
  } else if (batchMissing.length > 0) {
    out.push({ id: 'batch', tone: 'warn', text: `${batchMissing.length} batch-controlled line${batchMissing.length === 1 ? ' has' : 's have'} no batch selected.` })
  } else {
    const shortBatch = batchOut.filter((l) => input.availability[l.key] && !input.availability[l.key].ok)
    out.push(
      shortBatch.length > 0
        ? { id: 'batch', tone: 'risk', text: `${shortBatch.length} selected batch${shortBatch.length === 1 ? ' does' : 'es do'} not hold enough stock.` }
        : { id: 'batch', tone: 'ok', text: 'No batch shortages detected on the selected batches.' },
    )
  }

  // --- serials ----------------------------------------------------------------
  const serialLines = [...finished, ...components].filter((l) => l.track_serial)
  if (serialLines.length === 0) {
    out.push({ id: 'serial', tone: 'info', text: 'No serial-controlled item on this document.' })
  } else {
    const mismatched = serialLines.filter((l) => {
      const need = baseQtyOf(l)
      return need > 0 && l.serials.length !== need
    })
    out.push(
      mismatched.length === 0
        ? { id: 'serial', tone: 'ok', text: `Serial numbers match the quantity on all ${serialLines.length} serialised line${serialLines.length === 1 ? '' : 's'}.` }
        : { id: 'serial', tone: 'warn', text: `${mismatched.length} serialised line${mismatched.length === 1 ? '' : 's'} still need${mismatched.length === 1 ? 's' : ''} its serial numbers.` },
    )
  }

  // --- costing ----------------------------------------------------------------
  if (components.length === 0) {
    out.push({ id: 'cost', tone: 'pending', text: 'Add components to see what the recovered stock is worth.' })
  } else if (input.costsLoading) {
    out.push({ id: 'cost', tone: 'pending', text: 'Reading current inventory cost…' })
  } else {
    const uncosted = components.filter((l) => (toNumber(l.valuation_rate) ?? 0) <= 0).length
    out.push(
      uncosted === 0
        ? { id: 'cost', tone: 'ok', text: 'Every component carries a unit cost; the value below is what will post.' }
        : { id: 'cost', tone: 'warn', text: `${uncosted} component${uncosted === 1 ? '' : 's'} has no unit cost — the posting engine will cost ${uncosted === 1 ? 'it' : 'them'}.` },
    )
    if (input.itemsWithoutCost > 0) {
      out.push({ id: 'cost-unknown', tone: 'info', text: `${input.itemsWithoutCost} item${input.itemsWithoutCost === 1 ? ' has' : 's have'} no cost on record yet in this company.` })
    }
  }

  // --- warehouse --------------------------------------------------------------
  const warehouses = new Set(
    [...finished, ...components].map((l) => l.warehouse_id).filter((id): id is number => id !== null),
  )
  if (warehouses.size > 1) {
    out.push({ id: 'warehouse', tone: 'info', text: `This document moves stock across ${warehouses.size} warehouses.` })
  } else if (warehouses.size === 1 && short.length === 0 && finished.length > 0) {
    out.push({ id: 'warehouse', tone: 'ok', text: 'The default warehouse can fulfil this transaction.' })
  }

  return out
}
