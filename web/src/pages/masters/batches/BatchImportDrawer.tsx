import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Download, FileSpreadsheet, TriangleAlert, Upload, XCircle } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { ProgressBar } from '../../../ui/ProgressBar'
import { Select } from '../../../ui/Select'
import { Notice } from '../../../components/Notice'
import { cx } from '../../../ui/cx'
import { errorMessage } from '../../../services/api'
import { itemsApi } from '../../../services/items'
import { BATCH_STATUSES, batchesApi } from '../../../services/masters'
import { downloadCsv, toCsv } from '../../../utils/csv'
import { formatInt } from '../../../utils/format'
import {
  IMPORT_FIELDS,
  autoMapColumns,
  parseDelimited,
  tallyRows,
  validateImportRows,
} from './batchImport'
import type { ImportField, ImportItemRef, ParsedImportRow } from './batchImport'

/**
 * Import batches from a spreadsheet: upload, map, validate, preview, import.
 *
 * It writes through the ordinary `POST /v1/batches` — one request per row —
 * rather than a bulk endpoint, because there isn't one and inventing a second
 * write path for the same records would mean a second place for the duplicate
 * rule, the shelf-life defaulting and the audit log to be got wrong. Every row
 * imported here is indistinguishable from one typed into the form.
 *
 * Rows with an error are never sent. The reader sees exactly which ones and
 * why, before anything is written, and can download the rejects as a file to
 * fix and re-upload — a half-loaded stock file with no record of which half is
 * the failure mode this whole screen exists to avoid.
 */

type Step = 'upload' | 'map' | 'preview' | 'running' | 'done'

/** Beyond this the file should be split; the item lookup is per distinct name. */
const MAX_DISTINCT_ITEMS = 200
const MAX_ROWS = 2000
const LOOKUP_CONCURRENCY = 4

const normalise = (value: string): string => value.trim().toLowerCase().replace(/[\s_-]+/g, ' ')

export interface BatchImportDrawerProps {
  open: boolean
  onClose: () => void
  /** Called after a run that created at least one batch. */
  onImported: (created: number) => void
}

interface RunResult {
  created: number
  failures: { line: number; batch_no: string; reason: string }[]
  skipped: ParsedImportRow[]
}

/** Read an uploaded file into a grid, whichever of the three formats it is. */
async function readGrid(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.xlsm')) {
    // Loaded on demand, the same way the exporter does it: the sheet library is
    // ~1.5 MB and no one who never imports should pay for it.
    const XLSX = await import('xlsx-js-style')
    const book = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const sheet = book.Sheets[book.SheetNames[0]]
    if (!sheet) return []
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' })
    return grid
      .map((row) => (row as unknown[]).map((cell) => (cell === null || cell === undefined ? '' : String(cell))))
      .filter((row) => row.some((cell) => cell.trim() !== ''))
  }
  const text = await file.text()
  return parseDelimited(text, name.endsWith('.tsv') ? '\t' : ',')
}

