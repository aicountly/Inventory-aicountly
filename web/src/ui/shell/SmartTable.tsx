import { useMemo } from 'react'
import type { ReactNode, RefObject } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { Card } from '../Card'
import type { CardPadding } from '../Card'
import { EmptyState } from '../EmptyState'
import { ErrorState } from '../ErrorState'
import { LoadingState } from '../LoadingState'
import { cx } from '../cx'
import { useListKeyboardNav } from '../../keyboard/useListKeyboardNav'
import type { ResetKey } from '../../keyboard/useListKeyboardNav'
import {
  AMOUNT_CELL_CLASS,
  AMOUNT_HEADER_CLASS,
  TABLE_ROW_HOVER,
} from '../../styles/designTokens'
import type { SortOrder } from '../../services/api'
import type { CsvValue } from '../../utils/csv'

/**
 * The table every list, report and register renders.
 *
 * It is Books' SmartTable (sticky header, scrolling body, fill-available
 * height, pinned totals row, keyboard row activation, skeleton / error / empty
 * states, density) MERGED with the sortable headers of Inventory's DataTable
 * (`sortKey` + `sort` + `onSort`, `aria-sort`, server-side ordering).
 *
 * The merge is deliberate and was done up front: Books sorts server-side per
 * page and has no header sorting at all, so porting it naively would have
 * silently dropped sorting from every Inventory list it replaced.
 */

/**
 * Re-exported rather than redeclared: `utils/csv` owns the cell type, and a
 * second, narrower copy here made a column's `csv` resolver incompatible
 * between the table and the exporter that reads it (several report configs
 * return a boolean).
 */
export type { CsvValue }

export interface SmartColumn<T> {
  key: string
  header: ReactNode
  align?: 'left' | 'right' | 'center'
  width?: string | number
  minWidth?: number
  headerClassName?: string
  cellClassName?: string
  /** Full control over the cell. Takes precedence over `accessor`. */
  render?: (row: T, index: number) => ReactNode
  accessor?: (row: T) => ReactNode
  /** Sort parameter sent to the API. Omit for an unsortable column. */
  sortKey?: string

  /* --- export + column-config metadata, read by src/export and src/registers --- */
  /** Format as a currency amount in exports. */
  amount?: boolean
  exportType?: 'amount' | 'text'
  /** Cannot be hidden in the column configurator. */
  alwaysVisible?: boolean
  defaultVisible?: boolean
  configureLabel?: string
  configureHint?: string
  csv?: (row: T) => CsvValue
  csvHeader?: string
}

export type SmartTableError =
  | Error
  | string
  | { title?: string; description?: string; onRetry?: () => void }
  | null

export type TableDensity = 'compact' | 'normal' | 'roomy'

export interface SmartTableProps<T> {
  columns: readonly SmartColumn<T>[]
  rows: readonly T[]
  /** A field name, or a function. Falls back to the row index. */
  rowKey?: string | ((row: T, index: number) => string | number)

  onRowClick?: (row: T, index: number) => void
  onRowDoubleClick?: (row: T, index: number) => void
  /** Click / Enter / double-click, routed through keyboard navigation. */
  onRowActivate?: (row: T, index: number) => void
  onRowQuickAction?: (row: T, index: number) => void
  isRowActivatable?: (row: T) => boolean
  /**
   * Open the row on a single click as well as on Enter / double-click.
   *
   * Off by default, which is the register behaviour: one click selects, Enter
   * opens. List screens that have always opened on a single click pass true so
   * the habit is preserved.
   */
  activateOnSingleClick?: boolean
  keyboardNav?: boolean
  /** Change to send focus back to the first row (page, filters, sort). */
  keyboardResetKey?: ResetKey
  searchInputRef?: RefObject<HTMLInputElement | null>

  loading?: boolean
  error?: SmartTableError
  empty?: ReactNode
  footer?: ReactNode
  caption?: string
  /** Raw `<tr>` rows for the table foot. Ignored when `totals` is given. */
  tfoot?: ReactNode

  /** Pinned tfoot row keyed by column key — pass server totals, not page sums. */
  totals?: Record<string, ReactNode> | ((col: SmartColumn<T>) => ReactNode)

