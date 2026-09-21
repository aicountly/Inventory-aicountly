/**
 * What the bulk edit is about to do, row by row, and what it actually did.
 *
 * Everything on the screen that carries a number — the four cards, the status
 * column, the validation rail, the count inside the Apply button, the
 * confirmation dialog — reads one of these structures. They are computed from
 * the rows the API returned and the value in the editor, and nowhere else: two
 * places counting the same thing in two ways is how a confirmation dialog ends
 * up promising 24 items and writing 22.
 *
 * Pure. No React, no services, no formatting decisions that belong to a cell.
 */

import type { BulkUpdateResult, BulkUpdateRow, ItemListRow } from '../../../services/items'
import type { BulkFieldSpec, ValueCheck } from './bulkEditFields'
import { currentValueKey, isReadOnlyField, toPayloadValue } from './bulkEditFields'

/** The API writes at most this many rows per request (ItemsController::BULK_MAX_ROWS). */
export const MAX_PER_APPLY = 500

export type RowPlanStatus =
  /** Ticked, writable, and the value on the item is not the one being applied. */
  | 'will_update'
  /** Ticked, but the item already holds exactly this value — nothing to write. */
  | 'unchanged'
  /** Ticked, but the value in the editor cannot be written as it stands. */
  | 'invalid'
  /** Ticked, but Inventory may not write this field at all (Books owns it). */
  | 'locked'
  /** Not ticked. Shown so the reader can see what they are leaving out. */
  | 'not_selected'

export interface RowPlan {
  row: ItemListRow
  selected: boolean
  status: RowPlanStatus
  /** The item's value today, comparable form (`''` = none). */
  currentKey: string
  /** What it would become, comparable form. Null when nothing would be written. */
  nextKey: string | null
}

export interface PlanCounts {
  /** Rows on this page. */
  visible: number
  selected: number
  willUpdate: number
  unchanged: number
  invalid: number
  locked: number
}

export interface BulkEditPlan {
  rows: RowPlan[]
  counts: PlanCounts
}

export interface PlanInput {
  rows: readonly ItemListRow[]
  field: BulkFieldSpec
  /** Exactly what is in the editor, untrimmed. */
  newValue: string
  selectedIds: ReadonlySet<number>
  check: ValueCheck
}

/**
 * Classify every row on the page against the change in the editor.
 *
 * `unchanged` is a first-class outcome, not an error: ticking forty items to
 * set a group most of them already have is a perfectly sensible thing to do,
 * and calling that a validation failure would train the reader to ignore the
 * failures that matter. Those rows are simply not sent — see `buildPayload`.
 */
export function planBulkEdit({ rows, field, newValue, selectedIds, check }: PlanInput): BulkEditPlan {
  const locked = isReadOnlyField(field)
  const blocking = check.blocking
  const nextKey = locked || blocking ? null : normalizedKey(field, newValue)

  const plans = rows.map<RowPlan>((row) => {
    const currentKey = currentValueKey(row, field)
    const selected = selectedIds.has(row.item_id)
    if (!selected) return { row, selected, status: 'not_selected', currentKey, nextKey: null }
    if (locked) return { row, selected, status: 'locked', currentKey, nextKey: null }
    if (blocking) return { row, selected, status: 'invalid', currentKey, nextKey: null }
    if (nextKey !== null && currentKey === nextKey) return { row, selected, status: 'unchanged', currentKey, nextKey }
    return { row, selected, status: 'will_update', currentKey, nextKey }
  })

  const counts: PlanCounts = {
    visible: plans.length,
    selected: plans.filter((p) => p.selected).length,
    willUpdate: plans.filter((p) => p.status === 'will_update').length,
    unchanged: plans.filter((p) => p.status === 'unchanged').length,
    invalid: plans.filter((p) => p.status === 'invalid').length,
    locked: plans.filter((p) => p.status === 'locked').length,
  }

  return { rows: plans, counts }
}

