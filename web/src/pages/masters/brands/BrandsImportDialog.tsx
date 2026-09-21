import { useRef, useState } from 'react'
import { CircleAlert, CircleCheck, Download, FileUp, Upload } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { ProgressBar } from '../../../ui/ProgressBar'
import { Select } from '../../../ui/Select'
import { Notice } from '../../../components/Notice'
import { errorMessage } from '../../../services/api'
import { downloadCsv } from '../../../utils/csv'
import { formatInt } from '../../../utils/format'
import {
  BRAND_IMPORT_FIELDS,
  BRAND_IMPORT_MAX_ROWS,
  autoMapColumns,
  brandImportTemplateCsv,
  buildImportRows,
  importRowPayload,
  parseDelimited,
} from './brandImport'
import type { BrandImportMapping, BrandImportRow } from './brandImport'

/**
 * Importing a spreadsheet of brands, one screen at a time: pick the file, check
 * the columns are what you think they are, look at what will happen, then do
 * it.
 *
 * Two decisions worth stating.
 *
 * The preview is not optional and cannot be skipped. Importing four hundred
 * rows into the wrong column is not a mistake anybody notices until the item
 * master is wrong a week later, and the only cheap moment to catch it is before
 * the first request.
 *
 * Rows are created ONE AT A TIME through the ordinary `POST /v1/brands`, not
 * through a bulk endpoint that would have to re-implement the master's own
 * validation. That means every row gets exactly the checks a typed-in brand
 * gets — including the duplicate-name conflict only the database can answer —
 * and the results table can quote the server's own message against the line it
 * came from. It also means an import is not atomic: rows that succeeded stay,
 * and the summary says precisely which ones did not, so the file can be fixed
 * and the rest re-run without creating anything twice.
 */

type Stage = 'choose' | 'map' | 'importing' | 'done'

interface ImportOutcome {
  line: number
  name: string
  ok: boolean
  message: string
}

export interface BrandsImportDialogProps {
  open: boolean
  onClose: () => void
  /** Creates one brand. Rejects with an ApiError the summary quotes verbatim. */
  onCreate: (payload: Record<string, unknown>) => Promise<unknown>
  /** Called once when at least one brand was created, so the list can refresh. */
  onImported: (created: number) => void
}

