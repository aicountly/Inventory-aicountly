import type { IconTone } from '../../ui/IconTile'
import { AIC, cx } from '../../ui/cx'
import type { ReportPreviewKind } from './reportDirectory'

/**
 * The sketch in the corner of a report card.
 *
 * It says "this one is a shape over time", "this one is a list", "this one is a
 * gauge" at a glance, which is what makes a wall of ten cards scannable. It
 * says nothing else: every shape below is a fixed constant, nothing is fetched
 * to draw it, and no figure is ever printed inside it. A directory that drew a
 * plausible bar chart from invented quantities would be inviting someone to
 * read a stock position off a decoration.
 *
 * Drawn with spans and inline SVG rather than a charting library — a decoration
 * this size is not worth a dependency, and `currentColor` lets one shape serve
 * all nine tones.
 */

/** The accent each tone draws in. Matches IconTile's palette. */
export const TONE_INK: Record<IconTone, string> = {
  primary: 'text-primary',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  danger: 'text-red-500',
  info: 'text-sky-500',
  violet: 'text-violet-500',
  slate: 'text-slate-400',
  rose: 'text-rose-500',
  teal: 'text-teal-500',
}

const BAR_HEIGHTS = [26, 46, 72, 100, 68, 42, 58]
const COLUMN_HEIGHTS = [34, 58, 44, 88, 62, 100, 40]
const HISTOGRAM_HEIGHTS = [22, 40, 66, 92, 54, 30, 18]
const PROGRESS_WIDTHS = [78, 46, 92]
const LEDGER_WIDTHS: readonly [number, number][] = [
  [62, 24],
  [44, 32],
  [70, 18],
]
const SPARKLINE = '0,27 14,21 28,24 42,13 56,16 70,7 84,10 96,3'
const AREA = '0,28 13,20 26,23 39,12 52,17 65,9 78,13 96,5'

function Columns({ heights, width, gap }: { heights: readonly number[]; width: string; gap: string }) {
  return (
    <div className={cx('flex h-9 items-end', gap)}>
      {heights.map((h, i) => (
        <span
          key={i}
          className={cx(width, 'min-h-[5px] rounded-t-sm bg-current opacity-70')}
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  )
}

function Line({ area }: { area: boolean }) {
  return (
    <svg viewBox="0 0 96 32" className="h-9 w-full" preserveAspectRatio="none" focusable="false">
      {area ? (
        <polygon points={`${AREA} 96,32 0,32`} fill="currentColor" opacity="0.14" />
      ) : null}
      <polyline
        points={area ? AREA : SPARKLINE}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** Three rows, each a tracked thing and the state it is in. */
function StatusRows() {
  return (
    <div className="flex h-9 flex-col justify-center gap-1.5">
      {[46, 60, 38].map((w, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />
          <span className="h-1.5 rounded-full bg-current opacity-25" style={{ width: `${w}%` }} />
        </span>
      ))}
    </div>
  )
}

/** Three ledger lines — a narrative column and a figure column. */
function LedgerRows() {
  return (
    <div className="flex h-9 flex-col justify-center gap-1.5">
      {LEDGER_WIDTHS.map(([left, right], i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span className="h-1.5 rounded-full bg-current opacity-30" style={{ width: `${left}%` }} />
          <span className="h-1.5 rounded-full bg-current opacity-70" style={{ width: `${right}%` }} />
        </span>
      ))}
    </div>
  )
}

/**
 * Three gauges — a level against a track.
 *
 * Track and level are siblings, not parent and child: `opacity` compounds down
 * a subtree, so a level nested inside a 15%-opaque track would render at 15% of
 * its own opacity and the gauge would read as three faint lines.
 */
function ProgressBars() {
  return (
    <div className="flex h-9 flex-col justify-center gap-2">
      {PROGRESS_WIDTHS.map((w, i) => (
        <span key={i} className="relative block h-1.5 w-full">
          <span className="absolute inset-0 rounded-full bg-current opacity-20" />
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-current opacity-90"
            style={{ width: `${w}%` }}
          />
        </span>
      ))}
    </div>
  )
}

export interface ReportPreviewProps {
  kind: ReportPreviewKind
  tone: IconTone
  className?: string
}

export function ReportPreview({ kind, tone, className }: ReportPreviewProps) {
  return (
    // `pointer-events-none` matters: every shape below is drawn with `opacity`,
    // which creates a stacking context, so these spans paint ABOVE the card's
    // stretched title link and would otherwise be a dead patch in the middle of
    // a clickable card. Decoration should never take a click.
    <div
      aria-hidden
      className={cx(AIC, 'pointer-events-none min-w-0 flex-1', TONE_INK[tone], className)}
    >
      {kind === 'bars' ? <Columns heights={BAR_HEIGHTS} width="w-2" gap="gap-1" /> : null}
      {kind === 'columns' ? <Columns heights={COLUMN_HEIGHTS} width="w-1.5" gap="gap-1.5" /> : null}
      {kind === 'histogram' ? <Columns heights={HISTOGRAM_HEIGHTS} width="w-2.5" gap="gap-0.5" /> : null}
      {kind === 'sparkline' ? <Line area={false} /> : null}
      {kind === 'area' ? <Line area /> : null}
      {kind === 'status' ? <StatusRows /> : null}
      {kind === 'ledger' ? <LedgerRows /> : null}
      {kind === 'progress' ? <ProgressBars /> : null}
    </div>
  )
}

export default ReportPreview
