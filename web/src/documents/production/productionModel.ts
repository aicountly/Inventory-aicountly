/**
 * Everything the production workspace derives from what the APIs already returned.
 *
 * Pure on purpose — no React, no fetching — so every figure the cockpit prints can be
 * unit-tested against the same arithmetic the server uses. Nothing here invents data:
 *
 *  - required quantities come from the BOM explosion (`POST /v1/bill-of-materials/{id}/explode`,
 *    BomService::productionPayload) and are only ever *read* here;
 *  - availability comes from `GET /v1/availability` (the materialised balances), per warehouse;
 *  - unit costs come from `GET /v1/valuation/unit-costs` — inventory cost, never a selling price;
 *  - the negative-stock policy comes from `GET /v1/settings`, which is what the posting engine
 *    enforces, so "blocking" here means the same thing it will mean on the server.
 *
 * Where a figure cannot be derived it is `null` and the screen says so. There is no estimate,
 * no forecast and no manufacturing metric (cycle time, efficiency, OEE) — Inventory holds no
 * execution data that could produce one.
 */

import { lineBaseQty, round4 } from '../formModel'
import type { LineDraft } from '../formModel'
import { toNumber } from '../../utils/format'

/** Tolerance shared with the server's availability check (AvailabilityController::check). */
const EPSILON = 0.0001

export type ProductionLineKind = 'component' | 'by_product' | 'finished' | 'manual'

/** Availability of one item, in base units, split by warehouse. */
export interface ItemAvailability {
  byWarehouse: Map<number, number>
  /** Sum over every warehouse the balances know about. */
  total: number
}

export interface AlternateWarehouse {
  warehouseId: number
  available: number
}

export type StockStatus =
  | 'unknown'
  | 'no_warehouse'
  | 'insufficient'
  | 'tight'
  | 'in_stock'
  | 'receipt'

export interface ComponentRow {
  key: string
  line: LineDraft
  index: number
  kind: ProductionLineKind
  /** Quantity as entered, in the line's own unit. */
  qty: number
  /** Quantity in the item's base unit — what availability and the posting engine compare. */
  requiredBase: number
  /** Base units of this component per one finished unit (0 when the run quantity is unknown). */
  perFinishedUnit: number
  warehouseId: number | null
  /** Base units available in `warehouseId`; null when availability has not been read. */
  availableHere: number | null
  /** Base units available in every OTHER warehouse. */
  availableElsewhere: number
  alternates: AlternateWarehouse[]
  shortBy: number
  /** Inventory unit cost per BASE unit, or null when costing was not readable. */
  unitCost: number | null
  totalCost: number | null
  status: StockStatus
  needsBatch: boolean
  needsSerial: boolean
  /** Serials picked, but not as many as the base quantity — the server rejects this. */
  serialMismatch: boolean
}

export function lineKind(line: LineDraft): ProductionLineKind {
  const kind = line.metadata?.line_kind
  if (kind === 'component' || kind === 'by_product' || kind === 'finished') return kind
  return 'manual'
}

/** Lines the BOM tab shows: what this run consumes, plus any by-product it yields. */
export function isComponentLine(line: LineDraft): boolean {
  return lineKind(line) !== 'finished'
}

export function findFinishedLine(lines: LineDraft[]): LineDraft | null {
  return lines.find((l) => lineKind(l) === 'finished') ?? null
}

/**
 * Availability rows (`GET /v1/availability`, grouped by item and warehouse) indexed for lookup.
 *
 * A row with a null warehouse is stock the balances hold against no warehouse at all; it is
 * counted in the total but can never satisfy a line that names one, so it is not indexed.
 */
export function indexAvailability(
  rows: { item_id: number; warehouse_id: number | null; available: number }[],
): Map<number, ItemAvailability> {
  const out = new Map<number, ItemAvailability>()
  for (const row of rows) {
    const entry = out.get(row.item_id) ?? { byWarehouse: new Map<number, number>(), total: 0 }
    const available = round4(Number(row.available) || 0)
    if (row.warehouse_id !== null && row.warehouse_id > 0) {
      entry.byWarehouse.set(row.warehouse_id, round4((entry.byWarehouse.get(row.warehouse_id) ?? 0) + available))
    }
    entry.total = round4(entry.total + available)
    out.set(row.item_id, entry)
  }
  return out
}

