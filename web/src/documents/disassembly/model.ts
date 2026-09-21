/**
 * The pure half of the Disassembly screen: the draft it holds, the arithmetic it previews and
 * the payload it posts. No React, no fetching — so every rule below is unit-tested.
 *
 * ## Why disassembly gets its own model at all
 *
 * DISASSEMBLY is `line_mode: by_line` on the server, which means each stored line carries its
 * own direction. The generic line editor therefore asks the user to set a "Dir." dropdown per
 * row — but the business operation already decides it: the finished product is consumed (OUT)
 * and the components it breaks into are produced (IN). There is no valid disassembly in which
 * the parent comes in or a recovered component goes out, so the column was a way to enter a
 * document that means nothing.
 *
 * This model splits the one line list into the two roles and stamps the direction from the role,
 * so the payload the server receives is exactly the one the generic editor produced — same
 * `lines[]`, same `direction`, same `valuation_rate` — without the user ever setting it.
 */

import { isBlankLine, lineBaseQty, newLine, round4, toPayload } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import type { CreateDocumentPayload, DocumentMetadata } from '../types'
import { toNumber } from '../../utils/format'

export type DisassemblyRole = 'finished' | 'component'

export interface DisassemblyDraft {
  header: HeaderDraft
  /** Consumed. Always posted `direction: 'out'`. */
  finished: LineDraft[]
  /** Recovered. Always posted `direction: 'in'`. */
  components: LineDraft[]
}

/**
 * How the estimated unit cost of each recovered component is arrived at.
 *
 * None of these invent an accounting rule: every one of them only decides what goes in the
 * line's `valuation_rate`, a field the create payload already carries and the posting engine
 * already validates. `component_cost` is the default because it is the only basis that needs no
 * assumption — it is what each component is costed at in this company's own valuation method,
 * read live from `GET /v1/valuation/unit-costs`. The two allocation bases spread the parent's
 * inventory value over the recovered lines instead, which is what a company that treats
 * disassembly as a value-neutral operation asks for. `manual` leaves every figure to the user.
 */
export const COST_BASES = ['component_cost', 'by_value', 'by_qty', 'manual'] as const
export type CostBasis = (typeof COST_BASES)[number]

export const COST_BASIS_LABELS: Record<CostBasis, string> = {
  component_cost: 'Current inventory cost',
  by_value: 'Allocate parent value by component value',
  by_qty: 'Allocate parent value by quantity',
  manual: 'Enter each cost manually',
}

export const COST_BASIS_HELP: Record<CostBasis, string> = {
  component_cost: "Each component is valued at what it costs in this company's valuation method today.",
  by_value: "The parent's inventory value is spread over the components in proportion to their own value.",
  by_qty: "The parent's inventory value is spread over the components in proportion to base quantity.",
  manual: 'Nothing is calculated; the unit cost you type is the one that posts.',
}

