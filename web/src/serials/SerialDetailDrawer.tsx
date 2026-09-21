import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, FileText, Pencil, Printer } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Drawer } from '../ui/Drawer'
import { ErrorState } from '../ui/ErrorState'
import { LoadingState } from '../ui/LoadingState'
import { SegmentedControl } from '../ui/SegmentedControl'
import { StatusBadge } from '../ui/StatusBadge'
import { cx } from '../ui/cx'
import { useQuery } from '../hooks/useQuery'
import { serialsApi } from '../services/masters'
import type { Serial, SerialHistoryEvent } from '../services/masters'
import { currencySymbol, formatDate, formatDateTime, formatMoney, humanize } from '../utils/format'
import { buildSerialLifecycle } from './serialLifecycle'
import type { LifecycleNames, LifecycleTone } from './serialLifecycle'
import { SerialWarrantyCell } from './SerialWarrantyCell'
import { WARRANTY_STATE_LABEL, daysUntil, warrantyState, warrantyTone } from './warranty'
import type { WarrantyThresholds } from './warranty'

type Tab = 'overview' | 'lifecycle' | 'documents' | 'audit'

const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'lifecycle', label: 'Lifecycle' },
  { value: 'documents', label: 'Documents' },
  { value: 'audit', label: 'Audit' },
]

const DOT_TONE: Record<LifecycleTone, string> = {
  neutral: 'bg-gray-300',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-sky-500',
}

export interface SerialDetailDrawerProps {
  serial: Serial | null
  open: boolean
  onClose: () => void
  onEdit: (row: Serial) => void
  onPrintLabel: (row: Serial) => void
  canWrite: boolean
  costVisible: boolean
  currency: string
  today: string
  thresholds: WarrantyThresholds
  names: LifecycleNames
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-2 last:border-0">
      <dt className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="m-0 min-w-0 text-right text-xs text-gray-800">{children ?? <span className="text-gray-300">—</span>}</dd>
    </div>
  )
}

/**
 * One serial, read beside the list rather than on top of it.
 *
 * The history is fetched only once a tab that needs it is opened. A serial that
 * has passed through forty documents is forty joins nobody asked for while the
 * reader is looking at its warehouse.
 */
