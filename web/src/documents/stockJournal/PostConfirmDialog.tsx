import { AlertTriangle } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Button } from '../../ui/Button'
import { AIC, cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import type { JournalTotals, JournalWarning } from './model'

interface PostConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  busy: boolean
  totals: JournalTotals
  warnings: readonly JournalWarning[]
  /** True when the user holds `stock.negative_override`. */
  canOverride: boolean
  override: boolean
  onOverrideChange: (on: boolean) => void
  reasonLabel: string
  documentDate: string
}

/**
 * The last step before stock moves.
 *
 * It repeats the figures rather than the intent, and it surfaces whatever is
 * still unresolved — a negative-stock block belongs here, where it can be
 * acknowledged, not in a toast after the fact.
 */
export function PostConfirmDialog({
  open,
  onClose,
  onConfirm,
  busy,
  totals,
  warnings,
  canOverride,
  override,
  onOverrideChange,
  reasonLabel,
  documentDate,
}: PostConfirmDialogProps) {
  const blocking = warnings.filter((w) => w.level === 'blocking')
  const cautions = warnings.filter((w) => w.level === 'warning')
  const negative = blocking.filter((w) => w.code === 'insufficient_stock')
  const hardBlock = blocking.some((w) => w.code !== 'insufficient_stock')
  const overridable = negative.length > 0 && canOverride
  const stopped = hardBlock || (negative.length > 0 && !override)

  return (
    <Modal
      open={open}
      title="Post Stock Journal?"
      description="This will update inventory quantities and create auditable stock movements."
      onClose={onClose}
      size="md"
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} loading={busy} disabled={stopped}>
            {override && negative.length > 0 ? 'Post with override' : 'Post Stock Journal'}
          </Button>
        </>
      }
    >
      <div className={cx(AIC, 'space-y-3')}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-gray-500">Lines</dt>
            <dd className="font-semibold tabular-nums text-gray-900">{totals.lines}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-gray-500">Total In</dt>
            <dd className="font-semibold tabular-nums text-emerald-700">{formatQty(totals.qtyIn, '0')}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-gray-500">Total Out</dt>
            <dd className="font-semibold tabular-nums text-red-600">{formatQty(totals.qtyOut, '0')}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-gray-500">Net</dt>
            <dd className="font-semibold tabular-nums text-gray-900">{formatQty(totals.netQty, '0')}</dd>
          </div>
        </dl>

        <p className="text-xs text-gray-600">
          Dated <strong className="text-gray-900">{documentDate}</strong>
          {reasonLabel ? (
            <>
              {' '}
              · reason <strong className="text-gray-900">{reasonLabel}</strong>
            </>
          ) : null}
        </p>

        {blocking.length > 0 ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-red-800">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Must be resolved
            </p>
            <ul className="mt-1.5 space-y-1">
              {blocking.map((w, i) => (
                <li key={`${w.code}-${i}`} className="text-[11px] leading-relaxed text-red-700">
                  {w.message}
                </li>
              ))}
            </ul>
            {overridable ? (
              <label className="mt-2 flex items-start gap-2 text-[11px] text-red-800">
                <input type="checkbox" className="mt-0.5" checked={override} onChange={(e) => onOverrideChange(e.target.checked)} />
                <span>Post anyway and let stock go negative. The override is recorded on the audit trail.</span>
              </label>
            ) : negative.length > 0 ? (
              <p className="mt-2 text-[11px] text-red-700">
                Reduce the quantities or receive stock first — posting into negative stock needs the
                &ldquo;override negative-stock block&rdquo; permission.
              </p>
            ) : null}
          </div>
        ) : null}

        {cautions.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-800">Worth checking</p>
            <ul className="mt-1.5 space-y-1">
              {cautions.map((w, i) => (
                <li key={`${w.code}-${i}`} className="text-[11px] leading-relaxed text-amber-800">
                  {w.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-[11px] leading-relaxed text-gray-500">
          A posted stock journal cannot be deleted. Correcting it later means reversing it, which stays on
          the record.
        </p>
      </div>
    </Modal>
  )
}
