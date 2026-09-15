/**
 * The four things a user can do with a register: CSV, Excel, PDF, Print.
 *
 * Each builds the same payload from the same visible column list, so the file
 * a reader opens holds the columns they were looking at, in the order they were
 * in, with the totals that were under them. The functions here own the
 * user-facing outcome — the "nothing to export" guard, the success toast, the
 * error message — so the button components stay presentational.
 */

import type { ExportableColumn } from '../registers/registerCells'
import { toCsvColumns } from '../registers/registerCells'
import { downloadCsv, toCsv } from '../utils/csv'
import { formatInt } from '../utils/format'
import { notify } from '../ui/notify'
import { toExportColumns, toExportRows, toExportTotals } from './exportColumns'
import type { SheetIdentity, SheetSummaryCard, Orientation, PaperSize } from './sheetHtml'
import type { TabularExportPayload } from './documentExport'
import { exportTabularExcel, exportTabularPdf, printTabular } from './documentExport'
import { getExportTheme } from './exportTheme'

const CHUNK_LOAD = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk/i

/**
 * jsPDF and xlsx are loaded on demand, so a stale index after a deploy fails
 * with an import error that means nothing to a user. Name the remedy instead.
 */
export function exportErrorMessage(err: unknown, fallback: string): string {
  // Anything that is not an Error or a string has no message worth showing —
  // `String({})` is "[object Object]", which tells a reader nothing and hides
  // the fallback that would have.
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  if (CHUNK_LOAD.test(message)) {
    return 'Export libraries could not load. Please refresh the page and try again.'
  }
  return message || fallback
}

/** `stock-movement-register-acme-2026-09-14` — no extension. */
export function slugifyExportFilename(parts: readonly (string | number | null | undefined)[]): string {
  return (
    parts
      .filter((p) => p !== null && p !== undefined && p !== '')
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'export'
  )
}

export type ExportFormat = 'csv' | 'excel' | 'pdf' | 'print'

/**
 * What a short export says about itself.
 *
 * A file that holds 10,000 of 12,431 rows and says nothing reads as the whole
 * set — the reader sums a column and files the figure. So the note states both
 * counts and the difference between them, in the same words on the printed
 * sheet, in the PDF, in the spreadsheet and in the CSV toast.
 *
 * `total` is the server's count for the same filters. When it is unknown (0, or
 * not larger than what came back) the note still says the export is partial; it
 * just cannot say by how much, and it never guesses a number.
 */
export function truncationNote(exported: number, total: number): string {
  const dropped = Math.max(total - exported, 0)
  const remedy = 'Narrow the filters and export again for the rest.'
  if (dropped > 0) {
    return `Partial export — ${formatInt(exported)} of the ${formatInt(total)} rows matching these filters are included; ${formatInt(dropped)} are not. ${remedy}`
  }
  return `Partial export — only the first ${formatInt(exported)} rows are included. ${remedy}`
}

/** `Rows: 10,000 of 12,431` when the export is short, `Rows: 412` when it is not. */
export function rowCountMetaLine(exported: number, total: number): string {
  return total > exported
    ? `Rows: ${formatInt(exported)} of ${formatInt(total)}`
    : `Rows: ${formatInt(exported)}`
}

export interface TabularExportRequest<T> {
  /** The visible columns — the same list the table renders. */
  columns: readonly ExportableColumn<T>[]
  /** The rows to write. Callers pass the whole filtered result, not the page. */
  rows: readonly T[]
  identity: SheetIdentity
  title: string
  description?: string
  metaLines?: readonly string[]
  summaryCards?: readonly SheetSummaryCard[]
  /** Totals as text, in column order — from `totalsRowToText`. */
  totalsText?: readonly string[] | null
  totalsLabel?: string
  footerNotes?: readonly string[]
  warningNote?: string
  orientation?: Orientation
  paperSize?: PaperSize
  /** Basis for the filename, before the date and extension. */
  filenameBase: string
  generatedAt?: string
}

/** Everything the Excel / PDF / print writers need, built once. */
export function buildTabularPayload<T>(request: TabularExportRequest<T>): TabularExportPayload {
  const columns = toExportColumns(request.columns)
  const rows = toExportRows(request.rows, request.columns)
  const totalsRow = toExportTotals(columns, request.totalsText)
  return {
    ...request.identity,
    title: request.title,
    description: request.description,
    metaLines: request.metaLines,
    summaryCards: request.summaryCards,
    columns,
    rows,
    totalsRow,
    totalsLabel: request.totalsLabel,
    footerNotes: request.footerNotes,
    warningNote: request.warningNote,
    orientation: request.orientation ?? 'landscape',
    paperSize: request.paperSize ?? 'A4',
    generatedAt: request.generatedAt,
    theme: getExportTheme(),
    filenameBase: request.filenameBase,
    sheetName: request.title,
    // Signature lines belong on paper. A spreadsheet keeps only the notes that
    // describe the data — a truncation warning changes what the figures mean.
    excelNotes: [
      ...(request.warningNote ? [request.warningNote] : []),
      ...(request.footerNotes ?? []),
    ],
  }
}

function guard(count: number, verb: string): boolean {
  if (count > 0) return true
  notify.info(`Nothing to ${verb}.`)
  return false
}

export async function exportRegisterCsv<T>(request: TabularExportRequest<T>): Promise<void> {
  if (!guard(request.rows.length, 'export')) return
  try {
    downloadCsv(
      `${request.filenameBase}.csv`,
      toCsv(request.rows, toCsvColumns(request.columns)),
    )
    // A CSV has nowhere to carry a note — a trailing sentence would land in the
    // data as a row. So the truncation is said in the toast instead, and the
    // toast stops calling a partial file a success.
    if (request.warningNote) {
      notify.info(`Exported ${formatInt(request.rows.length)} rows to CSV. ${request.warningNote}`)
    } else {
      notify.success(`Exported ${formatInt(request.rows.length)} rows to CSV.`)
    }
  } catch (err) {
    notify.error(exportErrorMessage(err, 'CSV export failed.'))
  }
}

export async function exportRegisterExcel<T>(request: TabularExportRequest<T>): Promise<void> {
  if (!guard(request.rows.length, 'export')) return
  try {
    await exportTabularExcel(buildTabularPayload(request))
    notify.success(`${request.title} exported to Excel.`)
  } catch (err) {
    notify.error(exportErrorMessage(err, 'Excel export failed.'))
  }
}

export async function exportRegisterPdf<T>(request: TabularExportRequest<T>): Promise<void> {
  if (!guard(request.rows.length, 'export')) return
  try {
    await exportTabularPdf(buildTabularPayload(request))
    notify.success(`${request.title} exported to PDF.`)
  } catch (err) {
    notify.error(exportErrorMessage(err, 'PDF export failed.'))
  }
}

export function printRegisterSheet<T>(request: TabularExportRequest<T>): boolean {
  // An empty register still prints: "no rows match these filters" on headed
  // paper is a valid answer to an auditor, and it is what Books does.
  const ok = printTabular(buildTabularPayload(request))
  if (!ok) notify.error('The print sheet could not be opened. Check the browser’s popup settings.')
  return ok
}

export async function runTabularExport<T>(
  format: ExportFormat,
  request: TabularExportRequest<T>,
): Promise<void> {
  switch (format) {
    case 'csv':
      return exportRegisterCsv(request)
    case 'excel':
      return exportRegisterExcel(request)
    case 'pdf':
      return exportRegisterPdf(request)
    case 'print':
      printRegisterSheet(request)
      return
  }
}
