import { useCallback, useRef, useState } from 'react'
import { AlertTriangle, CircleCheck, Download, FileSpreadsheet, TriangleAlert, Upload } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { ProgressBar } from '../../../ui/ProgressBar'
import { Notice } from '../../../components/Notice'
import { cx } from '../../../ui/cx'
import { errorMessage } from '../../../services/api'
import { uomApi } from '../../../services/masters'
import type { Uom } from '../../../services/masters'
import { downloadCsv } from '../../../utils/csv'
import {
  failureReportCsv,
  parseUnitSheet,
  templateCsv,
  toCreatePayload,
} from './uomImport'
import type { Cell, ImportFailure, ParsedRow, ParseResult } from './uomImport'

/**
 * Import units from a spreadsheet.
 *
 * Four steps that cannot be skipped: choose a file, see what it holds, confirm,
 * read the result. Nothing is written before the confirm, the preview is the
 * whole file rather than the first few rows, and every row that will not import
 * says why with the line number it came from.
 *
 * Creation goes through `POST /v1/uom` one row at a time — the same endpoint,
 * validation, audit entry and Books mirror as a unit typed into the form. There
 * is no bulk endpoint to be out of step with, and a row the server refuses
 * anyway is reported rather than lost.
 */

type Stage = 'choose' | 'preview' | 'running' | 'done'

interface RunResult {
  created: number
  failures: ImportFailure[]
  skipped: number
}

const MAX_BYTES = 2 * 1024 * 1024
const MAX_ROWS = 2000

export interface UomImportDrawerProps {
  open: boolean
  onClose: () => void
  /** Every unit on record — what a row is checked for collisions against. */
  loadExisting: () => Promise<Uom[]>
  knownUqcCodes: readonly string[]
  onImported: () => void
}

