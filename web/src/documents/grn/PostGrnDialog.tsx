import { AlertTriangle, CheckCircle2, Info, PackageCheck, XCircle } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Modal } from '../../components/Modal'
import { cx } from '../../ui/cx'
import { formatMoney, formatQty } from '../../utils/format'
import type { GrnAlert, GrnTotals, StockImpact } from './grnModel'

export interface PostGrnDialogProps {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
  busy: boolean
  totals: GrnTotals
  impact: StockImpact
  alerts: GrnAlert[]
  currencySymbol: string
  supplierName: string
  warehouseName: string
  documentDate: string
  error?: string | null
}

/**
 * The last thing between a draft and stock that moved.
 *
 * Posting an inward challan is not reversible by pressing Back: it opens pending quantities
 * against a supplier, and on a physical receipt it changes what the warehouse is holding. So the
 * dialog restates the three things worth checking — how much, from whom, into where — and,
 * above all, what the chosen stock effect will actually do, in the same words the summary card
 * used.
 *
 * Warnings that were not enough to stop the post are repeated here rather than left behind on the
 * page the user has scrolled away from. Anything genuinely blocking has already kept the button
 * disabled; this dialog never offers to post over one.
 */
export function PostGrnDialog({
  open,
  onCancel,
  onConfirm,
  busy,
  totals,
  impact,
  alerts,
  currencySymbol,
  supplierName,
  warehouseName,
  documentDate,
  error,
}: PostGrnDialogProps) {
  const warnings = alerts.filter((a) => a.tone === 'warning')
  const blocking = alerts.filter((a) => a.tone === 'danger')

  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="md"
      busy={busy}
      title="Post inward challan / GRN?"
      description="This will update inventory according to the selected stock effect."
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button icon={PackageCheck} loading={busy} disabled={blocking.length > 0} onClick={onConfirm}>
            Post GRN
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-gray-700">
          Please verify quantities, batches and serial numbers before posting.
        </p>

        <dl className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs">
          <Row label="Supplier" value={supplierName || 'Not named'} />
          <Row label="Date" value={documentDate} />
          <Row label="Into" value={warehouseName || '—'} />
          <Row label="Items" value={`${totals.items} · ${formatQty(totals.quantity)} units`} />
          <Row label="Value" value={`${currencySymbol} ${formatMoney(totals.amount, '0.00')}`} />
          <Row label="Stock impact" value={impact.label} />
        </dl>

        <p
          className={cx(
            'flex items-start gap-1.5 rounded-lg border px-3 py-2 text-xs leading-snug',
            impact.tone === 'pending' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900',
          )}
        >
          {impact.tone === 'pending' ? (
            <Info className="mt-px h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <CheckCircle2 className="mt-px h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>{impact.detail}</span>
        </p>

        {warnings.length > 0 ? (
          <ul className="space-y-1">
            {warnings.map((alert) => (
              <li key={alert.id} className="flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                {alert.message}
              </li>
            ))}
          </ul>
        ) : null}

        {blocking.length > 0 ? (
          <ul className="space-y-1" role="alert">
            {blocking.map((alert) => (
              <li key={alert.id} className="flex items-start gap-1.5 text-xs text-red-700">
                <XCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                {alert.message}
              </li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
            <XCircle className="mt-px h-4 w-4 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="truncate font-medium text-gray-900">{value}</dd>
    </div>
  )
}

export default PostGrnDialog
