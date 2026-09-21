import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeftRight,
  Copy,
  Pencil,
  Printer,
  Warehouse as WarehouseIcon,
} from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { EmptyState } from '../../../ui/EmptyState'
import { ErrorState } from '../../../ui/ErrorState'
import { Skeleton } from '../../../ui/Skeleton'
import { Tooltip } from '../../../ui/Tooltip'
import { cx } from '../../../ui/cx'
import { useQuery } from '../../../hooks/useQuery'
import { batchesApi } from '../../../services/masters'
import type { Batch } from '../../../services/masters'
import { stockMovementsApi } from '../../../services/stockViewsApi'
import type { StockMovementRow } from '../../../services/stockViewsApi'
import { formatDate, formatDateTime, formatQty, humanize } from '../../../utils/format'
import { BATCH_STATE_LABEL, BATCH_STATE_TONE, batchState, expiryCaption } from './batchExpiry'

/**
 * One batch, read beside the list rather than on top of it.
 *
 * A drawer because the question it answers — "what is this lot, where is it,
 * what has happened to it" — is asked WHILE scanning the table, and a reader
 * comparing two lots should not have to close one to see where the other sat.
 *
 * Everything on it is fetched live: the record and its per-warehouse balances
 * from `GET /v1/batches/{id}`, and the movements from the movement ledger the
 * registers read. There is no invented history here — a batch with no postings
 * shows an empty movement section, and says so.
 */

const MOVEMENT_LIMIT = 8

export interface BatchDetailsDrawerProps {
  /** The row that was clicked — used for an instant header while the fetch runs. */
  batch: Batch | null
  open: boolean
  onClose: () => void
  today: string
  windowDays: number
  canWrite: boolean
  onEdit: (batch: Batch) => void
  onPrintLabel: (batch: Batch) => void
  onCopy: (value: string, what: string) => void
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <dt className="w-32 shrink-0 text-[11px] uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13px] text-gray-900">{children}</dd>
    </div>
  )
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-gray-100 pt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Dash() {
  return <span className="text-gray-300">—</span>
}

/** A value the reader will retype somewhere — so it is one click to copy. */
function Copyable({ value, what, onCopy }: { value: string | null | undefined; what: string; onCopy: (v: string, w: string) => void }) {
  if (!value) return <Dash />
  return (
    <Tooltip label={`Copy ${what.toLowerCase()}`}>
      <button
        type="button"
        onClick={() => onCopy(value, what)}
        className="inline-flex items-center gap-1.5 rounded font-mono text-[13px] font-semibold text-gray-900 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {value}
        <Copy className="h-3 w-3 shrink-0 opacity-40" aria-hidden />
      </button>
    </Tooltip>
  )
}

