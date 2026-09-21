/**
 * Material issue validation, resolved to the field it belongs to.
 *
 * The shared `validateDraft` already mirrors what the server refuses, and the
 * page still runs it — nothing here replaces it. What this adds is placement:
 * a message next to the box that is wrong, keyed by header field and by line
 * key, so the user is not reading a list and counting rows.
 *
 * Availability is deliberately NOT a rule here. Stock can move under the form
 * between the check and the post, so the server is the only honest arbiter; a
 * shortfall surfaces through the negative-stock response and its override,
 * which is the flow Inventory already has.
 */

import { toNumber } from '../../utils/format'
import { isBlankLine, lineBaseQty } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'

export interface MaterialIssueValidation {
  /** Keyed by header field name. */
  fieldErrors: Record<string, string>
  /** Keyed by line key. */
  lineErrors: Record<string, string>
  /** Everything above, flattened for the summary notice. */
  messages: string[]
  ok: boolean
}

export interface ValidateOptions {
  /**
   * Posting moves stock and books COGS, so it asks for the reason code that
   * makes the movement answerable. Saving a draft does not: half-finished work
   * must never be held hostage to a field the user has not reached yet.
   */
  requireReason: boolean
  /** Open financial year, ISO. Empty strings skip the range check. */
  fyRange?: { from: string; to: string }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

export function validateMaterialIssue(
  header: HeaderDraft,
  lines: LineDraft[],
  { requireReason, fyRange }: ValidateOptions,
): MaterialIssueValidation {
  const fieldErrors: Record<string, string> = {}
  const lineErrors: Record<string, string> = {}

  if (!ISO.test(header.document_date)) {
    fieldErrors.document_date = 'Pick the date this material left stores.'
  } else if (fyRange?.from && fyRange.to && (header.document_date < fyRange.from || header.document_date > fyRange.to)) {
    fieldErrors.document_date = 'The date falls outside the open financial year.'
  }

  if (header.default_warehouse_id === null) {
    fieldErrors.default_warehouse_id = 'Choose the warehouse the material leaves from.'
  }

  if (requireReason && !header.reason_code.trim()) {
    fieldErrors.reason_code = 'A reason code is required to post an issue.'
  }

  const active = lines.filter((l) => !isBlankLine(l))
  if (active.length === 0) {
    fieldErrors.lines = 'Add at least one item to issue.'
  }

  for (const line of active) {
    if (!line.item_id) {
      lineErrors[line.key] = 'Pick an item.'
      continue
    }
    const qty = toNumber(line.qty)
    if (qty === null || qty <= 0) {
      lineErrors[line.key] = 'Enter a quantity greater than zero.'
      continue
    }
    if (line.warehouse_id === null && header.default_warehouse_id === null) {
      lineErrors[line.key] = 'Choose a warehouse for this line.'
      continue
    }
    if (line.track_batch && line.batch_id === null) {
      lineErrors[line.key] = 'This item is batch-tracked — pick the batch.'
      continue
    }
    if (line.track_serial) {
      const required = lineBaseQty(line)
      if (line.serials.length !== required) {
        lineErrors[line.key] = `Pick ${required} serial number${required === 1 ? '' : 's'} (${line.serials.length} selected).`
        continue
      }
    }
    if (line.unit_id === null && line.units.length > 0) {
      lineErrors[line.key] = 'Choose the unit this quantity is in.'
    }
  }

  const messages = [...Object.values(fieldErrors), ...Object.values(lineErrors)]
  return { fieldErrors, lineErrors, messages, ok: messages.length === 0 }
}
