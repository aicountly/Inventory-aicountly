import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleCheck, Download, FileSpreadsheet, TriangleAlert, Upload } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { ProgressBar } from '../../../ui/ProgressBar'
import { Notice } from '../../../components/Notice'
import { cx } from '../../../ui/cx'
import { errorMessage } from '../../../services/api'
import type { StockCategory } from '../../../services/masters'
import { formatInt } from '../../../utils/format'
import { IMPORT_TEMPLATE_HEADERS, buildImportPlan } from './stockCategoryImport'
import type { ImportPlan, ImportRow } from './stockCategoryImport'

/**
 * Importing a stock-category CSV.
 *
 * There is no bulk endpoint, and this does not fake one: a confirmed import
 * replays the ordinary create call per row, so every category lands through
 * the same validation, the same uniqueness rule and the same audit entry as
 * one typed into the form. The rows go one at a time and in file order, so a
 * failure half way names the line it stopped on and the lines before it are
 * genuinely created — there is no partial transaction to explain.
 *
 * The file is read and judged in full before anything is written. The summary
 * below the picker is the whole verdict — how many will be created, how many
 * have a warning, how many cannot be created and why — because "12 of 40 rows
 * were skipped" discovered afterwards is not an import, it is a puzzle.
 */

type Phase = 'pick' | 'review' | 'running' | 'done'

export interface ImportOutcome {
  created: number
  failed: { line: number; name: string; reason: string }[]
}

export interface StockCategoryImportDrawerProps {
  open: boolean
  onClose: () => void
  /** Every existing category, for the duplicate check before anything is sent. */
  fetchExisting: () => Promise<StockCategory[]>
  /** One create call. Rejects with the API's own error. */
  createOne: (values: { cat_name: string; cat_alias: string | null; is_active: number }) => Promise<unknown>
  onDownloadTemplate: () => void
  /** Rows were created — the page reloads the list and the figures. */
  onImported: (outcome: ImportOutcome) => void
}

function IssueList({ row }: { row: ImportRow }) {
  if (row.issues.length === 0) return null
  return (
    <ul className="m-0 mt-0.5 list-none space-y-0.5 p-0">
      {row.issues.map((issue, i) => (
        <li key={i} className={cx('text-[11px]', issue.level === 'error' ? 'text-red-600' : 'text-amber-700')}>
          {issue.message}
        </li>
      ))}
    </ul>
  )
}

