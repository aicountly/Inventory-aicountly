import type { Bom, BomLine } from '../../../services/masters'

/**
 * What changed between two bills of materials.
 *
 * Pure set arithmetic over the two line lists — no API, no guessing. It is used
 * both for "compare two BOMs side by side" and, once a duplicate has been
 * edited, for "what did this revision change".
 *
 * Lines are matched on item AND kind: the same item appearing once as a
 * component and once as a by-product is two different facts about the run, and
 * folding them together would report a quantity change that never happened.
 */

export type BomDiffKind = 'added' | 'removed' | 'changed' | 'unchanged'

export interface BomDiffField {
  label: string
  left: string
  right: string
}

export interface BomDiffRow {
  key: string
  kind: BomDiffKind
  itemId: number
  itemName: string
  itemSku: string | null
  lineKind: string
  left: BomLine | null
  right: BomLine | null
  /** Populated for `changed` rows: what moved, old → new. */
  fields: BomDiffField[]
}

export interface BomDiff {
  rows: BomDiffRow[]
  added: number
  removed: number
  changed: number
  unchanged: number
  /** Header-level differences (yield, unit, status, finished item). */
  header: BomDiffField[]
}

function lineKey(line: BomLine): string {
  return `${line.item_id}:${line.line_kind}`
}

function qtyText(line: BomLine): string {
  return `${line.qty}${line.unit_symbol ? ` ${line.unit_symbol}` : ''}`
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Same numbers within the four decimals the API stores. */
function sameNumber(a: unknown, b: unknown): boolean {
  return Math.abs(num(a) - num(b)) < 0.00005
}

export function diffBoms(left: Bom, right: Bom): BomDiff {
  const leftLines = new Map((left.lines ?? []).map((l) => [lineKey(l), l]))
  const rightLines = new Map((right.lines ?? []).map((l) => [lineKey(l), l]))
  const keys = [...new Set([...leftLines.keys(), ...rightLines.keys()])]

  const rows: BomDiffRow[] = keys.map((key) => {
    const a = leftLines.get(key) ?? null
    const b = rightLines.get(key) ?? null
    const sample = (a ?? b) as BomLine
    const base = {
      key,
      itemId: sample.item_id,
      itemName: sample.item_name ?? `#${sample.item_id}`,
      itemSku: sample.item_sku ?? null,
      lineKind: String(sample.line_kind),
      left: a,
      right: b,
    }
    if (!a) return { ...base, kind: 'added' as const, fields: [] }
    if (!b) return { ...base, kind: 'removed' as const, fields: [] }

    const fields: BomDiffField[] = []
    if (!sameNumber(a.qty, b.qty) || (a.unit_symbol ?? '') !== (b.unit_symbol ?? '')) {
      fields.push({ label: 'Quantity', left: qtyText(a), right: qtyText(b) })
    }
    if (!sameNumber(a.scrap_percent, b.scrap_percent)) {
      fields.push({ label: 'Scrap %', left: `${num(a.scrap_percent)}%`, right: `${num(b.scrap_percent)}%` })
    }
    return { ...base, kind: fields.length > 0 ? ('changed' as const) : ('unchanged' as const), fields }
  })

  // Added, removed, changed, then the rest: a reader opens this to find what
  // moved, and the unchanged lines are context, not the answer.
  const weight: Record<BomDiffKind, number> = { added: 0, removed: 1, changed: 2, unchanged: 3 }
  rows.sort((x, y) => weight[x.kind] - weight[y.kind] || x.itemName.localeCompare(y.itemName))

  const header: BomDiffField[] = []
  if (left.finished_item_id !== right.finished_item_id) {
    header.push({
      label: 'Finished item',
      left: left.finished_item_name ?? `#${left.finished_item_id}`,
      right: right.finished_item_name ?? `#${right.finished_item_id}`,
    })
  }
  if (!sameNumber(left.yield_qty, right.yield_qty) || (left.yield_unit_symbol ?? '') !== (right.yield_unit_symbol ?? '')) {
    header.push({
      label: 'Yield',
      left: `${left.yield_qty}${left.yield_unit_symbol ? ` ${left.yield_unit_symbol}` : ''}`,
      right: `${right.yield_qty}${right.yield_unit_symbol ? ` ${right.yield_unit_symbol}` : ''}`,
    })
  }
  if (Number(left.is_active) !== Number(right.is_active)) {
    header.push({
      label: 'Status',
      left: Number(left.is_active) === 1 ? 'Active' : 'Inactive',
      right: Number(right.is_active) === 1 ? 'Active' : 'Inactive',
    })
  }

  return {
    rows,
    header,
    added: rows.filter((r) => r.kind === 'added').length,
    removed: rows.filter((r) => r.kind === 'removed').length,
    changed: rows.filter((r) => r.kind === 'changed').length,
    unchanged: rows.filter((r) => r.kind === 'unchanged').length,
  }
}
