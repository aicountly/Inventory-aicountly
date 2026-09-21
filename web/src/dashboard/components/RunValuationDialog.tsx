import { useEffect, useState } from 'react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { formatDate } from '../../utils/format'

/**
 * The confirmation behind "Run valuation".
 *
 * Running a live recalculation is not a refresh. It re-costs every movement
 * from a date forward, rewrites the cost layers behind it and publishes COGS
 * revisions to Books — work that leaves this application and that a reader who
 * opened the dashboard to look at a number has not asked for. So the primary
 * action opens this, which
 *
 *  - states in words what will happen, including the Books side;
 *  - defaults to a DRY RUN, which reports what would change and writes nothing;
 *  - shows the date the walk starts from and lets it be narrowed;
 *  - cannot be double-submitted — the confirm disables itself while the request
 *    is in flight, and a failure is shown here rather than thrown away.
 *
 * Both modes go through `POST /v1/valuation/recalculations`, the endpoint the
 * recalculations register already uses. Nothing new was invented for this
 * screen, and the permission (`valuation.recalculate`) is the existing one.
 */
export interface RunValuationDialogProps {
  open: boolean
  /** Earliest date the walk may start from — the financial year's start. */
  fyStart: string
  /** Default start, already clamped to the financial year. */
  defaultFrom: string
  maxDate: string
  busy: boolean
  error: string | null
  onConfirm: (options: { fromDate: string; dryRun: boolean }) => void
  onCancel: () => void
}

export function RunValuationDialog({
  open,
  fyStart,
  defaultFrom,
  maxDate,
  busy,
  error,
  onConfirm,
  onCancel,
}: RunValuationDialogProps) {
  const [fromDate, setFromDate] = useState(defaultFrom)
  const [mode, setMode] = useState<'dry' | 'live'>('dry')

  // Re-arm each time it opens: a dialog that remembers "live" from last time is
  // one mis-click away from an unintended re-costing.
  useEffect(() => {
    if (open) {
      setFromDate(defaultFrom)
      setMode('dry')
    }
  }, [open, defaultFrom])

  const dryRun = mode === 'dry'

  /**
   * `min` and `max` on a date input are advisory outside a form: nothing
   * validates them, and a typed or pasted date sails straight through. This is
   * a live re-costing that publishes to Books, so the range is checked here and
   * the confirm stays disabled until the date is one the year actually contains.
   */
  const outOfRange =
    fromDate === '' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) ||
    (fyStart !== '' && fromDate < fyStart) ||
    (maxDate !== '' && fromDate > maxDate)

  return (
    <Modal
      open={open}
      title="Run valuation"
      onClose={onCancel}
      busy={busy}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={dryRun ? 'primary' : 'warning'}
            onClick={() => onConfirm({ fromDate, dryRun })}
            loading={busy}
            disabled={outOfRange}
          >
            {dryRun ? 'Run dry run' : 'Run live recalculation'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm leading-relaxed text-gray-700">
        <p>
          Inventory will re-cost every stock movement from the date below onwards, under each
          item&rsquo;s own costing method.
        </p>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Recalculate from
          </span>
          <Input
            type="date"
            value={fromDate}
            min={fyStart || undefined}
            max={maxDate}
            disabled={busy}
            invalid={outOfRange}
            aria-invalid={outOfRange || undefined}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-[11rem]"
            aria-label="Recalculate from date"
          />
          <span className="mt-1 block text-[11px] text-gray-500">
            The financial year starts {formatDate(fyStart)}. Earlier dates belong to a closed year
            and are recalculated from its own screen.
          </span>
        </label>

        {outOfRange ? (
          <Notice kind="warning">
            Pick a date between {formatDate(fyStart)} and {formatDate(maxDate)}. Valuation is
            recalculated inside the open financial year, up to the date this page is reporting.
          </Notice>
        ) : null}

        <SegmentedControl
          label="Mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'dry', label: 'Dry run', title: 'Report what would change; write nothing' },
            { value: 'live', label: 'Live', title: 'Apply the new costs and publish revisions to Books' },
          ]}
        />

        {dryRun ? (
          <Notice kind="info">
            A dry run reports the lines whose valuation would change and writes nothing. No cost
            layer is rewritten and nothing is sent to Books.
          </Notice>
        ) : (
          <Notice kind="warning">
            A live run rewrites the cost layers from this date forward and publishes the resulting
            COGS revisions to Books. It cannot be undone from this screen.
          </Notice>
        )}

        {error ? <Notice kind="error">{error}</Notice> : null}
      </div>
    </Modal>
  )
}

export default RunValuationDialog