export function SerialDetailDrawer({
  serial,
  open,
  onClose,
  onEdit,
  onPrintLabel,
  canWrite,
  costVisible,
  currency,
  today,
  thresholds,
  names,
}: SerialDetailDrawerProps) {
  const [tab, setTab] = useState<Tab>('overview')
  const [historyWanted, setHistoryWanted] = useState(false)

  useEffect(() => {
    if (!open) {
      setTab('overview')
      setHistoryWanted(false)
    }
  }, [open, serial?.serial_id])

  const history = useQuery(
    (signal) => serialsApi.history(Number(serial?.serial_id), signal),
    [serial?.serial_id, historyWanted],
    { enabled: open && historyWanted && Boolean(serial?.serial_id) },
  )

  const events: SerialHistoryEvent[] = useMemo(() => history.data?.events ?? [], [history.data])
  const lifecycle = useMemo(() => buildSerialLifecycle(events, names), [events, names])
  const documents = useMemo(() => events.filter((e) => e.kind === 'document'), [events])
  const audits = useMemo(() => events.filter((e) => e.kind === 'audit'), [events])

  if (!serial) return null

  const state = warrantyState(serial.warranty_until, today, thresholds)
  const remaining = daysUntil(serial.warranty_until, today)

  /** Skeleton, error, "nothing here" or the list — in that order, once. */
  const historyBody = (empty: string, body: ReactNode) => {
    if (history.error) {
      return (
        <ErrorState
          size="sm"
          title="We couldn’t load this serial’s history."
          description={history.error.message}
          onRetry={history.reload}
        />
      )
    }
    if (!history.data) return <LoadingState variant="skeleton" rows={5} />
    return body === null ? <p className="text-xs text-gray-500">{empty}</p> : body
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={<span className="font-mono">{serial.serial_no}</span>}
      badge={<StatusBadge value={serial.status} dot />}
      description={serial.item_name ? `${serial.item_name}${serial.item_sku ? ` · ${serial.item_sku}` : ''}` : undefined}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" icon={Printer} onClick={() => onPrintLabel(serial)}>
            Print label
          </Button>
          {canWrite ? (
            <Button size="sm" icon={Pencil} onClick={() => onEdit(serial)}>
              Edit serial number
            </Button>
          ) : null}
        </div>
      }
    >
      <SegmentedControl<Tab>
        value={tab}
        options={TABS}
        onChange={(next) => {
          setTab(next)
          if (next !== 'overview') setHistoryWanted(true)
        }}
        className="mb-3"
      />

      {tab === 'overview' ? (
        <dl className="m-0">
          <Row label="Serial number">
            <span className="font-mono">{serial.serial_no}</span>
          </Row>
          <Row label="Item">
            <Link to={`/items/${serial.item_id}`} className="inline-flex items-center gap-1 no-underline hover:underline">
              {serial.item_name ?? `Item #${serial.item_id}`}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </Link>
          </Row>
          <Row label="SKU">{serial.item_sku}</Row>
          <Row label="Status">
            <StatusBadge value={serial.status} />
          </Row>
          <Row label="Warehouse">
            {serial.warehouse_name}
            {serial.warehouse_code ? <span className="text-gray-400"> · {serial.warehouse_code}</span> : null}
          </Row>
          <Row label="Location">{serial.location_code ? <span className="font-mono">{serial.location_code}</span> : null}</Row>
          <Row label="Batch">{serial.batch_no ? <span className="font-mono">{serial.batch_no}</span> : null}</Row>
          {/* The cost row is not rendered at all for a reader the server
              withholds it from — there is nothing in the markup to reveal. */}
          {costVisible ? (
            <Row label="Unit cost">
              {serial.unit_cost === null || serial.unit_cost === undefined
                ? null
                : `${currencySymbol(currency)} ${formatMoney(serial.unit_cost)}`}
            </Row>
          ) : null}
          <Row label="Warranty until">
            <SerialWarrantyCell until={serial.warranty_until} today={today} thresholds={thresholds} />
          </Row>
          <Row label="Registered">{formatDateTime(serial.created_at)}</Row>
          <Row label="Last updated">{formatDateTime(serial.updated_at)}</Row>
        </dl>
      ) : null}

      {tab === 'lifecycle'
        ? historyBody(
            'Nothing has been recorded against this serial number yet.',
            lifecycle.length === 0 ? null : (
              <ol className="m-0 list-none p-0">
                {lifecycle.map((entry, index) => (
                  <li key={entry.id} className="relative flex gap-3 pb-4 pl-1 last:pb-0">
                    {index < lifecycle.length - 1 ? (
                      <span className="absolute left-[7px] top-4 h-full w-px bg-gray-200" aria-hidden />
                    ) : null}
                    <span className={cx('relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full ring-4 ring-white', DOT_TONE[entry.tone])} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-xs font-semibold text-gray-800">{entry.title}</p>
                      <p className="m-0 text-[11px] text-gray-400">{formatDateTime(entry.at)}</p>
                      {entry.detail ? <p className="m-0 mt-0.5 text-[11px] text-gray-500">{entry.detail}</p> : null}
                      {entry.changes.length > 0 ? (
                        <ul className="m-0 mt-1 list-none p-0">
                          {entry.changes.map((change) => (
                            <li key={change.field} className="text-[11px] text-gray-500">
                              {change.label}: <span className="text-gray-400 line-through">{change.before}</span>{' '}
                              <span className="font-semibold text-gray-700">{change.after}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {entry.documentId ? (
                        <Link
                          to={`/documents/${entry.documentId}`}
                          className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold no-underline hover:underline"
                        >
                          Open document
                          <ExternalLink className="h-3 w-3" aria-hidden />
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ),
          )
        : null}

      {tab === 'documents'
        ? historyBody(
            'No inventory document has carried this serial number yet.',
            documents.length === 0 ? null : (
              <ul className="m-0 list-none p-0">
                {documents.map((event) =>
                  event.kind === 'document' ? (
                    <li key={`${event.document_id}-${event.at}`} className="flex items-start gap-2 border-b border-gray-100 py-2 last:border-0">
                      <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-xs font-semibold text-gray-800">
                          {humanize(event.document_type)}
                          {event.document_no ? <span className="font-mono text-gray-500"> · {event.document_no}</span> : null}
                        </p>
                        <p className="m-0 text-[11px] text-gray-400">
                          {formatDate(event.at)}
                          {event.warehouse_name ? ` · ${event.warehouse_name}` : ''}
                        </p>
                      </div>
                      <Badge tone={event.document_status === 'POSTED' ? 'success' : 'neutral'} size="xs">
                        {humanize(event.document_status)}
                      </Badge>
                      <Link to={`/documents/${event.document_id}`} className="shrink-0 text-[11px] no-underline hover:underline">
                        Open
                      </Link>
                    </li>
                  ) : null,
                )}
              </ul>
            ),
          )
        : null}

      {tab === 'audit'
        ? historyBody(
            'No change has been recorded against this serial number yet.',
            audits.length === 0 ? null : (
              <ul className="m-0 list-none p-0">
                {audits.map((event) =>
                  event.kind === 'audit' ? (
                    <li key={event.ref_id} className="border-b border-gray-100 py-2 last:border-0">
                      <p className="m-0 text-xs font-semibold text-gray-800">{humanize(event.action)}</p>
                      <p className="m-0 text-[11px] text-gray-400">
                        {formatDateTime(event.at)}
                        {event.source_app ? ` · ${humanize(event.source_app)}` : ''}
                        {event.actor_uuid ? ` · ${event.actor_uuid}` : ''}
                      </p>
                      {event.reason ? <p className="m-0 mt-0.5 text-[11px] text-gray-500">{event.reason}</p> : null}
                    </li>
                  ) : null,
                )}
                <li className="pt-2">
                  <Link to={`/audit?entity_type=serial&entity_id=${serial.serial_id}`} className="text-[11px] no-underline hover:underline">
                    Open the full audit trail
                  </Link>
                </li>
              </ul>
            ),
          )
        : null}

      {tab === 'overview' ? (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50/70 p-3">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Warranty</p>
          <p className="m-0 mt-1 text-xs text-gray-700">
            {WARRANTY_STATE_LABEL[state]}
            {remaining !== null && remaining >= 0 ? ` · ${remaining} day${remaining === 1 ? '' : 's'} remaining` : ''}
          </p>
          <Badge tone={warrantyTone(state) === 'neutral' ? 'neutral' : warrantyTone(state)} size="xs" className="mt-2">
            {formatDate(serial.warranty_until)}
          </Badge>
        </div>
      ) : null}
    </Drawer>
  )
}

export default SerialDetailDrawer
