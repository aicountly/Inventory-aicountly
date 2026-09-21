import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ArrowUpRight, CircleCheck, Clock, FileText } from 'lucide-react'
import { useQuery } from '../../hooks/useQuery'
import { pendingHistoryApi } from '../../services/pendingHistoryApi'
import type { PendingSettlement } from '../../services/pendingHistoryApi'
import { Drawer } from '../../ui/Drawer'
import { ErrorState } from '../../ui/ErrorState'
import { LoadingState } from '../../ui/LoadingState'
import { Badge } from '../../ui/Badge'
import { ProgressBar } from '../../ui/ProgressBar'
import { formatDate, formatDateTime, formatMoney, formatQty, humanize } from '../../utils/format'
import type { PendingRow } from '../../services/stockApi'
import {
  AgeingCell,
  DirectionBadge,
  PendingStatusBadge,
  PriorityBadge,
  pendingKindLabel,
} from './pendingCells'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-gray-900">{children}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </section>
  )
}

/**
 * The settlement trail, oldest first.
 *
 * This is the working behind `Settled qty`: every later document that consumed
 * part of this pending line, with the quantity it took. A reader disputing an
 * open figure is really disputing one of these rows, so each one links to the
 * document that made it.
 */
function SettlementTimeline({ settlements }: { settlements: readonly PendingSettlement[] }) {
  if (!settlements.length) {
    return (
      <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-500">
        Nothing has settled against this line yet.
      </p>
    )
  }
  return (
    <ol className="relative space-y-3 border-l border-gray-200 pl-4">
      {settlements.map((s) => (
        <li key={s.settlement_id} className="relative">
          <span
            className="absolute -left-[1.4rem] top-1 grid h-4 w-4 place-items-center rounded-full bg-emerald-50 text-emerald-600"
            aria-hidden
          >
            <CircleCheck className="h-3 w-3" strokeWidth={2} />
          </span>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="text-sm font-semibold tabular-nums text-gray-900">
              {formatQty(s.qty_settled)} settled
            </span>
            <span className="text-[11px] text-gray-500">{formatDateTime(s.created_at)}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
            {s.settle_document_id ? (
              <Link
                to={`/documents/${s.settle_document_id}`}
                className="font-medium text-primary hover:underline"
              >
                {s.document_no ?? `#${s.settle_document_id}`}
              </Link>
            ) : null}
            {s.document_type_label ? <span>{s.document_type_label}</span> : null}
            {s.settlement_type ? (
              <Badge tone="neutral" size="xs" className="normal-case">
                {humanize(s.settlement_type)}
              </Badge>
            ) : null}
            {s.source_app && s.source_app !== 'inventory' ? (
              <Badge tone="info" size="xs" className="normal-case">
                via {humanize(s.source_app)}
                {s.source_document_no ? ` · ${s.source_document_no}` : ''}
              </Badge>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

/**
 * One pending line, opened beside the register rather than instead of it.
 *
 * A drawer because the question it answers — "why is this still open?" — is
 * asked while running an eye down a column, and navigating away to answer it
 * loses the place in the list. The source document is still one click away and
 * is still where the line gets amended: this reads, it does not write.
 *
 * It fetches the line by id rather than reusing the row it was opened from,
 * because the settlement trail is the point and the list endpoint does not carry
 * it. Everything else the endpoint returns is derived by the same SQL the table
 * used, so the drawer cannot disagree with the row behind it.
 */
export function PendingDetailDrawer({
  row,
  open,
  onClose,
}: {
  row: PendingRow
  open: boolean
  onClose: () => void
}) {
  const detail = useQuery(
    (signal) => pendingHistoryApi.get(row.pending_id, signal),
    [row.pending_id, open],
    { enabled: open },
  )

  // The row the table already has, so the drawer paints instantly and the fetch
  // only fills in the trail. Never a second source of truth: the moment the
  // endpoint answers, its figures win.
  const d = detail.data ?? row
  const settledShare =
    d.qty_original > 0 ? Math.min(100, Math.max(0, (d.qty_settled / d.qty_original) * 100)) : 0

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={d.document_no ?? `Pending line #${row.pending_id}`}
      badge={d.status ? <PendingStatusBadge status={d.status} /> : null}
      description={`${d.document_type_label ?? d.document_type} · ${pendingKindLabel(d.pending_kind)} · ${formatDate(d.document_date)}`}
      footer={
        d.document_id ? (
          <Link
            to={`/documents/${d.document_id}`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >
            Open source document
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : null
      }
    >
      {detail.error && !detail.data ? (
        <ErrorState
          title="Unable to load this pending line"
          description="We couldn't retrieve its settlement history right now."
          onRetry={detail.reload}
        />
      ) : (
        <>
          <Section title="Pending quantity">
            <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Open quantity</p>
                  <p className="text-2xl font-semibold tabular-nums text-gray-900">
                    {formatQty(d.qty_open)}{' '}
                    <span className="text-sm font-medium text-gray-500">{d.unit_symbol ?? ''}</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">
                    Pending value (at cost)
                  </p>
                  <p className="text-sm font-semibold tabular-nums text-gray-900">
                    {formatMoney(d.pending_value)}
                  </p>
                </div>
              </div>
              <ProgressBar value={settledShare} className="mt-3" />
              <p className="mt-1.5 text-[11px] text-gray-500">
                {formatQty(d.qty_settled)} of {formatQty(d.qty_original)} settled
                {d.unit_symbol ? ` ${d.unit_symbol}` : ''} · {settledShare.toFixed(0)}%
              </p>
            </div>
          </Section>

          <Section title="Line">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Item">
                <Link
                  to={`/registers/stock-ledger?item_id=${d.item_id}`}
                  className="text-gray-900 hover:text-primary"
                >
                  {d.item_name ?? `Item #${d.item_id}`}
                </Link>
                {d.item_sku ? <span className="text-gray-400"> · {d.item_sku}</span> : null}
              </Field>
              <Field label="Direction">
                <DirectionBadge direction={d.direction} />
              </Field>
              <Field label="Warehouse">
                {d.warehouse_name ?? <span className="text-gray-400">—</span>}
              </Field>
              <Field label="Party">
                {d.party_name ?? (d.party_ref ? `Ledger #${d.party_ref}` : <span className="text-gray-400">—</span>)}
              </Field>
              <Field label="Unit cost (at cost)">{formatMoney(d.unit_cost)}</Field>
              <Field label="Kind">{pendingKindLabel(d.pending_kind)}</Field>
            </dl>
          </Section>

          <Section title="Timing">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Document date">{formatDate(d.document_date)}</Field>
              <Field label="Ageing">
                <AgeingCell row={d as PendingRow} />
              </Field>
              <Field label="Expected date">
                {d.has_expected_date ? (
                  formatDate(d.expected_return_date)
                ) : (
                  <span className="text-gray-400" title="The document recorded none; the register measures lateness against the company's grace period instead.">
                    Not recorded
                  </span>
                )}
              </Field>
              <Field label="Priority">
                {d.priority ? <PriorityBadge row={d as PendingRow} /> : <span className="text-gray-400">—</span>}
              </Field>
              <Field label="Last activity">{formatDateTime(d.last_activity_at)}</Field>
              <Field label="Settlement state">{humanize(d.settlement_status)}</Field>
            </dl>
          </Section>

          <Section title="Settlement history">
            {detail.loading && !detail.data ? (
              <LoadingState label="Loading settlement history" />
            ) : (
              <SettlementTimeline settlements={detail.data?.settlements ?? []} />
            )}
          </Section>

          <Section title="Related documents">
            <ul className="space-y-1.5 text-xs">
              <li className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                <Link to={`/documents/${d.document_id}`} className="text-primary hover:underline">
                  {d.document_no ?? `#${d.document_id}`}
                </Link>
                <span className="text-gray-500">raised this pending quantity</span>
              </li>
              <li className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                <Link
                  to={`/registers/pending-quantities?item_id=${d.item_id}`}
                  className="text-primary hover:underline"
                >
                  Everything pending for this item
                </Link>
              </li>
            </ul>
          </Section>
        </>
      )}
    </Drawer>
  )
}

export default PendingDetailDrawer
