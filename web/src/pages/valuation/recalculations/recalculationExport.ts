import type { ExportableColumn } from '../../../registers/registerCells'
import type { RecalcJob } from '../../../services/valuationApi'
import {
  hasSettledCounts,
  recalcFailure,
  recalcMode,
  recalcReference,
  recalcScope,
  statusMeta,
  triggerLabel,
} from './recalculationModel'

/**
 * The columns of the CSV, the spreadsheet, the PDF and the printed sheet.
 *
 * They are the register's columns, in the register's order, resolved through the
 * SAME helpers the cells use — so a sheet mailed to an auditor cannot describe a
 * job differently from the screen it was taken off. `statusMeta` rather than the
 * raw token for the same reason: a file that reads FAILED where the screen read
 * "Failed" is one column speaking two languages.
 *
 * `cogs_delta` is left as a number with `amount: true` so the spreadsheet holds
 * a figure that can be summed, not a pre-formatted string. Its header says what
 * kind of figure it is, because on paper there is no tooltip to explain that it
 * is a valuation movement rather than anything a customer was charged.
 */
export const RECALC_EXPORT_COLUMNS: ExportableColumn<RecalcJob>[] = [
  { key: 'job_id', csvHeader: 'Job', csv: (r) => recalcReference(r.job_id) },
  { key: 'created_at', csvHeader: 'Queued', format: 'datetime' },
  { key: 'status', csvHeader: 'Status', csv: (r) => statusMeta(r.status).label },
  { key: 'dry_run', csvHeader: 'Mode', csv: (r) => recalcMode(r).label },
  { key: 'from_date', csvHeader: 'Effective from', format: 'date' },
  { key: 'scope', csvHeader: 'Scope', csv: (r) => recalcScope(r).label },
  {
    key: 'trigger_kind',
    csvHeader: 'Trigger',
    csv: (r) =>
      `${triggerLabel(r.trigger_kind)}${r.trigger_document_id ? ` · ${r.trigger_document_no ?? `#${r.trigger_document_id}`}` : ''}`,
  },
  {
    key: 'affected_line_count',
    csvHeader: 'Lines affected',
    align: 'right',
    format: 'int',
    // Blank, not zero, until the replay has actually counted anything — the
    // same rule the cell follows, for the same reason.
    csv: (r) => (hasSettledCounts(r) ? (r.affected_line_count ?? 0) : null),
  },
  {
    key: 'revised_line_count',
    csvHeader: 'Lines revised',
    align: 'right',
    format: 'int',
    csv: (r) => (hasSettledCounts(r) ? (r.revised_line_count ?? 0) : null),
  },
  {
    key: 'cogs_delta',
    csvHeader: 'COGS delta (valuation)',
    align: 'right',
    format: 'amount',
    amount: true,
    csv: (r) => (hasSettledCounts(r) ? r.cogs_delta : null),
  },
  { key: 'finished_at', csvHeader: 'Finished', format: 'datetime' },
  { key: 'failure_reason', csvHeader: 'Failure', csv: (r) => recalcFailure(r.failure_reason)?.short ?? '' },
  { key: 'remarks', csvHeader: 'Reason given', csv: (r) => r.remarks ?? '' },
  { key: 'requested_by', csvHeader: 'Requested by', csv: (r) => r.requested_by ?? '' },
]