function stockStatus(row: {
  direction: 'in' | 'out' | null
  warehouseId: number | null
  availableHere: number | null
  requiredBase: number
  perFinishedUnit: number
}): StockStatus {
  if (row.direction === 'in') return 'receipt'
  if (row.warehouseId === null) return 'no_warehouse'
  if (row.availableHere === null) return 'unknown'
  if (row.availableHere + EPSILON < row.requiredBase) return 'insufficient'
  /*
   * "Low stock" is not a ratio of the quantity on hand — a percentage would call 75 metres of
   * fabric low because 2.5 are being used. It is the operational fact the storekeeper acts on:
   * after this run, what is left will not cover one more finished unit.
   */
  if (row.perFinishedUnit > 0 && row.availableHere - row.requiredBase + EPSILON < row.perFinishedUnit) return 'tight'
  return 'in_stock'
}

export interface BuildRowsInput {
  lines: LineDraft[]
  availability: Map<number, ItemAvailability> | null
  /** Unit cost per base unit, keyed by item. */
  unitCosts: Map<number, number> | null
  /** Run quantity, used only to express each requirement per finished unit. */
  productionQty: number
  fallbackWarehouseId: number | null
}

/** One row per consumption / by-product line, with everything the table and the insights need. */
export function buildComponentRows({
  lines,
  availability,
  unitCosts,
  productionQty,
  fallbackWarehouseId,
}: BuildRowsInput): ComponentRow[] {
  const rows: ComponentRow[] = []
  let index = 0
  for (const line of lines) {
    const kind = lineKind(line)
    if (kind === 'finished') continue
    index += 1
    const warehouseId = line.warehouse_id ?? fallbackWarehouseId
    const requiredBase = lineBaseQty(line)
    const perFinishedUnit = productionQty > 0 ? round4(requiredBase / productionQty) : 0
    const itemAvailability = line.item_id !== null ? (availability?.get(line.item_id) ?? null) : null
    const availableHere =
      itemAvailability === null || warehouseId === null ? null : (itemAvailability.byWarehouse.get(warehouseId) ?? 0)
    const alternates: AlternateWarehouse[] =
      itemAvailability === null
        ? []
        : [...itemAvailability.byWarehouse.entries()]
            .filter(([id, available]) => id !== warehouseId && available > EPSILON)
            .map(([id, available]) => ({ warehouseId: id, available }))
            .sort((a, b) => b.available - a.available)
    const unitCost = line.item_id !== null ? (unitCosts?.get(line.item_id) ?? null) : null
    const status = stockStatus({ direction: line.direction, warehouseId, availableHere, requiredBase, perFinishedUnit })
    rows.push({
      key: line.key,
      line,
      index,
      kind,
      qty: toNumber(line.qty) ?? 0,
      requiredBase,
      perFinishedUnit,
      warehouseId,
      availableHere,
      availableElsewhere: round4(alternates.reduce((n, a) => n + a.available, 0)),
      alternates,
      shortBy: status === 'insufficient' && availableHere !== null ? round4(requiredBase - availableHere) : 0,
      unitCost,
      totalCost: unitCost === null ? null : round4(unitCost * requiredBase),
      status,
      needsBatch: line.direction === 'out' && line.track_batch && line.batch_id === null,
      needsSerial: line.direction === 'out' && line.track_serial && line.serials.length === 0,
      serialMismatch: line.track_serial && line.serials.length > 0 && line.serials.length !== requiredBase,
    })
  }
  return rows
}

// ---------------------------------------------------------------------------------------------
// Cost summary
// ---------------------------------------------------------------------------------------------

export interface CostSummary {
  /** Inventory cost of everything consumed, over the components whose cost is known. */
  componentCost: number | null
  costedComponents: number
  totalComponents: number
  /** True when every consumed component had a readable unit cost. */
  costComplete: boolean
  finishedQty: number
  /** Per finished unit, as entered. Zero means "costed on posting". */
  finishedRate: number
  /** null when no rate was entered — the posting engine decides the cost, not this screen. */
  finishedValue: number | null
  valueAdd: number | null
  valueAddPct: number | null
}

