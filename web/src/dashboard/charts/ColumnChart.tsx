import { useId } from 'react'
import { cx } from '../../ui/cx'

/**
 * Grouped vertical columns — the day's receipts against its issues, by hour.
 *
 * Drawn as plain divs rather than SVG because the shape is a bar per category
 * and nothing here needs a path: divs get flexbox, text ellipsis and the
 * theme's own colour tokens for free, and they print.
 *
 * Two rules this component enforces for the caller:
 *
 *  - **It never draws the future.** `truncateAfter` marks the last bucket that
 *    has actually happened; bars past it are not rendered at all. An empty
 *    17:00 column drawn at 11:00 reads as "nothing happened this afternoon"
 *    rather than "the afternoon has not happened yet".
 *  - **It always ships a table.** The `<table>` in the visually-hidden block is
 *    the accessible equivalent, and it is the same numbers — a screen reader
 *    gets the data, not a description of a picture.
 */
export interface ColumnSeries {
  key: string
  label: string
  /** A Tailwind background class, from visuals.ts BAR_FILL. */
  fill: string
  values: readonly number[]
}

export interface ColumnChartProps {
  /** One label per column, e.g. `09`, `10`, `11`. */
  categories: readonly string[]
  series: readonly ColumnSeries[]
  /** Accessible name and the caption of the data table. */
  caption: string
  /** The unit, for the table header and the tooltip: `documents`, `units`. */
  unit?: string
  /** Index of the last real bucket; later columns are not drawn. */
  truncateAfter?: number | null
  /** Sentence shown where the un-happened part of the axis would be. */
  truncatedNote?: string
  /**
   * What one column is, for the accessible table's row header — `Hour`, `Week`.
   *
   * The table IS the data for a screen-reader, and a column of dates under the heading
   * "Hour" describes a different chart from the one on screen.
   */
  categoryLabel?: string
  /**
   * The unabbreviated name of each column, in `categories` order.
   *
   * An axis label has to be short enough to fit under a bar; the tooltip and the
   * accessible table have room for `Week of 14 Sep 2026` and are the places a reader
   * checks when the short form is ambiguous.
   */
  categoryTitles?: readonly string[]
  /** Bar width utilities. Widen it for a chart with few columns and room to spare. */
  barClassName?: string
  height?: number
  className?: string
}

export function ColumnChart({
  categories,
  series,
  caption,
  unit = 'documents',
  truncateAfter = null,
  truncatedNote,
  categoryLabel = 'Period',
  categoryTitles,
  barClassName = 'w-1.5 md:w-2',
  height = 168,
  className,
}: ColumnChartProps) {
  const tableId = useId()
  const lastIndex = truncateAfter === null ? categories.length - 1 : Math.min(truncateAfter, categories.length - 1)
  const shown = categories.slice(0, lastIndex + 1)

  const max = series.reduce(
    (m, s) => s.values.slice(0, lastIndex + 1).reduce((mm, v) => Math.max(mm, v), m),
    0,
  )

  if (shown.length === 0) {
    return (
      <p className={cx('text-xs text-gray-500', className)}>
        Nothing has been posted yet {truncatedNote ? `— ${truncatedNote}` : ''}
      </p>
    )
  }

  return (
    <figure className={cx('m-0', className)}>
      {/* The bars are decoration over the table below; the table is the data. */}
      <div
        role="img"
        aria-labelledby={tableId}
        className="flex items-end gap-px overflow-x-auto scrollbar-thin"
        style={{ height }}
      >
        {shown.map((category, i) => (
          <div key={`${category}-${i}`} className="flex h-full min-w-[18px] flex-1 flex-col justify-end gap-1">
            <div className="flex flex-1 items-end justify-center gap-[2px]">
              {series.map((s) => {
                const value = s.values[i] ?? 0
                // Zero draws nothing at all rather than a 1px stub: a sliver
                // that looks like activity where there was none is worse than
                // a gap, and the table still carries the 0.
                const pct = max > 0 && value > 0 ? Math.max(4, (value / max) * 100) : 0
                return (
                  <div
                    key={s.key}
                    className={cx('rounded-t-sm transition-[height] duration-500', barClassName, value > 0 ? s.fill : '')}
                    style={{ height: `${pct}%` }}
                    title={`${categoryTitles?.[i] ?? category} — ${s.label}: ${value} ${unit}`}
                  />
                )
              })}
            </div>
            <span className="text-center text-[10px] tabular-nums text-gray-400">{category}</span>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
            <span className={cx('h-2 w-2 rounded-sm', s.fill)} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>

      {truncatedNote ? <p className="mt-1 text-[11px] text-gray-400">{truncatedNote}</p> : null}

      <figcaption id={tableId} className="sr-only">
        {caption}
      </figcaption>
      {/* The accessible equivalent of the chart above.
          Wrapped in a div rather than carrying `sr-only` on the <table> itself:
          a table auto-sizes to its content and ignores the 1px width the
          sr-only recipe relies on, so the table stayed 1,800px wide and pushed
          the document's scroll width past the viewport — a horizontal scrollbar
          on every page, caused by something nobody can see. A div honours the
          clamp and the table inside it is clipped with everything else. */}
      <div className="sr-only">
        <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{categoryLabel}</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label} ({unit})
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((category, i) => (
            <tr key={`${category}-${i}`}>
              <th scope="row">{categoryTitles?.[i] ?? category}</th>
              {series.map((s) => (
                <td key={s.key}>{s.values[i] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </figure>
  )
}

export default ColumnChart
