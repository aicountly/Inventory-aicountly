/**
 * Deterministic, rule-based read of the current packing draft — never a network or model call.
 * Every statement is derived from data already on screen (lines, the same availability results
 * the line table shows, package info), so it is safe to recompute on every render and trivial to
 * unit test. This is the whole of "Inventory AI" for packing today; a real assistant backend can
 * replace or augment it later without the panel that renders this changing shape.
 */

import type { AvailabilityCheckResult } from '../../services/stockApi'
import type { HeaderDraft, LineDraft } from '../formModel'
import { isBlankLine, lineBaseQty, validateDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import { estimateVolumeM3, packageInfoOf } from './packingMetadata'

export type InsightTone = 'success' | 'warning' | 'danger' | 'info'

export interface PackingInsight {
  key: string
  tone: InsightTone
  message: string
}

export type ReadinessState = 'not_ready' | 'needs_attention' | 'ready_to_pack' | 'ready_to_dispatch'

export interface ReadinessResult {
  state: ReadinessState
  label: string
}

export interface PackingInsightsResult {
  insights: PackingInsight[]
  readiness: ReadinessResult
  /** One contextual nudge, or null when there is nothing worth suggesting right now. */
  tip: string | null
}

export interface ComputePackingInsightsArgs {
  header: HeaderDraft
  lines: LineDraft[]
  spec: DocumentTypeSpec
  availability: Record<string, AvailabilityCheckResult>
  checking: boolean
}

export const READINESS_LABEL: Record<ReadinessState, string> = {
  not_ready: 'Not ready',
  needs_attention: 'Needs attention',
  ready_to_pack: 'Ready to pack',
  ready_to_dispatch: 'Ready to dispatch',
}

function readinessMessage(state: ReadinessState): string {
  switch (state) {
    case 'ready_to_dispatch':
      return 'Ready to dispatch.'
    case 'ready_to_pack':
      return 'Ready to pack.'
    case 'needs_attention':
      return 'Needs attention before posting.'
    case 'not_ready':
      return 'Not ready to post yet.'
  }
}

export function computePackingInsights({ header, lines, spec, availability, checking }: ComputePackingInsightsArgs): PackingInsightsResult {
  const active = lines.filter((l) => !isBlankLine(l))

  if (active.length === 0) {
    return {
      insights: [{ key: 'empty', tone: 'info', message: 'Add items to see packing insights.' }],
      readiness: { state: 'not_ready', label: READINESS_LABEL.not_ready },
      tip: null,
    }
  }

  const insights: PackingInsight[] = []

  // Duplicate items — same item on more than one line for the same warehouse.
  const seen = new Map<string, number>()
  const dupeNames: string[] = []
  for (const l of active) {
    if (!l.item_id) continue
    const key = `${l.item_id}:${l.warehouse_id ?? header.default_warehouse_id ?? 0}`
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    if (count === 2) dupeNames.push(l.item_name || `Item #${l.item_id}`)
  }
  if (dupeNames.length > 0) {
    insights.push({
      key: 'dupes',
      tone: 'warning',
      message: `${dupeNames.join(', ')} ${dupeNames.length === 1 ? 'appears' : 'appear'} on more than one line for the same warehouse.`,
    })
  } else {
    insights.push({ key: 'no-dupes', tone: 'success', message: 'No duplicate items found.' })
  }

  // Stock sufficiency — the same availability results the line table shows.
  let shortCount = 0
  let uncheckedCount = 0
  for (const l of active) {
    if (!l.item_id) continue
    const r = availability[l.key]
    if (!r) {
      uncheckedCount += 1
      continue
    }
    if (!r.ok) shortCount += 1
  }
  if (shortCount > 0) {
    insights.push({
      key: 'stock-short',
      tone: 'danger',
      message: `${shortCount} line${shortCount === 1 ? '' : 's'} ${shortCount === 1 ? 'has' : 'have'} insufficient stock at the selected warehouse.`,
    })
  } else if (checking || uncheckedCount > 0) {
    insights.push({ key: 'stock-checking', tone: 'info', message: 'Checking stock availability…' })
  } else {
    insights.push({ key: 'stock-ok', tone: 'success', message: 'All items have sufficient stock.' })
  }

  // Serial completion.
  let serialLinesNeeded = 0
  let serialLinesComplete = 0
  for (const l of active) {
    if (!l.track_serial) continue
    serialLinesNeeded += 1
    const required = lineBaseQty(l)
    if (required > 0 && l.serials.length === required) serialLinesComplete += 1
  }
  if (serialLinesNeeded > 0) {
    if (serialLinesComplete === serialLinesNeeded) {
      insights.push({ key: 'serials-ok', tone: 'success', message: 'Serial requirements satisfied.' })
    } else {
      const remaining = serialLinesNeeded - serialLinesComplete
      insights.push({
        key: 'serials-pending',
        tone: 'warning',
        message: `${remaining} line${remaining === 1 ? '' : 's'} still ${remaining === 1 ? 'needs' : 'need'} serial numbers picked.`,
      })
    }
  }

  // Batch requirement sanity.
  const missingBatch = active.filter((l) => l.track_batch && !l.batch_id).length
  if (missingBatch > 0) {
    insights.push({
      key: 'batch-pending',
      tone: 'warning',
      message: `${missingBatch} line${missingBatch === 1 ? '' : 's'} still ${missingBatch === 1 ? 'needs' : 'need'} a batch selected.`,
    })
  }

  // Box dimensions tip.
  const pkg = packageInfoOf(header)
  let tip: string | null = null
  if (!pkg.dimensions_cm?.trim()) {
    tip = 'Add box dimensions to estimate shipment volume and print shipping labels.'
  } else if (estimateVolumeM3(pkg.dimensions_cm, pkg.boxes) === null) {
    tip = 'Box dimensions look incomplete — use the form "40 x 30 x 20" to estimate volume.'
  }

  // Readiness: escalate from validation/stock blockers, through pending picks, to fully dressed.
  const errors = validateDraft(header, lines, spec)
  let state: ReadinessState
  if (errors.length > 0 || shortCount > 0) state = 'not_ready'
  else if (serialLinesNeeded > serialLinesComplete || missingBatch > 0 || uncheckedCount > 0 || checking) state = 'needs_attention'
  else if (!header.default_warehouse_id || !pkg.boxes) state = 'ready_to_pack'
  else state = 'ready_to_dispatch'

  insights.push({
    key: 'ready',
    tone: state === 'ready_to_dispatch' ? 'success' : state === 'not_ready' ? 'danger' : 'info',
    message: readinessMessage(state),
  })

  return { insights, readiness: { state, label: READINESS_LABEL[state] }, tip }
}
