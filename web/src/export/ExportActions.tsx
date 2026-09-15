import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Download, FileSpreadsheet, FileText, Printer, RefreshCw, Table2 } from 'lucide-react'
import { Button } from '../ui/Button'
import type { FetchAllResult } from '../services/listAll'
import { formatGeneratedStamp } from '../utils/format'
import type { ExportableColumn } from '../registers/registerCells'
import { notify } from '../ui/notify'
import type { ExportFormat, TabularExportRequest } from './exportActions'
import { exportErrorMessage, rowCountMetaLine, runTabularExport, truncationNote } from './exportActions'
import type { Orientation, SheetIdentity, SheetSummaryCard } from './sheetHtml'

/**
 * Export and print for a register.
 *
 * CSV is first in the menu on purpose: it is the export Inventory already had,
 * it is formula-injection guarded, and nobody should have to hunt for it after
 * an upgrade. Excel and PDF sit beneath it, and Print is its own button because
 * it is the one action with no file at the end of it.
 *
 * Every action walks the **whole filtered result** through `fetchAll`, not the
 * page on screen. A register exported from page 1 of 17 whose footer says
 * "Total (4,182 movements)" would be a document that contradicts itself.
 *
 * When it cannot — the pager capped, or the screen has no pager and told us the
 * server's count through `totalRows` — the file says so in its own words: the
 * row pill reads "Rows: 10,000 of 12,431" and a partial-export note goes on the
 * sheet, into the PDF, into the spreadsheet and into the CSV's toast. A short
 * file that says nothing reads as the whole set, and that is the one outcome
 * this component may not produce. A pager that *fails* aborts the export
 * outright; there is no quiet fall back to the rows on screen.
 *
 * The menu is portalled to `document.body` and positioned against the viewport
 * rather than the toolbar, so it cannot be clipped by an ancestor's `overflow`
 * (the register shell is `tall:overflow-hidden`) and cannot run off the left
 * edge of a phone once the toolbar wraps.
 */

/** Figures re-derived over the rows an export actually writes. */
export interface ExportRowScopedFigures {
  summaryCards?: readonly SheetSummaryCard[]
  totalsText?: readonly string[] | null
}

export interface ExportActionsProps<T> {
  /** The visible columns — exactly what the table renders. */
  columns: readonly ExportableColumn<T>[]
  /** Rows on screen; used when `fetchAll` is not supplied. */
  rows: readonly T[]
  /** Walks every page so the file holds the whole result. */
  fetchAll?: () => Promise<FetchAllResult<T>>
  /**
   * The server's row count for the current filters.
   *
   * Only needed by a screen that exports `rows` with no `fetchAll`: without it
   * such a screen cannot know that it wrote one page of seventeen, and the file
   * goes out reading as the whole set. Supply it and the sheet says
   * "Rows: 100 of 4,182" and carries the partial-export note. A screen with a
   * real `fetchAll` leaves it out — the pager reports the count itself.
   */
  totalRows?: number
  /** Filename stem, without the extension. */
  filename: string
  identity: SheetIdentity
  title: string
  description?: string
  metaLines?: readonly string[]
  summaryCards?: readonly SheetSummaryCard[]
  /** Totals as text, in column order — the server's, not the page's. */
  totalsText?: readonly string[] | null
  totalsLabel?: string
  /**
   * Re-derive the summary and the totals over the rows the export writes.
   *
   * A register whose figures are the served page (configs/pageSummary.ts) must
   * total the whole export, or the sheet carries 10,000 rows under a footer
   * that speaks for 100 and still says "this page only". Registers backed by a
   * real server aggregate leave this out; their figures already cover the set.
   */
  forExportedRows?: (rows: readonly T[]) => ExportRowScopedFigures
  footerNotes?: readonly string[]
  orientation?: Orientation
  /** Defaults to the local clock at the moment the export runs. */
  generatedAt?: string
  onRefresh?: () => void
  refreshing?: boolean
  disabled?: boolean
  /** Hide formats a screen cannot support. All four are on by default. */
  formats?: readonly ExportFormat[]
  size?: 'xs' | 'sm'
  /**
   * Filled with the print action so the page can bind Ctrl+P to the sheet.
   * Without it the browser prints the app's own DOM — the on-screen page of
   * rows, no letterhead, no totals — which is the failure the sheet builder
   * exists to prevent.
   */
  printRef?: RefObject<(() => void) | null>
}