/** The editor's value in the same comparable form `currentValueKey` produces. */
export function normalizedKey(field: BulkFieldSpec, raw: string): string {
  const payload = toPayloadValue(field, raw)
  if (payload === null) return ''
  return String(payload)
}

/**
 * The rows to send: the ones that would genuinely change.
 *
 * Items that already hold the value are left out rather than written back over
 * themselves. A no-op write is not free here — it bumps the item's version,
 * stamps `updated_by` and appends an audit row — so sending forty of them would
 * put forty entries in the trail that say nothing happened. The screen says out
 * loud how many it is skipping, in the preview and in the confirmation, so this
 * is never a silent narrowing of what was asked for.
 */
export function buildPayload(plan: BulkEditPlan, field: BulkFieldSpec, newValue: string): BulkUpdateRow[] {
  const value = toPayloadValue(field, newValue)
  return plan.rows
    .filter((p) => p.status === 'will_update')
    .map((p) => ({ item_id: p.row.item_id, [field.key]: value }) as BulkUpdateRow)
}

/* -------------------------------------------------------------------------- */
/* Can this be applied at all?                                                */
/* -------------------------------------------------------------------------- */

export interface ApplyGate {
  canApply: boolean
  /** Why not — rendered as the button's tooltip and beside it. Null when it can. */
  reason: string | null
}

export function applyGate(plan: BulkEditPlan, field: BulkFieldSpec, check: ValueCheck, canWrite: boolean): ApplyGate {
  if (!canWrite) return { canApply: false, reason: 'Editing items needs the items write permission.' }
  if (isReadOnlyField(field)) return { canApply: false, reason: field.ownerNote ?? 'This field cannot be changed from Inventory.' }
  if (plan.counts.selected === 0) return { canApply: false, reason: 'Tick at least one item.' }
  if (check.blocking) return { canApply: false, reason: check.message }
  if (plan.counts.willUpdate === 0) {
    return {
      canApply: false,
      reason: `Every ticked item already has this ${field.label.toLowerCase()}. Nothing would change.`,
    }
  }
  if (plan.counts.willUpdate > MAX_PER_APPLY) {
    return {
      canApply: false,
      reason: `The API writes at most ${MAX_PER_APPLY} items per apply. Narrow the filters, or apply a page at a time.`,
    }
  }
  return { canApply: true, reason: null }
}

/* -------------------------------------------------------------------------- */
/* What came back                                                             */
/* -------------------------------------------------------------------------- */

export interface ApplyOutcome {
  /** Items the server reported as written. */
  updated: number
  /** Items that already held the value and were deliberately not sent. */
  skippedUnchanged: number
  /** Items that were sent and did NOT come back in the result. */
  missing: number[]
  /** True when every item that was sent was written. */
  complete: boolean
}

/**
 * Reconcile what was sent against what the server said it wrote.
 *
 * The endpoint is all-or-nothing — one rejected row rolls the whole batch back,
 * so the usual outcomes are "everything" or an error — but "it returned 200, so
 * it all worked" is an assumption, not a reading of the response. This compares
 * the ids, and a short answer is reported as a partial result rather than
 * celebrated as a success. A toast that says 24 when 22 were written is the one
 * failure mode a bulk editor must not have.
 */
export function summarizeOutcome(sentIds: readonly number[], skippedUnchanged: number, result: BulkUpdateResult): ApplyOutcome {
  const written = new Set((result.rows ?? []).map((r) => r.item_id))
  const missing = sentIds.filter((id) => !written.has(id))
  // `updated` is the server's own count, not `sentIds.length`: they are the
  // same number right up until the day they are not.
  const updated = Number.isFinite(result.updated) ? result.updated : written.size
  return { updated, skippedUnchanged, missing, complete: missing.length === 0 }
}

/* -------------------------------------------------------------------------- */
/* Selection                                                                  */
/* -------------------------------------------------------------------------- */