function MovementLine({ movement }: { movement: StockMovementRow }) {
  const qty = Number(movement.qty) || 0
  const incoming = qty >= 0
  return (
    <li className="flex items-start gap-3 py-2">
      <span
        className={cx(
          'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
          incoming ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
        )}
        aria-hidden
      >
        {incoming ? '+' : '−'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-medium text-gray-900">
            {movement.document_type_label ?? humanize(movement.document_type)}
            {movement.document_no ? <span className="ml-1 font-normal text-gray-500">{movement.document_no}</span> : null}
          </span>
          <span className="shrink-0 text-[13px] font-semibold tabular-nums text-gray-900">
            {formatQty(Math.abs(qty))}
            {movement.unit_symbol ? <span className="ml-1 font-normal text-gray-500">{movement.unit_symbol}</span> : null}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-gray-500">
          {formatDate(movement.movement_date)}
          {movement.warehouse_name ? ` · ${movement.warehouse_name}` : ''}
          {movement.party_name ? ` · ${movement.party_name}` : ''}
          {movement.movement_kind && movement.movement_kind !== 'physical' ? ` · ${humanize(movement.movement_kind)}` : ''}
        </p>
      </div>
    </li>
  )
}

export function BatchDetailsDrawer({
  batch,
  open,
  onClose,
  today,
  windowDays,
  canWrite,
  onEdit,
  onPrintLabel,
  onCopy,
}: BatchDetailsDrawerProps) {
  const batchId = batch?.batch_id ?? null

  const detail = useQuery(
    async (signal) => (batchId === null ? null : batchesApi.get(batchId, signal)),
    [batchId],
    { enabled: open && batchId !== null, resetKey: batchId },
  )

  const movements = useQuery(
    async (signal) =>
      batchId === null
        ? null
        : stockMovementsApi.list(
            { batch_id: batchId, limit: MOVEMENT_LIMIT, sort: 'movement_date', order: 'desc', all_fy: 1 },
            signal,
          ),
    [batchId],
    { enabled: open && batchId !== null, resetKey: batchId },
  )

  // The clicked row stands in until the full record lands, so the header and
  // the badge are right from the first frame rather than flashing a skeleton.
  const row = detail.data ?? batch
  const state = useMemo(() => (row ? batchState(row, today, windowDays) : 'active'), [row, today, windowDays])
  const balances = detail.data?.balances ?? []
  const caption = row ? expiryCaption(row.expiry_date, today) : null

  if (!row) return null

  const movementRows = movements.data?.data ?? []
  const movementsHref = `/registers/movement-register?item_id=${row.item_id}&batch_id=${row.batch_id}`

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={row.batch_no}
      badge={
        <Badge tone={BATCH_STATE_TONE[state]} size="sm" dot className="normal-case">
          {BATCH_STATE_LABEL[state]}
        </Badge>
      }
      description={row.item_name ?? `Item #${row.item_id}`}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" icon={Printer} onClick={() => onPrintLabel(row)}>
            Print label
          </Button>
          {/* A real link, not a button that navigates: the movement register is
              a routed screen and the reader may want it in a new tab. */}
          <Link
            to={movementsHref}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 no-underline transition-colors hover:border-primary/40 hover:bg-primary-light hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <ArrowLeftRight className="h-4 w-4" aria-hidden />
            View movements
          </Link>
          <Button variant="primary" size="sm" icon={Pencil} onClick={() => onEdit(row)}>
            {canWrite ? 'Edit batch' : 'View details'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <dl className="divide-y divide-gray-50">
          <Row label="Batch">
            <Copyable value={row.batch_no} what="Batch number" onCopy={onCopy} />
          </Row>
          <Row label="Lot">
            <Copyable value={row.lot_no} what="Lot number" onCopy={onCopy} />
          </Row>
          <Row label="Item">
            <Link to={`/items/${row.item_id}`} className="font-medium text-primary hover:underline">
              {row.item_name ?? `Item #${row.item_id}`}
            </Link>
            {row.item_sku ? <span className="ml-1.5 text-gray-500">· {row.item_sku}</span> : null}
            {row.stock_cat_name || row.item_grp_name ? (
              <span className="mt-0.5 block text-[11px] text-gray-500">{row.stock_cat_name ?? row.item_grp_name}</span>
            ) : null}
          </Row>
          <Row label="Manufactured">{row.mfg_date ? formatDate(row.mfg_date) : <Dash />}</Row>
          <Row label="Expires">
            {row.expiry_date ? (
              <>
                {formatDate(row.expiry_date)}
                {caption ? (
                  <span
                    className={cx(
                      'ml-2 text-[11px] font-medium',
                      state === 'expired' ? 'text-red-600' : state === 'expiring_soon' ? 'text-amber-700' : 'text-gray-500',
                    )}
                  >
                    {caption}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-gray-500">No expiry date recorded</span>
            )}
          </Row>
          <Row label="Stored status">{humanize(row.status)}</Row>
          {row.warranty_months ? <Row label="Warranty">{row.warranty_months} months</Row> : null}
        </dl>

        <Section title="Current stock">
          {detail.loading && !detail.data ? (
            <Skeleton className="h-16" />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'On hand', value: row.stock?.on_hand },
                { label: 'Available', value: row.stock?.available },
                { label: 'Reserved', value: row.stock?.reserved },
              ].map((cell) => (
                <div key={cell.label} className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">{cell.label}</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums text-gray-900">
                    {formatQty(cell.value ?? 0, '0')}
                    {row.unit_symbol ? <span className="ml-1 text-xs font-normal text-gray-500">{row.unit_symbol}</span> : null}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Stock by warehouse">
          {detail.loading && !detail.data ? (
            <Skeleton className="h-20" />
          ) : detail.error ? (
            <ErrorState
              size="sm"
              title="Couldn’t load this batch."
              description="Check your connection or try again."
              onRetry={detail.reload}
            />
          ) : balances.length === 0 ? (
            <p className="py-2 text-[13px] text-gray-500">
              This batch has never carried stock in any warehouse.
            </p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {balances.map((b) => (
                <li key={`${b.warehouse_id ?? 'none'}`} className="flex items-center gap-3 py-2">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600" aria-hidden>
                    <WarehouseIcon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-gray-900">
                      {b.warehouse_name ?? 'Unassigned'}
                    </p>
                    {b.reserved > 0 || b.quality_hold > 0 || b.damaged > 0 ? (
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        {[
                          b.reserved > 0 ? `${formatQty(b.reserved)} reserved` : '',
                          b.quality_hold > 0 ? `${formatQty(b.quality_hold)} on hold` : '',
                          b.damaged > 0 ? `${formatQty(b.damaged)} damaged` : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums text-gray-900">
                    {formatQty(b.on_hand, '0')}
                    {row.unit_symbol ? <span className="ml-1 font-normal text-gray-500">{row.unit_symbol}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Recent movements"
          aside={
            movementRows.length > 0 ? (
              <Link to={movementsHref} className="text-[11px] font-semibold text-primary hover:underline">
                View all
              </Link>
            ) : null
          }
        >
          {movements.loading && !movements.data ? (
            <Skeleton className="h-24" />
          ) : movements.error ? (
            <ErrorState
              size="sm"
              title="Couldn’t load movements."
              description="Check your connection or try again."
              onRetry={movements.reload}
            />
          ) : movementRows.length === 0 ? (
            <EmptyState
              size="sm"
              icon={ArrowLeftRight}
              title="No movements yet"
              description="Nothing has been received into or issued from this batch."
            />
          ) : (
            <ul className="divide-y divide-gray-50">
              {movementRows.map((m) => (
                <MovementLine key={m.movement_id} movement={m} />
              ))}
            </ul>
          )}
        </Section>

        <Section title="Record">
          <dl className="divide-y divide-gray-50">
            <Row label="Created">
              {row.created_at ? formatDateTime(row.created_at) : <Dash />}
              {row.created_by ? <span className="ml-1.5 text-gray-500">by {row.created_by}</span> : null}
            </Row>
            <Row label="Last updated">
              {row.updated_at ? formatDateTime(row.updated_at) : <Dash />}
              {row.updated_by ? <span className="ml-1.5 text-gray-500">by {row.updated_by}</span> : null}
            </Row>
          </dl>
        </Section>
      </div>
    </Drawer>
  )
}

export default BatchDetailsDrawer
