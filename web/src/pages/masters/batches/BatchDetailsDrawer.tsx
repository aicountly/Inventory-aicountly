import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Copy,
  History,
  MapPin,
  Pencil,
  Printer,
  Warehouse,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { EmptyState } from '../../../ui/EmptyState'
import { ErrorState } from '../../../ui/ErrorState'
import { Skeleton } from '../../../ui/Skeleton'
import { StatusBadge } from '../../../ui/StatusBadge'
import { cx } from '../../../ui/cx'
import { notify } from '../../../ui/notify'
import { useCompany } from '../../../company/CompanyContext'
import { useQuery } from '../../../hooks/useQuery'
import { batchWorkspaceApi } from '../../../services/batchesApi'
import type { Batch } from '../../../services/masters'
import { stockMovementsApi } from '../../../services/stockViewsApi'
import type { StockMovementRow } from '../../../services/stockViewsApi'
import { copyText } from '../../../utils/clipboard'
import { formatDate, formatDateTime, formatInt, formatQty, humanize } from '../../../utils/format'
import { batchStatusChip, daysUntil, expiryNote } from './batchPresentation'

/**
 * The inspector: one batch read beside the list it came from.
 *
 * Everything on it is live. The header, the dates and the status come from the
 * row the table already holds, so the panel opens with content instead of a
 * spinner; the per-warehouse balances and the recent movements are fetched from
 * `GET /v1/batches/{id}` and `GET /v1/stock-movements?batch_id=…` as the panel
 * opens. Nothing is invented: a batch with no movements says so rather than
 * showing a decorative timeline, and the sections the API cannot answer are not
 * drawn at all.
 *
 * The movement list is scoped to the selected financial year, like every other
 * movement view in the product, and the section heading says so — a "last
 * movement" that quietly skipped last year's issue would be worse than none.
 */

const MOVEMENT_LIMIT = 8

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px] text-gray-900">{children}</dd>
    </div>
  )
}

