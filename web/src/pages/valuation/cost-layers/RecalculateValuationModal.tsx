import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { TriangleAlert } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { Input } from '../../../ui/Input'
import { Modal } from '../../../components/Modal'
import { cx } from '../../../ui/cx'
import { ApiError } from '../../../services/api'
import { valuationApi } from '../../../services/valuationApi'
import type { RecalcJob } from '../../../services/valuationApi'
import { useToast } from '../../../ui/ToastContext'
import { formatDate, formatInt, formatMoney, todayIso } from '../../../utils/format'

type Scope = 'item' | 'company'

export interface RecalculateValuationModalProps {
  open: boolean
  onClose: () => void
  itemId: number | null
  itemName: string | null
  /** Pre-filled when the drawer asked to recalculate from a layer's date. */
  initialFromDate?: string | null
  onDone: (job: RecalcJob) => void
}

function Choice({
  checked,
  onSelect,
  title,
  description,
  disabled,
  tone = 'default',
}: {
  checked: boolean
  onSelect: () => void
  title: string
  description: string
  disabled?: boolean
  tone?: 'default' | 'warning'
}) {
  return (
    <label
      className={cx(
        'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors',
        disabled && 'cursor-not-allowed opacity-60',
        checked
          ? tone === 'warning'
            ? 'border-amber-300 bg-amber-50'
            : 'border-primary/40 bg-primary-light'
          : 'border-gray-200 hover:border-gray-300',
      )}
    >
      <input
        type="radio"
        name="recalc-scope"
        className="mt-0.5 h-4 w-4"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
      />
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-gray-900">{title}</span>
        <span className="block text-[11px] leading-relaxed text-gray-600">{description}</span>
      </span>
    </label>
  )
}

/**
 * Re-costing, behind a door.
 *
 * A live recalculation rewrites the valuation of every issue after the chosen
 * date and publishes the resulting COGS revisions to Books, so this deliberately
 * is not a button. Three things stand between the reader and that: the dry run
 * is the DEFAULT, a company-wide live run has to be confirmed a second time,
 * and the panel says in words what will be written before anything is.
 *
 * What the job records is stated here because it is the answer to "can we undo
 * this": who ran it, when, over what, and every line it moved — all of which an
 * auditor can read back on the Recalculations tab.
 */
