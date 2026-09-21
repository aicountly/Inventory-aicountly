import { useMemo } from 'react'
import { useCompany } from '../../company/CompanyContext'
import { ExportActions } from '../../export/ExportActions'
import { slugifyExportFilename } from '../../export/exportActions'
import { useExportIdentity } from '../../export/useExportIdentity'
import { formatMoney, formatQty, todayIso } from '../../utils/format'
import type { ExportableColumn } from '../registerCells'
import { buildTotalsRow, totalsLabel, totalsRowToText } from '../registerTotals'
import type { PendingRow } from '../../services/stockApi'
import type { PendingSummary } from './pendingRegister'

/**
 * What ticking rows on the pending register is for.
 *
 * Two things, and neither of them writes. A pending quantity is settled by
 * raising the document that settles it, so a register that offered to close one
 * from a checkbox would be a second, untracked way of moving stock.
 *
 *  1. **A subtotal.** "What do these six challans come to, and how much of what
 *     is outstanding is that" cannot be answered by reading a register down. The
 *     share is taken against the server's total for the WHOLE filtered set, so it
 *     means the same thing whichever page the rows were ticked on.
 *  2. **A file of exactly those lines.** The Export menu in the header walks the
 *     whole filtered result, which is right for a register and wrong for the
 *     handful of lines someone has just picked out of it to send to a supplier.
 *
 * The file is written by the same `ExportActions` the header uses, with the
 * selection passed as `rows` and no `fetchAll`: the selection IS the whole set
 * here, so there is no pager to walk and nothing can come up short.
 */
export interface PendingSelectionActionsProps {
  rows: readonly PendingRow[]
  summary: PendingSummary
  /** The register's own columns, so the file matches what the table shows. */
  columns: readonly ExportableColumn<PendingRow>[]
}

export function PendingSelectionActions({ rows, summary, columns }: PendingSelectionActionsProps) {
  const { companyName } = useCompany()
  const identity = useExportIdentity('All financial years')

  const picked = useMemo(() => {
    const open = rows.reduce((acc, r) => acc + (Number(r.qty_open) || 0), 0)
    const value = rows.reduce((acc, r) => acc + (Number(r.pending_value) || 0), 0)
    return {
      open,
      value,
      original: rows.reduce((acc, r) => acc + (Number(r.qty_original) || 0), 0),
      settled: rows.reduce((acc, r) => acc + (Number(r.qty_settled) || 0), 0),
      overdue: rows.filter((r) => r.is_overdue).length,
      // Against the server's figure for everything matching, not against the
      // page — which is the only way the share survives paging.
      shareOfValue: summary.pending_value > 0 ? (value / summary.pending_value) * 100 : null,
    }
  }, [rows, summary.pending_value])

  const totals = useMemo(
    () =>
      buildTotalsRow(
        [
          { key: 'document_no' },
          { key: 'qty_original', align: 'right' },
          { key: 'qty_settled', align: 'right' },
          { key: 'qty_open', align: 'right' },
          { key: 'pending_value', align: 'right' },
        ],
        {
          qty_original: formatQty(picked.original),
          qty_settled: formatQty(picked.settled),
          qty_open: formatQty(picked.open),
          pending_value: formatMoney(picked.value),
        },
        { label: totalsLabel(rows.length, 'line'), labelKey: 'document_no' },
      ),
    [picked, rows.length],
  )

  return (
    <>
      <span className="text-xs tabular-nums text-gray-600">
        {formatQty(picked.open)} open qty · {formatMoney(picked.value)} at cost
        {picked.shareOfValue !== null ? (
          <span className="text-gray-400"> · {picked.shareOfValue.toFixed(1)}% of pending value</span>
        ) : null}
        {picked.overdue > 0 ? (
          <span className="font-semibold text-red-600"> · {picked.overdue} overdue</span>
        ) : null}
      </span>
      <ExportActions
        columns={columns}
        rows={rows}
        filename={slugifyExportFilename(['pending-quantities-selection', companyName, todayIso()])}
        identity={identity}
        title="Pending quantity register — selected lines"
        description={`${rows.length} pending ${rows.length === 1 ? 'line' : 'lines'} picked from the register`}
        totalsText={totalsRowToText(columns, totals)}
        totalsLabel={totalsLabel(rows.length, 'line')}
        orientation="landscape"
        size="xs"
      />
    </>
  )
}

export default PendingSelectionActions
