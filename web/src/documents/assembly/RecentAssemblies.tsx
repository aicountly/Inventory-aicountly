import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { History } from 'lucide-react'
import { SmartTable } from '../../ui/shell/SmartTable'
import type { SmartColumn } from '../../ui/shell/SmartTable'
import { StatusBadge } from '../../ui/StatusBadge'
import { AIC, cx } from '../../ui/cx'
import { formatDate, formatMoney, formatQty } from '../../utils/format'
import { STATUS_LABELS, statusTone } from '../actions'
import { DocumentRowActions } from '../DocumentRowActions'
import type { RecentAssemblyRow } from './useRecentAssemblies'

export interface RecentAssembliesProps {
  rows: readonly RecentAssemblyRow[]
  loading: boolean
  error: string | null
  onReload: () => void
  costHidden: boolean
  currencySymbol: string
}

/**
 * The last few assemblies, so a user entering one can see how the previous ones were entered.
 *
 * There is no "created by" column: the list endpoint does not carry an author, and the detail
 * resource carries a portal UUID rather than a name — a column of UUIDs, or a column of dashes,
 * would be worse than the figure that IS available and does belong beside the rest, which is what
 * each of those assemblies cost.
 */
export function RecentAssemblies({ rows, loading, error, onReload, costHidden, currencySymbol }: RecentAssembliesProps) {
  const navigate = useNavigate()

  const columns = useMemo<SmartColumn<RecentAssemblyRow>[]>(() => {
    const base: SmartColumn<RecentAssemblyRow>[] = [
      {
        key: 'document_date',
        header: 'Date',
        width: '6.5rem',
        accessor: (row) => formatDate(row.document_date),
      },
      {
        key: 'document_no',
        header: 'Document no.',
        width: '8rem',
        render: (row) => (
          <Link to={`/documents/${row.document_id}`} className="font-medium text-primary hover:underline">
            {row.document_no ?? `#${row.document_id}`}
          </Link>
        ),
      },
      {
        key: 'finished_item',
        header: 'Finished item',
        minWidth: 180,
        accessor: (row) => row.finishedItem ?? <span className="text-gray-400">—</span>,
      },
      {
        key: 'qty',
        header: 'Qty',
        align: 'right',
        width: '6rem',
        accessor: (row) =>
          row.finishedQty === null ? (
            <span className="text-gray-400">—</span>
          ) : (
            `${formatQty(row.finishedQty)} ${row.unitSymbol ?? ''}`.trim()
          ),
      },
      {
        key: 'warehouse',
        header: 'Warehouse',
        minWidth: 110,
        accessor: (row) => row.warehouse ?? <span className="text-gray-400">—</span>,
      },
      {
        key: 'components',
        header: 'Components',
        align: 'right',
        width: '6.5rem',
        accessor: (row) => `${row.componentCount} item${row.componentCount === 1 ? '' : 's'}`,
      },
      {
        key: 'status',
        header: 'Status',
        width: '8rem',
        render: (row) => (
          <StatusBadge value={row.status} tone={statusTone(row.status)} label={STATUS_LABELS[row.status] ?? row.status} dot />
        ),
      },
    ]
    if (!costHidden) {
      base.push({
        key: 'value',
        header: 'Value',
        align: 'right',
        width: '8rem',
        amount: true,
        accessor: (row) =>
          row.valuationTotal > 0 ? `${currencySymbol} ${formatMoney(row.valuationTotal)}` : <span className="text-gray-400">—</span>,
      })
    }
    base.push({
      key: 'actions',
      header: 'Actions',
      align: 'right',
      width: '6.5rem',
      render: (row) => (
        <span className="inline-flex items-center justify-end gap-1">
          <Link
            to={`/documents/${row.document_id}`}
            onClick={(e) => e.stopPropagation()}
            className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 transition-colors hover:bg-sky-100"
          >
            View
          </Link>
          <DocumentRowActions row={row.raw} />
        </span>
      ),
    })
    return base
  }, [costHidden, currencySymbol])

  return (
    <section className={cx(AIC, 'min-w-0')}>
      <SmartTable
        title={
          <span className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" aria-hidden />
            Recent assemblies
          </span>
        }
        description="The last assemblies raised in this company, financial year and branch."
        headerAction={
          <Link to="/documents?document_type=ASSEMBLY" className="text-xs font-semibold text-primary hover:underline">
            View all
          </Link>
        }
        columns={columns}
        rows={rows}
        rowKey={(row) => row.document_id}
        density="compact"
        size="sm"
        minWidth={880}
        loading={loading}
        error={error ? { title: 'Recent assemblies could not be loaded.', description: error, onRetry: onReload } : null}
        empty={
          <span>
            <strong className="block text-sm font-semibold text-gray-900">No assemblies yet</strong>
            <span className="mt-1 block text-xs text-gray-500">
              Create your first assembly to turn components into finished stock.
            </span>
          </span>
        }
        onRowActivate={(row) => navigate(`/documents/${row.document_id}`)}
      />
    </section>
  )
}

export default RecentAssemblies
