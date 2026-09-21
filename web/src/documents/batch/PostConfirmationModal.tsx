import { Send } from 'lucide-react'
import type { ReactNode } from 'react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { formatDate, formatQty } from '../../utils/format'
import type { BatchAdjustmentMetrics, BatchIssue } from './batchAdjustmentModel'

function Line({ label, value, tone }: { label: string; value: ReactNode; tone?: 'warning' | 'danger' }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-100 py-1.5 text-xs last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className={cx('font-semibold tabular-nums', tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-700' : 'text-gray-900')}>{value}</span>
    </div>
  )
}

export interface PostConfirmationModalProps {
  open: boolean
  busy: boolean
  documentDate: string
  warehouseName: string
  metrics: BatchAdjustmentMetrics
  issues: readonly BatchIssue[]
  onCancel: () => void
  onConfirm: () => void
}

/**
 * The last look before the document leaves the browser.
 *
 * A blocking error keeps the button off; a warning does not, because the server decides what may
 * post and this screen must not invent a stricter rule than the one the backend applies.
 */
export function PostConfirmationModal({ open, busy, documentDate, warehouseName, metrics, issues, onCancel, onConfirm }: PostConfirmationModalProps) {
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const serialIssues = warnings.filter((i) => i.code === 'MISSING_SERIALS' || i.code === 'SERIAL_COUNT_MISMATCH' || i.code === 'DUPLICATE_SERIAL').length

  return (
    <Modal
      open={open}
      onClose={onCancel}
      busy={busy}
      size="md"
      title="Post batch adjustment?"
      description="Posting records the reallocation against the batches below. It can only be undone by reversing the document."
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button icon={Send} onClick={onConfirm} loading={busy} disabled={errors.length > 0}>
            Post adjustment
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-gray-200 px-3 py-1.5">
          <Line label="Document date" value={formatDate(documentDate)} />
          <Line label="Default warehouse" value={warehouseName || 'Not set'} />
          <Line label="Lines" value={metrics.totalLines} />
          <Line label="Qty out" value={formatQty(metrics.totalQtyOut, '0')} />
          <Line label="Qty in" value={formatQty(metrics.totalQtyIn, '0')} />
          <Line
            label="Net quantity variance"
            value={
              <span className="inline-flex items-center gap-1.5">
                {metrics.variance > 0 ? '+' : ''}
                {formatQty(metrics.variance, '0')}
                <Badge tone={metrics.variance === 0 ? 'success' : 'warning'} size="xs">
                  {metrics.variance === 0 ? 'Balanced' : 'Unbalanced'}
                </Badge>
              </span>
            }
            tone={metrics.variance === 0 ? undefined : 'warning'}
          />
          <Line label="Warnings" value={warnings.length} tone={warnings.length > 0 ? 'warning' : undefined} />
          <Line label="Serial issues" value={serialIssues} tone={serialIssues > 0 ? 'warning' : undefined} />
        </div>

        {errors.length > 0 ? (
          <Notice kind="error" title="Fix before posting">
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {errors.slice(0, 6).map((issue, i) => (
                <li key={`${issue.code}-${i}`}>{issue.message}</li>
              ))}
            </ul>
            {errors.length > 6 ? <p className="mt-1">…and {errors.length - 6} more.</p> : null}
          </Notice>
        ) : warnings.length > 0 ? (
          <Notice kind="warning" title="Posting with warnings">
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {warnings.slice(0, 5).map((issue, i) => (
                <li key={`${issue.code}-${i}`}>{issue.message}</li>
              ))}
            </ul>
            {warnings.length > 5 ? <p className="mt-1">…and {warnings.length - 5} more.</p> : null}
          </Notice>
        ) : (
          <Notice kind="success">Every check passed. The server validates the document again as it posts.</Notice>
        )}
      </div>
    </Modal>
  )
}

export default PostConfirmationModal
