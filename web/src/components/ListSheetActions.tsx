import { useRef } from 'react'
import type { RefObject } from 'react'
import { useCompany } from '../company/CompanyContext'
import { ExportActions } from '../export/ExportActions'
import { slugifyExportFilename } from '../export/exportActions'
import { useExportIdentity } from '../export/useExportIdentity'
import type { ExportFormat } from '../export/exportActions'
import type { Orientation, SheetSummaryCard } from '../export/sheetHtml'
import { usePageKeyboard } from '../keyboard/usePageKeyboard'
import type { ExportableColumn } from '../registers/registerCells'
import type { FetchAllResult } from '../services/listAll'
import { todayIso } from '../utils/format'

/**
 * The register's four exports — CSV, Excel, PDF, letterheaded print — mounted
 * on a classic list screen.
 *
 * `reports/ReportPage` has had all four since the register engine landed;
 * every other list in Inventory had either `ExportCsvButton` or nothing, so a
 * user who learned the Books workflow on one screen lost it on the next. This
 * is that mounting, packaged, so a list page adds the whole set in one element
 * and cannot get half of it:
 *
 *  - the letterhead (company, registered office, GSTIN, logo, scope) comes from
 *    `useExportIdentity`, never assembled by the caller;
 *  - `fetchAll` walks the WHOLE filtered result — a file whose footer counts
 *    4,182 rows must not hold the 100 that were on screen;
 *  - Ctrl+P prints the sheet, not the app's DOM. `printRef` is filled by
 *    ExportActions during render and read through the same guard as the button,
 *    so the key and the button never disagree.
 *
 * It does not own the figures: a screen with a server summary passes it as
 * `summaryCards` / `totalsText` so the paper carries the numbers the screen
 * showed, and a screen with none passes nothing rather than inventing a total.
 */
export interface ListSheetActionsProps<T> {
  /** The columns the sheet writes — the table's, in the table's order. */
  columns: readonly ExportableColumn<T>[]
  /** Rows on screen; only used if `fetchAll` is absent. */
  rows: readonly T[]
  /** Walks every page so the export holds the whole filtered result. */
  fetchAll?: () => Promise<FetchAllResult<T>>
  /** Filename stem, before the company and the date. */
  filenameBase: string
  title: string
  description?: string
  /** Period, filters, method — what the reader needs to read the figures. */
  metaLines?: readonly string[]
  /** Only figures a server computed. Never a page-scoped guess. */
  summaryCards?: readonly SheetSummaryCard[]
  totalsText?: readonly string[] | null
  totalsLabel?: string
  footerNotes?: readonly string[]
  orientation?: Orientation
  formats?: readonly ExportFormat[]
  onRefresh?: () => void
  refreshing?: boolean
  disabled?: boolean
  /** `/` focuses this box, the way it does on every register. */
  searchInputRef?: RefObject<HTMLInputElement | null>
  /**
   * Ctrl+N creates a record, where the screen has a create action.
   *
   * It is registered HERE rather than by the page, because this component
   * already owns the page keyboard scope; a second `usePageKeyboard` on the
   * same screen would replace these bindings and silently take `/`, Ctrl+R and
   * Ctrl+P away with it.
   */
  onNew?: () => void
  /** Scope period for the letterhead (`as at`, `for the year`…). */
  scopePeriod?: string
}

export function ListSheetActions<T>({
  columns,
  rows,
  fetchAll,
  filenameBase,
  title,
  description,
  metaLines,
  summaryCards,
  totalsText,
  totalsLabel,
  footerNotes,
  orientation = 'landscape',
  formats,
  onRefresh,
  refreshing,
  disabled,
  searchInputRef,
  onNew,
  scopePeriod,
}: ListSheetActionsProps<T>) {
  const { companyName } = useCompany()
  const identity = useExportIdentity(scopePeriod)
  const printRef = useRef<(() => void) | null>(null)
  usePageKeyboard({ searchInputRef, onRefresh, onPrint: () => printRef.current?.(), onNew })

  return (
    <ExportActions<T>
      columns={columns}
      rows={rows}
      fetchAll={fetchAll}
      filename={slugifyExportFilename([filenameBase, companyName, todayIso()])}
      identity={identity}
      title={title}
      description={description}
      metaLines={metaLines}
      summaryCards={summaryCards}
      totalsText={totalsText}
      totalsLabel={totalsLabel}
      footerNotes={footerNotes}
      orientation={orientation}
      formats={formats}
      onRefresh={onRefresh}
      refreshing={refreshing}
      disabled={disabled}
      printRef={printRef}
    />
  )
}

export default ListSheetActions