export function costSummary(rows: ComponentRow[], finishedLine: LineDraft | null, productionQty: number): CostSummary {
  const consumed = rows.filter((r) => r.line.direction === 'out')
  const costed = consumed.filter((r) => r.totalCost !== null)
  const componentCost = costed.length > 0 ? round4(costed.reduce((n, r) => n + (r.totalCost ?? 0), 0)) : null
  const finishedQty = finishedLine ? (toNumber(finishedLine.qty) ?? 0) : productionQty
  const finishedRate = finishedLine ? (toNumber(finishedLine.rate) ?? 0) : 0
  const finishedValue = finishedRate > 0 ? round4(finishedQty * finishedRate) : null
  const complete = consumed.length > 0 && costed.length === consumed.length
  const valueAdd = finishedValue !== null && componentCost !== null && complete ? round4(finishedValue - componentCost) : null
  return {
    componentCost,
    costedComponents: costed.length,
    totalComponents: consumed.length,
    costComplete: complete,
    finishedQty,
    finishedRate,
    finishedValue,
    valueAdd,
    valueAddPct: valueAdd !== null && componentCost !== null && componentCost > 0 ? round4((valueAdd / componentCost) * 100) : null,
  }
}

// ---------------------------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------------------------

export interface Capacity {
  /** Finished units the stock on hand covers, or null when nothing can be worked out yet. */
  maxProducible: number | null
  /** The component that runs out first. */
  limiting: ComponentRow | null
}

/**
 * How many finished units the current stock covers.
 *
 * Linear in the run quantity because the explosion is: every component line is
 * `bom_qty × production_qty / yield_qty × (1 + scrap%)`, so dividing the exploded requirement by
 * the run quantity gives the requirement for one finished unit exactly, scrap included. Rows whose
 * availability has not been read are skipped rather than assumed — a partial answer beats a wrong
 * one, and the caller can see `unknownRows` from the rows themselves.
 */
export function capacity(rows: ComponentRow[]): Capacity {
  let max: number | null = null
  let limiting: ComponentRow | null = null
  for (const row of rows) {
    if (row.line.direction !== 'out' || row.perFinishedUnit <= 0 || row.availableHere === null) continue
    const units = round4(row.availableHere / row.perFinishedUnit)
    if (max === null || units < max) {
      max = units
      limiting = row
    }
  }
  return { maxProducible: max, limiting }
}

// ---------------------------------------------------------------------------------------------
// Readiness and issues
// ---------------------------------------------------------------------------------------------

export type NegativeStockPolicy = 'allow' | 'warn' | 'block'

export type Readiness = 'idle' | 'awaiting_qty' | 'awaiting_explosion' | 'checking' | 'blocked' | 'attention' | 'ready'

export type IssueSeverity = 'blocking' | 'attention'

export type IssueAction =
  | { kind: 'alternates'; lineKey: string }
  | { kind: 'serials'; lineKey: string }
  | { kind: 'batch'; lineKey: string }
  | { kind: 'warehouse'; lineKey: string }
  | { kind: 'field'; field: 'bom' | 'quantity' | 'warehouse' | 'finished_item' }

export interface ProductionIssue {
  id: string
  severity: IssueSeverity
  message: string
  actionLabel?: string
  action?: IssueAction
}

export interface IssueInput {
  rows: ComponentRow[]
  hasBom: boolean
  hasFinishedItem: boolean
  productionQty: number
  warehouseId: number | null
  exploded: boolean
  negativeStockPolicy: NegativeStockPolicy
  warehouseName: (id: number | null) => string
}

/**
 * Everything standing between this document and a posted production run.
 *
 * `blocking` means the server would refuse the post, so the list mirrors what the API enforces:
 * the required header fields, a partial serial allocation (DocumentService rejects a count that
 * does not match the base quantity) and a shortage *only where the company's negative-stock
 * policy is `block`*. A missing batch does not block — the posting engine moves the stock at
 * warehouse level when no batch is named — so it is raised as attention, never as a false gate.
 */
