import { useCallback, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  CircleAlert,
  Download,
  FileSpreadsheet,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import { Notice } from '../../../components/Notice'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { ProgressBar } from '../../../ui/ProgressBar'
import { Select } from '../../../ui/Select'
import { AIC, cx } from '../../../ui/cx'
import { errorMessage } from '../../../services/api'
import { lookupApi } from '../../../services/lookupApi'
import { batchesApi } from '../../../services/masters'
import { downloadCsv, toCsv } from '../../../utils/csv'
import { formatDate, formatInt } from '../../../utils/format'
import {
  BATCH_IMPORT_FIELDS,
  BATCH_IMPORT_TEMPLATE_HEADERS,
  guessMapping,
  markDuplicates,
  parseDelimited,
  rowSeverity,
  tally,
  toCreatePayload,
  toImportRow,
} from './batchImport'
import type { BatchImportRow } from './batchImport'

/**
 * Import batches from a CSV or a spreadsheet paste.
 *
 * Five steps, and the fourth is the one that matters: nothing is sent until the
 * reader has seen, row by row, what will be created and what will be skipped
 * and why. A file with 400 good rows and 3 bad ones imports 400 and tells you
 * about the 3 — it never imports "most of it" quietly, and it never sends a row
 * this screen already knows the API will refuse.
 *
 * It rides the endpoints that already exist rather than adding a bulk importer
 * to the API: items are resolved through `GET /v1/items/search` (once per
 * distinct key in the file, not once per row) and each batch is created through
 * `POST /v1/batches`, which is what enforces every domain rule. The result
 * screen reports exactly what the API said about each failure.
 */

type Step = 'upload' | 'map' | 'review' | 'done'

const MAX_ROWS = 2000
const PREVIEW_ROWS = 50

interface ImportOutcome {
  created: number
  failed: { line: number; batch_no: string; reason: string }[]
  skipped: number
}

export interface BatchImportDrawerProps {
  open: boolean
  onClose: () => void
  /** Called once anything was created, so the list and figures refresh. */
  onImported: (created: number) => void
}

function SeverityChip({ row }: { row: BatchImportRow }) {
  const severity = rowSeverity(row)
  if (severity === 'error') {
    return (
      <Badge tone="danger" size="xs" className="normal-case">
        Error
      </Badge>
    )
  }
  if (severity === 'warning') {
    return (
      <Badge tone="warning" size="xs" className="normal-case">
        Warning
      </Badge>
    )
  }
  return (
    <Badge tone="success" size="xs" className="normal-case">
      Ready
    </Badge>
  )
}

export function BatchImportDrawer({ open, onClose, onImported }: BatchImportDrawerProps) {
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [grid, setGrid] = useState<string[][]>([])
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState<Record<string, number>>({})
  const [rows, setRows] = useState<BatchImportRow[]>([])
  const [resolving, setResolving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [importing, setImporting] = useState(false)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pasted, setPasted] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const headers = useMemo(
    () => (hasHeader ? (grid[0] ?? []) : (grid[0] ?? []).map((_, i) => `Column ${i + 1}`)),
    [grid, hasHeader],
  )
  const bodyRows = useMemo(() => (hasHeader ? grid.slice(1) : grid), [grid, hasHeader])
  const counts = useMemo(() => tally(rows), [rows])

  const reset = useCallback(() => {
    setStep('upload')
    setFileName('')
    setGrid([])
    setMapping({})
    setRows([])
    setOutcome(null)
    setError(null)
    setPasted('')
    setProgress(0)
  }, [])

  const close = useCallback(() => {
    if (importing) return
    reset()
    onClose()
  }, [importing, onClose, reset])

  const ingest = useCallback(
    (text: string, name: string) => {
      setError(null)
      const parsed = parseDelimited(text)
      if (parsed.length === 0) {
        setError('That file has no rows in it.')
        return
      }
      if (parsed.length > MAX_ROWS + 1) {
        setError(
          `That file holds ${formatInt(parsed.length)} lines. Import up to ${formatInt(MAX_ROWS)} at a time so a failure part-way through stays easy to sort out.`,
        )
        return
      }
      setGrid(parsed)
      setFileName(name)
      setMapping(guessMapping(parsed[0] ?? []))
      setStep('map')
    },
    [],
  )

  const onFile = (file: File | null) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => ingest(String(reader.result ?? ''), file.name)
    reader.onerror = () => setError('That file could not be read.')
    reader.readAsText(file)
  }

  const downloadTemplate = () => {
    const sample = [
      { a: 'SKU-001', b: 'BCH-2026-001', c: 'LOT-4587', d: '2026-04-01', e: '2028-03-31', f: '24', g: 'active' },
    ]
    downloadCsv(
      'batch-import-template.csv',
      toCsv(sample, [
        { header: BATCH_IMPORT_TEMPLATE_HEADERS[0], value: (r) => r.a },
        { header: BATCH_IMPORT_TEMPLATE_HEADERS[1], value: (r) => r.b },
        { header: BATCH_IMPORT_TEMPLATE_HEADERS[2], value: (r) => r.c },
        { header: BATCH_IMPORT_TEMPLATE_HEADERS[3], value: (r) => r.d },
        { header: BATCH_IMPORT_TEMPLATE_HEADERS[4], value: (r) => r.e },
        { header: BATCH_IMPORT_TEMPLATE_HEADERS[5], value: (r) => r.f },
        { header: BATCH_IMPORT_TEMPLATE_HEADERS[6], value: (r) => r.g },
      ]),
    )
  }

  /**
   * Build the drafts, then resolve the distinct item keys against the API.
   *
   * Once per distinct key, never once per row: a 500-line file that names 12
   * items costs 12 lookups. A key that matches nothing, matches an inactive
   * item or matches an item that is not batch-tracked fails every row using it,
   * and says which of the three it was.
   */
  const review = useCallback(async () => {
    setResolving(true)
    setError(null)
    try {
      const drafts = markDuplicates(
        bodyRows.map((raw, i) => toImportRow(raw, mapping, i + (hasHeader ? 2 : 1))),
      )
      const keys = [...new Set(drafts.map((r) => r.itemKey.trim()).filter(Boolean))]
      const resolved = new Map<string, { id: number; name: string } | string>()

      for (const key of keys) {
        try {
          const found = await lookupApi.searchItems(key, { limit: 10 })
          const needle = key.toLowerCase()
          const match =
            found.find((it) => (it.item_sku ?? '').toLowerCase() === needle) ??
            found.find((it) => it.item_name.toLowerCase() === needle) ??
            (found.length === 1 ? found[0] : undefined)
          if (!match) {
            resolved.set(key, found.length > 1 ? `"${key}" matches ${found.length} items — use the SKU` : `No item matches "${key}"`)
          } else if (Number(match.track_batch) !== 1) {
            resolved.set(key, `"${match.item_name}" is not batch-tracked`)
          } else {
            resolved.set(key, { id: match.item_id, name: match.item_name })
          }
        } catch (err) {
          resolved.set(key, errorMessage(err, `"${key}" could not be looked up`))
        }
      }

      for (const row of drafts) {
        const hit = row.itemKey ? resolved.get(row.itemKey.trim()) : undefined
        if (typeof hit === 'string') row.errors.push(hit)
        else if (hit) {
          row.itemId = hit.id
          row.itemName = hit.name
        }
      }

      setRows(drafts)
      setStep('review')
    } catch (err) {
      setError(errorMessage(err, 'The file could not be checked.'))
    } finally {
      setResolving(false)
    }
  }, [bodyRows, hasHeader, mapping])

  /** Create the importable rows, one at a time, reporting what the API said. */
  const runImport = useCallback(async () => {
    const queue = rows.filter((r) => rowSeverity(r) !== 'error')
    if (queue.length === 0) return
    setImporting(true)
    setProgress(0)
    const failed: ImportOutcome['failed'] = []
    let created = 0

    for (let i = 0; i < queue.length; i += 1) {
      const row = queue[i]
      try {
        await batchesApi.create(toCreatePayload(row))
        created += 1
      } catch (err) {
        failed.push({ line: row.line, batch_no: row.batch_no, reason: errorMessage(err, 'Rejected by the API') })
      }
      setProgress(Math.round(((i + 1) / queue.length) * 100))
    }

    setOutcome({ created, failed, skipped: rows.length - queue.length })
    setImporting(false)
    setStep('done')
    if (created > 0) onImported(created)
  }, [onImported, rows])

  if (!open) return null

  const previewRows = rows.slice(0, PREVIEW_ROWS)

  return (
    <Drawer
      open
      onClose={close}
      width="xl"
      title="Import batches"
      description={
        step === 'upload'
          ? 'Step 1 of 4 — choose a CSV file or paste rows from a spreadsheet.'
          : step === 'map'
            ? `Step 2 of 4 — match the columns in ${fileName || 'your file'}.`
            : step === 'review'
              ? 'Step 3 of 4 — check what will be created before anything is sent.'
              : 'Step 4 of 4 — the result.'
      }
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {step === 'map' || step === 'review' ? (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto"
              onClick={() => setStep(step === 'review' ? 'map' : 'upload')}
              disabled={resolving || importing}
            >
              Back
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={close} disabled={importing}>
            {step === 'done' ? 'Close' : 'Cancel'}
          </Button>
          {step === 'map' ? (
            <Button
              size="sm"
              onClick={() => void review()}
              loading={resolving}
              disabled={(mapping.item ?? -1) < 0 || (mapping.batch_no ?? -1) < 0}
            >
              Check {formatInt(bodyRows.length)} rows
            </Button>
          ) : null}
          {step === 'review' ? (
            <Button
              size="sm"
              icon={Upload}
              onClick={() => void runImport()}
              loading={importing}
              disabled={counts.importable === 0}
            >
              Import {formatInt(counts.importable)} batches
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
      {error ? (
        <Notice kind="error" className="mb-3">
          {error}
        </Notice>
      ) : null}

      {step === 'upload' ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center">
            <FileSpreadsheet className="mx-auto h-8 w-8 text-gray-400" aria-hidden />
            <p className="mt-2 text-sm font-semibold text-gray-900">Choose a CSV file</p>
            <p className="mt-1 text-xs text-gray-500">
              Comma, semicolon or tab separated. Up to {formatInt(MAX_ROWS)} rows at a time.
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" icon={Upload} onClick={() => fileRef.current?.click()}>
                Select file
              </Button>
              <Button variant="secondary" size="sm" icon={Download} onClick={downloadTemplate}>
                Download template
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => {
                onFile(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
          </div>

          <div>
            <label
              htmlFor="batch-import-paste"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500"
            >
              Or paste rows
            </label>
            <textarea
              id="batch-import-paste"
              rows={5}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={'Item SKU\tBatch number\tExpires on\nSKU-001\tBCH-2026-001\t2028-03-31'}
              className={cx(
                AIC,
                'block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-900 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30',
              )}
            />
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              disabled={!pasted.trim()}
              onClick={() => ingest(pasted, 'pasted rows')}
            >
              Use pasted rows
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'map' ? (
        <div className="space-y-4">
          <label className={cx(AIC, 'flex items-center gap-2 text-sm text-gray-700')}>
            <input
              type="checkbox"
              checked={hasHeader}
              className="h-3.5 w-3.5 accent-[rgb(var(--color-primary))]"
              onChange={(e) => {
                setHasHeader(e.target.checked)
                setMapping(guessMapping(e.target.checked ? (grid[0] ?? []) : []))
              }}
            />
            The first line holds column names
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {BATCH_IMPORT_FIELDS.map((field) => (
              <div key={field.key}>
                <label
                  htmlFor={`map-${field.key}`}
                  className="mb-1 block text-xs font-semibold text-gray-700"
                >
                  {field.label}
                  {field.required ? <span className="ml-1 text-red-600">*</span> : null}
                </label>
                <Select
                  id={`map-${field.key}`}
                  size="md"
                  value={String(mapping[field.key] ?? -1)}
                  onChange={(e) => setMapping((m) => ({ ...m, [field.key]: Number(e.target.value) }))}
                >
                  <option value="-1">— not in this file —</option>
                  {headers.map((h, i) => (
                    <option key={`${h}-${i}`} value={String(i)}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </Select>
                {field.hint ? (
                  <p className="mt-1 text-[11px] leading-snug text-gray-500">{field.hint}</p>
                ) : null}
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-[11px]">
              <thead className="bg-gray-50">
                <tr>
                  {headers.map((h, i) => (
                    <th key={i} className="px-2 py-1.5 text-left font-semibold text-gray-500">
                      {h || `Column ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.slice(0, 3).map((r, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    {headers.map((_, c) => (
                      <td key={c} className="truncate px-2 py-1.5 text-gray-700">
                        {r[c] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {step === 'review' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Ready</span>
              <strong className="text-lg tabular-nums text-emerald-800">{formatInt(counts.valid)}</strong>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-amber-700">Warnings</span>
              <strong className="text-lg tabular-nums text-amber-800">{formatInt(counts.warning)}</strong>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-red-700">Errors</span>
              <strong className="text-lg tabular-nums text-red-800">{formatInt(counts.error)}</strong>
            </div>
          </div>

          <Notice kind={counts.error > 0 ? 'warning' : 'info'}>
            {counts.error > 0
              ? `${formatInt(counts.importable)} rows will be created. The ${formatInt(counts.error)} with errors are left out — fix them in the file and import it again.`
              : `${formatInt(counts.importable)} rows will be created. Rows with warnings are still imported.`}
          </Notice>

          {importing ? (
            <ProgressBar value={progress} aria-label="Import progress" />
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-[11px]">
              <thead className="bg-gray-50">
                <tr>
                  {['Line', 'Item', 'Batch', 'Lot', 'Manufactured', 'Expires', 'Status', 'Notes'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-1.5 text-left font-semibold text-gray-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr key={row.line} className="border-t border-gray-100 align-top">
                    <td className="px-2 py-1.5 tabular-nums text-gray-500">{row.line}</td>
                    <td className="max-w-[10rem] truncate px-2 py-1.5 text-gray-900">
                      {row.itemName ?? row.itemKey}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-gray-900">{row.batch_no}</td>
                    <td className="px-2 py-1.5 text-gray-700">{row.lot_no || '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-gray-700">
                      {row.mfg_date ? formatDate(row.mfg_date) : row.mfg_raw || '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-gray-700">
                      {row.expiry_date ? formatDate(row.expiry_date) : row.expiry_raw || '—'}
                    </td>
                    <td className="px-2 py-1.5">
                      <SeverityChip row={row} />
                    </td>
                    <td className="px-2 py-1.5 text-gray-600">
                      {[...row.errors, ...row.warnings].join('; ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > PREVIEW_ROWS ? (
            <p className="text-[11px] text-gray-500">
              Showing the first {formatInt(PREVIEW_ROWS)} of {formatInt(rows.length)} rows. All of them are checked.
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 'done' && outcome ? (
        <div className="space-y-3">
          <div
            className={cx(
              'flex items-start gap-3 rounded-xl border px-4 py-3',
              outcome.failed.length === 0
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-amber-200 bg-amber-50',
            )}
          >
            {outcome.failed.length === 0 ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
            ) : (
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
            )}
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {formatInt(outcome.created)} batch{outcome.created === 1 ? '' : 'es'} created.
              </p>
              <p className="mt-0.5 text-xs text-gray-600">
                {outcome.skipped > 0
                  ? `${formatInt(outcome.skipped)} row${outcome.skipped === 1 ? '' : 's'} with errors were not sent. `
                  : ''}
                {outcome.failed.length > 0
                  ? `${formatInt(outcome.failed.length)} were refused by the API — see below.`
                  : 'Nothing was refused.'}
              </p>
            </div>
          </div>

          {outcome.failed.length > 0 ? (
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200" role="list">
              {outcome.failed.map((f) => (
                <li key={`${f.line}-${f.batch_no}`} className="flex items-start gap-2 px-3 py-2 text-xs">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
                  <span>
                    <strong className="font-mono text-gray-900">{f.batch_no}</strong>
                    <span className="ml-1 text-gray-400">line {f.line}</span>
                    <span className="block text-gray-600">{f.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  )
}

export default BatchImportDrawer
