import { useEffect, useState } from 'react'
import { Modal } from '../../../components/Modal'
import { Notice } from '../../../components/Notice'
import { Button } from '../../../ui/Button'
import { ProgressBar } from '../../../ui/ProgressBar'
import { Select } from '../../../ui/Select'
import { errorMessage } from '../../../services/api'
import { BATCH_STATUSES, batchesApi } from '../../../services/masters'
import type { Batch, BatchStatus } from '../../../services/masters'
import { formatInt, humanize } from '../../../utils/format'

/**
 * Set the stored status on several batches at once.
 *
 * There is no bulk endpoint for batches and this does not pretend there is: it
 * issues the same `PUT /v1/batches/{id}` the edit form does, one batch at a
 * time, so every domain rule and every audit hook that applies to a single edit
 * applies here too. A batch the server refuses is reported by name rather than
 * skipped — the point of a bulk action is not having to check afterwards.
 *
 * Sequential rather than parallel on purpose. Twenty simultaneous writes to the
 * same table buys a second and costs the ability to stop cleanly when the
 * fourth one is rejected.
 */

export interface BatchBulkStatusDialogProps {
  open: boolean
  batches: readonly Batch[]
  onClose: () => void
  /** Called once the run finishes, with how many batches actually changed. */
  onDone: (changed: number) => void
}

interface Failure {
  batch_no: string
  reason: string
}

export function BatchBulkStatusDialog({ open, batches, onClose, onDone }: BatchBulkStatusDialogProps) {
  const [status, setStatus] = useState<BatchStatus>('active')
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [failures, setFailures] = useState<Failure[]>([])
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    if (!open) return
    setStatus('active')
    setRunning(false)
    setDone(0)
    setFailures([])
    setFinished(false)
  }, [open])

  const run = async () => {
    setRunning(true)
    setFailures([])
    setDone(0)
    const failed: Failure[] = []
    let changed = 0
    for (const batch of batches) {
      try {
        // The whole record goes back, not a patch: the API rebuilds the row
        // from the body it is given, so sending `status` alone would blank the
        // dates this batch is traced by.
        await batchesApi.update(batch.batch_id, {
          item_id: batch.item_id,
          batch_no: batch.batch_no,
          lot_no: batch.lot_no,
          mfg_date: batch.mfg_date,
          expiry_date: batch.expiry_date,
          warranty_months: batch.warranty_months,
          status,
        })
        changed += 1
      } catch (err: unknown) {
        failed.push({ batch_no: batch.batch_no, reason: errorMessage(err, 'The server refused this change.') })
      }
      setDone((n) => n + 1)
    }
    setFailures(failed)
    setRunning(false)
    setFinished(true)
    onDone(changed)
  }

  const total = batches.length

  return (
    <Modal
      open={open}
      title={`Change status on ${formatInt(total)} ${total === 1 ? 'batch' : 'batches'}`}
      onClose={onClose}
      busy={running}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={running}>
            {finished ? 'Close' : 'Cancel'}
          </Button>
          {finished ? null : (
            <Button loading={running} onClick={() => void run()}>
              Apply to {formatInt(total)}
            </Button>
          )}
        </>
      }
    >
      {finished ? (
        <div className="space-y-3">
          <Notice kind={failures.length === 0 ? 'success' : 'warning'}>
            {formatInt(total - failures.length)} of {formatInt(total)} batches updated.
          </Notice>
          {failures.length > 0 ? (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-700">These were refused and left unchanged:</p>
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2 text-xs">
                {failures.map((f) => (
                  <li key={f.batch_no}>
                    <span className="font-mono font-semibold text-gray-900">{f.batch_no}</span>
                    <span className="text-gray-500"> — {f.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label htmlFor="bulk-status" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              New stored status
            </label>
            <Select id="bulk-status" size="md" value={status} onChange={(e) => setStatus(e.target.value as BatchStatus)}>
              {BATCH_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-xs text-gray-500">
            Quantities are not touched. Only the batch’s own status changes, and every change is written to the
            audit log.
          </p>
          {running ? (
            <div>
              <ProgressBar value={done} max={total} size="sm" aria-label="Applying status change" />
              <p className="mt-1.5 text-xs text-gray-500">
                {formatInt(done)} of {formatInt(total)} done…
              </p>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  )
}

export default BatchBulkStatusDialog