export function productionIssues({
  rows,
  hasBom,
  hasFinishedItem,
  productionQty,
  warehouseId,
  exploded,
  negativeStockPolicy,
  warehouseName,
}: IssueInput): ProductionIssue[] {
  const issues: ProductionIssue[] = []
  if (!hasFinishedItem && !hasBom) {
    issues.push({ id: 'finished-item', severity: 'blocking', message: 'Pick the finished item this run produces.', actionLabel: 'Choose item', action: { kind: 'field', field: 'finished_item' } })
  }
  if (!hasBom) {
    issues.push({ id: 'bom', severity: 'blocking', message: 'Pick the bill of materials to consume from.', actionLabel: 'Choose BOM', action: { kind: 'field', field: 'bom' } })
  }
  if (productionQty <= 0) {
    issues.push({ id: 'qty', severity: 'blocking', message: 'Enter how many finished units this run produces.', actionLabel: 'Enter quantity', action: { kind: 'field', field: 'quantity' } })
  }
  if (warehouseId === null) {
    issues.push({ id: 'warehouse', severity: 'blocking', message: 'Choose the warehouse components are issued from and finished goods received into.', actionLabel: 'Choose warehouse', action: { kind: 'field', field: 'warehouse' } })
  }
  if (hasBom && productionQty > 0 && !exploded) {
    issues.push({ id: 'explode', severity: 'blocking', message: 'Explode the bill of materials into lines before posting.', actionLabel: 'Explode', action: { kind: 'field', field: 'bom' } })
  }

  for (const row of rows) {
    const name = row.line.item_name || `Item #${row.line.item_id ?? '?'}`
    if (row.status === 'no_warehouse') {
      issues.push({ id: `wh-${row.key}`, severity: 'blocking', message: `${name} has no warehouse to issue from.`, actionLabel: 'Set warehouse', action: { kind: 'warehouse', lineKey: row.key } })
    }
    if (row.status === 'insufficient') {
      const where = warehouseName(row.warehouseId)
      const elsewhere = row.alternates.length > 0 ? ` ${row.alternates.length} other warehouse${row.alternates.length === 1 ? '' : 's'} hold${row.alternates.length === 1 ? 's' : ''} stock.` : ''
      issues.push({
        id: `short-${row.key}`,
        severity: negativeStockPolicy === 'block' ? 'blocking' : 'attention',
        message: `${name} is short by ${row.shortBy} in ${where}.${elsewhere}`,
        actionLabel: row.alternates.length > 0 ? 'Find stock' : undefined,
        action: row.alternates.length > 0 ? { kind: 'alternates', lineKey: row.key } : undefined,
      })
    }
    if (row.serialMismatch) {
      issues.push({
        id: `serial-${row.key}`,
        severity: 'blocking',
        message: `${name}: ${row.line.serials.length} serial number${row.line.serials.length === 1 ? '' : 's'} picked for a quantity of ${row.requiredBase}.`,
        actionLabel: 'Fix serials',
        action: { kind: 'serials', lineKey: row.key },
      })
    } else if (row.needsSerial) {
      issues.push({ id: `serial-none-${row.key}`, severity: 'attention', message: `${name} is serial-controlled and no serial numbers are selected.`, actionLabel: 'Select serials', action: { kind: 'serials', lineKey: row.key } })
    }
    if (row.needsBatch) {
      issues.push({ id: `batch-${row.key}`, severity: 'attention', message: `${name} is batch-controlled and no batch is allocated; it will be issued at warehouse level.`, actionLabel: 'Allocate batch', action: { kind: 'batch', lineKey: row.key } })
    }
  }
  return issues
}

export interface ReadinessState {
  readiness: Readiness
  blocking: number
  attention: number
}

export function readinessFrom(issues: ProductionIssue[], opts: { hasBom: boolean; productionQty: number; exploded: boolean; checking: boolean }): ReadinessState {
  const blocking = issues.filter((i) => i.severity === 'blocking').length
  const attention = issues.filter((i) => i.severity === 'attention').length
  let readiness: Readiness
  if (!opts.hasBom) readiness = 'idle'
  else if (opts.productionQty <= 0) readiness = 'awaiting_qty'
  else if (!opts.exploded) readiness = 'awaiting_explosion'
  else if (opts.checking) readiness = 'checking'
  else if (blocking > 0) readiness = 'blocked'
  else if (attention > 0) readiness = 'attention'
  else readiness = 'ready'
  return { readiness, blocking, attention }
}

export const READINESS_LABEL: Record<Readiness, string> = {
  idle: 'Waiting for BOM',
  awaiting_qty: 'Waiting for quantity',
  awaiting_explosion: 'Not exploded',
  checking: 'Checking stock…',
  blocked: 'Issues to resolve',
  attention: 'Needs attention',
  ready: 'Ready to post',
}

// ---------------------------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------------------------

export type InsightTone = 'good' | 'warn' | 'bad' | 'info'

export interface Insight {
  id: string
  tone: InsightTone
  text: string
}