export function StockCategoryImportDrawer({
  open,
  onClose,
  fetchExisting,
  createOne,
  onDownloadTemplate,
  onImported,
}: StockCategoryImportDrawerProps) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [phase, setPhase] = useState<Phase>('pick')
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [done, setDone] = useState(0)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)

  const reset = useCallback(() => {
    setPhase('pick')
    setFileName('')
    setReading(false)
    setReadError(null)
    setPlan(null)
    setDone(0)
    setOutcome(null)
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    setReading(true)
    setReadError(null)
    try {
      const [text, existing] = await Promise.all([file.text(), fetchExisting()])
      setPlan(buildImportPlan(text, existing))
      setPhase('review')
    } catch (err) {
      setReadError(errorMessage(err, 'The file could not be read.'))
    } finally {
      setReading(false)
    }
  }

  const run = async () => {
    if (!plan || plan.valid.length === 0) return
    setPhase('running')
    setDone(0)
    const failed: ImportOutcome['failed'] = []
    let created = 0
    for (const row of plan.valid) {
      try {
        await createOne({ cat_name: row.name, cat_alias: row.alias, is_active: row.isActive })
        created += 1
      } catch (err) {
        failed.push({ line: row.line, name: row.name, reason: errorMessage(err, 'The API refused this row.') })
      }
      setDone((n) => n + 1)
    }
    const result = { created, failed }
    setOutcome(result)
    setPhase('done')
    if (created > 0) onImported(result)
  }

  const blockedFile = plan ? plan.fileIssues.some((i) => i.level === 'error') : false

  return (
    <Drawer
      open={open}
      title="Import stock categories"
      description={`Columns: ${IMPORT_TEMPLATE_HEADERS.join(', ')}. Every row is created through the normal stock-category API.`}
      width="lg"
      onClose={() => {
        if (phase !== 'running') onClose()
      }}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={phase === 'running'}>
            {phase === 'done' ? 'Close' : 'Cancel'}
          </Button>
          {phase === 'review' && plan && plan.valid.length > 0 ? (
            <Button icon={Upload} onClick={run}>
              Import {formatInt(plan.valid.length)} {plan.valid.length === 1 ? 'category' : 'categories'}
            </Button>
          ) : null}
          {phase === 'done' ? (
            <Button variant="secondary" onClick={reset}>
              Import another file
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        {/* ---- pick ---------------------------------------------------- */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-3">
          <FileSpreadsheet className="h-5 w-5 shrink-0 text-gray-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900">{fileName || 'No file chosen'}</p>
            <p className="text-xs text-gray-500">A .csv file with a header row.</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            id="stock-category-import-file"
            onChange={(e) => void onFile(e.target.files?.[0])}
            disabled={phase === 'running'}
          />
          <Button
            variant="secondary"
            size="sm"
            icon={Upload}
            loading={reading}
            disabled={phase === 'running'}
            onClick={() => fileRef.current?.click()}
          >
            Choose file
          </Button>
          <Button variant="ghost" size="sm" icon={Download} onClick={onDownloadTemplate}>
            Template
          </Button>
        </div>

        {readError ? <Notice kind="error">{readError}</Notice> : null}

        {/* ---- review -------------------------------------------------- */}
        {plan && phase !== 'running' && phase !== 'done' ? (
          <>
            {plan.fileIssues.map((issue, i) => (
              <Notice key={i} kind={issue.level === 'error' ? 'error' : 'warning'}>
                {issue.message}
              </Notice>
            ))}

            {!blockedFile ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Valid</p>
                    <p className="mt-0.5 text-xl font-semibold tabular-nums text-primary">
                      {formatInt(plan.valid.length)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Warnings</p>
                    <p className="mt-0.5 text-xl font-semibold tabular-nums text-amber-600">
                      {formatInt(plan.warned.length)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Invalid</p>
                    <p className="mt-0.5 text-xl font-semibold tabular-nums text-red-600">
                      {formatInt(plan.invalid.length)}
                    </p>
                  </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <table className="w-full text-left text-xs">
                    <caption className="sr-only">Every row in the file and what will happen to it</caption>
                    <thead>
                      <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                        <th scope="col" className="px-2.5 py-2 font-semibold">
                          Line
                        </th>
                        <th scope="col" className="px-2.5 py-2 font-semibold">
                          Category
                        </th>
                        <th scope="col" className="px-2.5 py-2 font-semibold">
                          Alias
                        </th>
                        <th scope="col" className="px-2.5 py-2 font-semibold">
                          Status
                        </th>
                        <th scope="col" className="px-2.5 py-2 font-semibold">
                          Result
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.rows.map((row) => {
                        const invalid = row.issues.some((i) => i.level === 'error')
                        return (
                          <tr key={row.line} className="border-t border-gray-100 align-top">
                            <td className="px-2.5 py-2 tabular-nums text-gray-400">{row.line}</td>
                            <td className="px-2.5 py-2 text-gray-800">{row.name || <span className="text-gray-300">—</span>}</td>
                            <td className="px-2.5 py-2 font-mono text-gray-600">{row.alias ?? '—'}</td>
                            <td className="px-2.5 py-2 text-gray-600">{row.isActive === 1 ? 'Active' : 'Inactive'}</td>
                            <td className="px-2.5 py-2">
                              <span
                                className={cx(
                                  'inline-flex items-center gap-1 font-semibold',
                                  invalid ? 'text-red-600' : row.issues.length > 0 ? 'text-amber-700' : 'text-primary',
                                )}
                              >
                                {invalid ? (
                                  <TriangleAlert className="h-3 w-3" aria-hidden />
                                ) : (
                                  <CircleCheck className="h-3 w-3" aria-hidden />
                                )}
                                {invalid ? 'Will be skipped' : 'Will be created'}
                              </span>
                              <IssueList row={row} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {/* ---- running -------------------------------------------------- */}
        {phase === 'running' && plan ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-700">
              Creating {formatInt(done)} of {formatInt(plan.valid.length)}…
            </p>
            <ProgressBar value={done} max={Math.max(1, plan.valid.length)} aria-label="Import progress" />
          </div>
        ) : null}

        {/* ---- done ----------------------------------------------------- */}
        {phase === 'done' && outcome ? (
          <div className="space-y-3">
            <Notice kind={outcome.failed.length === 0 ? 'success' : 'warning'}>
              {formatInt(outcome.created)} {outcome.created === 1 ? 'category' : 'categories'} created
              {outcome.failed.length > 0 ? `, ${formatInt(outcome.failed.length)} refused by the API.` : '.'}
              {plan && plan.invalid.length > 0
                ? ` ${formatInt(plan.invalid.length)} ${plan.invalid.length === 1 ? 'row' : 'rows'} in the file were skipped before sending.`
                : ''}
            </Notice>
            {outcome.failed.length > 0 ? (
              <ul className="m-0 list-none space-y-1 p-0">
                {outcome.failed.map((f) => (
                  <li key={f.line} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
                    <strong className="font-semibold">Line {f.line}</strong> — {f.name}: {f.reason}
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

export default StockCategoryImportDrawer