export type HeaderSelectState = 'none' | 'some' | 'all'

/**
 * The header checkbox's state — over the rows ON SCREEN, deliberately.
 *
 * It selects what it can see and says so ("Select the 25 items on this page").
 * There is no "select all 248 matching items": the write takes explicit item
 * ids, the API caps a batch at 500, and a control that implied the whole filter
 * had been ticked would promise a write this screen cannot make.
 */
export function headerSelectState(rows: readonly ItemListRow[], selectedIds: ReadonlySet<number>): HeaderSelectState {
  if (rows.length === 0) return 'none'
  const hits = rows.reduce((n, r) => (selectedIds.has(r.item_id) ? n + 1 : n), 0)
  if (hits === 0) return 'none'
  return hits === rows.length ? 'all' : 'some'
}

/**
 * Add or remove every visible row in one go.
 *
 * The selection is a map of id → ROW, not a set of ids: a selection made across
 * several pages has to stay classifiable, previewable and exportable once those
 * pages are gone, and only the row carries the current value that decides
 * whether the item would change at all.
 */
export function toggleVisibleSelection(
  rows: readonly ItemListRow[],
  selection: ReadonlyMap<number, ItemListRow>,
): Map<number, ItemListRow> {
  const next = new Map(selection)
  const state = headerSelectState(rows, new Set(selection.keys()))
  for (const row of rows) {
    if (state === 'all') next.delete(row.item_id)
    else next.set(row.item_id, row)
  }
  return next
}

/**
 * Tick every visible row that has no value for this field.
 *
 * The honest half of "find missing values": it FINDS them. Nothing here
 * proposes what the value should be.
 */
export function selectMissing(
  rows: readonly ItemListRow[],
  field: BulkFieldSpec,
  selection: ReadonlyMap<number, ItemListRow>,
): { next: Map<number, ItemListRow>; added: number } {
  const next = new Map(selection)
  let added = 0
  for (const row of rows) {
    if (currentValueKey(row, field) !== '') continue
    if (next.has(row.item_id)) continue
    next.set(row.item_id, row)
    added += 1
  }
  return { next, added }
}

/* -------------------------------------------------------------------------- */
/* Chips                                                                      */
/* -------------------------------------------------------------------------- */

export type ChipKey = 'q' | 'item_grp_id' | 'status' | 'field' | 'value' | 'selection'

export interface ChangeChip {
  key: ChipKey
  label: string
  value: string
  /** False for the chip that only states the change and has nothing to clear. */
  clearable: boolean
}

export interface ChipInput {
  search: string
  groupId: string
  groupLabel: string | null
  status: string
  field: BulkFieldSpec
  newValue: string
  newValueLabel: string
  selectedCount: number
}

const STATUS_LABEL: Record<string, string> = { active: 'Active', inactive: 'Inactive', all: 'All statuses' }

/** The whole of what is set right now, as one scannable row. */
export function buildChips(input: ChipInput): ChangeChip[] {
  const chips: ChangeChip[] = []
  if (input.search.trim()) chips.push({ key: 'q', label: 'Search', value: input.search.trim(), clearable: true })
  if (input.groupId) chips.push({ key: 'item_grp_id', label: 'Group', value: input.groupLabel ?? `#${input.groupId}`, clearable: true })
  if (input.status) chips.push({ key: 'status', label: 'Status', value: STATUS_LABEL[input.status] ?? input.status, clearable: true })
  chips.push({ key: 'field', label: 'Field', value: input.field.label, clearable: false })
  if (input.newValue.trim() !== '') {
    chips.push({ key: 'value', label: 'New value', value: input.newValueLabel, clearable: true })
  }
  if (input.selectedCount > 0) {
    chips.push({ key: 'selection', label: 'Items', value: `${input.selectedCount} selected`, clearable: true })
  }
  return chips
}