  /**
   * In-table grouping: which group a row belongs to, and what to call it.
   *
   * The rows must already be ordered so that a group's rows are adjacent — the
   * table groups what it is given, it does not re-sort behind the caller's back
   * and quietly undo the sort column the reader picked.
   */
  rowGroup?: (row: T, index: number) => { key: string; label: string } | null
  /** Subtotal cells for one group, keyed by column key. Omit for headers only. */
  groupSubtotal?: (rows: readonly T[], group: { key: string; label: string }) => Record<string, ReactNode>

  size?: 'xs' | 'sm'
  density?: TableDensity
  hover?: boolean
  striped?: boolean
  stickyHeader?: boolean
  scrollBody?: boolean
  fillAvailable?: boolean
  minWidth?: number
  className?: string
  cardPadding?: CardPadding
  rowClassName?: (row: T, index: number) => string | undefined
  getRowDomId?: (row: T, index: number) => string | undefined

  /** Server sort state; pair with `sortKey` on the columns. */
  sort?: { key: string; order: SortOrder }
  onSort?: (key: string) => void
}

const DENSITY_PAD: Record<TableDensity, string> = {
  compact: 'px-2.5 py-1.5',
  normal: 'px-3 py-2',
  roomy: 'px-4 py-3',
}

function alignCls(align: SmartColumn<unknown>['align']): string {
  if (align === 'right') return 'text-right'
  if (align === 'center') return 'text-center'
  return 'text-left'
}

function resolveRowKey<T>(
  row: T,
  index: number,
  rowKey: SmartTableProps<T>['rowKey'],
): string | number {
  if (typeof rowKey === 'function') return rowKey(row, index)
  if (typeof rowKey === 'string') {
    const value = (row as Record<string, unknown>)[rowKey]
    if (typeof value === 'string' || typeof value === 'number') return value
  }
  return index
}

function cellValue<T>(row: T, col: SmartColumn<T>, index: number): ReactNode {
  if (typeof col.render === 'function') return col.render(row, index)
  if (typeof col.accessor === 'function') return col.accessor(row)
  const raw = (row as Record<string, unknown>)[col.key]
  if (raw == null) return null
  if (typeof raw === 'object') return JSON.stringify(raw)
  return String(raw)
}

