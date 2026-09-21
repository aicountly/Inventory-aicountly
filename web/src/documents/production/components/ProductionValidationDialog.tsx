import { CircleAlert, TriangleAlert } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Modal } from '../../../components/Modal'
import type { ProductionIssue } from '../productionModel'

export interface ProductionValidationDialogProps {
  open: boolean
  issues: readonly ProductionIssue[]
  /** Field-level messages from the shared draft validator — what the server would reject. */
  draftErrors: readonly string[]
  onClose: () => void
  onResolve: (issue: ProductionIssue) => void
}

/**
 * What is standing in the way, in the order it has to be dealt with.
 *
 * Every entry names the line and offers the control that fixes it, so a shortage or a half-picked
 * serial set can be resolved without hunting down the row. Nothing on the document is changed by
 * opening this: the dialog reports, the user decides.
 */
export function ProductionValidationDialog({ open, issues, draftErrors, onClose, onResolve }: ProductionValidationDialogProps) {
  const blocking = issues.filter((i) => i.severity === 'blocking')
  const attention = issues.filter((i) => i.severity === 'attention')
  const stopped = blocking.length > 0 || draftErrors.length > 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={stopped ? 'Production cannot be posted' : 'Worth a look before posting'}
      description={
        stopped
          ? `${blocking.length + draftErrors.length} issue${blocking.length + draftErrors.length === 1 ? '' : 's'} must be resolved before this run can post.`
          : `${attention.length} item${attention.length === 1 ? '' : 's'} the document will record as chosen. None of them stops the post.`
      }
      footer={
        <Button variant="primary" onClick={onClose}>
          Back to the document
        </Button>
      }
    >
      <div className="space-y-4">
        {draftErrors.length > 0 ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
            <p className="mb-1 text-xs font-semibold text-red-700">The document is not valid yet</p>
            <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-red-700">
              {draftErrors.map((message, i) => (
                <li key={`${message}-${i}`}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {blocking.length > 0 ? (
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <CircleAlert className="h-3.5 w-3.5 text-red-600" aria-hidden />
              Must be resolved
              <Badge tone="danger" size="xs">{blocking.length}</Badge>
            </h3>
            <ul className="space-y-1.5">
              {blocking.map((issue) => (
                <li key={issue.id} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2">
                  <span className="text-xs leading-relaxed text-gray-700">{issue.message}</span>
                  {issue.actionLabel && issue.action ? (
                    <Button variant="secondary" size="xs" className="shrink-0" onClick={() => onResolve(issue)}>
                      {issue.actionLabel}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {attention.length > 0 ? (
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <TriangleAlert className="h-3.5 w-3.5 text-amber-600" aria-hidden />
              Worth reviewing
              <Badge tone="warning" size="xs">{attention.length}</Badge>
            </h3>
            <ul className="space-y-1.5">
              {attention.map((issue) => (
                <li key={issue.id} className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50/70 px-3 py-2">
                  <span className="text-xs leading-relaxed text-gray-600">{issue.message}</span>
                  {issue.actionLabel && issue.action ? (
                    <Button variant="ghost" size="xs" className="shrink-0" onClick={() => onResolve(issue)}>
                      {issue.actionLabel}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
              These do not stop the post. They are choices the document will record as made.
            </p>
          </section>
        ) : null}
      </div>
    </Modal>
  )
}

export default ProductionValidationDialog
