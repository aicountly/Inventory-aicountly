import { useMemo } from 'react'
import { useCompany } from '../company/CompanyContext'
import { ExportActions } from '../export/ExportActions'
import { slugifyExportFilename } from '../export/exportActions'
import { useExportIdentity } from '../export/useExportIdentity'
import type { StockBalanceGridRow } from '../services/stockViewsApi'
import type { PageSummary } from './configs/pageSummary'
import type { ExportableColumn } from './registerCells'
import { buildTotalsRow, totalsLabel, totalsRowToText } from './registerTotals'
import { formatQty, todayIso, toNumber } from '../utils/format'

/**
 * What ticking rows on the stock balance register is for.
 *
 * The same two things the valuation register's selection is for, and it exists
 * for the same reason: a checkbox column with nothing behind it is chrome, and
 * this register earns one.
 *
 *  1. **A subtotal of a handful of lines.** "These six SKUs — what is actually
 *     on hand across the warehouses they sit in, and how much of it is free to
 *     promise" is a question this grid cannot answer by being read down,
 *     because the rows are item × warehouse × batch and the six the reader
 *     cares about are scattered through four hundred.
 *  2. **A file of exactly those rows.** The header's Export walks the whole
 *     filtered result, which is right for a register and wrong for the
 *     shortlist someone has just picked out of it.
 *
 * The file is written by the same `ExportActions` the header uses, with the
 * selection passed as `rows` and no `fetchAll`: the selection IS the whole set
 * here, so there is no pager to walk and nothing can come up short.
 *
 * WHAT IT WILL NOT SAY: a percentage of the register. `/v1/stock-balances`
 * sends no aggregate over the filtered set, so `summary.sums` is the served
 * page (configs/pageSummary.ts). "18% of stock on hand" against a page total
 * would be a made-up denominator, and the selection survives paging, so the
 * numerator can legitimately cover rows that page never held. The share is
 * offered only when the page IS the whole result, which is exactly when the
 * denominator is real.
 */
export interface StockBalanceSelectionActionsProps {
  rows: readonly StockBalanceGridRow[]
  summary: PageSummary
  /** The register's own columns, so the file matches what the table shows. */
  columns: readonly ExportableColumn<StockBalanceGridRow>[]
}

function sum(rows: readonly StockBalanceGridRow[], key: keyof StockBalanceGridRow): number {
  return rows.reduce((acc, r) => acc + (toNumber(r[key]) ?? 0), 0)
}

export function StockBalanceSelectionActions({
  rows,
  summary,
  columns,
}: StockBalanceSelectionActionsProps) {
  const { companyName } = useCompany()
  const identity = useExportIdentity()

  const totals = useMemo(
    () => ({ onHand: sum(rows, 'on_hand_qty'), available: sum(rows, 'available_qty') }),
    [rows],
  )

  const label = totalsLabel(rows.length, 'row')

  const totalsText = useMemo(
    () =>
      totalsRowToText(
        columns,
        buildTotalsRow(
          columns.map((c) => ({ key: c.key, align: c.align })),
          {
            on_hand_qty: formatQty(totals.onHand),
            available_qty: formatQty(totals.available),
          },
          { label, labelKey: 'item_name' },
        ),
      ),
    [columns, totals, label],
  )

  // Only when the page is the whole filtered result is there a denominator
  // that means anything. See the note above.
  const share =
    summary.isWholeResult && summary.sums.on_hand_qty > 0
      ? (totals.onHand / summary.sums.on_hand_qty) * 100
      : null

  return (
    <>
      <span className="tabular-nums text-gray-700">
        <strong className="font-semibold text-gray-900">{formatQty(totals.onHand)}</strong> on hand
        · {formatQty(totals.available)} available
        {share !== null ? (
          <span className="text-gray-500"> · {share.toFixed(1)}% of stock on hand</span>
        ) : null}
      </span>
      <ExportActions
        columns={columns}
        rows={rows}
        identity={identity}
        title="Stock balance register — selected rows"
        description="Selected item, warehouse and batch balances"
        // Without this the sheet reads as the register itself. A file of six
        // rows that does not say it is a selection is a file someone will
        // later mistake for the whole stock position.
        metaLines={[
          'Live balances, all financial years',
          `Selection: ${rows.length} of ${summary.total} rows in the current filters`,
        ]}
        totalsText={totalsText}
        totalsLabel={label}
        filename={slugifyExportFilename(['stock-balances-selection', companyName, todayIso()])}
        // No Print: the header's print button already prints this register, and
        // a second one here would be two buttons for one sheet of paper.
        formats={['csv', 'excel', 'pdf']}
        size="xs"
      />
    </>
  )
}

export default StockBalanceSelectionActions
