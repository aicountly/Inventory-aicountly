/**
 * The contextual column beside the serial grid: what the scanner is pointed at right now,
 * what the document adds up to, and what a serial adjustment does and does not do.
 */

import { BadgeCheck, ChartColumn, Lightbulb, ScanLine, ScanBarcode } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../../ui/Badge'
import { Card } from '../../ui/Card'
import { Spinner } from '../../ui/Spinner'
import { StatusBadge } from '../../ui/StatusBadge'
import { AIC, cx } from '../../ui/cx'
import { formatDate, formatInt } from '../../utils/format'
import type { SerialLookupRow } from '../../services/lookupApi'
import type { AdjustmentSummary } from './model'

function SideTitle({ icon: Icon, children }: { icon: typeof ScanLine; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-primary shrink-0" aria-hidden />
      <h3 className="text-sm font-semibold text-gray-900">{children}</h3>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Live stock info
// ---------------------------------------------------------------------------

export interface LiveSerialInfoCardProps {
  serial: SerialLookupRow | null
  loading: boolean
  /** Shown instead of the record when the last scan found nothing. */
  notFound: string | null
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-gray-100 last:border-0">
      <dt className="text-[11px] text-gray-500 shrink-0">{label}</dt>
      <dd className="text-[12px] font-medium text-gray-900 text-right min-w-0 break-words">{value}</dd>
    </div>
  )
}

/**
 * What the API knows about the serial the operator last touched — read live from
 * `GET /v1/serials`, never from anything this screen stores.
 */
export function LiveSerialInfoCard({ serial, loading, notFound }: LiveSerialInfoCardProps) {
  return (
    <Card padding="md" className={AIC}>
      <SideTitle icon={ScanLine}>Live stock info</SideTitle>
      {loading ? (
        <div className="flex items-center gap-2 py-6 justify-center text-xs text-gray-500">
          <Spinner size="sm" />
          Checking the serial master…
        </div>
      ) : serial ? (
        <div>
          <div className="mb-2">
            <p className="text-sm font-semibold text-gray-900 leading-snug">{serial.item_name ?? `Item #${serial.item_id}`}</p>
            {serial.item_sku ? <p className="text-[11px] text-gray-500 mt-0.5">SKU: {serial.item_sku}</p> : null}
          </div>
          <dl className="mt-3">
            <InfoRow label="Serial" value={<span className="font-mono text-[11px]">{serial.serial_no}</span>} />
            <InfoRow label="Status" value={<StatusBadge value={serial.status} size="xs" />} />
            <InfoRow label="Warehouse" value={serial.warehouse_name ?? (serial.warehouse_id ? `#${serial.warehouse_id}` : '—')} />
            {serial.location_code ? <InfoRow label="Location" value={serial.location_code} /> : null}
            {serial.batch_no ? <InfoRow label="Batch" value={serial.batch_no} /> : null}
            {serial.expiry_date ? <InfoRow label="Expires" value={formatDate(serial.expiry_date)} /> : null}
            {serial.warranty_until ? <InfoRow label="Warranty to" value={formatDate(serial.warranty_until)} /> : null}
            {serial.received_document_id ? (
              <InfoRow
                label="Received on"
                value={
                  <Link className="text-primary hover:underline" to={`/documents/${serial.received_document_id}`}>
                    Document #{serial.received_document_id}
                  </Link>
                }
              />
            ) : null}
            {serial.issued_document_id ? (
              <InfoRow
                label="Issued on"
                value={
                  <Link className="text-primary hover:underline" to={`/documents/${serial.issued_document_id}`}>
                    Document #{serial.issued_document_id}
                  </Link>
                }
              />
            ) : null}
            {serial.updated_at ? <InfoRow label="Last updated" value={formatDate(serial.updated_at)} /> : null}
          </dl>
          <Link
            to={`/masters/serials?q=${encodeURIComponent(serial.serial_no)}`}
            className="mt-3 inline-block text-[11px] font-medium text-primary hover:underline"
          >
            Open in the serial master
          </Link>
        </div>
      ) : (
        <div className="text-center py-2">
          <span className="w-16 h-14 rounded-xl bg-gray-50 border border-gray-200 grid place-items-center mx-auto mb-3">
            <ScanBarcode className="w-7 h-7 text-gray-400" aria-hidden />
          </span>
          <p className="text-[12px] leading-relaxed text-gray-500 mb-3">
            {notFound ?? 'Scan a serial number to see where it is, what state it is in and which documents moved it — read live from the serial master.'}
          </p>
          <Badge tone="neutral" size="xs">
            Reads barcode / QR / IMEI scanners
          </Badge>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Adjustment summary
// ---------------------------------------------------------------------------

function SummaryRow({ label, value, tone }: { label: string; value: ReactNode; tone?: 'danger' | 'muted' }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <dt className="text-[12px] text-gray-600">{label}</dt>
      <dd
        className={cx(
          'text-[13px] font-bold tabular-nums',
          tone === 'danger' ? 'text-red-600' : tone === 'muted' ? 'text-gray-400' : 'text-gray-900',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * Derived from the form state on every keystroke — nothing here is fetched.
 *
 * "Document lines" is the figure that matters and the one the old screen could not show:
 * the grid is one row per serial, but the document posts one line per item / warehouse /
 * batch / direction, so twenty scanned serials of the same model in the same warehouse
 * post as a single line of twenty.
 */
export function AdjustmentSummaryCard({ summary }: { summary: AdjustmentSummary }) {
  return (
    <Card padding="md" className={AIC}>
      <SideTitle icon={ChartColumn}>Adjustment summary</SideTitle>
      <dl>
        <SummaryRow label="Serials entered" value={formatInt(summary.serialLines)} />
        <SummaryRow label="Unique serials" value={formatInt(summary.uniqueSerials)} tone={summary.uniqueSerials !== summary.serialLines ? 'danger' : undefined} />
        <SummaryRow label="Items" value={formatInt(summary.items)} />
        <SummaryRow label="Warehouses" value={formatInt(summary.warehouses)} />
        <SummaryRow label="In / Out" value={`${formatInt(summary.inCount)} / ${formatInt(summary.outCount)}`} />
        <div className="mt-2 pt-2 border-t border-gray-100">
          <SummaryRow label="Document lines" value={formatInt(summary.documentLines)} />
          <SummaryRow
            label="Needs attention"
            value={formatInt(summary.needsAttention)}
            tone={summary.needsAttention > 0 ? 'danger' : 'muted'}
          />
        </div>
      </dl>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Guidelines
// ---------------------------------------------------------------------------

const GUIDELINES: string[] = [
  'A serial adjustment records a correction against serial numbers. It never changes what the stock is worth — the type carries no valuation and raises no accounting effect.',
  'Scan, paste or import serial numbers in bulk; each one is checked against the live serial master before it reaches the grid.',
  'Every save and post is written to the audit log with a before and after snapshot.',
]

/**
 * Deliberately not the four cheerful lines the mock carries. Two of those ("use it for
 * location, status or detail corrections") describe a screen whose posting step would write
 * the new location and status back to `inv_serials` — and this document type does not do
 * that today (DocumentPostingService::movesStockNow returns false for SERIAL_ADJUSTMENT, so
 * applySerials never runs). Printing them would be the app telling the operator it had done
 * something it had not.
 */
export function GuidelinesCard({ recordsOnly }: { recordsOnly: boolean }) {
  return (
    <Card padding="md" className={cx(AIC, 'border-amber-200 bg-amber-50/60')}>
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="w-4 h-4 text-amber-600 shrink-0" aria-hidden />
        <h3 className="text-sm font-semibold text-gray-900">Guidelines</h3>
      </div>
      <ul className="space-y-2.5 list-none p-0 m-0">
        {GUIDELINES.map((text) => (
          <li key={text} className="flex items-start gap-2">
            <BadgeCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
            <span className="text-[11.5px] leading-relaxed text-gray-600">{text}</span>
          </li>
        ))}
        {recordsOnly ? (
          <li className="flex items-start gap-2 pt-2 border-t border-amber-200">
            <span className="text-[11.5px] leading-relaxed text-amber-800">
              <strong className="font-semibold">Posting records the correction; it does not rewrite the serial.</strong>{' '}
              Change a serial&rsquo;s own warehouse or status in the{' '}
              <Link to="/masters/serials" className="underline">
                serial master
              </Link>
              .
            </span>
          </li>
        ) : null}
      </ul>
    </Card>
  )
}