const ALL_FORMATS: readonly ExportFormat[] = ['csv', 'excel', 'pdf', 'print']

const MENU_WIDTH = 208
const MENU_GAP = 4
const VIEWPORT_MARGIN = 8

interface MenuStyle {
  top: number
  left: number
  width: number
}

/**
 * Anchor the menu to the viewport: flip it above the trigger when there is no
 * room below, and clamp it inside both edges. Books' VoucherExportMenu does the
 * same, and for the same reason — at ~400px the Export button sits near the
 * left edge and a right-aligned menu would hang off the screen.
 */
function computeMenuStyle(anchor: HTMLElement | null, menuHeight: number): MenuStyle | null {
  if (!anchor) return null
  const rect = anchor.getBoundingClientRect()
  const openUpward = window.innerHeight - rect.bottom < menuHeight + MENU_GAP + VIEWPORT_MARGIN
  const top = openUpward ? rect.top - menuHeight - MENU_GAP : rect.bottom + MENU_GAP
  return {
    top: Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - menuHeight - VIEWPORT_MARGIN)),
    left: Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN),
    ),
    width: MENU_WIDTH,
  }
}

export function ExportActions<T>({
  columns,
  rows,
  fetchAll,
  totalRows,
  filename,
  identity,
  title,
  description,
  metaLines,
  summaryCards,
  totalsText,
  totalsLabel,
  forExportedRows,
  footerNotes,
  orientation = 'landscape',
  generatedAt,
  onRefresh,
  refreshing = false,
  disabled = false,
  formats = ALL_FORMATS,
  size = 'xs',
  printRef,
}: ExportActionsProps<T>) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<MenuStyle | null>(null)
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null)
      return undefined
    }
    const update = () => {
      setMenuStyle(computeMenuStyle(anchorRef.current, menuRef.current?.offsetHeight || 132))
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  // A menu that announces itself as a menu owes the reader the keyboard
  // contract that goes with it: focus lands inside on open, arrows move within
  // it, and Escape puts focus back where it came from.
  const items = useCallback(
    (): HTMLButtonElement[] =>
      Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    [],
  )

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) anchorRef.current?.querySelector('button')?.focus()
  }, [])

  useEffect(() => {
    if (!open) return undefined
    items()[0]?.focus()
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      const all = items()
      if (event.key === 'Escape') {
        event.preventDefault()
        close(true)
        return
      }
      if (event.key === 'Tab') {
        close(false)
        return
      }
      const index = all.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (!all.length) return
        const step = event.key === 'ArrowDown' ? 1 : -1
        all[(index + step + all.length) % all.length].focus()
      } else if (event.key === 'Home') {
        event.preventDefault()
        all[0]?.focus()
      } else if (event.key === 'End') {
        event.preventDefault()
        all[all.length - 1]?.focus()
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, items, close])

  const run = async (format: ExportFormat) => {
    setOpen(false)
    setBusy(format)
    try {
      // A pager that rejects must abort the export. Falling back to the rows on
      // screen here would hand the reader a one-page file that looks like the
      // whole register and says nothing about the request that failed.
      const result: FetchAllResult<T> = fetchAll
        ? await fetchAll()
        : { rows: [...rows], total: totalRows ?? rows.length, truncated: false }

      if (!result || !Array.isArray(result.rows)) {
        throw new Error('The full result set could not be read, so nothing was exported.')
      }

      const exported = result.rows.length
      // Two ways to come up short, and both have to speak: the pager saying it
      // capped, and a row count below the server's own total for these filters
      // (a pager that stopped early, a screen exporting the page it holds).
      const total = Math.max(result.total ?? 0, exported)
      const short = result.truncated || total > exported
      const warningNote = short ? truncationNote(exported, total) : undefined

      const scoped = forExportedRows?.(result.rows)

      const request: TabularExportRequest<T> = {
        columns,
        rows: result.rows,
        identity,
        title,
        description,
        metaLines: [...(metaLines ?? []), rowCountMetaLine(exported, total)],
        summaryCards: scoped?.summaryCards ?? summaryCards,
        totalsText: scoped ? scoped.totalsText : totalsText,
        totalsLabel,
        footerNotes,
        warningNote,
        orientation,
        filenameBase: filename,
        generatedAt: generatedAt ?? formatGeneratedStamp(),
      }
      await runTabularExport(format, request)
    } catch (err) {
      notify.error(exportErrorMessage(err, 'Export failed.'))
    } finally {
      setBusy(null)
    }
  }

  const enabled = (format: ExportFormat) => formats.includes(format)
  const menuFormats = (['csv', 'excel', 'pdf'] as const).filter(enabled)
  const anyBusy = busy !== null

  // Deliberately not memoised: `run` closes over every prop the sheet is built
  // from, so the handle the page holds has to be this render's. It honours the
  // same guard as the button, so Ctrl+P and the button never disagree.
  const runPrint = () => {
    if (disabled || anyBusy || !enabled('print')) return
    void run('print')
  }
  if (printRef) printRef.current = runPrint

  const menu = open ? (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Export ${title}`}
      className="fixed z-50 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-overlay print:hidden"
      style={
        menuStyle
          ? { top: menuStyle.top, left: menuStyle.left, width: menuStyle.width }
          : { top: -9999, left: -9999, width: MENU_WIDTH }
      }
    >
      {enabled('csv') ? (
        <MenuItem
          icon={<Table2 className="h-4 w-4 text-sky-600" />}
          label="CSV (.csv)"
          hint="Raw values"
          onClick={() => void run('csv')}
        />
      ) : null}
      {enabled('excel') ? (
        <MenuItem
          icon={<FileSpreadsheet className="h-4 w-4 text-emerald-600" />}
          label="Excel (.xlsx)"
          hint="Formatted, with totals"
          onClick={() => void run('excel')}
        />
      ) : null}
      {enabled('pdf') ? (
        <MenuItem
          icon={<FileText className="h-4 w-4 text-red-600" />}
          label="PDF (.pdf)"
          hint="Letterhead, paginated"
          onClick={() => void run('pdf')}
        />
      ) : null}
    </div>
  ) : null

  return (
    <div className="flex flex-wrap items-center gap-1.5 print:hidden">
      {onRefresh ? (
        <Button
          variant="ghost"
          size={size}
          icon={RefreshCw}
          onClick={onRefresh}
          loading={refreshing}
          title="Refresh (Ctrl+R)"
        >
          Refresh
        </Button>
      ) : null}

      {menuFormats.length ? (
        <div className="relative" ref={anchorRef}>
          <Button
            variant="secondary"
            size={size}
            icon={Download}
            onClick={() => setOpen((v) => !v)}
            loading={anyBusy && busy !== 'print'}
            disabled={disabled || anyBusy}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            Export
          </Button>
          {menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : null}
        </div>
      ) : null}

      {enabled('print') ? (
        <Button
          variant="secondary"
          size={size}
          icon={Printer}
          onClick={runPrint}
          loading={busy === 'print'}
          disabled={disabled || anyBusy}
          title="Print the register (Ctrl+P)"
        >
          Print
        </Button>
      ) : null}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: ReactNode
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-primary-light/50 focus-visible:bg-primary-light/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      onClick={onClick}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-gray-800">{label}</span>
        <span className="block text-label-xs text-gray-500">{hint}</span>
      </span>
    </button>
  )
}

export default ExportActions