export function isCostBasis(value: unknown): value is CostBasis {
  return typeof value === 'string' && (COST_BASES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export function newFinishedLine(spec: DocumentTypeSpec, partial: Partial<LineDraft> = {}): LineDraft {
  return newLine(spec, { ...partial, direction: 'out' })
}

export function newComponentLine(spec: DocumentTypeSpec, partial: Partial<LineDraft> = {}): LineDraft {
  return newLine(spec, { ...partial, direction: 'in' })
}

/**
 * Split the flat line list of a stored document back into the two roles.
 *
 * A document entered on the old generic editor may carry a line with no direction at all — the
 * dropdown could be left empty and the draft still saved. Such a line is shown as a component,
 * never silently dropped: a row the user typed must stay visible and editable, and the role it
 * lands in is the one that does not change stock the wrong way when it is re-saved.
 */
export function splitDraftLines(lines: readonly LineDraft[]): { finished: LineDraft[]; components: LineDraft[] } {
  const finished: LineDraft[] = []
  const components: LineDraft[] = []
  for (const line of lines) {
    if (line.direction === 'out') finished.push({ ...line, direction: 'out' })
    else components.push({ ...line, direction: 'in' })
  }
  return { finished, components }
}

/** The flat list the payload builder expects, with the direction stamped from the role. */
export function mergeDraftLines(finished: readonly LineDraft[], components: readonly LineDraft[]): LineDraft[] {
  return [
    ...finished.map((l) => ({ ...l, direction: 'out' as const })),
    ...components.map((l) => ({ ...l, direction: 'in' as const })),
  ]
}

export function activeLines(lines: readonly LineDraft[]): LineDraft[] {
  return lines.filter((l) => !isBlankLine(l))
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface DisassemblyMeta {
  /** The BOM the components were loaded from, when they were. */
  bom_id?: number
  cost_basis?: CostBasis
}

/**
 * The create / update payload. Nothing here is disassembly-specific on the wire: the server sees
 * the same shape any `by_line` document posts, so no backend change is needed for this screen.
 */
export function disassemblyPayload(
  draft: DisassemblyDraft,
  spec: DocumentTypeSpec,
  extra: DisassemblyMeta = {},
  options: { negativeOverride?: boolean } = {},
): CreateDocumentPayload {
  const metadata: DocumentMetadata = { ...draft.header.metadata }
  if (extra.bom_id) metadata.bom_id = extra.bom_id
  if (extra.cost_basis) metadata.cost_basis = extra.cost_basis
  const header: HeaderDraft = { ...draft.header, metadata }
  return toPayload(header, mergeDraftLines(draft.finished, draft.components), spec, options)
}

// ---------------------------------------------------------------------------
// Quantities and value
// ---------------------------------------------------------------------------

/** Base-unit quantity of one line; 0 for a line with no quantity yet. */
export function baseQtyOf(line: LineDraft): number {
  return lineBaseQty(line)
}

export function totalBaseQty(lines: readonly LineDraft[]): number {
  return round4(activeLines(lines).reduce((sum, l) => sum + baseQtyOf(l), 0))
}

/** Value of one recovered component: base quantity × the unit cost that will post. */
export function lineValue(line: LineDraft): number {
  const rate = toNumber(line.valuation_rate)
  if (rate === null) return 0
  return round4(baseQtyOf(line) * rate)
}

export function componentsValue(components: readonly LineDraft[]): number {
  return round4(activeLines(components).reduce((sum, l) => sum + lineValue(l), 0))
}

/**
 * What the components average per base unit. Undefined (null) rather than zero when there is no
 * quantity to divide by — a screen must not print "0.00 average cost" for an empty document.
 */
export function averageUnitCost(components: readonly LineDraft[]): number | null {
  const qty = totalBaseQty(components)
  if (qty <= 0) return null
  return round4(componentsValue(components) / qty)
}

export type UnitCostLookup = (itemId: number, warehouseId: number | null) => number | null

/**
 * What the finished product being consumed is carried at, from the live valuation read — never
 * from anything the user typed, because an OUT line's cost is decided by the costing method and
 * the layers it consumes, not by this form.
 */
export function parentValue(finished: readonly LineDraft[], unitCost: UnitCostLookup): number | null {
  const rows = activeLines(finished).filter((l) => l.item_id !== null)
  if (rows.length === 0) return null
  let total = 0
  let known = false
  for (const line of rows) {
    const cost = unitCost(line.item_id as number, line.warehouse_id)
    if (cost === null) continue
    known = true
    total = round4(total + baseQtyOf(line) * cost)
  }
  return known ? total : null
}

export interface ValueSummary {
  componentsValue: number
  averageUnitCost: number | null
  parentValue: number | null
  /** Recovered − consumed. Null while the parent's cost is not known. */
  variance: number | null
}

export function valueSummary(draft: DisassemblyDraft, unitCost: UnitCostLookup): ValueSummary {
  const recovered = componentsValue(draft.components)
  const parent = parentValue(draft.finished, unitCost)
  return {
    componentsValue: recovered,
    averageUnitCost: averageUnitCost(draft.components),
    parentValue: parent,
    variance: parent === null ? null : round4(recovered - parent),
  }
}

// ---------------------------------------------------------------------------
// Stock impact
// ---------------------------------------------------------------------------

export interface StockImpactGroup {
  direction: 'in' | 'out'
  /** Unit symbol the quantity is expressed in; '' when the line has no unit yet. */
  unit: string
  qty: number
  lines: number
}

/**
 * The live preview of what posting will do, grouped by unit.
 *
 * Grouped, not summed: adding 4 Nos to 2 Kg gives 6 of nothing. A document whose lines use one
 * unit collapses to the single row the mock shows; one that mixes units shows a row each, which
 * is the only honest way to print it.
 */
export function stockImpact(draft: DisassemblyDraft, unitSymbol: (unitId: number | null) => string): StockImpactGroup[] {
  const out = new Map<string, StockImpactGroup>()
  const add = (direction: 'in' | 'out', lines: readonly LineDraft[]) => {
    for (const line of activeLines(lines)) {
      const qty = baseQtyOf(line)
      if (qty <= 0) continue
      const unit = unitSymbol(line.unit_id)
      const key = `${direction}|${unit}`
      const hit = out.get(key)
      if (hit) {
        hit.qty = round4(hit.qty + qty)
        hit.lines += 1
      } else {
        out.set(key, { direction, unit, qty, lines: 1 })
      }
    }
  }
  add('out', draft.finished)
  add('in', draft.components)
  return [...out.values()]
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

/** Identity of a component line for the duplicate check: same item, warehouse, batch and unit. */
export function duplicateKeyOf(line: LineDraft): string | null {
  if (line.item_id === null) return null
  return [line.item_id, line.warehouse_id ?? 0, line.batch_id ?? 0, line.unit_id ?? 0].join('|')
}

/**
 * Keys of the component rows that repeat another row exactly.
 *
 * Serial-controlled rows are excluded on purpose: two rows of the same serialised item carry
 * different serial numbers, so they are two different pieces of stock however identical the
 * other four columns look, and merging them would destroy the serial split. §25 of the brief
 * says the same thing — never silently merge serial-controlled rows.
 */
export function duplicateComponentKeys(components: readonly LineDraft[]): Set<string> {
  const seen = new Map<string, string>()
  const dupes = new Set<string>()
  for (const line of activeLines(components)) {
    if (line.track_serial) continue
    const id = duplicateKeyOf(line)
    if (id === null) continue
    const first = seen.get(id)
    if (first === undefined) seen.set(id, line.key)
    else {
      dupes.add(first)
      dupes.add(line.key)
    }
  }
  return dupes
}

/** Merge every exact duplicate into its first occurrence, adding the quantities. */
export function mergeDuplicateComponents(components: readonly LineDraft[]): LineDraft[] {
  const byId = new Map<string, number>()
  const out: LineDraft[] = []
  for (const line of components) {
    const id = line.track_serial || isBlankLine(line) ? null : duplicateKeyOf(line)
    if (id === null) {
      out.push(line)
      continue
    }
    const at = byId.get(id)
    if (at === undefined) {
      byId.set(id, out.length)
      out.push(line)
      continue
    }
    const first = out[at]
    const qty = round4((toNumber(first.qty) ?? 0) + (toNumber(line.qty) ?? 0))
    out[at] = { ...first, qty: String(qty) }
  }
  return out
}

// ---------------------------------------------------------------------------
// Cost allocation
// ---------------------------------------------------------------------------

/**
 * Set every component's unit cost from the chosen basis.
 *
 * `component_cost` reads each item's live cost; the two allocation bases spread `parent` over
 * the rows by weight. A weight total of zero (nothing entered yet, or every component free)
 * falls back to quantity, and failing that leaves the rows untouched rather than dividing by
 * zero. `manual` is a no-op by definition.
 */
export function applyCostBasis(
  components: readonly LineDraft[],
  basis: CostBasis,
  parent: number | null,
  unitCost: UnitCostLookup,
): LineDraft[] {
  if (basis === 'manual') return [...components]
  if (basis === 'component_cost') {
    return components.map((line) => {
      if (line.item_id === null) return line
      const cost = unitCost(line.item_id, line.warehouse_id)
      return cost === null ? line : { ...line, valuation_rate: String(cost) }
    })
  }
  if (parent === null || parent <= 0) return [...components]
  const rows = components.filter((l) => !isBlankLine(l) && l.item_id !== null && baseQtyOf(l) > 0)
  if (rows.length === 0) return [...components]
  const weightOf = (line: LineDraft): number => {
    if (basis === 'by_qty') return baseQtyOf(line)
    const cost = line.item_id === null ? null : unitCost(line.item_id, line.warehouse_id)
    return round4(baseQtyOf(line) * (cost ?? 0))
  }
  let weights = rows.map(weightOf)
  let total = round4(weights.reduce((a, b) => a + b, 0))
  if (total <= 0) {
    weights = rows.map((l) => baseQtyOf(l))
    total = round4(weights.reduce((a, b) => a + b, 0))
  }
  if (total <= 0) return [...components]
  const rateByKey = new Map<string, string>()
  rows.forEach((line, i) => {
    const share = round4((parent * weights[i]) / total)
    rateByKey.set(line.key, String(round4(share / baseQtyOf(line))))
  })
  return components.map((line) => {
    const rate = rateByKey.get(line.key)
    return rate === undefined ? line : { ...line, valuation_rate: rate }
  })
}

// ---------------------------------------------------------------------------
// Summary sentence
// ---------------------------------------------------------------------------

export interface DisassemblyCounts {
  finishedLines: number
  componentLines: number
  qtyOut: number
  qtyIn: number
}

export function disassemblyCounts(draft: DisassemblyDraft): DisassemblyCounts {
  return {
    finishedLines: activeLines(draft.finished).length,
    componentLines: activeLines(draft.components).length,
    qtyOut: totalBaseQty(draft.finished),
    qtyIn: totalBaseQty(draft.components),
  }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * The sentence under the lines, written from what is actually on screen.
 *
 * The screen this replaces printed "0 lines" and "0 components will be produced" while four
 * component rows sat above it, because it counted a list the panel never filled. This counts
 * the rows themselves, so the two can never disagree.
 */
export function summaryText(draft: DisassemblyDraft): string {
  const c = disassemblyCounts(draft)
  if (c.finishedLines === 0 && c.componentLines === 0) return 'Nothing entered yet — pick the finished product to disassemble.'
  if (c.finishedLines === 0) return `${plural(c.componentLines, 'component')} entered. Pick the finished product they come from.`
  if (c.componentLines === 0) return `${plural(c.finishedLines, 'finished product')} to disassemble. Add the components it breaks into.`
  return `${plural(c.componentLines, 'component')} will be produced from ${plural(c.finishedLines, 'finished product')}.`
}