export function SmartTable<T>({
  columns,
  rows,
  rowKey = 'id',
  onRowClick,
  onRowDoubleClick,
  onRowActivate,
  onRowQuickAction,
  isRowActivatable,
  activateOnSingleClick = false,
  keyboardNav,
  keyboardResetKey,
  searchInputRef,
  loading = false,
  error = null,
  empty,
  footer,
  caption,
  tfoot,
  totals,
  rowGroup,
  groupSubtotal,
  size = 'sm',
  density = 'compact',
  hover = true,
  striped = false,
  stickyHeader = false,
  scrollBody = false,
  fillAvailable = false,
  minWidth = 600,
  className,
  cardPadding = 'none',
  rowClassName,
  getRowDomId,
  sort,
  onSort,
}: SmartTableProps<T>) {
  const activateHandler = onRowActivate ?? onRowClick
  const navEnabled =
    keyboardNav === true || (keyboardNav !== false && typeof activateHandler === 'function')

  const { containerRef, getRowProps, activateAt } = useListKeyboardNav<T>({
    rows: navEnabled && !loading && !error ? rows : [],
    onActivate: activateHandler,
    onQuickAction: onRowQuickAction,
    isRowActivatable,
    resetKey: keyboardResetKey,
    searchInputRef,
    enabled: navEnabled && !loading && !error && rows.length > 0,
  })

  const padCls = DENSITY_PAD[density]
  const textCls = size === 'xs' ? 'text-xs' : 'text-sm'
  const stickyHeadCls =
    stickyHeader && scrollBody
      ? 'sticky top-0 z-10 bg-gray-50 shadow-[0_1px_0_0_rgb(var(--color-border))]'
      : ''

  const headerCells = useMemo(
    () =>
      columns.map((col) => {
        const sortable = Boolean(col.sortKey) && typeof onSort === 'function'
        const active = sortable && sort?.key === col.sortKey
        const SortIcon = active ? (sort?.order === 'desc' ? ArrowDown : ArrowUp) : ChevronsUpDown
        return (
          <th
            key={col.key}
            scope="col"
            style={col.width ? { width: col.width, minWidth: col.minWidth } : undefined}
            aria-sort={active ? (sort?.order === 'desc' ? 'descending' : 'ascending') : undefined}
            className={cx(
              padCls,
              'font-semibold text-label-sm uppercase tracking-wide text-gray-500',
              alignCls(col.align),
              col.align === 'right' && AMOUNT_HEADER_CLASS,
              col.headerClassName,
              stickyHeadCls,
            )}
          >
            {sortable ? (
              <button
                type="button"
                onClick={() => onSort?.(col.sortKey as string)}
                className={cx(
                  'inline-flex items-center gap-1 font-semibold uppercase tracking-wide transition-colors hover:text-primary focus:outline-none focus-visible:text-primary',
                  col.align === 'right' && 'flex-row-reverse',
                  active && 'text-primary',
                )}
              >
                <span>{col.header}</span>
                <SortIcon
                  className={cx('w-3 h-3 shrink-0', active ? 'opacity-100' : 'opacity-40')}
                  aria-hidden
                />
              </button>
            ) : (
              col.header
            )}
          </th>
        )
      }),
    [columns, padCls, stickyHeadCls, sort, onSort],
  )

  const bodyContent = (() => {
    if (loading && rows.length === 0) {
      return (
        <tr>
          <td colSpan={columns.length} className="px-3 py-6">
            <LoadingState variant="skeleton" rows={6} />
          </td>
        </tr>
      )
    }
    if (error) {
      const isObj = typeof error === 'object' && error !== null
      const asErr = error as { title?: string; description?: string; onRetry?: () => void }
      return (
        <tr>
          <td colSpan={columns.length} className="px-3 py-6">
            <ErrorState
              size="sm"
              title={
                typeof error === 'string'
                  ? error
                  : error instanceof Error
                    ? 'Unable to load'
                    : (asErr.title ?? 'Unable to load')
              }
              description={
                error instanceof Error ? error.message : isObj ? asErr.description : undefined
              }
              onRetry={isObj && !(error instanceof Error) ? asErr.onRetry : undefined}
            />
          </td>
        </tr>
      )
    }
    if (!rows.length) {
      return (
        <tr>
          <td colSpan={columns.length} className="px-3 py-6">
            {empty ?? <EmptyState size="sm" title="No rows" />}
          </td>
        </tr>
      )
    }
    const grouped: ReactNode[] = []
    let openGroup: { key: string; label: string } | null = null
    let openRows: T[] = []

    const closeGroup = () => {
      if (!openGroup || !groupSubtotal) return
      const cells = groupSubtotal(openRows, openGroup)
      grouped.push(
        <tr key={`grp-sub-${openGroup.key}`} className="border-t border-gray-200 bg-gray-50/70 font-semibold text-gray-800">
          {columns.map((col) => (
            <td
              key={`grp-sub-${openGroup?.key}-${col.key}`}
              className={cx(padCls, textCls, alignCls(col.align), col.align === 'right' && AMOUNT_CELL_CLASS)}
            >
              {cells[col.key] ?? ''}
            </td>
          ))}
        </tr>,
      )
    }

    const rowNodes = rows.map((row, rowIdx) => {
      const keyboardProps = navEnabled ? getRowProps(row, rowIdx) : {}
      const {
        ref: rowRef,
        className: keyboardCls,
        onClick: keyboardClick,
        onFocus: keyboardFocus,
        ...restKeyboardProps
      } = keyboardProps

      const legacyClickable = !navEnabled && typeof onRowClick === 'function'
      const legacyDblClickable = !navEnabled && typeof onRowDoubleClick === 'function'
      const activatable = navEnabled && typeof activateHandler === 'function'

      return (
        <tr
          key={resolveRowKey(row, rowIdx, rowKey)}
          id={getRowDomId?.(row, rowIdx)}
          ref={rowRef}
          {...restKeyboardProps}
          onClick={
            navEnabled
              ? (e) => {
                  keyboardClick?.(e)
                  if (activateOnSingleClick) activateAt(rowIdx)
                }
              : legacyClickable
                ? () => onRowClick?.(row, rowIdx)
                : undefined
          }
          onFocus={keyboardFocus}
          onDoubleClick={
            activatable
              ? () => activateAt(rowIdx)
              : legacyDblClickable
                ? () => onRowDoubleClick?.(row, rowIdx)
                : undefined
          }
          className={cx(
            rowIdx > 0 && 'border-t border-gray-100',
            striped && rowIdx % 2 === 1 && 'bg-gray-50/40',
            (legacyClickable || legacyDblClickable || activatable) && 'cursor-pointer',
            hover && !keyboardCls ? TABLE_ROW_HOVER : hover ? 'transition-colors' : '',
            keyboardCls,
            rowClassName?.(row, rowIdx),
          )}
        >
          {columns.map((col) => {
            const value = cellValue(row, col, rowIdx)
            return (
              <td
                key={col.key}
                className={cx(
                  padCls,
                  textCls,
                  'text-gray-700',
                  alignCls(col.align),
                  col.align === 'right' && AMOUNT_CELL_CLASS,
                  col.cellClassName,
                )}
              >
                {value == null || value === '' ? <span className="text-gray-300">—</span> : value}
              </td>
            )
          })}
        </tr>
      )
    })

    if (!rowGroup) return rowNodes

    rows.forEach((row, rowIdx) => {
      const group = rowGroup(row, rowIdx)
      if (group && group.key !== openGroup?.key) {
        closeGroup()
        openGroup = group
        openRows = []
        grouped.push(
          <tr key={`grp-${group.key}`} className="bg-gray-100/80">
            <th
              scope="colgroup"
              colSpan={columns.length}
              className={cx(padCls, textCls, 'text-left font-semibold text-gray-700')}
            >
              {group.label}
            </th>
          </tr>,
        )
      }
      if (openGroup) openRows.push(row)
      grouped.push(rowNodes[rowIdx])
    })
    closeGroup()

    return grouped
  })()

  const tableFoot = !totals && tfoot ? (
    <tfoot>{tfoot}</tfoot>
  ) : totals ? (
    <tfoot>
      <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-900">
        {columns.map((col) => {
          const value = typeof totals === 'function' ? totals(col) : totals[col.key]
          return (
            <td
              key={`tot-${col.key}`}
              className={cx(
                padCls,
                textCls,
                alignCls(col.align),
                col.align === 'right' && AMOUNT_CELL_CLASS,
                scrollBody &&
                  'sticky bottom-0 z-10 bg-gray-50 shadow-[0_-1px_0_0_rgb(var(--color-border))]',
              )}
            >
              {value ?? ''}
            </td>
          )
        })}
      </tr>
    </tfoot>
  ) : null

  return (
    <Card
      padding={cardPadding}
      className={cx(
        fillAvailable && 'flex flex-col min-h-0 h-full overflow-hidden',
        scrollBody && !fillAvailable && 'flex flex-col overflow-hidden',
        className,
      )}
    >
      <div
        ref={navEnabled ? containerRef : undefined}
        className={cx(
          'scrollbar-thin',
          scrollBody ? 'overflow-auto flex-1 min-h-0' : 'overflow-x-auto',
        )}
        tabIndex={navEnabled ? -1 : undefined}
      >
        <table
          className={cx('w-full border-separate border-spacing-0 text-gray-700', textCls)}
          style={{ minWidth }}
          aria-busy={loading || undefined}
        >
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead
            className={cx('bg-gray-50', stickyHeader && !scrollBody && 'sticky top-0 z-10')}
          >
            <tr>{headerCells}</tr>
          </thead>
          <tbody className={cx(loading && rows.length > 0 && 'opacity-60 transition-opacity')}>
            {bodyContent}
          </tbody>
          {tableFoot}
        </table>
      </div>
      {footer ? (
        <div className="border-t border-gray-100 px-3 py-2 shrink-0">{footer}</div>
      ) : null}
    </Card>
  )
}

export default SmartTable
