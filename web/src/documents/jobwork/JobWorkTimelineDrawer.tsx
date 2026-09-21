import { Link } from 'react-router-dom'
import { CircleDot } from 'lucide-react'
import { useQuery } from '../../hooks/useQuery'
import { errorMessage } from '../../services/api'
import { pendingHistoryApi } from '../../services/pendingHistoryApi'
import { Badge } from '../../ui/Badge'
import { Drawer } from '../../ui/Drawer'
import { ErrorState } from '../../ui/ErrorState'
import { LoadingState } from '../../ui/LoadingState'
import { ProgressBar } from '../../ui/ProgressBar'
import { formatDate, formatQty } from '../../utils/format'

export interface JobWorkTimelineDrawerProps {
  /** The pending quantity to trace; null closes the drawer. */
  pendingId: number | null
  onClose: () => void
}

/**
 * One job-work quantity from dispatch to settlement.
 *
 * Built entirely from what was recorded — the dispatch that opened it and
 * every `inv_pending_settlements` row against it, with the document that made
 * each one. Nothing is inferred, and a quantity still open says so rather than
 * projecting a return.
 */
export function JobWorkTimelineDrawer({ pendingId, onClose }: JobWorkTimelineDrawerProps) {
  const detail = useQuery((signal) => pendingHistoryApi.get(pendingId as number, signal), [pendingId], {
    enabled: pendingId !== null,
    keepData: false,
  })
  const row = detail.data
  const percent = row && row.qty_original > 0 ? Math.min(100, (row.qty_settled / row.qty_original) * 100) : 0

  return (
    <Drawer
      open={pendingId !== null}
      onClose={onClose}
      width="md"
      title="Job work timeline"
      description={row ? `${row.item_name ?? `Item #${row.item_id}`} · ${row.document_no ?? `#${row.document_id}`}` : undefined}
      badge={row ? <Badge tone={row.qty_open > 0 ? 'info' : 'success'} size="xs">{row.qty_open > 0 ? 'Open' : 'Settled'}</Badge> : null}
    >
      {detail.loading && !row ? <LoadingState label="Loading the settlement trail…" /> : null}
      {detail.error ? <ErrorState title="Unable to load the timeline." description={errorMessage(detail.error)} onRetry={detail.reload} /> : null}

      {row ? (
        <div className="aic space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-gray-500">Settled</span>
              <span className="tabular-nums font-semibold text-gray-900">
                {formatQty(row.qty_settled)} of {formatQty(row.qty_original)} {row.unit_symbol ?? ''}
              </span>
            </div>
            <ProgressBar value={percent} />
          </div>

          <ol className="relative space-y-4 border-l border-gray-200 pl-5">
            <li className="relative">
              <CircleDot className="absolute -left-[1.6rem] top-0.5 h-3.5 w-3.5 text-primary" aria-hidden />
              <p className="text-sm font-medium text-gray-900">
                Sent to {row.party_name ?? (row.party_ref ? `ledger #${row.party_ref}` : 'the job worker')}
              </p>
              <p className="text-xs text-gray-500">
                {formatDate(row.document_date)} ·{' '}
                <Link to={`/documents/${row.document_id}`} className="text-primary no-underline hover:underline">
                  {row.document_no ?? `#${row.document_id}`}
                </Link>{' '}
                · {formatQty(row.qty_original)} {row.unit_symbol ?? ''}
                {row.warehouse_name ? ` from ${row.warehouse_name}` : ''}
              </p>
            </li>

            {row.settlements.map((s) => (
              <li key={s.settlement_id} className="relative">
                <CircleDot className="absolute -left-[1.6rem] top-0.5 h-3.5 w-3.5 text-emerald-600" aria-hidden />
                <p className="text-sm font-medium text-gray-900">
                  {s.settlement_type === 'returned' ? 'Returned unused' : s.settlement_type === 'consumed' ? 'Consumed at the job worker' : 'Settled'} ·{' '}
                  {formatQty(s.qty_settled)} {row.unit_symbol ?? ''}
                </p>
                <p className="text-xs text-gray-500">
                  {formatDate(s.document_date ?? s.created_at)}
                  {s.document_no ? (
                    <>
                      {' · '}
                      <Link to={`/documents/${s.settle_document_id}`} className="text-primary no-underline hover:underline">
                        {s.document_no}
                      </Link>
                    </>
                  ) : null}
                  {s.document_status ? ` · ${s.document_status.toLowerCase()}` : ''}
                </p>
              </li>
            ))}

            <li className="relative">
              <CircleDot className={`absolute -left-[1.6rem] top-0.5 h-3.5 w-3.5 ${row.qty_open > 0 ? 'text-amber-500' : 'text-gray-300'}`} aria-hidden />
              <p className="text-sm font-medium text-gray-900">
                {row.qty_open > 0 ? `${formatQty(row.qty_open)} ${row.unit_symbol ?? ''} still with the job worker` : 'Fully settled'}
              </p>
              {row.qty_open > 0 ? <p className="text-xs text-gray-500">Settle it on a Job Work Inward.</p> : null}
            </li>
          </ol>
        </div>
      ) : null}
    </Drawer>
  )
}