export function UomImportDrawer({ open, onClose, loadExisting, knownUqcCodes, onImported }: UomImportDrawerProps) {
  const [stage, setStage] = useState<Stage>('choose')
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<RunResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setStage('choose')
    setFileName('')
    setParsed(null)
    setReadError(null)
    setProgress(0)
    setResult(null)
    if (inputRef.current) inputRef.current.value = ''
  }, [])

  const readFile = async (file: File) => {
    setReadError(null)
    if (file.size > MAX_BYTES) {
      setReadError('That file is larger than 2 MB. Units are a small master — check you picked the right sheet.')
      return
    }
    try {
      // SheetJS is ~860 kB and is already lazy-loaded for exports; an import
      // that nobody runs must not put it in the initial bundle either.
      const XLSX = await import('xlsx-js-style')
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = book.Sheets[book.SheetNames[0]]
      if (!sheet) {
        setReadError('That file has no sheets in it.')
        return
      }
      const grid = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, blankrows: false, raw: false })
      if (grid.length > MAX_ROWS + 1) {
        setReadError(`That sheet has more than ${MAX_ROWS} rows. Split it and import in parts.`)
        return
      }
      const existing = await loadExisting()
      setParsed(parseUnitSheet(grid, existing, knownUqcCodes))
      setFileName(file.name)
      setStage('preview')
    } catch (err) {
      setReadError(errorMessage(err, 'That file could not be read as a spreadsheet.'))
    }
  }

  const importable = (parsed?.rows ?? []).filter((r) => r.verdict !== 'error')

  const run = async () => {
    if (importable.length === 0) return
    setStage('running')
    setProgress(0)
    const failures: ImportFailure[] = []
    let created = 0
    for (let i = 0; i < importable.length; i += 1) {
      const row = importable[i]
      try {
        await uomApi.create(toCreatePayload(row))
        created += 1
      } catch (err) {
        failures.push({ line: row.line, name: row.values.unit_name, reason: errorMessage(err) })
      }
      setProgress(Math.round(((i + 1) / importable.length) * 100))
    }
    setResult({ created, failures, skipped: (parsed?.counts.error ?? 0) })
    setStage('done')
    if (created > 0) onImported()
  }

  const close = () => {
    reset()
    onClose()
  }

  return (
    <Drawer
      open={open}
      title="Import units of measure"
      description="Add several units from a CSV or Excel sheet. Nothing is created until you confirm."
      onClose={() => {
        if (stage !== 'running') close()
      }}
      width="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={Download}
            onClick={() => downloadCsv('units-of-measure-template.csv', templateCsv())}
          >
            Download template
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={close} disabled={stage === 'running'}>
              {stage === 'done' ? 'Close' : 'Cancel'}
            </Button>
            {stage === 'preview' ? (
              <Button onClick={() => void run()} disabled={importable.length === 0}>
                Import {importable.length} {importable.length === 1 ? 'unit' : 'units'}
              </Button>
            ) : null}
            {stage === 'done' ? <Button onClick={reset}>Import another sheet</Button> : null}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {stage === 'choose' ? (
          <>
            <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
              <FileSpreadsheet className="mx-auto h-8 w-8 text-gray-400" aria-hidden />
              <p className="mt-2 text-sm font-medium text-gray-900">Choose a CSV or Excel file</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-gray-500">
                The first row names the columns. Unit Name and Symbol are required; Print Name, GST UQC, Decimals and
                Status are optional.
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                id="uom-import-file"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void readFile(file)
                }}
              />
              <Button className="mt-3" icon={Upload} onClick={() => inputRef.current?.click()}>
                Choose file
              </Button>
            </div>
            {readError ? <Notice kind="error">{readError}</Notice> : null}
          </>
        ) : null}

        {stage === 'preview' && parsed ? (
          parsed.fatal ? (
            <>
              <Notice kind="error">{parsed.fatal}</Notice>
              <Button variant="secondary" onClick={reset}>
                Choose another file
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs text-gray-500">
                Read <strong className="text-gray-800">{fileName}</strong>
              </p>

              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-gray-200 p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">Rows</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">{parsed.counts.total}</p>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-amber-700">Warnings</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-amber-800">{parsed.counts.warning}</p>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-red-700">Errors</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-red-700">{parsed.counts.error}</p>
                </div>
              </div>

              {parsed.unknownHeaders.length > 0 ? (
                <Notice kind="warning">
                  Ignoring {parsed.unknownHeaders.length === 1 ? 'a column' : 'columns'} this master has no field for:{' '}
                  {parsed.unknownHeaders.join(', ')}.
                </Notice>
              ) : null}

              {parsed.counts.error > 0 ? (
                <Notice kind="warning">
                  {parsed.counts.error} {parsed.counts.error === 1 ? 'row' : 'rows'} will be skipped. Fix them in the
                  sheet and import again, or go ahead with the rest.
                </Notice>
              ) : null}

              <ul className="max-h-80 space-y-1 overflow-y-auto scrollbar-thin" aria-label="Rows read from the sheet">
                {parsed.rows.map((row) => (
                  <PreviewRow key={row.line} row={row} />
                ))}
              </ul>
            </>
          )
        ) : null}

        {stage === 'running' ? (
          <div className="space-y-2 py-6 text-center">
            <p className="text-sm font-medium text-gray-900">Creating units…</p>
            <ProgressBar value={progress} />
            <p className="text-xs text-gray-500">{progress}% — leave this panel open until it finishes.</p>
          </div>
        ) : null}

        {stage === 'done' && result ? (
          <div className="space-y-3">
            <div
              className={cx(
                'flex items-start gap-2.5 rounded-xl border p-3',
                result.failures.length === 0 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50/60',
              )}
            >
              {result.failures.length === 0 ? (
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              )}
              <div className="min-w-0 text-xs leading-relaxed">
                <strong className="block text-sm text-gray-900">
                  {result.created} {result.created === 1 ? 'unit' : 'units'} created
                </strong>
                <p className="mt-0.5 text-gray-600">
                  {result.skipped > 0 ? `${result.skipped} skipped before the run. ` : ''}
                  {result.failures.length > 0
                    ? `${result.failures.length} refused by the server.`
                    : 'Every importable row went through.'}
                </p>
              </div>
            </div>

            {result.failures.length > 0 ? (
              <>
                <ul className="max-h-60 space-y-1 overflow-y-auto scrollbar-thin">
                  {result.failures.map((f) => (
                    <li key={f.line} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs">
                      <strong className="text-gray-900">
                        Line {f.line} · {f.name}
                      </strong>
                      <p className="mt-0.5 text-red-700">{f.reason}</p>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Download}
                  onClick={() => downloadCsv('units-of-measure-import-errors.csv', failureReportCsv(result.failures))}
                >
                  Download the error report
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </Drawer>
  )
}

function PreviewRow({ row }: { row: ParsedRow }) {
  const tone =
    row.verdict === 'error'
      ? 'border-red-200 bg-red-50'
      : row.verdict === 'warning'
        ? 'border-amber-200 bg-amber-50/60'
        : 'border-gray-200'
  return (
    <li className={cx('rounded-lg border px-2.5 py-1.5', tone)}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="w-10 shrink-0 tabular-nums text-gray-400">L{row.line}</span>
        <strong className="min-w-0 truncate font-semibold text-gray-900">{row.values.unit_name || '—'}</strong>
        <span className="text-gray-500">{row.values.unit_symbol || '—'}</span>
        {row.values.uqc_gst ? <span className="font-mono text-[11px] text-gray-500">{row.values.uqc_gst}</span> : null}
        <Badge
          tone={row.verdict === 'error' ? 'danger' : row.verdict === 'warning' ? 'warning' : 'success'}
          size="xs"
          className="ml-auto"
        >
          {row.verdict === 'error' ? 'Skipped' : row.verdict === 'warning' ? 'Check' : 'Ready'}
        </Badge>
      </div>
      {row.messages.length > 0 ? (
        <ul className="mt-1 space-y-0.5 pl-12">
          {row.messages.map((m) => (
            <li
              key={m}
              className={cx('flex items-start gap-1 text-[11px]', row.verdict === 'error' ? 'text-red-700' : 'text-amber-800')}
            >
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span>{m}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export default UomImportDrawer
