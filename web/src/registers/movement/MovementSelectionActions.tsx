import { useMemo } from 'react'
import { useCompany } from '../../company/CompanyContext'
import { ExportActions } from '../../export/ExportActions'
import { slugifyExportFilename } from '../../export/exportActions'
import { useExportIdentity } from '../../export/useExportIdentity'
import { percentOf } from '../../dashboard/formatters'
import type { StockMovementRow } from '../../services/stockViewsApi'
import type { ExportableColumn } from '../registerCells'
import { buildTotalsRow, totalsLabel, totalsRowToText } from '../registerTotals'
import { formatDate, formatMoney, formatQty, todayIso } from '../../utils/format'
import { aggregateMovements } from './movementSummary'
import type { MovementRegisterSummary } from './movementSummary'

/**
 * What ticking rows on the movement register is for.
 *
 * Two things, and they are the reason the checkbox column exists at all:
 *
 *  1. **A subtotal.** "What did these eleven lines move between them, and how much of the
 *     period is that" is a question a register cannot answer by being read down. The
 *     figures are sums of the rows' own quantities and values — nothing is re-costed —
 *     and the share is taken against the server's aggregate for the whole filtered set,
 *     so it means the same thing whichever page the rows were ticked on.
 *  2. **A file of exactly those rows.** The Export menu in the header walks the whole
 *     filtered result, which is right for a register and wrong for the handful of lines
 *     someone has just picked out of it.
 *
 * The file is written by the same `ExportActions` the header uses, with the selection
 * passed as `rows` and no `fetchAll`: the selection IS the whole set here, so there is no
 * pager to walk and nothing can come up short. That also means it gets Excel and PDF with
 * a real totals row rather than a second, thinner export path written specially for it.
 *
 * The selection survives paging (the engine holds it as id → row), so these figures can
 * cover rows no longer on screen — which is why the count is always stated beside them.
 */
export interface MovementSelectionActionsProps {
  rows: readonly StockMovementRow[]
  summary: MovementRegisterSummary
  /** The register's own columns, so the file matches what the table shows. */
  columns: readonly ExportableColumn<StockMovementRow>[]
}

export function MovementSelectionActions({ rows, summary, columns }: MovementSelectionActionsProps) {
  const { companyName } = useCompany()
  const identity = useExportIdentity()

  const totals = useMemo(() => aggregateMovements(rows), [rows])
  const label = totalsLabel(rows.length, 'movement')
  const share = percentOf(rows.length, summary.total)

  const totalsText = useMemo(
    () =>
      totalsRowToText(
        columns,
        buildTotalsRow(
          columns.map((c) => ({ key: c.key, align: c.align })),
          {
            in_qty: formatQty(totals.in_qty),
            out_qty: formatQty(totals.out_qty),
            value: formatMoney(totals.net_value),
          },
          { label, labelKey: 'movement_date' },
        ),
      ),
    [columns, totals, label],
  )

  const period =
    summary.from && summary.to ? `${formatDate(summary.from)} – ${formatDate(summary.to)}` : 'the selected period'

  return (
    <>
      <span className="tabular-nums text-gray-700">
        <strong className="font-semibold text-emerald-700">{formatQty(totals.in_qty)}</strong> in ·{' '}
        <strong className="font-semibold text-rose-700">{formatQty(totals.out_qty)}</strong> out ·{' '}
        <strong className="font-semibold text-gray-900">{formatMoney(totals.net_value)}</strong>
        {summary.total > 0 ? (
          <span className="text-gray-500"> · {share.toFixed(1)}% of the movements in view</span>
        ) : null}
      </span>
      <ExportActions
        columns={columns}
        rows={rows}
        identity={identity}
        title="Movement register — selected movements"
        description={`Selected movements from ${period}`}
        // Without this the sheet reads as the register itself. A file of eight rows that
        // does not say it is a selection is a file someone will later mistake for the
        // whole period's movements.
        metaLines={[
          `Period: ${period}`,
          `Selection: ${rows.length} of ${summary.total} movements in the current filters`,
        ]}
        totalsText={totalsText}
        totalsLabel={label}
        filename={slugifyExportFilename(['movement-selection', companyName, todayIso()])}
        // No Print: the header's print button already prints this register, and a second
        // one here would be two buttons for one sheet of paper.
        formats={['csv', 'excel', 'pdf']}
        size="xs"
      />
    </>
  )
}

export default MovementSelectionActions