function Dash() {
  return <span className="text-gray-300">—</span>
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

async function copy(value: string, what: string) {
  const ok = await copyText(value)
  if (ok) notify.success(`${what} copied`)
  else notify.error(`Could not copy the ${what.toLowerCase()}`)
}

function CopyChip({ value, what }: { value: string; what: string }) {
  return (
    <button
      type="button"
      onClick={() => void copy(value, what)}
      title={`Copy ${what.toLowerCase()}`}
      className="inline-flex items-center gap-1 rounded px-1 font-mono text-[13px] font-semibold text-gray-900 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      {value}
      <Copy className="h-3 w-3 shrink-0 opacity-45" aria-hidden />
      <span className="sr-only">Copy {what.toLowerCase()}</span>
    </button>
  )
}

export interface BatchDetailsDrawerProps {
  /** The row the table already has, so the panel opens filled in. */
  batch: Batch | null
  onClose: () => void
  onEdit: (batch: Batch) => void
  onPrintLabel: (batch: Batch) => void
  canWrite: boolean
  today: string
  nearExpiryDays: number
}

export function BatchDetailsDrawer({
  batch,
  onClose,
  onEdit,
  onPrintLabel,
  canWrite,
  today,
  nearExpiryDays,
}: BatchDetailsDrawerProps) {
  const { scope } = useCompany()
  const cmpId = scope?.cmp_id ?? null
  const batchId = batch?.batch_id ?? null

  const detail = useQuery(
    (signal) => batchWorkspaceApi.get(batchId as number, signal),
    [batchId, cmpId],
    { enabled: batchId !== null && scope !== null, keepData: false, resetKey: cmpId },
  )

  const movements = useQuery(
    (signal) =>
      stockMovementsApi.list(
        { batch_id: batchId as number, limit: MOVEMENT_LIMIT, sort: 'movement_date', order: 'desc' },
        signal,
      ),
    [batchId, cmpId],
    { enabled: batchId !== null && scope !== null, keepData: false, resetKey: cmpId },
  )

  const balances = detail.data?.balances ?? []
  const stock = detail.data?.stock ?? batch?.stock ?? null
  const rows: StockMovementRow[] = movements.data?.data ?? []

  const chip = useMemo(
    () => (batch ? batchStatusChip(batch, today, nearExpiryDays) : null),
    [batch, today, nearExpiryDays],
  )
  const days = batch ? daysUntil(batch.expiry_date, today) : null

  if (!batch) return null

  const unit = batch.unit_symbol ? ` ${batch.unit_symbol}` : ''

  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title={<span className="font-mono">{batch.batch_no}</span>}
      badge={
        chip ? (
          <Badge tone={chip.tone} size="sm" dot className="normal-case">
            {chip.label}
            <span className="sr-only"> — {chip.srText}</span>
          </Badge>
        ) : null
      }
      description={batch.item_name ?? `Item #${batch.item_id}`}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* No icon: the header already carries the ✕, and a second glyph
              beside the word only invites guessing at what it means. */}
          <Button variant="ghost" size="sm" onClick={() => onClose()} className="mr-auto">
            Close
          </Button>
          <Button variant="secondary" size="sm" icon={Printer} onClick={() => onPrintLabel(batch)}>
            Print label
          </Button>
          <Link
            to={`/registers/movement-register?batch_id=${batch.batch_id}`}
            className="no-underline"
          >
            <Button variant="secondary" size="sm" icon={History}>
              View movements
            </Button>
          </Link>
          {canWrite ? (
            <Button size="sm" icon={Pencil} onClick={() => onEdit(batch)}>
              Edit batch
            </Button>
          ) : null}
        </div>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Field label="Batch number">
          <CopyChip value={batch.batch_no} what="Batch number" />
        </Field>
        <Field label="Lot number">
          {batch.lot_no ? <CopyChip value={batch.lot_no} what="Lot number" /> : <Dash />}
        </Field>
        <Field label="Stored status">
          <StatusBadge value={batch.status} size="sm" />
        </Field>
        <Field label="Item">
          <Link to={`/items/${batch.item_id}`} className="font-medium text-primary hover:underline">
            {batch.item_name ?? `Item #${batch.item_id}`}
          </Link>
          {batch.item_sku ? (
            <span className="ml-1 text-[11px] text-gray-500">· {batch.item_sku}</span>
          ) : null}
        </Field>
        <Field label="Manufactured">{formatDate(batch.mfg_date)}</Field>
        <Field label="Expires">
          {batch.expiry_date ? (
            <>
              {formatDate(batch.expiry_date)}
              {days !== null ? (
                <span
                  className={cx(
                    'ml-1.5 text-[11px] font-medium',
                    days < 0 ? 'text-red-600' : days <= nearExpiryDays ? 'text-amber-600' : 'text-gray-500',
                  )}
                >
                  {expiryNote(days)}
                </span>
              ) : null}
            </>
          ) : (
            <Dash />
          )}
        </Field>
        <Field label="On hand">
          {stock ? (
            <strong className="tabular-nums">{`${formatQty(stock.on_hand)}${unit}`}</strong>
          ) : detail.loading ? (
            <Skeleton className="h-4 w-16" rounded="md" />
          ) : (
            <Dash />
          )}
        </Field>
        <Field label="Available">
          {stock ? <span className="tabular-nums">{`${formatQty(stock.available)}${unit}`}</span> : <Dash />}
        </Field>
        <Field label="Reserved">
          {stock ? <span className="tabular-nums">{`${formatQty(stock.reserved)}${unit}`}</span> : <Dash />}
        </Field>
        <Field label="Warranty">
          {batch.warranty_months ? `${formatInt(batch.warranty_months)} months` : <Dash />}
        </Field>
        <Field label="Created">
          {batch.created_at ? (
            <>
              {formatDateTime(batch.created_at)}
              {batch.created_by ? (
                <span className="block text-[11px] text-gray-500">by {batch.created_by}</span>
              ) : null}
            </>
          ) : (
            <Dash />
          )}
        </Field>
        <Field label="Last changed">
          {batch.updated_at ? formatDateTime(batch.updated_at) : <Dash />}
        </Field>
      </dl>

      <Section title="Stock by warehouse">
        {detail.loading && balances.length === 0 ? (
          <div className="space-y-1.5">
            <Skeleton className="h-8" rounded="lg" />
            <Skeleton className="h-8" rounded="lg" />
          </div>
        ) : detail.error ? (
          <ErrorState
            size="sm"
            title="Balances could not be loaded."
            description="The figures above the table are unaffected."
            onRetry={detail.reload}
          />
        ) : balances.length === 0 ? (
          <p className="text-xs text-gray-500">
            This batch has no balance recorded in any warehouse. It stays on record for traceability.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200" role="list">
            {balances.map((b) => (
              <li
                key={`${b.warehouse_id ?? 'none'}`}
                className="flex items-center justify-between gap-3 px-2.5 py-2 text-[12px]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Warehouse className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-gray-900">
                      {b.warehouse_name ?? (b.warehouse_id ? `Warehouse #${b.warehouse_id}` : 'Unassigned')}
                    </span>
                    {b.warehouse_code ? (
                      <span className="block truncate text-[10px] text-gray-400">{b.warehouse_code}</span>
                    ) : null}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <strong className="block tabular-nums text-gray-900">{`${formatQty(b.on_hand)}${unit}`}</strong>
                  <span className="block text-[10px] text-gray-500">
                    {formatQty(b.available)} available
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Recent movements · this financial year"
        action={
          <Link
            to={`/registers/movement-register?batch_id=${batch.batch_id}`}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            Open register
          </Link>
        }
      >
        {movements.loading && rows.length === 0 ? (
          <div className="space-y-1.5">
            <Skeleton className="h-8" rounded="lg" />
            <Skeleton className="h-8" rounded="lg" />
            <Skeleton className="h-8" rounded="lg" />
          </div>
        ) : movements.error ? (
          <ErrorState
            size="sm"
            title="Movements could not be loaded."
            onRetry={movements.reload}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            size="sm"
            icon={History}
            title="No movements this year"
            description="Nothing has moved in or out of this batch in the selected financial year."
          />
        ) : (
          <ol className="relative space-y-3 border-l border-gray-200 pl-4" role="list">
            {rows.map((m) => {
              const inward = m.direction === 'in' || Number(m.qty) > 0
              return (
                <li key={m.movement_id} className="relative">
                  <span
                    className={cx(
                      'absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full ring-2 ring-white',
                      m.movement_kind === 'reversal'
                        ? 'bg-amber-500'
                        : inward
                          ? 'bg-primary'
                          : 'bg-sky-500',
                    )}
                    aria-hidden
                  />
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 text-[12px] font-medium text-gray-900">
                      {m.document_type_label || humanize(m.document_type)}
                      {m.document_no ? (
                        <span className="ml-1 font-mono text-[11px] text-gray-500">{m.document_no}</span>
                      ) : null}
                    </span>
                    <strong
                      className={cx(
                        'shrink-0 tabular-nums text-[12px]',
                        inward ? 'text-emerald-600' : 'text-gray-700',
                      )}
                    >
                      {inward ? '+' : ''}
                      {formatQty(m.qty)}
                      {m.unit_symbol ? ` ${m.unit_symbol}` : ''}
                    </strong>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-gray-500">
                    <span>{formatDate(m.movement_date)}</span>
                    {m.warehouse_name ? (
                      <span className="inline-flex items-center gap-0.5">
                        <MapPin className="h-3 w-3" aria-hidden />
                        {m.warehouse_name}
                      </span>
                    ) : null}
                    {m.source_app ? <span>· {humanize(m.source_app)}</span> : null}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </Section>
    </Drawer>
  )
}

export default BatchDetailsDrawer
