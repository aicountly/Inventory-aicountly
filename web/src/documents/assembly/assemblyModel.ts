/**
 * The Assembly screen's model: the split between what an assembly CONSUMES and what it BUILDS,
 * the cost arithmetic over that split, and the validation the server would refuse anyway.
 *
 * An ASSEMBLY is an ordinary `by_line` document — components are `out` lines, the assembled item
 * is the `in` line — so everything here converts to and from the shared `LineDraft` the rest of
 * `documents/` already speaks. Nothing is stored in a second shape: `toPayload` receives exactly
 * the same array it receives from every other editor, which is what keeps this screen and the
 * generic one able to open each other's drafts.
 *
 * Pure on purpose — no React, no hooks, no API — so the split, the maths and the rules are
 * unit-testable without a DOM.
 */

import { toNumber } from '../../utils/format'
import { conversionFactor, isBlankLine, lineBaseQty, newLine, round4 } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import type { DocumentMetadata } from '../types'

// ---------------------------------------------------------------------------
// Assembly type (Standard / From BOM / Custom)
// ---------------------------------------------------------------------------

/**
 * How this assembly was put together. It changes what the screen OFFERS, never what posts:
 * the payload of a standard and a custom assembly of the same lines is byte for byte the same
 * document, which is why the choice rides in metadata rather than becoming a second document type.
 */
export type AssemblyMode = 'standard' | 'bom' | 'custom'

export const ASSEMBLY_MODES: readonly { value: AssemblyMode; label: string; hint: string }[] = [
  { value: 'standard', label: 'Standard', hint: 'Pick the components and the assembled item by hand.' },
  { value: 'bom', label: 'From BOM', hint: 'Load a bill of materials and scale it to the output quantity.' },
  { value: 'custom', label: 'Custom', hint: 'Free-form kit: components and output are yours to set, with no BOM behind them.' },
]

const MODE_VALUES = new Set<string>(ASSEMBLY_MODES.map((m) => m.value))

/** The mode a stored document was entered in; `standard` for anything that never recorded one. */
export function modeFromMetadata(metadata: DocumentMetadata | null | undefined): AssemblyMode {
  const raw = metadata?.assembly_mode
  return typeof raw === 'string' && MODE_VALUES.has(raw) ? (raw as AssemblyMode) : 'standard'
}

// ---------------------------------------------------------------------------
// The split: components out, assembled item in
// ---------------------------------------------------------------------------

export interface AssemblySplit {
  /** `out` lines — the stock this document consumes. */
  components: LineDraft[]
  /** The single `in` line — the stock this document creates. Null on a fresh draft. */
  finished: LineDraft | null
  /**
   * Any FURTHER `in` lines the document already carried.
   *
   * This screen builds one finished item, so it has one slot for one. A document created through
   * the API (or by the generic line editor, which has no such rule) may carry several, and losing
   * them on the next save would be this screen silently deleting stock movements it simply had
   * nowhere to draw. They are carried through untouched and named on screen instead.
   */
  extraOutputs: LineDraft[]
}

/** Split stored / generic draft lines into the two halves this screen edits. */
export function splitAssemblyLines(lines: readonly LineDraft[]): AssemblySplit {
  const components: LineDraft[] = []
  const inbound: LineDraft[] = []
  for (const line of lines) {
    if (line.direction === 'in') inbound.push(line)
    else components.push(line)
  }
  return { components, finished: inbound[0] ?? null, extraOutputs: inbound.slice(1) }
}

/**
 * Back to one array, components first.
 *
 * Blank rows are dropped here rather than at the payload, so the count on screen, the count in
 * the preview and the count that posts are the same number.
 */
export function joinAssemblyLines(split: AssemblySplit): LineDraft[] {
  const out = split.components.filter((l) => !isBlankLine(l))
  if (split.finished && !isBlankLine(split.finished)) out.push(split.finished)
  return [...out, ...split.extraOutputs.filter((l) => !isBlankLine(l))]
}

export function newComponentLine(spec: DocumentTypeSpec, warehouseId: number | null): LineDraft {
  return newLine(spec, { direction: 'out', warehouse_id: warehouseId })
}

