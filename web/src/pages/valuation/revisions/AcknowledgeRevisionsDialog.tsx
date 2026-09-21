import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { Notice } from '../../../components/Notice'
import { formatInt, formatMoney } from '../../../utils/format'
import type { AckSelection } from './revisionsModel'

export interface AcknowledgeRevisionsDialogProps {
  open: boolean
  selection: AckSelection
  busy: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">{value}</p>
    </div>
  )
}

/**
 * The confirmation an audit-sensitive action deserves.
 *
 * Acknowledging is a claim on Inventory's side that Books has re-posted the COGS for these
 * lines, and it is recorded in the audit log against whoever pressed it. So the dialog states
 * what is being claimed, shows the figures behind it, and separates the rows that will be
 * acknowledged from the rows that will not — a bulk action that quietly skipped some of the
 * user's selection would be the worst of both.
 */
export function AcknowledgeRevisionsDialog({
  open,
  selection,
  busy,
  error,
  onConfirm,
  onCancel,
}: AcknowledgeRevisionsDialogProps) {
  const count = selection.eligible.length
  return (
    <ConfirmDialog
      open={open}
      title="Acknowledge selected revisions?"
      confirmLabel={busy ? 'Acknowledging…' : `Acknowledge ${formatInt(count)} revision${count === 1 ? '' : 's'}`}
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
      message={
        <div className="space-y-3">
          <p>
            You are about to acknowledge <strong>{formatInt(count)}</strong> valuation revision
            {count === 1 ? '' : 's'}. Confirm that Books has re-posted the accounting COGS for
            {count === 1 ? ' this line' : ' these lines'}.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <Figure label="Net valuation delta" value={formatMoney(selection.netDelta)} />
            <Figure label="Gross movement" value={formatMoney(selection.absDelta)} />
          </div>

          {selection.awaitingPublish > 0 ? (
            <Notice kind="warning">
              {formatInt(selection.awaitingPublish)} of them {selection.awaitingPublish === 1 ? 'has' : 'have'} not
              been published to Books yet. Acknowledging now records the COGS as applied for
              {selection.awaitingPublish === 1 ? ' a revision' : ' revisions'} Books has never been sent.
            </Notice>
          ) : null}

          {selection.ineligible.length > 0 ? (
            <Notice kind="info">
              {formatInt(selection.ineligible.length)} selected revision
              {selection.ineligible.length === 1 ? ' is' : 's are'} already applied in Books and will be left
              untouched.
            </Notice>
          ) : null}

          <p className="text-xs text-gray-500">
            This records the acknowledgement in Inventory and clears the revision from reconciliation. It posts
            nothing to the ledger — that is Books&apos; own job.
          </p>
        </div>
      }
    />
  )
}

export default AcknowledgeRevisionsDialog
