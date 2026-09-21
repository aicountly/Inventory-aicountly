import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { Button } from '../../ui/Button'
import { formatInt, formatMoney } from '../../utils/format'
import type { LandedCostSummary } from './model'

interface PostAllocationDialogProps {
  open: boolean
  summary: LandedCostSummary
  currency: string
  busy: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-gray-100 py-1.5 last:border-b-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`tabular-nums text-sm font-semibold ${strong ? 'text-emerald-700' : 'text-gray-900'}`}>{value}</span>
    </div>
  )
}

/**
 * The last thing between the operator and a change to stock valuation.
 *
 * It repeats the four figures that matter and says, in the sentence that is easiest to get wrong,
 * what this does and does not touch. Posting a landed cost changes what the goods cost; it does not
 * change what was invoiced or what tax was charged on it, and an operator who believes otherwise
 * will go looking for a GST effect that is never going to appear.
 */
export function PostAllocationDialog({ open, summary, currency, busy, error, onConfirm, onCancel }: PostAllocationDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      busy={busy}
      size="md"
      title="Post landed cost allocation?"
      description="This updates inventory valuation and the cost of goods sold that follows from it."
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} loading={busy}>
            Post allocation
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2">
          <Row label="Receipts loaded" value={`${formatInt(summary.receipts)}`} />
          <Row label="Item lines affected" value={`${formatInt(summary.itemLines)}`} />
          <Row label="Landed cost allocated" value={`${currency} ${formatMoney(summary.allocated)}`} />
          <Row label="Revised stock value" value={`${currency} ${formatMoney(summary.revisedValue)}`} strong />
        </div>

        <p className="text-sm leading-relaxed text-gray-700">
          These charges become part of what the stock cost, so closing stock and future COGS carry them. The purchase invoice value and every
          GST figure are left exactly as they are — those belong to the purchase, in Books.
        </p>

        <Notice kind="info">
          Stock already issued out of a receipt is not re-costed. Only what is still on hand absorbs the charge, and posting will report the
          part it could not absorb for you to expense.
        </Notice>

        {error ? <Notice kind="error">{error}</Notice> : null}
      </div>
    </Modal>
  )
}