export function newFinishedLine(spec: DocumentTypeSpec, warehouseId: number | null): LineDraft {
  return newLine(spec, { direction: 'in', warehouse_id: warehouseId, qty: '1' })
}

/** A fresh, empty assembly: one component row waiting for an item, and an empty output slot. */
export function newAssemblySplit(spec: DocumentTypeSpec, warehouseId: number | null): AssemblySplit {
  return {
    components: [newComponentLine(spec, warehouseId), newComponentLine(spec, warehouseId)],
    finished: newFinishedLine(spec, warehouseId),
    extraOutputs: [],
  }
}

/** Rows that carry an item or a quantity — what the user has actually entered. */
export function filledComponents(components: readonly LineDraft[]): LineDraft[] {
  return components.filter((l) => !isBlankLine(l))
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

/** Unit cost per BASE unit, by item — what `GET /v1/valuation/unit-costs` answers. */
export type UnitCostLookup = (itemId: number) => number | null

export interface ComponentCostRow {
  key: string
  itemId: number | null
  baseQty: number
  /** Per base unit; null when the cost is not known (or not permitted). */
  unitCost: number | null
  /** Per ENTERED unit, for the column beside the quantity. */
  enteredUnitCost: number | null
  amount: number | null
}

export interface AssemblyCostSummary {
  rows: ComponentCostRow[]
  /** Σ amount over the rows that have a cost. */
  componentCost: number
  /** Rows carrying an item whose cost is known. */
  pricedLines: number
  /** Rows carrying an item whose cost is NOT known — the figure is short by these. */
  unpricedLines: number
  /** Component cost, which is all an assembly capitalises: nothing else is configured. */
  expectedCost: number
  /** Output quantity in BASE units — the denominator the server's valuation_rate is per. */
  outputBaseQty: number
  /** expectedCost / outputBaseQty, null until there is an output quantity to divide by. */
  estimatedUnitCost: number | null
  /** True while any component's cost is unknown — the total is a floor, not the answer. */
  partial: boolean
}

/** Per-base-unit cost × base quantity, for every component row, plus the totals over them. */
export function assemblyCost(
  components: readonly LineDraft[],
  finished: LineDraft | null,
  unitCostOf: UnitCostLookup,
): AssemblyCostSummary {
  const rows: ComponentCostRow[] = []
  let componentCost = 0
  let priced = 0
  let unpriced = 0

  for (const line of filledComponents(components)) {
    const baseQty = lineBaseQty(line)
    const unitCost = line.item_id === null ? null : unitCostOf(line.item_id)
    const amount = unitCost === null ? null : round4(baseQty * unitCost)
    if (line.item_id !== null) {
      if (unitCost === null) unpriced += 1
      else priced += 1
    }
    if (amount !== null) componentCost = round4(componentCost + amount)
    rows.push({
      key: line.key,
      itemId: line.item_id,
      baseQty,
      unitCost,
      // The column sits beside a quantity in the ENTERED unit, so the rate beside it has to be
      // per that unit too — a box of 12 priced at the each-cost reads as a tenth of its value.
      enteredUnitCost: unitCost === null ? null : round4(unitCost * conversionFactor(line)),
      amount,
    })
  }

  const outputBaseQty = finished ? lineBaseQty(finished) : 0
  const expectedCost = componentCost

  return {
    rows,
    componentCost,
    pricedLines: priced,
    unpricedLines: unpriced,
    expectedCost,
    outputBaseQty,
    estimatedUnitCost: outputBaseQty > 0 ? round4(expectedCost / outputBaseQty) : null,
    partial: unpriced > 0,
  }
}

/**
 * The finished line, priced at what the components cost.
 *
 * An assembly moves value, it does not create it: the kit is worth what went into it. Left blank
 * the server falls back to the item's last known cost (DocumentPostingService::inwardUnitCost),
 * which prices the kit at whatever the last unrelated receipt of it cost and leaves the
 * difference unexplained in closing stock. Posting re-derives the components' real layer costs
 * either way, so this is a proposal, never the authority.
 */
export function withEstimatedValuationRate(finished: LineDraft, summary: AssemblyCostSummary): LineDraft {
  if (summary.estimatedUnitCost === null || summary.estimatedUnitCost <= 0 || summary.partial) return finished
  return { ...finished, valuation_rate: String(summary.estimatedUnitCost) }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type FinishedField = 'item_id' | 'warehouse_id' | 'qty' | 'batch_id' | 'serials'
export type ComponentField = 'item_id' | 'warehouse_id' | 'qty' | 'batch_id' | 'serials'
export type HeaderField = 'document_date' | 'default_warehouse_id'

export interface AssemblyErrors {
  header: Partial<Record<HeaderField, string>>
  /** Keyed by draft line key, then by field. */
  components: Record<string, Partial<Record<ComponentField, string>>>
  finished: Partial<Record<FinishedField, string>>
  /** Everything a reader should see at the top of the form, in reading order. */
  summary: string[]
}

export function hasErrors(errors: AssemblyErrors): boolean {
  return errors.summary.length > 0
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function label(line: LineDraft, index: number): string {
  return line.item_name?.trim() ? line.item_name.trim() : `Component ${index + 1}`
}

export interface ValidateOptions {
  /** A draft may be saved incomplete; posting may not. */
  posting: boolean
}

/**
 * What the form refuses before it asks the server.
 *
 * The server is still the authority — it re-checks the item, the warehouse, the stock, the batch,
 * the serials, the period and the permissions — but a 422 that comes back naming `lines.2.qty`
 * cannot put the message next to the field, and this can.
 */
export function validateAssembly(
  header: HeaderDraft,
  split: AssemblySplit,
  options: ValidateOptions,
): AssemblyErrors {
  const errors: AssemblyErrors = { header: {}, components: {}, finished: {}, summary: [] }
  const add = (message: string) => {
    if (!errors.summary.includes(message)) errors.summary.push(message)
  }
  const onComponent = (key: string, field: ComponentField, message: string) => {
    errors.components[key] = { ...errors.components[key], [field]: message }
    add(message)
  }

  if (!ISO_DATE.test(header.document_date)) {
    errors.header.document_date = 'Document date is required.'
    add('Document date is required (YYYY-MM-DD).')
  }
  if (!header.default_warehouse_id) {
    errors.header.default_warehouse_id = 'Warehouse is required.'
    add('Warehouse is required.')
  }

  const components = filledComponents(split.components)
  if (components.length === 0) {
    add('Add at least one component.')
  }

  // One serial number cannot be consumed twice in one document, and the server's uniqueness check
  // reports the collision without saying which two rows collided. This does.
  const serialSeen = new Map<number, string>()

  components.forEach((line, i) => {
    const name = label(line, i)
    if (line.item_id === null) {
      onComponent(line.key, 'item_id', `${name}: pick an item.`)
    }
    const qty = toNumber(line.qty)
    if (qty === null || qty <= 0) {
      onComponent(line.key, 'qty', `${name}: quantity must be greater than zero.`)
    }
    if (!(line.warehouse_id ?? header.default_warehouse_id)) {
      onComponent(line.key, 'warehouse_id', `${name}: choose a warehouse.`)
    }
    if (line.item_id !== null && line.track_batch && line.batch_id === null) {
      onComponent(line.key, 'batch_id', `${name}: batch is required for this item.`)
    }
    if (line.item_id !== null && line.track_serial) {
      const need = lineBaseQty(line)
      if (line.serials.length === 0) {
        onComponent(line.key, 'serials', `${name}: pick the serial numbers being consumed.`)
      } else if (need > 0 && line.serials.length !== need) {
        onComponent(line.key, 'serials', `${name}: ${line.serials.length} serial number(s) picked for a quantity of ${need}.`)
      }
      for (const serial of line.serials) {
        const owner = serialSeen.get(serial.serial_id)
        if (owner && owner !== line.key) {
          onComponent(line.key, 'serials', `Duplicate serial number ${serial.serial_no ?? `#${serial.serial_id}`}: it is on more than one component line.`)
        } else {
          serialSeen.set(serial.serial_id, line.key)
        }
      }
    }
  })

  const finished = split.finished
  if (!finished || finished.item_id === null) {
    errors.finished.item_id = 'Select a finished item.'
    add('Select a finished item.')
  }
  if (finished) {
    const qty = toNumber(finished.qty)
    if (qty === null || qty <= 0) {
      errors.finished.qty = 'Quantity must be greater than zero.'
      add('Assembly quantity must be greater than zero.')
    }
    if (!(finished.warehouse_id ?? header.default_warehouse_id)) {
      errors.finished.warehouse_id = 'Warehouse is required.'
      add('Choose the warehouse the assembled item is received into.')
    }
    if (finished.item_id !== null && finished.track_batch && finished.batch_id === null && !finished.batch_no?.trim()) {
      errors.finished.batch_id = 'Batch is required for this item.'
      add('Batch is required for the assembled item.')
    }
    if (finished.item_id !== null && finished.track_serial) {
      const need = lineBaseQty(finished)
      if (finished.serials.length === 0) {
        errors.finished.serials = 'Serial numbers are required for this item.'
        add('Serial numbers are required for the assembled item.')
      } else if (need > 0 && finished.serials.length !== need) {
        errors.finished.serials = `${finished.serials.length} picked for a quantity of ${need}.`
        add('Serial quantity does not match the assembly quantity.')
      }
    }
    // Consuming the thing you are building is a stock movement in and out of the same pool, and
    // whichever side the valuation method reaches first decides what the other one cost.
    if (finished.item_id !== null && components.some((c) => c.item_id === finished.item_id)) {
      errors.finished.item_id = 'The assembled item is also listed as a component.'
      add('The assembled item cannot also be one of its own components.')
    }
  }

  // A draft is allowed to be half-typed; posting is not. Everything above is checked either way
  // so the field markers are the same on both paths — only whether they STOP the save differs.
  if (!options.posting) {
    const blocking = errors.summary.filter((m) => m.startsWith('Document date'))
    return { ...errors, summary: blocking }
  }

  return errors
}

/** Enough of a document to be worth storing as a draft: a date, and something on it. */
export function canSaveDraft(header: HeaderDraft, split: AssemblySplit): boolean {
  if (!ISO_DATE.test(header.document_date)) return false
  return filledComponents(split.components).length > 0 || (split.finished !== null && !isBlankLine(split.finished))
}

// ---------------------------------------------------------------------------
// Merging imported components into what is already on screen
// ---------------------------------------------------------------------------

export type ImportStrategy = 'replace' | 'merge'

function mergeKey(line: LineDraft): string {
  return [line.item_id ?? 0, line.warehouse_id ?? 0, line.unit_id ?? 0, line.batch_id ?? 0].join(':')
}

/**
 * Fold imported component lines into the existing ones.
 *
 * `replace` drops what is there. `merge` adds the quantities of rows that name the same item in
 * the same warehouse, batch and unit, and appends the rest — so importing a BOM twice doubles the
 * run rather than silently listing every component two ways, which is the same quantity to the
 * reader and a different one to the picker on the floor.
 */
export function mergeComponents(
  existing: readonly LineDraft[],
  incoming: readonly LineDraft[],
  strategy: ImportStrategy,
): LineDraft[] {
  if (strategy === 'replace') return [...incoming]
  const out = filledComponents(existing).map((l) => ({ ...l }))
  const byKey = new Map<string, LineDraft>()
  for (const line of out) {
    if (line.item_id !== null) byKey.set(mergeKey(line), line)
  }
  for (const line of incoming) {
    const hit = line.item_id === null ? undefined : byKey.get(mergeKey(line))
    if (!hit) {
      out.push({ ...line })
      if (line.item_id !== null) byKey.set(mergeKey(line), out[out.length - 1])
      continue
    }
    const total = round4((toNumber(hit.qty) ?? 0) + (toNumber(line.qty) ?? 0))
    hit.qty = String(total)
  }
  return out
}
