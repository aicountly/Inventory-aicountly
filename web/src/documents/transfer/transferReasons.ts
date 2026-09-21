/**
 * Why stock is moving, and the quick tags that pick a reason in one click.
 *
 * These are LABELS, not a master. Inventory has no reason master to read: the
 * reason travels in the two columns `inv_documents` has always carried —
 * `reason_code` (VARCHAR 32) and `movement_reason` (VARCHAR 64) — which
 * DocumentService::headerFromPayload accepts for every document type. Nothing
 * here creates a table, a master or a duplicate of one; if a reason master is
 * ever added, `TRANSFER_REASONS` becomes the fallback for a list that is still
 * loading and the options come from the API instead.
 *
 * `OTHER` keeps the field open: a warehouse that moves stock for a reason no
 * catalogue anticipated types it, and the typed text is what posts.
 */

export interface TransferReason {
  /** Stored in `reason_code`. Upper snake, ≤ 32 chars. */
  code: string
  /** Stored in `movement_reason`. ≤ 64 chars. */
  label: string
  /** One line in the dropdown, under the label. */
  hint: string
}

export const OTHER_REASON_CODE = 'OTHER'

export const TRANSFER_REASONS: readonly TransferReason[] = [
  { code: 'BRANCH_TRANSFER', label: 'Branch Transfer', hint: 'Between two branches or sites.' },
  { code: 'REPLENISHMENT', label: 'Replenishment', hint: 'Topping a warehouse back up.' },
  { code: 'PRODUCTION', label: 'Production', hint: 'Staging material for a run.' },
  { code: 'CUSTOMER_FULFILMENT', label: 'Customer Fulfilment', hint: 'Positioning stock to ship from.' },
  { code: 'SAMPLE', label: 'Sample', hint: 'Samples to a showroom or rep.' },
  { code: 'JOB_WORK', label: 'Job Work', hint: 'Staging goods for a job worker.' },
  { code: 'DAMAGE_SEGREGATION', label: 'Damage Segregation', hint: 'Isolating damaged stock.' },
  { code: 'QUALITY_INSPECTION', label: 'Quality Inspection', hint: 'Held for inspection before release.' },
  { code: OTHER_REASON_CODE, label: 'Other', hint: 'Describe it in your own words.' },
] as const

const BY_CODE = new Map(TRANSFER_REASONS.map((r) => [r.code, r]))

export function reasonForCode(code: string | null | undefined): TransferReason | null {
  if (!code) return null
  return BY_CODE.get(code.trim().toUpperCase()) ?? null
}

/**
 * The quick tags under the narration. Each names a reason in the catalogue, so
 * a tag never invents a value the dropdown cannot show — it IS the dropdown,
 * one click wide. No tag column is written anywhere: the tag sets the reason
 * and nothing else.
 */
export interface QuickTag {
  label: string
  reasonCode: string
}

export const QUICK_TAGS: readonly QuickTag[] = [
  { label: 'Branch Transfer', reasonCode: 'BRANCH_TRANSFER' },
  { label: 'Production', reasonCode: 'PRODUCTION' },
  { label: 'For Sale', reasonCode: 'CUSTOMER_FULFILMENT' },
  { label: 'Sample', reasonCode: 'SAMPLE' },
  { label: 'Damage', reasonCode: 'DAMAGE_SEGREGATION' },
  { label: 'Others', reasonCode: OTHER_REASON_CODE },
] as const

/**
 * The value the Reference Type select carries for "something outside Inventory"
 * — a purchase order, an email, a request slip. Every other option in that list
 * is a real document type code from `GET /v1/document-types`, so nothing here
 * hard-codes a catalogue.
 */
export const OTHER_REFERENCE_TYPE = 'OTHER'
