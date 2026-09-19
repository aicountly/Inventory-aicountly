import { Badge } from '../../../ui/Badge'
import { Tooltip } from '../../../ui/Tooltip'
import { cx } from '../../../ui/cx'
import { formatElapsed, statusMeta } from './recalculationModel'
import type { RecalcJob } from '../../../services/valuationApi'

/**
 * The status chip, and — while a job is still moving — what it is doing.
 *
 * Word AND glyph, never colour alone: the chip has to survive a monochrome
 * print and a reader who cannot tell amber from green.
 */
export function RecalculationStatusBadge({
  status,
  size = 'sm',
}: {
  status: string
  size?: 'xs' | 'sm'
}) {
  const meta = statusMeta(status)
  const Icon = meta.icon
  return (
    <Tooltip label={meta.hint}>
      <Badge tone={meta.tone} size={size} className="gap-1.5">
        <Icon
          className={cx('h-3 w-3 shrink-0', meta.live && 'motion-safe:animate-spin motion-safe:[animation-duration:2.4s]')}
          aria-hidden
        />
        {meta.label}
      </Badge>
    </Tooltip>
  )
}

/**
 * The status cell of a live row: the chip, then how long it has been going.
 *
 * There is NO percentage here, and that is deliberate. RecalculationService
 * replays an item at a time inside one transaction and reports nothing until it
 * lands, so the server has no processed count to send — the job row carries
 * `affected_line_count` only once it is over. A bar filling to an invented 62%
 * would be a number no one could reconcile against anything, on a screen whose
 * whole purpose is that its numbers reconcile. So the running state shows an
 * indeterminate bar (something IS happening) and the elapsed clock (for how
 * long), which are the two things actually known.
 *
 * `aria-live="polite"` on the wrapper: the poll updates this text without any
 * interaction, and a screen-reader user watching a job should hear it settle.
 */
export function RecalculationLiveCell({ job, now }: { job: RecalcJob; now: number }) {
  const meta = statusMeta(job.status)
  const running = String(job.status).toUpperCase() === 'RUNNING'
  const elapsed = formatElapsed(running ? job.started_at ?? job.created_at : job.created_at, null, now)

  return (
    <div className="flex flex-col gap-1" aria-live="polite">
      <RecalculationStatusBadge status={job.status} />
      {meta.live ? (
        <div className="flex items-center gap-1.5">
          {running ? (
            <span
              className="h-1 w-12 overflow-hidden rounded-full bg-amber-100 print:hidden"
              role="progressbar"
              aria-label="Recalculation in progress"
              aria-valuetext="In progress; no completion estimate is available"
            >
              <span className="block h-full w-1/3 rounded-full bg-amber-500 motion-safe:animate-[aic-indeterminate_1.4s_ease-in-out_infinite]" />
            </span>
          ) : null}
          {elapsed ? (
            // The duration alone, with the sentence on hover: "queued 59m 23s
            // ago" spelled out wraps the status column onto three lines and
            // pushes every column right of it off a laptop screen.
            <Tooltip label={running ? `Running for ${elapsed}` : `Queued ${elapsed} ago`}>
              <span className="text-[11px] tabular-nums text-gray-500">{elapsed}</span>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