export function BatchImportDrawer({ open, onClose, onImported }: BatchImportDrawerProps) {
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [grid, setGrid] = useState<string[][]>([])
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState<Record<ImportField, number>>(() => autoMapColumns([]))
  const [items, setItems] = useState<Map<string, ImportItemRef>>(new Map())
  const [rows, setRows] = useState<ParsedImportRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<RunResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setStep('upload')
    setFileName('')
    setGrid([])
    setHasHeader(true)
    setItems(new Map())
    setRows([])
    setError(null)
    setBusy(false)
    setProgress(0)
    setResult(null)
  }, [])

  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  const headers = hasHeader && grid.length > 0 ? grid[0] : grid[0]?.map((_, i) => `Column ${i + 1}`) ?? []
  const dataRows = useMemo(() => (hasHeader ? grid.slice(1) : grid), [grid, hasHeader])

  const onFile = async (file: File | null) => {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const parsed = await readGrid(file)
      if (parsed.length === 0) {
        setError('That file has no rows in it.')
        return
      }
      if (parsed.length > MAX_ROWS + 1) {
        setError(`That file has more than ${formatInt(MAX_ROWS)} rows. Split it and import the parts.`)
        return
      }
      setFileName(file.name)
      setGrid(parsed)
      setMapping(autoMapColumns(parsed[0] ?? []))
      setStep('map')
    } catch (err: unknown) {
      setError(errorMessage(err, 'That file could not be read.'))
    } finally {
      setBusy(false)
    }
  }

  /** Resolve the distinct item keys in the file, then validate every row. */
  const validate = async () => {
    setBusy(true)
    setError(null)
    try {
      const column = mapping.item
      const keys = new Set<string>()
      for (const row of dataRows) {
        const value = column >= 0 ? String(row[column] ?? '').trim() : ''
        if (value) keys.add(value)
      }
      if (keys.size > MAX_DISTINCT_ITEMS) {
        setError(`This file names ${formatInt(keys.size)} different items. Split it into files of at most ${MAX_DISTINCT_ITEMS}.`)
        return
      }

      /*
       * One search per distinct name, not one per row, and not the whole item
       * master: the cost scales with the file rather than with the catalogue,
       * which is what makes this survive an item master of a hundred thousand.
       */
      const resolved = new Map<string, ImportItemRef>()
      const pending = [...keys]
      const worker = async () => {
        for (;;) {
          const key = pending.shift()
          if (key === undefined) return
          const found = await itemsApi.search(key, 10)
          const needle = normalise(key)
          const hit =
            found.find((r) => normalise(r.item_name) === needle) ??
            found.find((r) => r.item_sku && normalise(r.item_sku) === needle) ??
            null
          if (hit) {
            resolved.set(needle, {
              item_id: hit.item_id,
              item_name: hit.item_name,
              item_sku: hit.item_sku,
              track_batch: hit.track_batch,
            })
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, pending.length) }, worker))

      setItems(resolved)
      setRows(
        validateImportRows({
          rows: dataRows,
          mapping,
          itemsByKey: resolved,
          statuses: BATCH_STATUSES,
          firstLine: hasHeader ? 2 : 1,
        }),
      )
      setStep('preview')
    } catch (err: unknown) {
      setError(errorMessage(err, 'The items in this file could not be looked up.'))
    } finally {
      setBusy(false)
    }
  }

  const tally = useMemo(() => tallyRows(rows), [rows])

  const run = async () => {
    const importable = rows.filter((r) => r.payload !== null)
    setStep('running')
    setProgress(0)
    const failures: RunResult['failures'] = []
    let created = 0
    for (const row of importable) {
      try {
        await batchesApi.create(row.payload as Record<string, unknown>)
        created += 1
      } catch (err: unknown) {
        failures.push({
          line: row.line,
          batch_no: row.values.batch_no,
          reason: errorMessage(err, 'The server refused this row.'),
        })
      }
      setProgress((n) => n + 1)
    }
    setResult({ created, failures, skipped: rows.filter((r) => r.verdict === 'error') })
    setStep('done')
    if (created > 0) onImported(created)
  }

  /** The rows that did not make it, as a file to fix and re-upload. */
  const downloadRejects = () => {
    const rejected = [
      ...(result?.skipped ?? rows.filter((r) => r.verdict === 'error')).map((r) => ({
        line: r.line,
        values: r.values,
        reason: r.messages.join(' '),
      })),
      ...(result?.failures ?? []).map((f) => ({
        line: f.line,
        values: rows.find((r) => r.line === f.line)?.values,
        reason: f.reason,
      })),
    ]
    downloadCsv(
      'batch-import-rejects.csv',
      toCsv(rejected, [
        { header: 'Line', value: (r) => r.line },
        ...IMPORT_FIELDS.map((f) => ({
          header: f.label,
          value: (r: (typeof rejected)[number]) => r.values?.[f.key] ?? '',
        })),
        { header: 'Why it was not imported', value: (r) => r.reason },
      ]),
    )
  }

  const stepLabel: Record<Step, string> = {
    upload: 'Step 1 of 4 · Upload',
    map: 'Step 2 of 4 · Map columns',
    preview: 'Step 3 of 4 · Review',
    running: 'Step 4 of 4 · Importing',
    done: 'Finished',
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="xl"
      title="Import batches"
      description={stepLabel[step]}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {step === 'done' && (result?.failures.length || result?.skipped.length) ? (
            <Button variant="ghost" size="sm" icon={Download} onClick={downloadRejects}>
              Download rejected rows
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onClose} disabled={step === 'running'}>
            {step === 'done' ? 'Close' : 'Cancel'}
          </Button>
          {step === 'map' ? (
            <Button
              size="sm"
              loading={busy}
              disabled={mapping.item < 0 || mapping.batch_no < 0}
              onClick={() => void validate()}
            >
              Validate {formatInt(dataRows.length)} rows
            </Button>
          ) : null}
          {step === 'preview' ? (
            <Button size="sm" disabled={tally.importable === 0} onClick={() => void run()}>
              Import {formatInt(tally.importable)} {tally.importable === 1 ? 'batch' : 'batches'}
            </Button>
          ) : null}
          {step === 'done' ? (
            <Button size="sm" onClick={reset}>
              Import another file
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        {error ? <Notice kind="warning">{error}</Notice> : null}

        {step === 'upload' ? (
          // The drawer is sized for the preview table; the upload step is one
          // control and reads as an empty room at that width.
          <div className="mx-auto max-w-xl">
            <div className="rounded-xl border-2 border-dashed border-gray-200 px-6 py-10 text-center">
              <span className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-light text-primary" aria-hidden>
                <FileSpreadsheet className="h-6 w-6" />
              </span>
              <p className="text-sm font-semibold text-gray-900">Upload a CSV or Excel file</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-gray-500">
                One row per batch, with at least an item and a batch number. Dates may be written
                <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 text-[11px]">2028-03-31</code>
                or
                <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 text-[11px]">31/03/2028</code>.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.xlsx,.xls,.xlsm,text/csv"
                className="sr-only"
                onChange={(e) => {
                  void onFile(e.target.files?.[0] ?? null)
                  e.target.value = ''
                }}
              />
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" icon={Upload} loading={busy} onClick={() => fileInputRef.current?.click()}>
                  Choose file
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Download}
                  onClick={() =>
                    downloadCsv(
                      'batch-import-template.csv',
                      toCsv([{}], IMPORT_FIELDS.map((f) => ({ header: f.label, value: () => '' }))),
                    )
                  }
                >
                  Download template
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {step === 'map' ? (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              <strong className="font-semibold text-gray-700">{fileName}</strong> — {formatInt(dataRows.length)} rows.
              Check each field points at the right column.
            </p>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => {
                  setHasHeader(e.target.checked)
                  setMapping(autoMapColumns(e.target.checked ? (grid[0] ?? []) : []))
                }}
                className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary/30"
              />
              The first row is a header
            </label>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {IMPORT_FIELDS.map((field) => (
                <li key={field.key} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="min-w-[11rem] flex-1 text-[13px] text-gray-700">
                    {field.label}
                    {field.required ? <span className="ml-1 text-red-600" aria-label="required">*</span> : null}
                  </span>
                  <Select
                    size="md"
                    aria-label={`Column for ${field.label}`}
                    value={String(mapping[field.key])}
                    onChange={(e) => setMapping((m) => ({ ...m, [field.key]: Number(e.target.value) }))}
                    className="w-56"
                    invalid={field.required && mapping[field.key] < 0}
                  >
                    <option value="-1">— Not in this file —</option>
                    {headers.map((header, i) => (
                      <option key={`${header}-${i}`} value={i}>
                        {header || `Column ${i + 1}`}
                      </option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>
            {mapping.item < 0 || mapping.batch_no < 0 ? (
              <Notice kind="warning">An item column and a batch-number column are both required.</Notice>
            ) : null}
          </div>
        ) : null}

        {step === 'preview' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Ready', value: tally.valid, tone: 'text-emerald-700', icon: CheckCircle2 },
                { label: 'With warnings', value: tally.warning, tone: 'text-amber-700', icon: TriangleAlert },
                { label: 'Cannot import', value: tally.error, tone: 'text-red-700', icon: XCircle },
              ].map((card) => (
                <div key={card.label} className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-500">
                    <card.icon className={cx('h-3 w-3', card.tone)} aria-hidden />
                    {card.label}
                  </p>
                  <p className="mt-0.5 text-xl font-semibold tabular-nums text-gray-900">{formatInt(card.value)}</p>
                </div>
              ))}
            </div>
            {tally.error > 0 ? (
              <Notice kind="warning">
                {formatInt(tally.error)} {tally.error === 1 ? 'row' : 'rows'} will not be imported. Nothing partial is
                written — fix them and re-upload, or import the rest now and add them afterwards.
              </Notice>
            ) : null}
            {items.size === 0 ? (
              <Notice kind="warning">None of the items in this file could be matched by name or SKU.</Notice>
            ) : null}
            <div className="max-h-[22rem] overflow-auto rounded-lg border border-gray-200">
              <table className="w-full border-separate border-spacing-0 text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    {['Line', 'Item', 'Batch', 'Lot', 'Mfg', 'Expiry', 'Status'].map((h) => (
                      <th key={h} scope="col" className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-gray-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.line}
                      className={cx(
                        'border-t border-gray-100',
                        row.verdict === 'error' && 'bg-red-50/60',
                        row.verdict === 'warning' && 'bg-amber-50/60',
                      )}
                    >
                      <td className="px-2 py-1.5 align-top tabular-nums text-gray-500">{row.line}</td>
                      <td className="px-2 py-1.5 align-top">
                        <span className="block max-w-[14rem] truncate text-gray-900">
                          {row.item?.item_name ?? (row.values.item || '—')}
                        </span>
                        {row.messages.length > 0 ? (
                          <span className={cx('mt-0.5 block', row.verdict === 'error' ? 'text-red-700' : 'text-amber-700')}>
                            {row.messages.join(' ')}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 align-top font-mono text-gray-900">{row.values.batch_no || '—'}</td>
                      <td className="px-2 py-1.5 align-top text-gray-600">{row.values.lot_no || '—'}</td>
                      <td className="px-2 py-1.5 align-top text-gray-600">{String(row.payload?.mfg_date ?? row.values.mfg_date ?? '') || '—'}</td>
                      <td className="px-2 py-1.5 align-top text-gray-600">{String(row.payload?.expiry_date ?? row.values.expiry_date ?? '') || '—'}</td>
                      <td className="px-2 py-1.5 align-top">
                        <Badge
                          size="xs"
                          tone={row.verdict === 'error' ? 'danger' : row.verdict === 'warning' ? 'warning' : 'success'}
                          className="normal-case"
                        >
                          {row.verdict === 'error' ? 'Skipped' : row.verdict === 'warning' ? 'Warning' : 'Ready'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {step === 'running' ? (
          <div className="py-6">
            <ProgressBar value={progress} max={Math.max(1, tally.importable)} aria-label="Importing batches" />
            <p className="mt-2 text-center text-sm text-gray-600">
              Creating batch {formatInt(Math.min(progress + 1, tally.importable))} of {formatInt(tally.importable)}…
            </p>
            <p className="mt-1 text-center text-xs text-gray-400">Leave this open until it finishes.</p>
          </div>
        ) : null}

        {step === 'done' && result ? (
          <div className="space-y-3">
            <Notice kind={result.failures.length === 0 ? 'success' : 'warning'}>
              {formatInt(result.created)} {result.created === 1 ? 'batch' : 'batches'} imported.
              {result.skipped.length > 0 ? ` ${formatInt(result.skipped.length)} skipped before sending.` : ''}
              {result.failures.length > 0 ? ` ${formatInt(result.failures.length)} refused by the server.` : ''}
            </Notice>
            {result.failures.length > 0 ? (
              <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2 text-xs">
                {result.failures.map((f) => (
                  <li key={f.line}>
                    <span className="text-gray-500">Line {f.line}</span>{' '}
                    <span className="font-mono font-semibold text-gray-900">{f.batch_no}</span>
                    <span className="text-gray-500"> — {f.reason}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </Drawer>
  )
}

export default BatchImportDrawer
