import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CircleCheck, RefreshCw } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { Input } from '../../../ui/Input'
import { Modal } from '../../../components/Modal'
import { Notice } from '../../../components/Notice'
import { useToast } from '../../../ui/ToastContext'
import { ApiError } from '../../../services/api'
import { valuationApi } from '../../../services/valuationApi'
import type { RecalcJob } from '../../../services/valuationApi'
import { formatDate, formatInt, formatMoney, todayIso } from '../../../utils/format'

export type RecalcScope = 'item' | 'all'

export interface RecalculateValuationModalProps {
  open: boolean
  onClose: () => void
  itemId: string
  itemName: string | null
  /** Pre-fills the from-date when the modal was opened from a layer. */
  defaultFromDate?: string | null
  onDone: () => void
}

/**
 * Queue a re-costing.
 *
 * Recalculation is the one control on this screen that changes figures the
 * accounts are kept on, so it is deliberately three decisions rather than a
 * button: from when, over what, and whether this run writes. It opens on
 * "preview", which queues a dry run — the job reports what WOULD change and
 * publishes nothing — and a live run over every item asks a second time before
 * it goes.
 *
 * The result panel is the receipt: job number, lines examined, lines revised
 * and the COGS movement, with a link to the revisions the job published. That
 * job number is the audit reference; the server records the requester and the
 * timestamp against it.
 */
