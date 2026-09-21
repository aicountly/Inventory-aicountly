/**
 * Batch Assist — the header strip and its drawer.
 *
 * Everything here is deterministic and runs in the browser: it reads the draft the operator is
 * typing and says what is wrong with it, what is only worth a second look, and what would make it
 * safer to post. It is NOT a generative model and is not presented as one.
 *
 * The shape is the one a server-side assistant would return, so when Inventory grows an endpoint
 * for it (`GET /v1/inventory-documents/{id}/assistant` or whatever the API settles on) the
 * workspace swaps the source and the drawer is unchanged.
 */

import { toNumber } from '../../utils/format'
import { lineBaseQty, newLine } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import { applyBatchMapping, batchMapping, populatedLines, serialsSatisfied } from './batchAdjustmentModel'
import type { BatchIssue, IssueField } from './batchAdjustmentModel'

export type AssistSeverity = 'critical' | 'warning' | 'suggestion'

/** What clicking the item does. `focus` scrolls to the field; `pair` offers the matching in line. */
export type AssistAction = { kind: 'focus' } | { kind: 'pair'; lineKey: string }

export interface AssistItem {
  id: string
  severity: AssistSeverity
  title: string
  detail?: string
  lineKey?: string | null
  field?: IssueField
  action?: AssistAction
}