export function RecalculateValuationModal({
  open,
  onClose,
  itemId,
  itemName,
  initialFromDate,
  onDone,
}: RecalculateValuationModalProps) {
  const toast = useToast()
  const [scope, setScope] = useState<Scope>('item')
  const [fromDate, setFromDate] = useState(initialFromDate ?? todayIso())
  const [dryRun, setDryRun] = useState(true)
  const [runNow, setRunNow] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RecalcJob | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setScope(itemId === null ? 'company' : 'item')
    setFromDate(initialFromDate ?? todayIso())
    setDryRun(true)
    setRunNow(true)
    setConfirming(false)
    setResult(null)
    setError(null)
  }, [open, itemId, initialFromDate])

  const wideAndLive = scope === 'company' && !dryRun

  const submit = async () => {
    if (wideAndLive && !confirming) {
      setConfirming(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const job = await valuationApi.enqueueRecalc({
        from_date: fromDate,
        item_id: scope === 'item' ? itemId : null,
        dry_run: dryRun,
        run_now: runNow,
      })
      setResult(job)
      onDone(job)
      toast.success(
        `Recalculation #${job.job_id} ${job.status.toLowerCase()}${job.dry_run ? ' (preview only)' : ''}.`,
      )
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'The recalculation could not be started.'
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title="Recalculate valuation"
      description="Replays costing forward from a date, re-costs every issue after it and records what changed."
      footer={
        result ? (
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setResult(null)}>
              Run another
            </Button>
            <Button onClick={onClose}>Close</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              loading={busy}
              variant={wideAndLive ? 'danger' : 'primary'}
              disabled={fromDate === ''}
            >
              {confirming
                ? 'Yes — run it for every item'
                : dryRun
                  ? 'Preview the impact'
                  : 'Run recalculation'}
            </Button>
          </div>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <div
            className={cx(
              'rounded-lg border p-3',
              result.status === 'FAILED' ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50',
            )}
          >
            <p className="text-xs font-semibold text-gray-900">
              Job #{result.job_id} — {result.status.toLowerCase()}
              {result.dry_run ? ' (preview only, nothing was written)' : ''}
            </p>
            {result.failure_reason ? (
              <p className="mt-1 text-[11.5px] leading-relaxed text-red-700">{result.failure_reason}</p>
            ) : null}
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Scope', value: result.item_id ? (result.item_name ?? `Item #${result.item_id}`) : 'All items' },
              { label: 'Lines affected', value: formatInt(result.affected_line_count ?? 0) },
              { label: 'Lines revised', value: formatInt(result.revised_line_count ?? 0) },
              { label: 'COGS movement', value: formatMoney(result.cogs_delta) },
            ].map((cell) => (
              <div key={cell.label} className="rounded-lg border border-gray-200 p-2.5">
                <dt className="text-[10.5px] font-medium uppercase tracking-wide text-gray-500">{cell.label}</dt>
                <dd className="mt-0.5 truncate text-[13px] font-semibold tabular-nums text-gray-900">{cell.value}</dd>
              </div>
            ))}
          </dl>

          <p className="text-[11.5px] leading-relaxed text-gray-600">
            Recalculated from {formatDate(result.from_date)}. The full record — including every revision published to
            Books — is on the{' '}
            <Link to="/valuation/recalculations" className="font-semibold text-primary no-underline hover:underline">
              recalculations tab
            </Link>
            {result.job_uuid ? ` under reference ${result.job_uuid}` : ''}.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-xs font-semibold text-gray-700">Scope</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Choice
                checked={scope === 'item'}
                onSelect={() => setScope('item')}
                disabled={itemId === null}
                title={itemName ? `This item — ${itemName}` : 'This item'}
                description={
                  itemId === null
                    ? 'Choose an item on the screen behind to enable this.'
                    : 'Only this item’s layers and the issues that drew from them.'
                }
              />
              <Choice
                checked={scope === 'company'}
                onSelect={() => setScope('company')}
                tone="warning"
                title="Every item in the company"
                description="Long-running. Re-costs the whole company from the date below."
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
              The engine recalculates by item and date; it does not take a warehouse or a period, so those filters on
              the screen behind do not narrow this run.
            </p>
          </fieldset>

          <label className="flex max-w-xs flex-col gap-1">
            <span className="text-xs font-semibold text-gray-700">Recalculate from</span>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} required />
            <span className="text-[11px] leading-relaxed text-gray-500">
              Every issue on or after this date is re-costed. Earlier movements are left exactly as they are.
            </span>
          </label>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-200 p-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={dryRun}
                onChange={(e) => {
                  setDryRun(e.target.checked)
                  setConfirming(false)
                }}
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-gray-900">Preview the impact only (dry run)</span>
                <span className="block text-[11px] leading-relaxed text-gray-600">
                  Reports what would change and writes nothing — no valuation is touched and Books is told nothing.
                  Leave this on the first time.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-200 p-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={runNow}
                onChange={(e) => setRunNow(e.target.checked)}
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-gray-900">Run it now</span>
                <span className="block text-[11px] leading-relaxed text-gray-600">
                  Off, the job is queued and the background worker picks it up — better for a company-wide run.
                </span>
              </span>
            </label>
          </div>

          {!dryRun ? (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11.5px] leading-relaxed text-amber-800">
              <TriangleAlert className="mt-px h-4 w-4 shrink-0" aria-hidden />
              <span>
                A live run rewrites the valuation rate and amount on every affected line and publishes the resulting
                COGS revisions to Books. It cannot be un-run — it is corrected by running it again from an earlier
                date.
              </span>
            </p>
          ) : null}

          {confirming ? (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-[11.5px] font-semibold leading-relaxed text-red-700"
            >
              This will re-cost every item in the company from {formatDate(fromDate)} and publish the revisions to
              Books. Press the button again to go ahead.
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-[11.5px] text-red-700">
              {error}
            </p>
          ) : null}

          <p className="border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-500">
            The job records who requested it, when it ran, its scope and mode, every line it revised and the net COGS
            movement — all readable afterwards on the recalculations tab.
          </p>
        </div>
      )}
    </Modal>
  )
}

export default RecalculateValuationModal
