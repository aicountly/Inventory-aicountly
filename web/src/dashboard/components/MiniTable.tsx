import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { SmartTable } from '../../ui/shell/SmartTable'
import type { SmartColumn } from '../../ui/shell/SmartTable'
import { DASHBOARD_TABLE_PROPS } from '../../styles/designTokens'

/**
 * The compact table inside a dashboard card: sticky header, capped scroll, one
 * click per row into the record behind it.
 *
 * It is SmartTable with the dashboard prop bundle, exactly as Books'
 * DashboardCompactTable is — so a widget table and a register table agree on
 * density, sticky head, totals and the column widths they ask for. Only the
 * row-link contract is added on top: the first cell of a row with a destination
 * is a real `<a href>`, which is what middle-click, Ctrl-click and the status
 * bar need and what a `<tr role="link">` gives none of.
 */
export interface MiniColumn<T> {
  key: string
  header: ReactNode
  align?: 'left' | 'right'
  /** Extra classes for the cell (width caps, tabular-nums…). */
  cellClassName?: string
  headerClassName?: string
  render: (row: T) => ReactNode
}

export interface MiniTableProps<T> {
  columns: readonly MiniColumn<T>[]
  rows: readonly T[]
  rowKey: (row: T, index: number) => string | number
  /** Destination for the row; a row with no destination is not clickable. */
  to?: (row: T) => string | null
  /**
   * What the link in the first cell is called, e.g. "Blue widget, batch B-102".
   * Say what the row *is*: a screen reader hearing "row 1, row 2…" learns
   * nothing, and this table is how a dashboard card is escaped.
   */
  rowLabel?: (row: T) => string
  /** Tailwind max-height for the scroll body. */
  maxHeight?: string
  /** Extra classes on a row — used to tint the ones that need attention. */
  rowClassName?: (row: T) => string | undefined
  /**
   * What the columns need, not what the card happens to be. A widget card is
   * about half a register wide, so without this the browser guesses and the
   * numeric columns collapse into each other; below it the card scrolls.
   */
  minWidth?: number
  /** Pinned totals row, keyed by column key — server figures, not page sums. */
  totals?: Record<string, ReactNode>
  /** Names the table for a screen reader. */
  caption?: string
}

export function MiniTable<T>({
  columns,
  rows,
  rowKey,
  to,
  rowLabel,
  maxHeight,
  rowClassName,
  minWidth = 420,
  totals,
  caption,
}: MiniTableProps<T>) {
  const navigate = useNavigate()

  const smartColumns = useMemo<SmartColumn<T>[]>(
    () =>
      columns.map((c, colIdx) => ({
        ...c,
        render: (row: T) => {
          const content = c.render(row)
          const href = colIdx === 0 && to ? to(row) : null
          if (!href) return content
          return (
            <Link
              to={href}
              aria-label={rowLabel?.(row)}
              // The row below is clickable too, and Link preventDefaults without
              // stopping the click: let it bubble and one press of the first
              // cell pushes the same path twice, so Back lands where it started.
              onClick={(e) => e.stopPropagation()}
              className="block no-underline text-inherit"
            >
              {content}
            </Link>
          )
        },
      })),
    [columns, to, rowLabel],
  )

  return (
    <SmartTable<T>
      {...DASHBOARD_TABLE_PROPS}
      className={maxHeight ?? DASHBOARD_TABLE_PROPS.className}
      cardPadding="none"
      columns={smartColumns}
      rows={rows}
      rowKey={rowKey}
      minWidth={minWidth}
      totals={totals}
      caption={caption}
      rowClassName={rowClassName}
      // Click anywhere on the row as a convenience, but no keyboard row
      // navigation: it listens on the window, and a dashboard renders four of
      // these at once, so Enter would fire in all four and each would grab
      // focus as its own request landed. The link in the first cell is the
      // keyboard path here.
      keyboardNav={false}
      onRowClick={to ? (row) => {
        const href = to(row)
        if (href) navigate(href)
      } : undefined}
    />
  )
}

export default MiniTable
