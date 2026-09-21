/**
 * What kind of issue this is — the segmented control at the top of the form.
 *
 * There is no column for it. `inv_documents` carries reason_code and
 * movement_reason, and the mode is a narrower thing than either: it decides
 * what the Reference points at (a production document, nothing at all), not why
 * the stock left. So it rides in the document's free-form `metadata`
 * (metadata_json) — where the production, packing and landed-cost headers
 * already keep their own extras — and survives save / reload without a
 * migration or a change to the posting engine.
 */

import type { DocumentMetadata } from '../types'

export type IssueMode = 'standard' | 'against_production' | 'sample' | 'other'

export interface IssueModeSpec {
  value: IssueMode
  label: string
  /** One line under the control, so the choice is not a guess. */
  hint: string
}

export const ISSUE_MODES: readonly IssueModeSpec[] = [
  { value: 'standard', label: 'Standard Issue', hint: 'Material leaves stores against a reason code.' },
  { value: 'against_production', label: 'Against Production', hint: 'Issued to a production document; pick it as the reference.' },
  { value: 'sample', label: 'Sample Issue', hint: 'Samples given out — costed like any other issue.' },
  { value: 'other', label: 'Other Issue', hint: 'Anything the three above do not describe; say what in the narration.' },
]

export const DEFAULT_ISSUE_MODE: IssueMode = 'standard'

const VALUES = new Set<string>(ISSUE_MODES.map((m) => m.value))

export function isIssueMode(value: unknown): value is IssueMode {
  return typeof value === 'string' && VALUES.has(value)
}

/** The stored mode, or the default for a document saved before the field existed. */
export function issueModeFromMetadata(metadata: DocumentMetadata | null | undefined): IssueMode {
  const raw = metadata?.issue_mode
  return isIssueMode(raw) ? raw : DEFAULT_ISSUE_MODE
}

export function issueModeLabel(mode: IssueMode): string {
  return ISSUE_MODES.find((m) => m.value === mode)?.label ?? mode
}

export function issueModeHint(mode: IssueMode): string {
  return ISSUE_MODES.find((m) => m.value === mode)?.hint ?? ''
}

/**
 * Reference fields for the mode.
 *
 * Only `against_production` names another document, and the one it names is
 * Inventory's own PRODUCTION document — read live from
 * `/v1/inventory-documents`. Nothing here copies a work order out of another
 * Aicountly product into Inventory.
 */
export function referencesProduction(mode: IssueMode): boolean {
  return mode === 'against_production'
}

/**
 * Reason codes Aicountly Inventory has no master for.
 *
 * `reason_code` is a free-text column (32 chars) the server stores verbatim —
 * there is no `/v1/reason-codes` endpoint and no reason table, so these are
 * suggestions on a free-text field, not a master list pretending to be one. The
 * user may type anything; picking one of these only saves the typing. If a
 * reason master is ever added, replace this constant with the live read and
 * delete it.
 */
export const REASON_CODE_SUGGESTIONS: readonly string[] = [
  'PRODUCTION',
  'CONSUMPTION',
  'DAMAGE',
  'MAINTENANCE',
  'SAMPLE',
  'TESTING',
  'SCRAP',
  'RND',
  'OTHER',
]
