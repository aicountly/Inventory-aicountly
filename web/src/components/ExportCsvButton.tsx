import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '../ui/Button'
import { useToast } from '../ui/ToastContext'
import { errorMessage } from '../services/api'
import { partialFilename, truncationNote } from '../export/exportActions'
import type { FetchAllResult } from '../services/listAll'
import { downloadCsv, toCsv } from '../utils/csv'
import type { CsvColumn } from '../utils/csv'
import { formatInt } from '../utils/format'

/**
 * The plain CSV button, on the screens that still use it.
 *
 * It is NOT `ExportActions` — there is no letterhead, no Excel, no PDF — but it
 * owes the reader the one property that matters most: a file that came up short
 * of the filters must say so. `fetchAllRows` reports THREE things, and
 * `truncated` alone is not enough:
 *
 *   - `truncated` is true when the walk hit its 10,000-row cap;
 *   - `total` is the server's count for the same filters, and can exceed the
 *     rows returned with `truncated` false — an endpoint that clamps the
 *     requested limit makes `services/listAll.ts` exit on the short page.
 *
 * Reading only `truncated` is how a 200-row CSV of a 4,182-row filter goes out
 * as a plain success. So both are checked, and a short file is named for what
 * it is (`…-partial-200-of-4182.csv`), because the name is the only part of a
 * CSV that can carry the warning: a sentence inside it would land in the data
 * as a row, and a toast is gone in a few seconds.
 */
interface ExportCsvButtonProps<T> {
  /** Full filename including `.csv` — see `utils/csv.csvFilename`. */
  filename: string
  columns: readonly CsvColumn<T>[]
  /** Rows currently on screen; exported when `fetchAll` is not given. */
  rows: readonly T[]
  /** Walks every page (see services/listAll) so the file holds the whole result. */
  fetchAll?: () => Promise<FetchAllResult<T>>
  disabled?: boolean
  label?: string
}

/** `report-acme-2026-09-15.csv` → `report-acme-2026-09-15-partial-200-of-4182.csv`. */
function markShort(filename: string, exported: number, total: number): string {
  const stem = filename.replace(/\.csv$/i, '')
  return `${partialFilename(stem, exported, total)}.csv`
}

/** Builds the CSV in the browser from the rows the API already served. */
export function ExportCsvButton<T>({ filename, columns, rows, fetchAll, disabled, label = 'Export CSV' }: ExportCsvButtonProps<T>) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const result: FetchAllResult<T> = fetchAll
        ? await fetchAll()
        : { rows: [...rows], total: rows.length, truncated: false }
      const exported = result.rows.length
      if (exported === 0) {
        toast.info('Nothing to export.')
        return
      }

      const total = Math.max(result.total ?? 0, exported)
      const short = result.truncated || total > exported
      const name = short ? markShort(filename, exported, total) : filename

      downloadCsv(name, toCsv(result.rows, columns))

      if (short) {
        toast.info(`${truncationNote(exported, total)} Saved as ${name}.`)
      } else {
        toast.success(`Exported ${formatInt(exported)} rows.`)
      }
    } catch (err) {
      toast.error(errorMessage(err, 'Export failed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="secondary"
      size="xs"
      icon={Download}
      loading={busy}
      onClick={() => void run()}
      disabled={disabled}
    >
      {busy ? 'Exporting…' : label}
    </Button>
  )
}
