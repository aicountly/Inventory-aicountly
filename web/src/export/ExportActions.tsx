import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Download, FileSpreadsheet, FileText, Printer, RefreshCw, Table2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { errorMessage } from '../services/api'
import type { FetchAllResult } from '../services/listAll'
import { formatInt } from '../utils/format'
import type { ExportableColumn } from '../registers/registerCells'
import { notify } from '../ui/notify'
import type { ExportFormat, TabularExportRequest } from './exportActions'
import { runTabularExport } from './exportActions'
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
 */

export interface ExportActionsProps<T> {
  /** The visible columns — exactly what the table renders. */
  columns: readonly ExportableColumn<T>[]
  /** Rows on screen; used when `fetchAll` is not supplied. */
  rows: readonly T[]
  /** Walks every page so the file holds the whole result. */
  fetchAll?: () => Promise<FetchAllResult<T>>
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
  footerNotes?: readonly string[]
  orientation?: Orientation
  generatedAt?: string
  onRefresh?: () => void
  refreshing?: boolean
  disabled?: boolean
  /** Hide formats a screen cannot support. All four are on by default. */
  formats?: readonly ExportFormat[]
  size?: 'xs' | 'sm'
}

const ALL_FORMATS: readonly ExportFormat[] = ['csv', 'excel', 'pdf', 'print']

export function ExportActions<T>({
  columns,
  rows,
  fetchAll,
  filename,
  identity,
  title,
  description,
  metaLines,
  summaryCards,
  totalsText,
  totalsLabel,
  footerNotes,
  orientation = 'landscape',
  generatedAt,
  onRefresh,
  refreshing = false,
  disabled = false,
  formats = ALL_FORMATS,
  size = 'xs',
}: ExportActionsProps<T>) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return undefined
    const onDocClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const run = async (format: ExportFormat) => {
    setOpen(false)
    setBusy(format)
    try {
      const result: FetchAllResult<T> = fetchAll
        ? await fetchAll()
        : { rows: [...rows], total: rows.length, truncated: false }

      const warningNote = result.truncated
        ? `Only the first ${formatInt(result.rows.length)} rows are included — narrow the filters for the rest.`
        : undefined

      const request: TabularExportRequest<T> = {
        columns,
        rows: result.rows,
        identity,
        title,
        description,
        metaLines: [...(metaLines ?? []), `Rows: ${formatInt(result.rows.length)}`],
        summaryCards,
        totalsText,
        totalsLabel,
        footerNotes,
        warningNote,
        orientation,
        filenameBase: filename,
        generatedAt,
      }
      await runTabularExport(format, request)
    } catch (err) {
      notify.error(errorMessage(err, 'Export failed.'))
    } finally {
      setBusy(null)
    }
  }

  const enabled = (format: ExportFormat) => formats.includes(format)
  const menuFormats = (['csv', 'excel', 'pdf'] as const).filter(enabled)
  const anyBusy = busy !== null

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
        <div className="relative" ref={menuRef}>
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
          {open ? (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-1 min-w-[196px] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-overlay"
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
          ) : null}
        </div>
      ) : null}

      {enabled('print') ? (
        <Button
          variant="secondary"
          size={size}
          icon={Printer}
          onClick={() => void run('print')}
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
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-primary-light/50"
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
