import { useMemo, useRef, useState } from 'react'
import { CheckCircle2, Download, FileSpreadsheet, TriangleAlert, Upload } from 'lucide-react'
import { Modal } from '../../../components/Modal'
import { Notice } from '../../../components/Notice'
import { Button } from '../../../ui/Button'
import { ProgressBar } from '../../../ui/ProgressBar'
import { Select } from '../../../ui/Select'
import { cx } from '../../../ui/cx'
import { downloadCsv } from '../../../utils/csv'
import { formatInt } from '../../../utils/format'
import { errorMessage } from '../../../services/api'
import { itemsApi } from '../../../services/items'
import { bomApi } from '../../../services/masters'
import {
  BOM_IMPORT_FIELDS,
  autoMap,
  buildPlan,
  codesInPlan,
  issuesToCsv,
  missingRequiredFields,
  parseDelimited,
  resolvePlan,
  templateCsv,
  toCreatePayload,
} from './bomImport'
import type {
  BomImportIssue,
  BomImportMapping,
  ParsedSheet,
  ResolvedItem,
} from './bomImport'

/**
 * Upload → map → validate → import.
 *
 * Four steps because the third one is the point. A bill of materials is a
 * production instruction, so nothing is written until every code in the file
 * has been resolved against this company's item master and the user has seen
 * what was rejected and why. Rows that fail come back as a CSV they can fix and
 * re-upload.
 *
 * Bills are created through the ordinary `POST /v1/bill-of-materials`, one at a
 * time, so every one of them goes through the same validation, the same
 * permission check and the same audit entry as a bill typed by hand. They are
 * created INACTIVE unless the sheet says otherwise.
 */

type Step = 'upload' | 'map' | 'validate' | 'done'

export interface BomImportDialogProps {
  open: boolean
  onClose: () => void
  onImported: () => void
}

interface ImportOutcome {
  created: number
  failed: { name: string; message: string }[]
}

