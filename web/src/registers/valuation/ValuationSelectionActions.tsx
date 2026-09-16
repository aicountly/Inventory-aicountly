import { useMemo } from 'react'
import { useCompany } from '../../company/CompanyContext'
import { ExportActions } from '../../export/ExportActions'
import { slugifyExportFilename } from '../../export/exportActions'
import { useExportIdentity } from '../../export/useExportIdentity'
import { percentOf } from '../../dashboard/formatters'
import { METHOD_LABELS } from '../../services/valuationApi'
import type { ReportMethod, ValuationSnapshotRow, ValuationSnapshotSummary } from '../../services/valuationApi'
import type { ExportableColumn } from '../registerCells'
import { buildTotalsRow, totalsLabel, totalsRowToText } from '../registerTotals'
import { formatMoney, formatQty, todayIso } from '../../utils/format'

/**
 * What ticking rows on a valuation register is for.
 *
 * Two things, and they are the reason the checkbox column exists at all:
 *
 *  1. **A subtotal.** "What are these five items worth together, and how much
 *     of my stock value is that" is a question a register cannot answer by
 *     being read down. The figures are sums of per-row values the valuation
 *     engine computed — this adds them up, it does not re-cost anything — and
 *     the share is taken against the server's total for the whole filtered set,
 *     so it means the same thing whichever page the rows were ticked on.
 *  2. **A file of exactly those rows.** The Export menu in the header walks the
 *     whole filtered result, which is right for a register and wrong for the
 *     handful of items someone has just picked out of it.
 *
 * The file is written by the same `ExportActions` the header uses, with the
 * selection passed as `rows` and no `fetchAll`: the selection IS the whole set
 * here, so there is no pager to walk and nothing can come up short. That also
 * means the selection gets Excel and PDF with a real totals row, rather than a
 * second, thinner export path written specially for it.
 *
 * The selection survives paging (the engine holds it as id → row), so these
 * figures can cover rows no longer on screen — which is why the count is always
 * stated beside them.
 */
export interface ValuationSelectionActionsProps {
  rows: readonly ValuationSnapshotRow[]
  summary: ValuationSnapshotSummary
  /** The register's own columns, so the file matches what the table shows. */
  columns: readonly ExportableColumn<ValuationSnapshotRow>[]
}

export function ValuationSelectionActions({ rows, summary, columns }: ValuationSelectionActionsProps) {
  const { companyName } = useCompany()
  const identity = useExportIdentity()

  const totals = useMemo(() => {
    const qty = rows.reduce((acc, r) => acc + (Number(r.closing_qty) || 0), 0)
    const value = rows.reduce((acc, r) => acc + (Number(r.stock_value) || 0), 0)
    return { qty, value, share: percentOf(value, summary.total_value) }
  }, [rows, summary.total_value])

  const method = METHOD_LABELS[summary.method as ReportMethod] ?? summary.method
  const label = totalsLabel(rows.length, 'item')

  const totalsText = useMemo(
    () =>
      totalsRowToText(
        columns,
        buildTotalsRow(
          columns.map((c) => ({ key: c.key, align: c.align })),
          { closing_qty: formatQty(totals.qty), stock_value: formatMoney(totals.value) },
          { label, labelKey: 'item_name' },
        ),
      ),
    [columns, totals, label],
  )

  return (
    <>
      <span className="tabular-nums text-gray-700">
        {formatQty(totals.qty)} units ·{' '}
        <strong className="font-semibold text-gray-900">{formatMoney(totals.value)}</strong>
        {summary.total_value > 0 ? (
          <span className="text-gray-500"> · {totals.share.toFixed(1)}% of stock value</span>
        ) : null}
      </span>
      <ExportActions
        columns={columns}
        rows={rows}
        identity={identity}
        title="Valuation register — selected items"
        description={`Selected items valued at ${method} as at ${summary.as_of}`}
        // Without this the sheet reads as the register itself. A file of eight
        // rows that does not say it is a selection is a file someone will later
        // mistake for the whole valuation.
        metaLines={[
          `As at: ${summary.as_of}`,
          `Method: ${method}`,
          `Selection: ${rows.length} of ${summary.item_count} items in the current filters`,
        ]}
        totalsText={totalsText}
        totalsLabel={label}
        filename={slugifyExportFilename(['valuation-selection', companyName, todayIso()])}
        // No Print: the header's print button already prints this register, and
        // a second one here would be two buttons for one sheet of paper.
        formats={['csv', 'excel', 'pdf']}
        size="xs"
      />
    </>
  )
}

export default ValuationSelectionActions
