import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { cx } from '../../ui/cx'
import { formatInt, formatQty } from '../../utils/format'
import type { CountSummary, PostingReadiness } from './countModel'

/**
 * The last thing between a count and a stock movement.
 *
 * It states what posting will do in the units the reader has been working in,
 * and it will not offer the button while the browser can already see a blocking
 * problem. That gate is a courtesy, not a control: `DocumentPostingService`
 * re-validates every line, and this dialog cannot and must not be the thing
 * that decides a post is legal.
 */

export interface PostPhysicalCountDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  summary: CountSummary
  readiness: PostingReadiness
  money: (value: number) => string
  showCost: boolean
  posting: boolean
  /** Reveals the rows behind a blocking issue, and closes the dialog. */
  onReveal: (lineKeys: string[], label: string) => void
  documentNo?: string | null
}

export function PostPhysicalCountDialog({
  open,
  onClose,
  onConfirm,
  summary,
  readiness,
  money,
  showCost,
  posting,
  onReveal,
  documentNo,
}: PostPhysicalCountDialogProps) {
  const blocking = readiness.issues.filter((i) => i.blocking)
  const advisory = readiness.issues.filter((i) => !i.blocking)

  const figures: { label: string; value: string; tone?: 'danger' | 'success' }[] = [
    { label: 'Items counted', value: formatInt(summary.countedLines) },
    { label: 'Shortage items', value: formatInt(summary.shortageItems), tone: summary.shortageItems ? 'danger' : undefined },
    { label: 'Excess items', value: formatInt(summary.excessItems), tone: summary.excessItems ? 'success' : undefined },
    {
      label: 'Net quantity variance',
      value: `${summary.netQtyVariance > 0 ? '+' : ''}${formatQty(summary.netQtyVariance)}`,
      tone: summary.netQtyVariance < 0 ? 'danger' : summary.netQtyVariance > 0 ? 'success' : undefined,
    },
    ...(showCost
      ? [
          {
            label: 'Net inventory variance',
            value: summary.varianceValue === null ? 'Not available' : money(summary.varianceValue),
            tone:
              (summary.varianceValue ?? 0) < 0
                ? ('danger' as const)
                : (summary.varianceValue ?? 0) > 0
                  ? ('success' as const)
                  : undefined,
          },
        ]
      : []),
    {
      label: 'Unresolved exceptions',
      value: formatInt(summary.criticalExceptions + summary.warningExceptions),
      tone: summary.criticalExceptions ? 'danger' : undefined,
    },
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={posting}
      title="Post physical stock count?"
      description="Posting creates inventory adjustments for the counted differences. Verify shortages, excess quantities, batches and serial numbers before continuing."
      size="md"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={posting}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm} loading={posting} disabled={!readiness.canPost}>
            Post stock count
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <dl className="grid grid-cols-2 gap-2">
          {figures.map((f) => (
            <div key={f.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
              <dt className="text-[10px] uppercase tracking-wide text-gray-500">{f.label}</dt>
              <dd
                className={cx(
                  'mt-0.5 text-sm font-semibold tabular-nums',
                  f.tone === 'danger' ? 'text-red-600' : f.tone === 'success' ? 'text-emerald-600' : 'text-gray-900',
                )}
              >
                {f.value}
              </dd>
            </div>
          ))}
        </dl>

        {!showCost ? (
          <p className="text-[11px] text-gray-500">
            Inventory value is not shown to your profile. The adjustment is still valued when it posts.
          </p>
        ) : null}

        {blocking.length > 0 ? (
          <Notice kind="error" title="Resolve before posting">
            <ul className="mt-1 space-y-0.5">
              {blocking.map((issue) => (
                <li key={issue.message}>
                  {issue.lineKeys?.length ? (
                    <button
                      type="button"
                      className="text-left underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      onClick={() => {
                        onReveal(issue.lineKeys as string[], issue.message)
                        onClose()
                      }}
                    >
                      {issue.message}
                    </button>
                  ) : (
                    issue.message
                  )}
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {advisory.length > 0 ? (
          <Notice kind="warning">
            <ul className="space-y-0.5">
              {advisory.map((issue) => (
                <li key={issue.message}>{issue.message}</li>
              ))}
            </ul>
          </Notice>
        ) : null}

        <div
          className={cx(
            'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
            readiness.canPost ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800',
          )}
        >
          {readiness.canPost ? (
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <p>
            {readiness.canPost
              ? `Lines whose counted quantity equals the book quantity are not adjusted. ${documentNo ? `This will post as ${documentNo}.` : 'A document number is assigned on posting.'}`
              : 'Posting is held until the items above are resolved.'}
          </p>
        </div>
      </div>
    </Modal>
  )
}

export default PostPhysicalCountDialog