export interface InsightInput {
  rows: ComponentRow[]
  capacity: Capacity
  productionQty: number
  warehouseName: (id: number | null) => string
  unitLabel: (line: LineDraft) => string
  /** Batches allocated on the lines, so an expiry inside this window can be called out. */
  expiringBatches: { itemName: string; batchNo: string; expiry: string }[]
  availabilityKnown: boolean
}

/** Facts counted off the rows on screen. Nothing here is modelled, scored or predicted. */
export function buildInsights({
  rows,
  capacity: cap,
  productionQty,
  warehouseName,
  unitLabel,
  expiringBatches,
  availabilityKnown,
}: InsightInput): Insight[] {
  const out: Insight[] = []
  const consumed = rows.filter((r) => r.line.direction === 'out')
  if (consumed.length === 0) {
    return [
      { id: 'empty-1', tone: 'info', text: 'Select a bill of materials to analyse component availability.' },
      { id: 'empty-2', tone: 'info', text: 'The run quantity decides how much of each component is required.' },
      { id: 'empty-3', tone: 'info', text: 'Batch and serial requirements appear here once the BOM is exploded.' },
    ]
  }

  if (!availabilityKnown) {
    out.push({ id: 'availability-unknown', tone: 'info', text: 'Stock availability could not be read, so shortages are not shown. The server still checks every line when the document posts.' })
  } else {
    const short = consumed.filter((r) => r.status === 'insufficient')
    out.push(
      short.length === 0
        ? { id: 'stock', tone: 'good', text: `Sufficient stock for all ${consumed.length} component${consumed.length === 1 ? '' : 's'}.` }
        : { id: 'stock', tone: 'bad', text: `${short.length} component${short.length === 1 ? ' has' : 's have'} insufficient stock in the selected warehouse.` },
    )
    const tight = consumed.filter((r) => r.status === 'tight')
    if (tight.length > 0) {
      out.push({ id: 'tight', tone: 'warn', text: `${tight.length} component${tight.length === 1 ? '' : 's'} will not cover another finished unit after this run.` })
    }
  }

  if (cap.maxProducible !== null && cap.limiting) {
    const unit = unitLabel(cap.limiting.line)
    out.push({
      id: 'capacity',
      tone: cap.maxProducible + EPSILON < productionQty ? 'bad' : 'info',
      text: `Stock on hand covers ${cap.maxProducible} finished unit${cap.maxProducible === 1 ? '' : 's'} — limited by ${cap.limiting.line.item_name || 'a component'} (${cap.limiting.availableHere ?? 0} available, ${cap.limiting.perFinishedUnit}${unit ? ` ${unit}` : ''} per unit).`,
    })
  }

  const batchControlled = consumed.filter((r) => r.line.track_batch)
  if (batchControlled.length > 0) {
    const unallocated = batchControlled.filter((r) => r.line.batch_id === null).length
    out.push({
      id: 'batch',
      tone: unallocated > 0 ? 'warn' : 'good',
      text:
        unallocated > 0
          ? `${batchControlled.length} batch-controlled component${batchControlled.length === 1 ? '' : 's'}; ${unallocated} without an allocated batch.`
          : `${batchControlled.length} batch-controlled component${batchControlled.length === 1 ? '' : 's'}, all allocated.`,
    })
  }

  const serialControlled = consumed.filter((r) => r.line.track_serial)
  if (serialControlled.length > 0) {
    const picked = serialControlled.reduce((n, r) => n + r.line.serials.length, 0)
    const needed = round4(serialControlled.reduce((n, r) => n + r.requiredBase, 0))
    out.push({
      id: 'serial',
      tone: picked === needed ? 'good' : 'warn',
      text: `${serialControlled.length} serial-controlled component${serialControlled.length === 1 ? '' : 's'} — ${picked} of ${needed} serial numbers selected.`,
    })
  }

  if (expiringBatches.length > 0) {
    out.push({
      id: 'expiry',
      tone: 'warn',
      text: `${expiringBatches.length} allocated batch${expiringBatches.length === 1 ? '' : 'es'} expire soon (${expiringBatches.map((b) => `${b.batchNo} · ${b.expiry}`).join(', ')}).`,
    })
  }

  const withAlternates = consumed.filter((r) => r.alternates.length > 0).length
  if (availabilityKnown && withAlternates > 0) {
    const first = consumed.find((r) => r.warehouseId !== null)
    out.push({
      id: 'warehouses',
      tone: 'info',
      text: `${warehouseName(first?.warehouseId ?? null) || 'The selected warehouse'} plus stock for ${withAlternates} component${withAlternates === 1 ? '' : 's'} in other warehouses.`,
    })
  }

  return out
}

