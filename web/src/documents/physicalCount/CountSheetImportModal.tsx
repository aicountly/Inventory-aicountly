import { useCallback, useMemo, useRef, useState } from 'react'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { cx } from '../../ui/cx'
import { csvFilename, downloadCsv, toCsv } from '../../utils/csv'
import { formatInt, formatQty } from '../../utils/format'
import type { LineDraft } from '../formModel'
import type { CountRow } from './countModel'
import {
  IMPORT_TEMPLATE_HEADERS,
  matchCountSheet,
  parseCountSheet,
} from './countSheetImport'
import type { ImportPreview, MatchedRow } from './countSheetImport'

/**
 * Upload → parse → validate → preview → apply. Four steps, and the fourth is
 * not posting.
 *
 * The preview is the point of the whole dialog: a file from a handheld is the
 * least trustworthy input this screen takes, and every row it could not place
 * is listed with the reason rather than dropped. Applying writes counted
 * quantities into the sheet, where they are still editable and still have to be
 * posted by hand.
 */

const MAX_BYTES = 8 * 1024 * 1024

export interface CountSheetImportModalProps {
  open: boolean
  onClose: () => void
  rows: readonly CountRow[]
  lines: readonly LineDraft[]
  warehouseName: (id: number | null | undefined) => string
  onApply: (preview: ImportPreview) => void
  scopeLabel?: string
}