export function RecalculateValuationModal({
  open,
  onClose,
  itemId,
  itemName,
  defaultFromDate,
  onDone,
}: RecalculateValuationModalProps) {
  const toast = useToast()
  const [scope, setScope] = useState<RecalcScope>(itemId ? 'item' : 'all')
  const [fromDate, setFromDate] = useState(defaultFromDate || todayIso())
  const [dryRun, setDryRun] = useState(true)
  const [runNow, setRunNow] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RecalcJob | null>(null)

  // Re-arm every time the dialog opens: a stale result panel from the last run
  // under the last scope is the worst thing this dialog could show.
  useEffect(() => {
    if (!open) return
    setScope(itemId ? 'item' : 'all')
    setFromDate(defaultFromDate || todayIso())
    setDryRun(true)
    setRunNow(true)
    setConfirming(false)
    setResult(null)
  }, [open, itemId, defaultFromDate])

  const wide = scope === 'all' && !dryRun
  const scopeLabel = scope === 'item' ? (itemName ?? 'the selected item') : 'every item in this company'

  const submit = async () => {
    if (wide && !confirming) {
      setConfirming(true)
      return
    }
    setBusy(true)
    try {
      const job = await valuationApi.enqueueRecalc({
        from_date: fromDate,
        item_id: scope === 'item' && itemId ? Number(itemId) : null,
        dry_run: dryRun,
        run_now: runNow,
      })
      setResult(job)
      setConfirming(false)
      toast.success(
        `Recalculation #${job.job_id} ${job.status.toLowerCase()}${job.dry_run ? ' (dry run)' : ''}.`,
      )
      onDone()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not queue the recalculation.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Recalculate valuation"
      description="Re-cost every movement from a date forward, in order."
      onClose={onClose}
      busy={busy}
      size="md"
      footer={
        result ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              icon={RefreshCw}
              loading={busy}
              disabled={!fromDate}
              variant={confirming ? 'danger' : 'primary'}
              onClick={submit}
            >
              {confirming
                ? `Yes — recalculate ${scopeLabel}`
                : dryRun
                  ? 'Preview impact'
                  : 'Run recalculation'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <RecalcResult job={result} />
      ) : (
        <div className="space-y-3.5">
          <fieldset>
            <legend className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Scope
            </legend>
            <div className="mt-1.5 space-y-1.5">
              <label className="flex items-start gap-2 text-[12.5px] text-gray-700">
                <input
                  type="radio"
                  name="recalc-scope"
                  checked={scope === 'item'}
                  disabled={!itemId}
                  onChange={() => setScope('item')}
                  className="mt-0.5 h-3.5 w-3.5 border-gray-300 text-primary focus:ring-primary/30"
                />
                <span>
                  <span className="font-medium text-gray-900">
                    {itemName ?? 'The selected item'}
                  </span>
                  <span className="block text-[11px] text-gray-500">
                    {itemId ? 'Only this item is re-costed.' : 'Pick an item first to use this scope.'}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-[12.5px] text-gray-700">
                <input
                  type="radio"
                  name="recalc-scope"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                  className="mt-0.5 h-3.5 w-3.5 border-gray-300 text-primary focus:ring-primary/30"
                />
                <span>
                  <span className="font-medium text-gray-900">Every item</span>
                  <span className="block text-[11px] text-gray-500">
                    The whole company, from the date below. This can take a while.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="recalc-from"
              className="text-[11px] font-semibold uppercase tracking-wide text-gray-500"
            >
              Recalculate from
            </label>
            <Input
              id="recalc-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="mt-1 w-[11rem]"
            />
            <p className="mt-1 text-[11px] text-gray-500">
              Every movement on or after {formatDate(fromDate)} is re-costed in sequence. Earlier
              periods are untouched.
            </p>
          </div>

          <label className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-700">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary/30"
            />
            <span>
              <span className="font-medium text-gray-900">Preview impact only (dry run)</span>
              <span className="block text-[11px] text-gray-500">
                Reports what would change and publishes no revisions. Leave this on until you have
                seen the numbers.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-[12px] text-gray-700">
            <input
              type="checkbox"
              checked={runNow}
              onChange={(e) => setRunNow(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary/30"
            />
            <span>
              Run immediately
              <span className="block text-[11px] text-gray-500">
                Otherwise the job waits in the queue for the worker to pick it up.
              </span>
            </span>
          </label>

          {!dryRun ? (
            <Notice kind="warning" title="This run writes.">
              Revisions are published to Books for every line whose cost changes. They cannot be
              un-published — a mistake is corrected by another recalculation, which is itself
              recorded.
            </Notice>
          ) : null}

          {confirming ? (
            <Notice kind="error" title="Recalculating every item.">
              This re-costs the whole company from {formatDate(fromDate)} and publishes the
              revisions it produces. Press the red button again to go ahead.
            </Notice>
          ) : null}

          <p className="text-[10.5px] leading-relaxed text-gray-400">
            The job records who asked for it and when. A free-text reason is not stored against a
            recalculation — note it on the source document so it travels with the audit trail.
          </p>
        </div>
      )}
    </Modal>
  )
}

/** The job's own report. Every figure comes back from the server. */
export function RecalcResult({ job }: { job: RecalcJob }) {
  const failed = job.status === 'FAILED'
  return (
    <div className="space-y-3">
      <div
        className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${
          failed ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'
        }`}
      >
        {failed ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
        ) : (
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        )}
        <div className="min-w-0 text-[12.5px]">
          <p className="font-semibold text-gray-900">
            Job #{job.job_id} — {job.status.toLowerCase()}
            {job.dry_run ? ' (dry run)' : ''}
          </p>
          <p className="mt-0.5 text-[11.5px] text-gray-600">
            {failed
              ? (job.failure_reason ?? 'The job stopped without a reason.')
              : `Re-costed from ${formatDate(job.from_date)} over ${job.item_id ? 'one item' : 'every item'}.`}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-3 overflow-hidden rounded-lg border border-gray-200">
        <Figure label="Lines examined" value={formatInt(job.affected_line_count ?? 0)} />
        <Figure label="Lines revised" value={formatInt(job.revised_line_count ?? 0)} />
        <Figure
          label="COGS movement"
          value={formatMoney(job.cogs_delta)}
          tone={job.cogs_delta < 0 ? 'text-red-600' : 'text-gray-900'}
        />
      </dl>

      {job.affected_document_ids?.length ? (
        <p className="text-[11px] text-gray-500">
          {formatInt(job.affected_document_ids.length)} document
          {job.affected_document_ids.length === 1 ? '' : 's'} touched.
        </p>
      ) : null}

      <p className="text-[11.5px] text-gray-600">
        {job.dry_run ? (
          <>Nothing was published. Re-run with the preview unticked to apply it.</>
        ) : (
          <>
            <Link
              to={`/valuation/revisions?job_id=${job.job_id}`}
              className="font-semibold text-primary no-underline hover:underline"
            >
              Open the revisions this job published
            </Link>{' '}
            — Books acknowledges each one once it has re-posted the COGS.
          </>
        )}
      </p>
    </div>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border-r border-gray-200 px-2.5 py-2 last:border-r-0">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className={`mt-0.5 text-[13px] font-semibold tabular-nums ${tone ?? 'text-gray-900'}`}>
        {value}
      </dd>
    </div>
  )
}

export default RecalculateValuationModal