export interface SuggestionInput {
  rows: ComponentRow[]
  capacity: Capacity
  productionQty: number
  fefoEnabled: boolean
  warehouseName: (id: number | null) => string
  hasBom: boolean
}

/**
 * One next step, chosen by rule from the rows on screen.
 *
 * Deliberately called a suggestion and not an AI answer: it is a decision table over live
 * inventory figures, and it recommends — it never allocates stock, moves it or changes a
 * quantity. When an AI service is wired in later it can replace the text this returns; until
 * then, labelling a `switch` statement "AI" would be a claim the product cannot keep.
 */
export function buildSuggestion({ rows, capacity: cap, productionQty, fefoEnabled, warehouseName, hasBom }: SuggestionInput): string {
  const consumed = rows.filter((r) => r.line.direction === 'out')
  if (!hasBom || consumed.length === 0) {
    return 'Select the finished item, its bill of materials and a run quantity to get component availability, shortages and the maximum quantity your stock supports.'
  }
  const short = consumed.filter((r) => r.status === 'insufficient')
  const shortWithAlternates = short.filter((r) => r.alternates.length > 0)
  if (shortWithAlternates.length > 0) {
    const names = shortWithAlternates.slice(0, 2).map((r) => r.line.item_name || 'a component')
    const first = shortWithAlternates[0]
    return `${names.join(' and ')}${shortWithAlternates.length > 2 ? ` and ${shortWithAlternates.length - 2} more` : ''} ${shortWithAlternates.length === 1 ? 'is' : 'are'} short here but held elsewhere — ${first.alternates.length === 1 ? warehouseName(first.alternates[0].warehouseId) : `${first.alternates.length} other warehouses`} can cover ${first.line.item_name || 'it'}. Switch the line's warehouse, or raise a stock transfer first; nothing is moved for you.`
  }
  if (short.length > 0) {
    const names = short.slice(0, 2).map((r) => r.line.item_name || 'a component')
    if (cap.maxProducible !== null && cap.maxProducible > 0) {
      return `${names.join(' and ')} cannot cover this run in any warehouse. Current stock supports ${cap.maxProducible} finished unit${cap.maxProducible === 1 ? '' : 's'} — reduce the run quantity or receive material before posting.`
    }
    return `${names.join(' and ')} cannot cover this run in any warehouse. Receive the material, or post with an override if your profile allows negative stock.`
  }
  const unallocatedBatches = consumed.filter((r) => r.line.track_batch && r.line.batch_id === null)
  if (unallocatedBatches.length > 0) {
    return fefoEnabled
      ? `${unallocatedBatches.length} batch-controlled component${unallocatedBatches.length === 1 ? '' : 's'} ${unallocatedBatches.length === 1 ? 'has' : 'have'} no batch allocated. FEFO is enabled for this company — allocating the earliest-expiring batches keeps the shelf-life order intact.`
      : `${unallocatedBatches.length} batch-controlled component${unallocatedBatches.length === 1 ? '' : 's'} ${unallocatedBatches.length === 1 ? 'has' : 'have'} no batch allocated; the issue will be recorded at warehouse level and the batch trail will stop at this document.`
  }
  const unpickedSerials = consumed.filter((r) => r.line.track_serial && r.line.serials.length === 0)
  if (unpickedSerials.length > 0) {
    return `${unpickedSerials.length} serial-controlled component${unpickedSerials.length === 1 ? '' : 's'} ${unpickedSerials.length === 1 ? 'has' : 'have'} no serial numbers selected. Pick them now so the units consumed are traceable after posting.`
  }
  const headroom = cap.maxProducible !== null && productionQty > 0 ? round4(cap.maxProducible - productionQty) : null
  if (headroom !== null && headroom > 0) {
    return `All ${consumed.length} component${consumed.length === 1 ? '' : 's'} are covered. Stock would still support ${headroom} more finished unit${headroom === 1 ? '' : 's'} beyond this run.`
  }
  return `All ${consumed.length} component${consumed.length === 1 ? '' : 's'} are covered in the selected warehouse. Review the lines and post when you are ready.`
}
