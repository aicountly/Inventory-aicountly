import { Sparkles, X } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Tooltip } from '../../ui/Tooltip'
import { AIC, cx } from '../../ui/cx'

export interface ReceiptAiStripProps {
  onUploadInvoice: () => void
  onSelectPo: () => void
  onDismiss: () => void
  aiReason: string | null
  poReason: string | null
  disabled?: boolean
}

/**
 * The one place AI is offered on this screen, and it is an accelerator: a
 * dismissible strip above the fields, never a step in the way of typing one in
 * by hand. Nothing here saves or posts anything — both buttons open a workflow
 * that ends in the user confirming what goes on the form.
 */
export function ReceiptAiStrip({ onUploadInvoice, onSelectPo, onDismiss, aiReason, poReason, disabled }: ReceiptAiStripProps) {
  const action = (label: string, onClick: () => void, reason: string | null) => {
    const button = (
      <Button variant="secondary" size="sm" onClick={onClick} disabled={disabled || Boolean(reason)}>
        {label}
      </Button>
    )
    return reason ? <Tooltip label={reason}>{button}</Tooltip> : button
  }

  return (
    <div
      className={cx(
        AIC,
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 mb-4',
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 shrink-0">
        <Sparkles className="w-4 h-4" aria-hidden />
        AI assistant
      </span>
      <p className="text-xs text-gray-600 flex-1 min-w-[12rem] m-0">
        Upload a supplier invoice or pick a purchase order and the details are filled in for you to
        check — nothing is saved until you say so.
      </p>
      <div className="flex items-center gap-2 shrink-0">
        {action('Upload invoice', onUploadInvoice, aiReason)}
        {action('Select PO', onSelectPo, poReason)}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Hide the AI assistant for now"
          className="w-7 h-7 inline-grid place-items-center rounded-lg text-gray-500 hover:bg-white hover:text-gray-900 transition-colors"
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}

export default ReceiptAiStrip
