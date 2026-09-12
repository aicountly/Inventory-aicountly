import { useState } from 'react'
import { useToast } from '../ui/ToastContext'
import { errorMessage } from '../services/api'
import { downloadCsv, toCsv } from '../utils/csv'
import type { CsvColumn } from '../utils/csv'
import { formatInt } from '../utils/format'

interface ExportCsvButtonProps<T> {
  filename: string
  columns: readonly CsvColumn<T>[]
  /** Rows currently on screen; exported when `fetchAll` is not given. */
  rows: readonly T[]
  /** Walks every page (see services/listAll) so the file holds the whole result. */
  fetchAll?: () => Promise<{ rows: T[]; truncated: boolean }>
  disabled?: boolean
  label?: string
}

/** Builds the CSV in the browser from the rows the API already served. */
export function ExportCsvButton<T>({ filename, columns, rows, fetchAll, disabled, label = 'Export CSV' }: ExportCsvButtonProps<T>) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const result = fetchAll ? await fetchAll() : { rows: [...rows], truncated: false }
      if (result.rows.length === 0) {
        toast.info('Nothing to export.')
        return
      }
      downloadCsv(filename, toCsv(result.rows, columns))
      toast.success(`Exported ${formatInt(result.rows.length)} rows${result.truncated ? ' (capped — narrow the filters for the rest)' : ''}.`)
    } catch (err) {
      toast.error(errorMessage(err, 'Export failed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className="btn btn-sm" onClick={() => void run()} disabled={disabled || busy}>
      {busy ? 'Exporting…' : label}
    </button>
  )
}
