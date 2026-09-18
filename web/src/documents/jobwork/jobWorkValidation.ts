/**
 * Field-level validation for the job work outward form.
 *
 * `formModel.validateDraft` already encodes what the server refuses with a 422, and it stays
 * the authority — this only says WHERE each of those problems is, so the message can sit next
 * to the control instead of in a list at the bottom. Anything it reports, validateDraft
 * reports too; it never lets through something validateDraft would stop.
 */

import { toNumber } from '../../utils/format'
import { isBlankLine, lineBaseQty } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'

export interface HeaderIssues {
  document_date?: string
  party_ref?: string
  default_warehouse_id?: string
  expected_return_date?: string
  lines?: string
}

export interface LineIssue {
  item?: boolean
  qty?: boolean
  warehouse?: boolean
  serials?: boolean
}

export interface JobWorkValidation {
  /** Blocking problems, by field. */
  header: HeaderIssues
  lines: Record<string, LineIssue>
  /** Worth saying, but never a reason to refuse the save. */
  warnings: HeaderIssues
  /** Which section to scroll to first. */
  firstSection: 'document' | 'lines' | null
  ok: boolean
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function validateJobWorkOutward(header: HeaderDraft, lines: LineDraft[]): JobWorkValidation {
  const headerIssues: HeaderIssues = {}
  const warnings: HeaderIssues = {}
  const lineIssues: Record<string, LineIssue> = {}

  if (!ISO_DATE.test(header.document_date)) {
    headerIssues.document_date = 'Enter the document date.'
  }

  const ref = toNumber(header.party_ref)
  if (ref === null || ref <= 0) {
    headerIssues.party_ref = 'Pick the job worker this material is going to.'
  }

  if (header.default_warehouse_id === null) {
    headerIssues.default_warehouse_id = 'Choose the warehouse the material leaves from.'
  }

  if (header.returnable && header.expected_return_date) {
    if (!ISO_DATE.test(header.expected_return_date)) {
      headerIssues.expected_return_date = 'Use a valid date.'
    } else if (ISO_DATE.test(header.document_date) && header.expected_return_date < header.document_date) {
      // Said, never enforced: an edited draft may legitimately carry a date that has since
      // passed, and refusing the save would push the user to erase what was agreed with the
      // job worker just to get the document out.
      warnings.expected_return_date = 'This is before the document date.'
    }
  }

  const active = lines.filter((l) => !isBlankLine(l))
  if (active.length === 0) {
    headerIssues.lines = 'Add at least one item line.'
  }

  for (const line of active) {
    const issue: LineIssue = {}
    if (!line.item_id) issue.item = true
    const qty = toNumber(line.qty)
    if (qty === null || qty <= 0) issue.qty = true
    if ((line.warehouse_id ?? header.default_warehouse_id) === null) issue.warehouse = true
    if (line.track_serial && line.serials.length > 0 && qty !== null && line.serials.length !== lineBaseQty(line)) {
      issue.serials = true
    }
    if (Object.keys(issue).length > 0) lineIssues[line.key] = issue
  }

  const headerBad = (Object.keys(headerIssues) as (keyof HeaderIssues)[]).some((k) => k !== 'lines' && headerIssues[k])
  const linesBad = Object.keys(lineIssues).length > 0 || headerIssues.lines !== undefined

  return {
    header: headerIssues,
    lines: lineIssues,
    warnings,
    firstSection: headerBad ? 'document' : linesBad ? 'lines' : null,
    ok: !headerBad && !linesBad,
  }
}
