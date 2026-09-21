import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Circle, Clock } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { cx } from '../../../ui/cx'
import type { ValuationRevision } from '../../../services/valuationApi'
import { formatDate, formatDateTime, formatMoney, formatQty, humanize } from '../../../utils/format'
import { BOOKS_STATE_BADGE, DELTA_MEANING, booksState, deltaDirection, triggerLabel } from './revisionsModel'

export interface RevisionDetailDrawerProps {
  revision: ValuationRevision | null
  onClose: () => void
  onAcknowledge: (row: ValuationRevision) => void
  canAcknowledge: boolean
  canViewDocuments: boolean
  documentTypeLabel: (code: string | null) => string
  busy: boolean
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 py-1.5 last:border-b-0">
      <dt className="shrink-0 text-xs text-gray-500">{label}</dt>
      <dd className="min-w-0 text-right text-xs font-medium text-gray-900">{value}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title}</h3>
      <dl className="rounded-lg border border-gray-200 px-3 py-1">{children}</dl>
    </section>
  )
}

/**
 * One step of the revision's life.
 *
 * Only the three the database actually timestamps are ever drawn — generated, published to
 * Books, acknowledged. A step with no timestamp is shown as still to happen rather than
 * given a plausible-looking date, and nothing is invented between them.
 */
function Step({ done, label, at, detail }: { done: boolean; label: string; at: string | null; detail?: string }) {
  const Icon = done ? CheckCircle2 : Circle
  return (
    <li className="flex items-start gap-2.5">
      <Icon className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', done ? 'text-primary' : 'text-gray-300')} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cx('text-xs font-medium', done ? 'text-gray-900' : 'text-gray-400')}>{label}</p>
        <p className="text-[11px] text-gray-500">
          {done ? formatDateTime(at) : 'Not yet'}
          {done && detail ? ` · ${detail}` : ''}
        </p>
      </div>
    </li>
  )
}

export function RevisionDetailDrawer({
  revision,
  onClose,
  onAcknowledge,
  canAcknowledge,
  canViewDocuments,
  documentTypeLabel,
  busy,
}: RevisionDetailDrawerProps) {
  if (!revision) return null
  const r = revision
  const state = booksState(r)
  const badge = BOOKS_STATE_BADGE[state]
  const direction = deltaDirection(r.delta_amount)
  const meaning = DELTA_MEANING[direction]
  const rateDiff =
    r.new_valuation_rate !== null && r.old_valuation_rate !== null ? r.new_valuation_rate - r.old_valuation_rate : null

  return (
    <Drawer
      open
      onClose={onClose}
      width="md"
      title={`Revision #${r.revision_id}`}
      badge={
        <Badge tone={badge.tone} size="xs" dot>
          {badge.label}
        </Badge>
      }
      description={`Created ${formatDateTime(r.created_at)}`}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
          {canAcknowledge && !r.acknowledged ? (
            <Button size="sm" loading={busy} onClick={() => onAcknowledge(r)}>
              Acknowledge revision
            </Button>
          ) : null}
        </div>
      }
    >
      <Section title="Valuation change">
        <Row
          label="Item"
          value={
            r.item_id ? (
              <Link to={`/valuation/cost-layers?item_id=${r.item_id}`} className="text-primary hover:underline">
                {r.item_name ?? `Item #${r.item_id}`}
              </Link>
            ) : null
          }
        />
        <Row label="SKU" value={r.item_sku} />
        <Row label="Warehouse" value={r.warehouse_name ?? (r.warehouse_id ? `Warehouse #${r.warehouse_id}` : null)} />
        <Row
          label="Quantity"
          value={`${formatQty(r.base_qty)}${r.unit_symbol ? ` ${r.unit_symbol}` : ''}${r.direction ? ` · ${humanize(r.direction)}` : ''}`}
        />
        <Row label="Old valuation rate" value={<span className="tabular-nums">{formatMoney(r.old_valuation_rate)}</span>} />
        <Row label="New valuation rate" value={<span className="tabular-nums">{formatMoney(r.new_valuation_rate)}</span>} />
        <Row label="Rate difference" value={<span className="tabular-nums">{formatMoney(rateDiff)}</span>} />
        <Row label="Old valuation amount" value={<span className="tabular-nums">{formatMoney(r.old_valuation_amount)}</span>} />
        <Row label="New valuation amount" value={<span className="tabular-nums">{formatMoney(r.new_valuation_amount)}</span>} />
        <Row
          label="Valuation delta"
          value={
            <span
              className={cx(
                'tabular-nums font-semibold',
                direction === 'increase' && 'text-red-700',
                direction === 'decrease' && 'text-emerald-700',
              )}
            >
              {formatMoney(r.delta_amount)}
              <span className="ml-1 text-[11px] font-normal text-gray-500">({meaning.srLabel})</span>
            </span>
          }
        />
        <Row label="Valuation method" value={r.valuation_method_applied} />
      </Section>

      <Section title="Where it came from">
        <Row
          label="Document"
          value={
            r.document_id && canViewDocuments ? (
              <Link to={`/documents/${r.document_id}`} className="text-primary hover:underline">
                {r.document_no ?? `#${r.document_id}`}
              </Link>
            ) : (
              (r.document_no ?? (r.document_id ? `#${r.document_id}` : null))
            )
          }
        />
        <Row label="Document type" value={documentTypeLabel(r.document_type)} />
        <Row label="Document date" value={formatDate(r.document_date)} />
        <Row label="Document status" value={r.document_status ? humanize(r.document_status) : null} />
        <Row label="Originated in" value={r.source_app ? humanize(r.source_app) : null} />
        <Row
          label="Source document"
          value={r.source_document_no ?? (r.source_document_id ? `#${r.source_document_id}` : null)}
        />
      </Section>

      <Section title="Recalculation">
        <Row
          label="Job"
          value={
            r.job_id ? (
              <Link to={`/valuation/revisions?job_id=${r.job_id}`} className="text-primary hover:underline">
                #{r.job_id}
              </Link>
            ) : null
          }
        />
        <Row label="Reason recorded" value={r.trigger_kind ? triggerLabel(r.trigger_kind) : null} />
        <Row
          label="Triggered by document"
          value={
            r.trigger_document_id && canViewDocuments ? (
              <Link to={`/documents/${r.trigger_document_id}`} className="text-primary hover:underline">
                #{r.trigger_document_id}
              </Link>
            ) : r.trigger_document_id ? (
              `#${r.trigger_document_id}`
            ) : null
          }
        />
        <Row label="Job status" value={r.job_status ? humanize(r.job_status) : null} />
        <Row label="Mode" value={r.dry_run === null || r.dry_run === undefined ? null : r.dry_run ? 'Dry run' : 'Live'} />
        <Row label="Requested by" value={r.job_requested_by} />
      </Section>

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          <Clock className="h-3 w-3" aria-hidden />
          Books handover
        </h3>
        <ol className="space-y-2.5">
          <Step done label="Revision generated by Inventory" at={r.created_at} />
          <Step done={r.published_at !== null} label="Published to Books" at={r.published_at} />
          <Step
            done={r.acknowledged}
            label="COGS re-posted and acknowledged"
            at={r.acknowledged_at}
            detail={r.acknowledged_by_app ?? undefined}
          />
        </ol>
        {!r.acknowledged ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
            Until Books acknowledges it, this revision stays in reconciliation as an unposted valuation
            difference. Acknowledging here records that the COGS re-posting has been done — it does not post
            anything to the ledger, which is Books&apos; own job.
          </p>
        ) : null}
      </section>
    </Drawer>
  )
}

export default RevisionDetailDrawer