export function BomImportDialog({ open, onClose, onImported }: BomImportDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [sheet, setSheet] = useState<ParsedSheet | null>(null)
  const [mapping, setMapping] = useState<BomImportMapping>({})
  const [items, setItems] = useState<ResolvedItem[]>([])
  const [issues, setIssues] = useState<BomImportIssue[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)

  const plan = useMemo(() => (sheet ? buildPlan(sheet, mapping) : null), [sheet, mapping])
  const resolved = useMemo(() => (plan ? resolvePlan(plan, items) : null), [plan, items])
  const allIssues = useMemo(
    () => [...(plan?.issues ?? []), ...(resolved?.issues ?? []), ...issues],
    [plan, resolved, issues],
  )
  const errorCount = allIssues.filter((i) => i.severity === 'error').length
  const warningCount = allIssues.filter((i) => i.severity === 'warning').length

  const reset = () => {
    setStep('upload')
    setFileName('')
    setSheet(null)
    setMapping({})
    setItems([])
    setIssues([])
    setError(null)
    setProgress(0)
    setOutcome(null)
    setBusy(false)
  }

  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  const readFile = async (file: File) => {
    setError(null)
    // The browser's own filename is echoed back to the user; it is rendered as
    // text, never as markup, and nothing downstream reads it.
    setFileName(file.name)
    try {
      const text = await file.text()
      const parsed = parseDelimited(text)
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setError('That file has no rows under a header. Save the sheet as CSV and try again.')
        return
      }
      setSheet(parsed)
      setMapping(autoMap(parsed.headers))
      setStep('map')
    } catch (err) {
      setError(errorMessage(err, 'That file could not be read.'))
    }
  }

  const validate = async () => {
    if (!plan) return
    setBusy(true)
    setError(null)
    setIssues([])
    try {
      const codes = codesInPlan(plan)
      const found = await itemsApi.bulkLookup({ item_skus: codes })
      setItems(found.map((i) => ({ item_id: i.item_id, item_sku: i.item_sku, item_name: i.item_name, is_active: i.is_active })))
      setStep('validate')
    } catch (err) {
      setError(errorMessage(err, 'Item codes could not be checked. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  const runImport = async () => {
    if (!resolved || resolved.ready.length === 0) return
    setBusy(true)
    setError(null)
    setProgress(0)
    const failed: ImportOutcome['failed'] = []
    let created = 0
    // Sequential on purpose: the API creates a bill in a transaction and the
    // user is watching a progress bar, not a race. Forty parallel writes would
    // also make a duplicate-name clash land in an unpredictable order.
    for (const [index, draft] of resolved.ready.entries()) {
      try {
        await bomApi.create(toCreatePayload(draft, items))
        created += 1
      } catch (err) {
        failed.push({ name: draft.bomName, message: errorMessage(err) })
      }
      setProgress(Math.round(((index + 1) / resolved.ready.length) * 100))
    }
    setOutcome({ created, failed })
    setIssues((current) => [
      ...current,
      ...failed.map((f) => ({
        row: 0,
        severity: 'error' as const,
        message: f.message,
        bomName: f.name,
        componentCode: '',
      })),
    ])
    setBusy(false)
    setStep('done')
    if (created > 0) onImported()
  }

  const downloadIssues = () => downloadCsv('bom-import-problems.csv', issuesToCsv(allIssues))
  const downloadTemplate = () => downloadCsv('bom-import-template.csv', templateCsv())

  const missing = missingRequiredFields(mapping)

  return (
    <Modal
      open={open}
      onClose={close}
      busy={busy}
      size="lg"
      title="Import bills of materials"
      description="Upload a CSV, match the columns, and review what will be created before anything is written."
      footer={
        <>
          {step === 'map' ? (
            <Button variant="secondary" onClick={() => setStep('upload')} disabled={busy}>
              Back
            </Button>
          ) : null}
          <Button variant="secondary" onClick={close} disabled={busy}>
            {step === 'done' ? 'Close' : 'Cancel'}
          </Button>
          {step === 'map' ? (
            <Button onClick={validate} loading={busy} disabled={missing.length > 0}>
              Validate
            </Button>
          ) : null}
          {step === 'validate' ? (
            <Button onClick={runImport} loading={busy} disabled={(resolved?.ready.length ?? 0) === 0}>
              Import {formatInt(resolved?.ready.length ?? 0)} bill
              {(resolved?.ready.length ?? 0) === 1 ? '' : 's'}
            </Button>
          ) : null}
          {step === 'done' ? <Button onClick={reset}>Import another file</Button> : null}
        </>
      }
    >
      <div className="space-y-4">
        <ol className="flex flex-wrap items-center gap-2 text-[10.5px]" aria-label="Import steps">
          {(['upload', 'map', 'validate', 'done'] as const).map((s, i) => (
            <li
              key={s}
              aria-current={step === s ? 'step' : undefined}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold',
                step === s ? 'bg-primary-light text-primary' : 'bg-gray-100 text-gray-500',
              )}
            >
              <span className="tabular-nums">{i + 1}</span>
              {{ upload: 'Upload', map: 'Map columns', validate: 'Validate', done: 'Result' }[s]}
            </li>
          ))}
        </ol>

        {error ? <Notice kind="error">{error}</Notice> : null}

        {step === 'upload' ? (
          <div className="space-y-3">
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50/60 px-6 py-10 text-center">
              <FileSpreadsheet className="mb-2 h-8 w-8 text-gray-400" aria-hidden />
              <p className="text-[13px] font-semibold text-gray-900">Choose a CSV file</p>
              <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-gray-500">
                One row per component. Rows sharing a BOM name become one bill of materials.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void readFile(file)
                  e.target.value = ''
                }}
              />
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Button icon={Upload} onClick={() => fileRef.current?.click()}>
                  Choose file
                </Button>
                <Button variant="secondary" icon={Download} onClick={downloadTemplate}>
                  Download template
                </Button>
              </div>
            </div>
            <p className="text-[10.5px] leading-relaxed text-gray-500">
              Imported bills are created inactive unless the sheet's Status column says otherwise, so
              nothing becomes a live manufacturing recipe without somebody activating it.
            </p>
          </div>
        ) : null}

        {step === 'map' && sheet ? (
          <div className="space-y-3">
            <p className="text-[11.5px] text-gray-600">
              <strong className="font-semibold text-gray-900">{fileName}</strong> — {formatInt(sheet.rows.length)} row
              {sheet.rows.length === 1 ? '' : 's'}. Matched columns are filled in already.
            </p>
            {missing.length > 0 ? (
              <Notice kind="warning">
                Still to match: {missing.map((m) => m.label).join(', ')}.
              </Notice>
            ) : null}
            <div className="grid gap-2.5 sm:grid-cols-2">
              {BOM_IMPORT_FIELDS.map((spec) => (
                <label key={spec.field} className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-gray-700">
                    {spec.label}
                    {spec.required ? <span className="text-red-600"> *</span> : null}
                  </span>
                  <Select
                    size="md"
                    value={mapping[spec.field] ?? ''}
                    onChange={(e) =>
                      setMapping((m) => ({
                        ...m,
                        [spec.field]: e.target.value === '' ? undefined : Number(e.target.value),
                      }))
                    }
                  >
                    <option value="">Not in this file</option>
                    {sheet.headers.map((header, i) => (
                      <option key={`${header}-${i}`} value={i}>
                        {header || `Column ${i + 1}`}
                      </option>
                    ))}
                  </Select>
                  <span className="text-[10px] text-gray-400">{spec.hint}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {step === 'validate' && resolved && plan ? (
          <div className="space-y-3">
            <div className="grid gap-2.5 sm:grid-cols-3">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                <small className="block text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  Ready to import
                </small>
                <strong className="mt-1 block text-lg font-bold text-emerald-800">
                  {formatInt(resolved.ready.length)}
                </strong>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50/60 p-3">
                <small className="block text-[10px] font-semibold uppercase tracking-wide text-red-700">Errors</small>
                <strong className="mt-1 block text-lg font-bold text-red-700">{formatInt(errorCount)}</strong>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                <small className="block text-[10px] font-semibold uppercase tracking-wide text-amber-700">Warnings</small>
                <strong className="mt-1 block text-lg font-bold text-amber-800">{formatInt(warningCount)}</strong>
              </div>
            </div>

            {allIssues.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-400">What was rejected</h3>
                  <Button variant="ghost" size="xs" icon={Download} onClick={downloadIssues}>
                    Download report
                  </Button>
                </div>
                <ul className="scrollbar-thin max-h-56 list-none space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
                  {allIssues.slice(0, 200).map((issue, i) => (
                    <li
                      key={`${issue.row}-${i}`}
                      className={cx(
                        'flex items-start gap-1.5 rounded px-2 py-1.5 text-[11px]',
                        issue.severity === 'error' ? 'bg-red-50/60 text-red-700' : 'bg-amber-50/60 text-amber-900',
                      )}
                    >
                      <TriangleAlert className="mt-px h-3 w-3 shrink-0" aria-hidden />
                      <span>
                        {issue.row > 0 ? <strong className="font-semibold">Row {issue.row}: </strong> : null}
                        {issue.message}
                      </span>
                    </li>
                  ))}
                </ul>
                {allIssues.length > 200 ? (
                  <p className="text-[10.5px] text-gray-500">
                    Showing the first 200. Download the report for all {formatInt(allIssues.length)}.
                  </p>
                ) : null}
              </div>
            ) : (
              <Notice kind="success">Every row checks out. Nothing will be skipped.</Notice>
            )}

            {resolved.ready.length === 0 ? (
              <Notice kind="warning">
                No complete bill could be built from this file. Fix the problems above and upload it
                again — nothing has been created.
              </Notice>
            ) : null}
          </div>
        ) : null}

        {busy && step === 'validate' ? <ProgressBar value={progress} /> : null}

        {step === 'done' && outcome ? (
          <div className="space-y-3">
            <div
              className={cx(
                'flex items-start gap-2.5 rounded-xl border p-4',
                outcome.failed.length === 0 ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/60',
              )}
            >
              <CheckCircle2
                className={cx('mt-0.5 h-5 w-5 shrink-0', outcome.failed.length === 0 ? 'text-emerald-600' : 'text-amber-600')}
                aria-hidden
              />
              <div>
                <p className="text-[13px] font-semibold text-gray-900">
                  {formatInt(outcome.created)} bill{outcome.created === 1 ? '' : 's'} created.
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-600">
                  {outcome.failed.length > 0
                    ? `${formatInt(outcome.failed.length)} could not be created — they are in the report below.`
                    : 'They are inactive until somebody activates them.'}
                </p>
              </div>
            </div>
            {allIssues.length > 0 ? (
              <Button variant="secondary" icon={Download} onClick={downloadIssues}>
                Download the problem report
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

export default BomImportDialog