export interface AssistReport {
  items: AssistItem[]
  critical: number
  warnings: number
  suggestions: number
  /** One line for the header strip. */
  headline: string
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Out lines with no in line to receive what they release, matched greedily on item, warehouse and
 * quantity. A batch adjustment that only takes stock off a batch leaves it nowhere.
 */
export function unpairedOutLines(lines: readonly LineDraft[], defaultWarehouseId: number | null): LineDraft[] {
  const active = populatedLines(lines)
  const pool = active
    .filter((l) => l.direction === 'in' && l.item_id !== null)
    .map((l) => ({ line: l, taken: false }))
  const unpaired: LineDraft[] = []
  for (const out of active) {
    if (out.direction !== 'out' || out.item_id === null) continue
    const warehouse = out.warehouse_id ?? defaultWarehouseId
    const qty = toNumber(out.qty)
    const match = pool.find(
      (candidate) =>
        !candidate.taken &&
        candidate.line.item_id === out.item_id &&
        (candidate.line.warehouse_id ?? defaultWarehouseId) === warehouse &&
        toNumber(candidate.line.qty) === qty,
    )
    if (match) match.taken = true
    else unpaired.push(out)
  }
  return unpaired
}

/** The in line that receives what `out` releases — same item, warehouse and quantity, opposite direction. */
export function matchingInLine(out: LineDraft, spec: DocumentTypeSpec): LineDraft {
  const mapping = batchMapping(out)
  const seed = newLine(spec, {
    item_id: out.item_id,
    item_name: out.item_name,
    item_sku: out.item_sku,
    track_batch: out.track_batch,
    track_serial: out.track_serial,
    units: out.units,
    unit_id: out.unit_id,
    warehouse_id: out.warehouse_id,
    direction: 'in',
    qty: out.qty,
    description: out.batch_no ? `Reallocated from ${out.batch_no}` : '',
  })
  const withSource = { ...seed, ...applyBatchMapping(seed, 'from', mapping.from_batch_id !== null ? { batch_id: mapping.from_batch_id, batch_no: mapping.from_batch_no ?? '' } : null) }
  if (mapping.to_batch_id === null) return withSource
  return { ...withSource, ...applyBatchMapping(withSource, 'to', { batch_id: mapping.to_batch_id, batch_no: mapping.to_batch_no ?? '' }) }
}

function issueItems(issues: readonly BatchIssue[]): AssistItem[] {
  return issues.map((issue, i) => ({
    id: `${issue.code}-${issue.lineKey ?? 'doc'}-${i}`,
    severity: issue.severity === 'error' ? ('critical' as const) : ('warning' as const),
    title: issue.message,
    lineKey: issue.lineKey,
    field: issue.field,
    action: issue.lineKey ? ({ kind: 'focus' } as const) : undefined,
  }))
}

/**
 * Read the draft and say what it needs. Suggestions are the non-blocking half: things that are
 * not wrong, but that a reviewer of the posted document would rather see.
 */
export function buildAssistReport(header: HeaderDraft, lines: readonly LineDraft[], issues: readonly BatchIssue[]): AssistReport {
  const items = issueItems(issues)
  const active = populatedLines(lines)

  for (const out of unpairedOutLines(lines, header.default_warehouse_id)) {
    items.push({
      id: `pair-${out.key}`,
      severity: 'suggestion',
      title: `${out.item_name || 'This line'} goes out of ${out.batch_no ?? 'its batch'} with nothing receiving it.`,
      detail: 'Add the matching in line so the quantity lands on a batch instead of leaving stock.',
      lineKey: out.key,
      action: { kind: 'pair', lineKey: out.key },
    })
  }

  if (active.length > 0 && !header.reason_code.trim()) {
    items.push({
      id: 'reason-code',
      severity: 'suggestion',
      title: 'No reason code recorded.',
      detail: 'The reason code is what the audit trail reads back months later — DAMAGE, EXPIRY, PHYSICAL_COUNT and the like.',
      field: null,
    })
  }
  if (active.length > 0 && !header.narration.trim()) {
    items.push({
      id: 'narration',
      severity: 'suggestion',
      title: 'No narration on the document.',
      detail: 'One sentence on why the batches were reallocated saves the next reader a reconstruction.',
      field: null,
    })
  }

  const serialLines = active.filter((l) => l.track_serial)
  if (serialLines.length > 0 && serialLines.every((l) => serialsSatisfied(l))) {
    items.push({
      id: 'serials-ok',
      severity: 'suggestion',
      title: `Serial mapping is complete on ${plural(serialLines.length, 'line')}.`,
      detail: 'Every serial-tracked line carries exactly the serial numbers its quantity needs.',
    })
  }

  const qtyOut = active.filter((l) => l.direction === 'out').reduce((t, l) => t + Math.max(toNumber(l.qty) ?? 0, 0), 0)
  const qtyIn = active.filter((l) => l.direction === 'in').reduce((t, l) => t + Math.max(toNumber(l.qty) ?? 0, 0), 0)
  if (active.length > 0 && qtyOut > 0 && qtyOut === qtyIn) {
    items.push({
      id: 'balanced',
      severity: 'suggestion',
      title: 'Quantities balance — nothing enters or leaves stock.',
      detail: `${qtyOut} out of one set of batches, ${qtyIn} into another.`,
    })
  }

  const serialTotal = active.reduce((t, l) => t + (l.track_serial ? lineBaseQty(l) : 0), 0)
  if (serialTotal > 0) {
    const mapped = active.reduce((t, l) => t + (l.track_serial ? l.serials.length : 0), 0)
    if (mapped < serialTotal) {
      items.push({
        id: 'serials-progress',
        severity: 'suggestion',
        title: `${mapped} of ${serialTotal} serial numbers mapped.`,
        detail: 'Open the serial mapping on a flagged line to finish the allocation.',
      })
    }
  }

  const critical = items.filter((i) => i.severity === 'critical').length
  const warnings = items.filter((i) => i.severity === 'warning').length
  const suggestions = items.filter((i) => i.severity === 'suggestion').length

  return { items, critical, warnings, suggestions, headline: assistHeadline(critical, warnings, suggestions) }
}

export function assistHeadline(critical: number, warnings: number, suggestions: number): string {
  const problems = critical + warnings
  if (problems === 0 && suggestions === 0) return 'Nothing to flag on this document yet.'
  const parts: string[] = []
  if (problems > 0) parts.push(plural(problems, 'potential issue'))
  if (suggestions > 0) parts.push(plural(suggestions, 'suggestion'))
  return `We found ${parts.join(' and ')}.`
}
