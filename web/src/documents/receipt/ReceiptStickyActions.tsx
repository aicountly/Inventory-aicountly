import { Link } from 'react-router-dom'
import { AlertTriangle, Check, CircleDot, Save, TriangleAlert } from 'lucide-react'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { ActionBarTotal, StickyActionBar } from '../../ui/shell/StickyActionBar'
import { formatMoney, formatQty } from '../../utils/format'
import type { ReceiptTotals } from './receiptModel'

export interface ReceiptStickyActionsProps {
  totals: ReceiptTotals
  currency: string
  errors: number
  warnings: number
  dirty: boolean
  busy: 'save' | 'post' | null
  canSave: boolean
  canPost: boolean
  saveLabel: string
  cancelTo: string
  onCancel: () => void
  onSaveDraft: () => void
  onPost: () => void
}

/**
 * Pinned to the bottom: what is on the receipt, what is wrong with it, and the
 * three things that can happen to it.
 *
 * The totals sit here as well as on the summary card on purpose — a clerk on
 * line thirty should never have to scroll up to see what they are about to
 * post. The status chip names the count, not just a colour, and Save & post
 * stays enabled while there are errors so pressing it lands the user on the
 * first one instead of leaving a dead button with no explanation.
 */
export function ReceiptStickyActions({
  totals,
  currency,
  errors,
  warnings,
  dirty,
  busy,
  canSave,
  canPost,
  saveLabel,
  cancelTo,
  onCancel,
  onSaveDraft,
  onPost,
}: ReceiptStickyActionsProps) {
  const chip = errors > 0 ? (
    <span className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700">
      <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
      {errors} to fix
    </span>
  ) : warnings > 0 ? (
    <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
      <TriangleAlert className="w-3.5 h-3.5" aria-hidden />
      {warnings} to check
    </span>
  ) : totals.lines > 0 ? (
    <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
      <Check className="w-3.5 h-3.5" aria-hidden />
      Ready to post
    </span>
  ) : null

  return (
    <StickyActionBar
      status={
        <div className="flex items-center gap-2">
          {chip}
          {dirty ? (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-gray-500">
              <CircleDot className="w-3 h-3 text-amber-500" aria-hidden />
              Unsaved
            </span>
          ) : null}
        </div>
      }
      totals={
        <>
          <ActionBarTotal label="Lines" value={totals.lines} className="hidden sm:flex" />
          <ActionBarTotal label="Quantity" value={formatQty(totals.quantity, '0')} className="hidden md:flex" />
          <ActionBarTotal label={`Net (${currency})`} value={formatMoney(totals.net, '0.00')} tone="success" />
        </>
      }
    >
      <Link
        to={cancelTo}
        data-unsaved-allow
        onClick={(e) => {
          e.preventDefault()
          onCancel()
        }}
        className={cx(
          'inline-flex items-center justify-center h-8 px-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:border-primary/40 hover:bg-primary-light hover:text-primary transition-colors',
        )}
      >
        Cancel
      </Link>
      <Button
        variant="secondary"
        size="md"
        icon={Save}
        onClick={onSaveDraft}
        loading={busy === 'save'}
        disabled={busy !== null || !canSave}
        kbd="Ctrl S"
        title="Save without posting (Ctrl+S)"
      >
        {saveLabel}
      </Button>
      {canPost ? (
        <Button
          size="md"
          icon={Check}
          onClick={onPost}
          loading={busy === 'post'}
          disabled={busy !== null}
          kbd="Ctrl ⏎"
          title="Post the receipt into stock (Ctrl+Enter)"
        >
          {busy === 'post' ? 'Posting…' : 'Save & post'}
        </Button>
      ) : null}
    </StickyActionBar>
  )
}

export default ReceiptStickyActions