export function BrandsImportDialog({ open, onClose, onCreate, onImported }: BrandsImportDialogProps) {
  const [stage, setStage] = useState<Stage>('choose')
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [dataRows, setDataRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<BrandImportMapping | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [outcomes, setOutcomes] = useState<ImportOutcome[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setStage('choose')
    setFileName('')
    setHeaders([])
    setDataRows([])
    setMapping(null)
    setFileError(null)
    setProgress({ done: 0, total: 0 })
    setOutcomes([])
    if (inputRef.current) inputRef.current.value = ''
  }

  const close = () => {
    if (stage === 'importing') return
    reset()
    onClose()
  }

  const readFile = async (file: File) => {
    setFileError(null)
    try {
      const text = await file.text()
      const table = parseDelimited(text)
      if (table.length < 2) {
        setFileError('That file has a header row but no data rows.')
        return
      }
      const [head, ...rest] = table
      if (rest.length > BRAND_IMPORT_MAX_ROWS) {
        setFileError(
          `That file has ${formatInt(rest.length)} rows. Import up to ${formatInt(BRAND_IMPORT_MAX_ROWS)} at a time.`,
        )
        return
      }
      setFileName(file.name)
      setHeaders(head)
      setDataRows(rest)
      setMapping(autoMapColumns(head))
      setStage('map')
    } catch (err) {
      setFileError(errorMessage(err, 'That file could not be read.'))
    }
  }

  const rows: BrandImportRow[] = mapping ? buildImportRows(dataRows, mapping) : []
  const valid = rows.filter((r) => r.problem === null)
  const invalid = rows.filter((r) => r.problem !== null)
  const nameMapped = (mapping?.brand_name ?? -1) >= 0

  const runImport = async () => {
    setStage('importing')
    setProgress({ done: 0, total: valid.length })
    const results: ImportOutcome[] = []
    let created = 0
    for (const row of valid) {
      try {
        await onCreate(importRowPayload(row))
        created += 1
        results.push({ line: row.line, name: row.brand_name, ok: true, message: 'Created' })
      } catch (err) {
        // The server's own words, against the line they belong to: "Brand
        // \"Samsung\" already exists" is exactly what the reader needs to fix.
        results.push({ line: row.line, name: row.brand_name, ok: false, message: errorMessage(err) })
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }))
    }
    setOutcomes(results)
    setStage('done')
    if (created > 0) onImported(created)
  }

  const succeeded = outcomes.filter((o) => o.ok).length
  const failed = outcomes.filter((o) => !o.ok)

  return (
    <Drawer
      open={open}
      onClose={close}
      title="Import brands"
      description={
        stage === 'choose'
          ? 'A CSV with one brand per row. The column names do not have to match ours.'
          : fileName
      }
      width="xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={Download}
            onClick={() => downloadCsv('brand-import-template.csv', brandImportTemplateCsv())}
            disabled={stage === 'importing'}
          >
            Download template
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={close} disabled={stage === 'importing'}>
              {stage === 'done' ? 'Close' : 'Cancel'}
            </Button>
            {stage === 'map' ? (
              <Button icon={Upload} onClick={runImport} disabled={valid.length === 0 || !nameMapped}>
                Import {formatInt(valid.length)} {valid.length === 1 ? 'brand' : 'brands'}
              </Button>
            ) : null}
            {stage === 'done' ? <Button onClick={reset}>Import another file</Button> : null}
          </div>
        </div>
      }
    >
      {stage === 'choose' ? (
        <div className="space-y-4">
          {fileError ? <Notice kind="error">{fileError}</Notice> : null}

          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 px-6 py-10 text-center transition-colors hover:border-primary/40 hover:bg-primary-light/30">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary-light text-primary">
              <FileUp className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-sm font-semibold text-gray-900">Choose a CSV file</span>
            <span className="max-w-sm text-xs leading-relaxed text-gray-500">
              Up to {formatInt(BRAND_IMPORT_MAX_ROWS)} rows. Comma, semicolon and tab separated files
              are all read.
            </span>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void readFile(file)
              }}
            />
          </label>

          <div className="rounded-xl bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-600">
            <p className="font-semibold text-gray-800">What can be imported</p>
            <p className="mt-1">
              Brand name (required), alias, brand code, description and status. Nothing is
              overwritten: every row is created as a new brand, and a name this company already has
              is reported as a problem rather than merged.
            </p>
          </div>
        </div>
      ) : null}

      {stage === 'map' && mapping ? (
        <div className="space-y-5">
          <section>
            <h3 className="text-sm font-semibold text-gray-900">Match the columns</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              We matched what we recognised. Change anything that looks wrong.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {BRAND_IMPORT_FIELDS.map((spec) => (
                <label key={spec.field} className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    {spec.label}
                    {spec.required ? <span className="ml-0.5 text-red-500">*</span> : null}
                  </span>
                  <Select
                    size="md"
                    value={String(mapping[spec.field])}
                    invalid={spec.required && mapping[spec.field] < 0}
                    onChange={(e) =>
                      setMapping({ ...mapping, [spec.field]: Number(e.target.value) })
                    }
                  >
                    <option value="-1">— Not in this file —</option>
                    {headers.map((h, i) => (
                      <option key={`${h}-${i}`} value={String(i)}>
                        {h.trim() || `Column ${i + 1}`}
                      </option>
                    ))}
                  </Select>
                </label>
              ))}
            </div>
            {!nameMapped ? (
              <p className="mt-2 text-[11px] text-red-600">
                Brand name has to be matched to a column before anything can be imported.
              </p>
            ) : null}
          </section>

          <section>
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-semibold text-gray-900">Preview</h3>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                <CircleCheck className="h-3.5 w-3.5" aria-hidden />
                {formatInt(valid.length)} ready
              </span>
              {invalid.length > 0 ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
                  <CircleAlert className="h-3.5 w-3.5" aria-hidden />
                  {formatInt(invalid.length)} with problems
                </span>
              ) : null}
            </div>

            <div className="scrollbar-thin mt-2 max-h-[22rem] overflow-auto rounded-xl border border-gray-200">
              <table className="w-full text-xs">
                <caption className="sr-only">Rows found in the import file</caption>
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    <th scope="col" className="px-2 py-2 text-left font-semibold text-gray-500">Line</th>
                    <th scope="col" className="px-2 py-2 text-left font-semibold text-gray-500">Brand name</th>
                    <th scope="col" className="px-2 py-2 text-left font-semibold text-gray-500">Alias</th>
                    <th scope="col" className="px-2 py-2 text-left font-semibold text-gray-500">Code</th>
                    <th scope="col" className="px-2 py-2 text-left font-semibold text-gray-500">Status</th>
                    <th scope="col" className="px-2 py-2 text-left font-semibold text-gray-500">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.line}
                      className={row.problem ? 'border-t border-gray-100 bg-red-50/60' : 'border-t border-gray-100'}
                    >
                      <td className="px-2 py-1.5 tabular-nums text-gray-400">{row.line}</td>
                      <td className="px-2 py-1.5 font-medium text-gray-900">{row.brand_name || '—'}</td>
                      <td className="px-2 py-1.5 text-gray-600">{row.brand_alias || '—'}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px] uppercase text-gray-600">
                        {row.brand_code || '—'}
                      </td>
                      <td className="px-2 py-1.5 text-gray-600">{row.is_active === 1 ? 'Active' : 'Inactive'}</td>
                      <td className="px-2 py-1.5 text-red-600">{row.problem?.message ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {invalid.length > 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
                Rows with a problem are skipped. Fix them in the file and import it again — the rows
                that went in this time will be reported as duplicates rather than created twice.
              </p>
            ) : null}
          </section>
        </div>
      ) : null}

      {stage === 'importing' ? (
        <div className="space-y-3 py-8 text-center">
          <p className="text-sm font-semibold text-gray-900">
            Importing {formatInt(progress.done)} of {formatInt(progress.total)}…
          </p>
          <ProgressBar
            value={progress.done}
            max={Math.max(1, progress.total)}
            aria-label="Import progress"
            className="mx-auto max-w-sm"
          />
          <p className="text-xs text-gray-500">Leave this panel open until it finishes.</p>
        </div>
      ) : null}

      {stage === 'done' ? (
        <div className="space-y-4">
          <Notice kind={failed.length === 0 ? 'success' : 'warning'} title="Import finished">
            {formatInt(succeeded)} {succeeded === 1 ? 'brand was' : 'brands were'} created
            {failed.length > 0 ? `, ${formatInt(failed.length)} could not be.` : '.'}
          </Notice>

          {failed.length > 0 ? (
            <div className="scrollbar-thin max-h-72 overflow-auto rounded-xl border border-gray-200">
              <table className="w-full text-xs">
                <caption className="sr-only">Rows the API refused</caption>
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    <th scope="col" className="px-2 py-2 text-left font-semibold text-gray-500">Line</th>
                    <th scope="col" className="px-2 py-2 text-left font-semibold text-gray-500">Brand</th>
                    <th scope="col" className="px-2 py-2 text-left font-semibold text-gray-500">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {failed.map((o) => (
                    <tr key={o.line} className="border-t border-gray-100">
                      <td className="px-2 py-1.5 tabular-nums text-gray-400">{o.line}</td>
                      <td className="px-2 py-1.5 font-medium text-gray-900">{o.name}</td>
                      <td className="px-2 py-1.5 text-red-600">{o.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  )
}

export default BrandsImportDialog