export function CountSheetImportModal({
  open,
  onClose,
  rows,
  lines,
  warehouseName,
  onApply,
  scopeLabel = '',
}: CountSheetImportModalProps) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setFileName(null)
    setError(null)
    setPreview(null)
    setDragging(false)
  }, [])

  const readFile = useCallback(
    async (file: File) => {
      reset()
      setFileName(file.name)
      if (file.size > MAX_BYTES) {
        setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Split counts above 8 MB into separate sheets.`)
        return
      }
      setBusy(true)
      try {
        const text = await file.text()
        const parsed = parseCountSheet(text)
        if (parsed.error) {
          setError(parsed.error)
          return
        }
        if (parsed.rows.length === 0) {
          setError('The file has a header row but no count rows.')
          return
        }
        setPreview(matchCountSheet(parsed.rows, lines, warehouseName))
      } catch {
        setError('That file could not be read as text. Export it as CSV or tab-separated and try again.')
      } finally {
        setBusy(false)
      }
    },
    [lines, warehouseName, reset],
  )

  const downloadTemplate = () => {
    const csvRows = rows.slice(0, 2000).map((row) => ({
      code: row.line.item_sku ?? '',
      name: row.line.item_name,
      warehouse: row.snapshot.warehouseName ?? warehouseName(row.line.warehouse_id) ?? '',
      batch: row.line.batch_no ?? '',
      serial: '',
      counted: '',
      uom: row.snapshot.unitSymbol ?? '',
    }))
    const csv = toCsv(csvRows, [
      { header: IMPORT_TEMPLATE_HEADERS[0], value: (r) => r.code },
      { header: IMPORT_TEMPLATE_HEADERS[1], value: (r) => r.name },
      { header: IMPORT_TEMPLATE_HEADERS[2], value: (r) => r.warehouse },
      { header: IMPORT_TEMPLATE_HEADERS[3], value: (r) => r.batch },
      { header: IMPORT_TEMPLATE_HEADERS[4], value: (r) => r.serial },
      { header: IMPORT_TEMPLATE_HEADERS[5], value: (r) => r.counted },
      { header: IMPORT_TEMPLATE_HEADERS[6], value: (r) => r.uom },
    ])
    downloadCsv(csvFilename('physical-count-sheet', scopeLabel), csv)
  }

  const grouped = useMemo(() => {
    if (!preview) return []
    const byProblem = new Map<string, MatchedRow[]>()
    for (const r of preview.rejected) {
      const key = r.problem ?? 'unknown'
      byProblem.set(key, [...(byProblem.get(key) ?? []), r])
    }
    return [...byProblem.entries()]
  }, [preview])

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Import count sheet"
      description="Counted quantities are read from the file. Book quantities stay as the system recorded them."
      size="lg"
      busy={busy}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="secondary" size="sm" icon={Download} onClick={downloadTemplate} disabled={rows.length === 0}>
            Download blank sheet
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                reset()
                onClose()
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!preview || preview.matched.length === 0}
              onClick={() => {
                if (!preview) return
                onApply(preview)
                reset()
                onClose()
              }}
            >
              Apply {preview ? formatInt(preview.matched.length) : ''} count
              {preview?.matched.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {lines.length === 0 ? (
          <Notice kind="warning">
            Load book quantities first. An import fills the Counted column of lines that are already on the sheet; it
            cannot create them.
          </Notice>
        ) : null}

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const file = e.dataTransfer.files?.[0]
            if (file) void readFile(file)
          }}
          className={cx(
            'rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
            dragging ? 'border-primary bg-primary-light/40' : 'border-gray-200 bg-gray-50',
          )}
        >
          <FileSpreadsheet className="mx-auto h-7 w-7 text-gray-400" aria-hidden />
          <p className="mt-2 text-sm font-medium text-gray-800">Drop the count sheet here</p>
          <p className="mt-0.5 text-xs text-gray-500">CSV, TSV or any delimited export from a handheld terminal.</p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void readFile(file)
              e.target.value = ''
            }}
          />
          <Button variant="secondary" size="sm" icon={Upload} className="mt-3" onClick={() => inputRef.current?.click()}>
            Browse file
          </Button>
          {fileName ? <p className="mt-2 text-[11px] text-gray-500">{fileName}</p> : null}
        </div>

        {error ? <Notice kind="error">{error}</Notice> : null}

        {preview ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-center">
                <div className="text-lg font-semibold tabular-nums text-emerald-600">
                  {formatInt(preview.matched.length)}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Rows matched</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-center">
                <div
                  className={cx(
                    'text-lg font-semibold tabular-nums',
                    preview.rejected.length ? 'text-red-600' : 'text-gray-400',
                  )}
                >
                  {formatInt(preview.rejected.length)}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Rows rejected</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-center">
                <div className="text-lg font-semibold tabular-nums text-gray-700">
                  {formatInt(preview.untouchedLines)}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Lines left uncounted</div>
              </div>
            </div>

            {grouped.length > 0 ? (
              <div className="rounded-lg border border-gray-200">
                <h3 className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Rows that were not applied
                </h3>
                <ul className="max-h-48 divide-y divide-gray-100 overflow-y-auto">
                  {grouped.map(([problem, list]) => (
                    <li key={problem} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Badge tone="danger" size="xs">
                          {formatInt(list.length)}
                        </Badge>
                        <span className="text-xs text-gray-700">{list[0].message}</span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-gray-500">
                        File row{list.length === 1 ? '' : 's'} {list.slice(0, 8).map((r) => r.row.rowNumber).join(', ')}
                        {list.length > 8 ? ` and ${list.length - 8} more` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {preview.matched.length > 0 ? (
              <div className="rounded-lg border border-gray-200">
                <h3 className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Counts that will be applied
                </h3>
                <ul className="max-h-48 divide-y divide-gray-100 overflow-y-auto">
                  {preview.matched.slice(0, 200).map((m) => (
                    <li key={`${m.row.rowNumber}`} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <span className="w-10 shrink-0 text-gray-400">#{m.row.rowNumber}</span>
                      <span className="min-w-0 flex-1 truncate text-gray-800">
                        {m.row.itemCode || m.row.itemName}
                        {m.row.warehouse ? <span className="text-gray-500"> · {m.row.warehouse}</span> : null}
                        {m.row.batch ? <span className="text-gray-500"> · {m.row.batch}</span> : null}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-gray-900">{formatQty(m.qty)}</span>
                    </li>
                  ))}
                </ul>
                {preview.matched.length > 200 ? (
                  <p className="border-t border-gray-100 px-3 py-1.5 text-[11px] text-gray-500">
                    Showing the first 200 of {formatInt(preview.matched.length)}.
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  )
}

export default CountSheetImportModal
