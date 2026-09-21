/**
 * Bulk intake for serial numbers: scan one at a time, paste a block, or read a file.
 *
 * All three land on the same pipeline — parse, check every value against `GET /v1/serials`,
 * show the operator exactly what came back, and only then add rows. Nothing here posts, and
 * nothing is added that the API did not confirm; a serial the master does not know is listed
 * as not found rather than quietly created.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ClipboardList, Copy, Download, FileUp, ScanLine, Upload } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { Input } from '../../ui/Input'
import { ProgressBar } from '../../ui/ProgressBar'
import { Textarea } from '../../ui/Textarea'
import { AIC, cx } from '../../ui/cx'
import { StatusBadge } from '../../ui/StatusBadge'
import { isAbortError } from '../../services/api'
import type { SerialLookupRow } from '../../services/lookupApi'
import { resolveSerial, resolveSerials } from './resolver'
import { IMPORT_TEMPLATE_CSV, SERIAL_MAX_LENGTH, parseDelimitedSerials, parseSerialList, humanStatus, STOCK_BEARING_STATUSES } from './model'

export type IntakeMode = 'scan' | 'paste' | 'import'

export type IntakeState = 'ok' | 'warning' | 'duplicate' | 'missing' | 'error'

export interface IntakeResult {
  serial_no: string
  row: SerialLookupRow | null
  state: IntakeState
  message: string | null
}

export interface SerialIntakeDrawerProps {
  open: boolean
  mode: IntakeMode
  onModeChange: (mode: IntakeMode) => void
  onClose: () => void
  /** Lower-cased serial numbers already on the grid, for duplicate detection. */
  taken: ReadonlySet<string>
  /** Add these to the grid. Called per scan in scan mode, once per batch otherwise. */
  onAccept: (results: IntakeResult[]) => void
}

const MAX_FILE_BYTES = 2 * 1024 * 1024
const ACCEPTED_FILE = '.csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values'

function classify(serialNo: string, row: SerialLookupRow | null, error: string | null, taken: ReadonlySet<string>): IntakeResult {
  if (error) return { serial_no: serialNo, row: null, state: 'error', message: error }
  if (taken.has(serialNo.trim().toLowerCase())) {
    return { serial_no: serialNo, row, state: 'duplicate', message: 'Already on this document.' }
  }
  if (!row) return { serial_no: serialNo, row: null, state: 'missing', message: 'Not in the serial master.' }
  if (!STOCK_BEARING_STATUSES.includes(String(row.status))) {
    return { serial_no: serialNo, row, state: 'warning', message: `Currently ${humanStatus(row.status)}.` }
  }
  return { serial_no: serialNo, row, state: 'ok', message: null }
}

const STATE_STYLE: Record<IntakeState, { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string }> = {
  ok: { tone: 'success', label: 'Found' },
  warning: { tone: 'warning', label: 'Review' },
  duplicate: { tone: 'neutral', label: 'Duplicate' },
  missing: { tone: 'danger', label: 'Not found' },
  error: { tone: 'danger', label: 'Failed' },
}

const MODE_TABS: { value: IntakeMode; label: string; icon: typeof ScanLine }[] = [
  { value: 'scan', label: 'Scan', icon: ScanLine },
  { value: 'paste', label: 'Paste list', icon: ClipboardList },
  { value: 'import', label: 'Import file', icon: FileUp },
]

export function SerialIntakeDrawer({ open, mode, onModeChange, onClose, taken, onAccept }: SerialIntakeDrawerProps) {
  const [scanValue, setScanValue] = useState('')
  const [scanBusy, setScanBusy] = useState(false)
  const [log, setLog] = useState<IntakeResult[]>([])
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [results, setResults] = useState<IntakeResult[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const scanRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // A scanner sends its payload followed by Enter into whatever holds focus, so the field
  // must take focus back after every scan or the second barcode goes nowhere.
  useEffect(() => {
    if (open && mode === 'scan') {
      const id = setTimeout(() => scanRef.current?.focus(), 60)
      return () => clearTimeout(id)
    }
    return undefined
  }, [open, mode])

  useEffect(() => {
    if (open) return undefined
    return () => abortRef.current?.abort()
  }, [open])

  const reset = useCallback(() => {
    setScanValue('')
    setLog([])
    setText('')
    setFileName(null)
    setFileError(null)
    setResults(null)
    setProgress(null)
  }, [])

  const close = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    reset()
    onClose()
  }, [onClose, reset])

  const submitScan = useCallback(
    async (value: string) => {
      const serial = value.trim()
      if (serial === '' || scanBusy) return
      setScanBusy(true)
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const resolved = await resolveSerial(serial, controller.signal)
        const result = classify(serial, resolved.row, resolved.error, taken)
        setLog((l) => [result, ...l].slice(0, 60))
        if (result.state === 'ok' || result.state === 'warning') onAccept([result])
        setScanValue('')
      } catch (err) {
        if (!isAbortError(err)) {
          const failure: IntakeResult = { serial_no: serial, row: null, state: 'error', message: 'Could not reach the serial master.' }
          setLog((l) => [failure, ...l].slice(0, 60))
        }
      } finally {
        setScanBusy(false)
        abortRef.current = null
        scanRef.current?.focus()
      }
    },
    [onAccept, scanBusy, taken],
  )

  const parsed = useMemo(() => (mode === 'import' ? parseDelimitedSerials(text) : parseSerialList(text)), [text, mode])
  const alreadyOnGrid = useMemo(() => parsed.serials.filter((s) => taken.has(s.toLowerCase())).length, [parsed.serials, taken])

  const validate = useCallback(async () => {
    if (parsed.serials.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller
    setChecking(true)
    setResults(null)
    setProgress({ done: 0, total: parsed.serials.length })
    try {
      const resolved = await resolveSerials(parsed.serials, {
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      setResults(resolved.map((r) => classify(r.query, r.row, r.error, taken)))
    } catch (err) {
      if (!isAbortError(err)) setFileError('Could not check these serial numbers against the serial master.')
    } finally {
      setChecking(false)
      setProgress(null)
      abortRef.current = null
    }
  }, [parsed.serials, taken])

  const readFile = useCallback(async (file: File) => {
    setFileError(null)
    setResults(null)
    if (file.size > MAX_FILE_BYTES) {
      setFileError(`${file.name} is larger than 2 MB. Split it, or paste the serial numbers instead.`)
      return
    }
    const name = file.name.toLowerCase()
    if (!/\.(csv|tsv|txt)$/.test(name)) {
      setFileError('Only .csv, .tsv and .txt files can be read here.')
      return
    }
    try {
      const content = await file.text()
      setFileName(file.name)
      setText(content)
    } catch {
      setFileError('That file could not be read.')
    }
  }, [])

  const downloadTemplate = useCallback(() => {
    const blob = new Blob([IMPORT_TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'serial-adjustment-template.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [])

  const usable = results?.filter((r) => r.state === 'ok' || r.state === 'warning') ?? []

  const accept = useCallback(() => {
    if (usable.length === 0) return
    onAccept(usable)
    close()
  }, [close, onAccept, usable])

  const counts = useMemo(() => {
    const out = { ok: 0, warning: 0, duplicate: 0, missing: 0, error: 0 }
    for (const r of results ?? []) out[r.state] += 1
    return out
  }, [results])

  return (
    <Drawer
      open={open}
      onClose={close}
      width="lg"
      title="Add serial numbers"
      description="Every serial is checked against the live serial master before it reaches the grid. Nothing is posted from here."
      footer={
        mode === 'scan' ? (
          <div className="flex items-center justify-between gap-3 w-full">
            <span className="text-[11px] text-gray-500">
              {log.filter((l) => l.state === 'ok' || l.state === 'warning').length} added this session
            </span>
            <Button variant="secondary" onClick={close}>
              Done
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 w-full">
            <span className="text-[11px] text-gray-500">
              {results ? `${usable.length} of ${results.length} can be added` : `${parsed.serials.length} serial${parsed.serials.length === 1 ? '' : 's'} detected`}
            </span>
            <span className="flex items-center gap-2">
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              {results ? (
                <Button variant="primary" onClick={accept} disabled={usable.length === 0}>
                  Add {usable.length} serial{usable.length === 1 ? '' : 's'}
                </Button>
              ) : (
                <Button variant="primary" onClick={() => void validate()} loading={checking} disabled={parsed.serials.length === 0}>
                  Check {parsed.serials.length || ''} serial{parsed.serials.length === 1 ? '' : 's'}
                </Button>
              )}
            </span>
          </div>
        )
      }
    >
      <div className={cx(AIC, 'space-y-4')}>
        <div role="tablist" aria-label="How to add serial numbers" className="flex gap-1 p-1 bg-gray-100 rounded-lg">
          {MODE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={mode === tab.value}
              className={cx(
                'flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-md text-xs font-medium transition-colors',
                mode === tab.value ? 'bg-white text-gray-900 shadow-card' : 'text-gray-600 hover:text-gray-900',
              )}
              onClick={() => {
                setResults(null)
                onModeChange(tab.value)
              }}
            >
              <tab.icon className="w-3.5 h-3.5" aria-hidden />
              {tab.label}
            </button>
          ))}
        </div>

        {mode === 'scan' ? (
          <div className="space-y-3">
            <label htmlFor="sa-scan-input" className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Scan or type, then press Enter
            </label>
            <Input
              id="sa-scan-input"
              ref={scanRef}
              size="md"
              value={scanValue}
              autoComplete="off"
              spellCheck={false}
              placeholder="Waiting for a scan…"
              className="font-mono text-base h-12"
              onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void submitScan(e.currentTarget.value)
                }
              }}
            />
            <p className="text-[11px] text-gray-500">
              The field takes focus back after every scan, so a whole rack can be read without touching the mouse.
              Each serial found is added to the grid straight away.
            </p>
            {log.length > 0 ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Recently scanned</p>
                <ResultList results={log} />
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === 'paste' ? (
          <div className="space-y-3">
            <label htmlFor="sa-paste-input" className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              One serial number per line
            </label>
            <Textarea
              id="sa-paste-input"
              rows={9}
              monospace
              value={text}
              placeholder={'SN-10001\nSN-10002\nSN-10003'}
              onChange={(e) => {
                setText(e.target.value)
                setResults(null)
              }}
            />
            <IntakeCounts parsed={parsed} alreadyOnGrid={alreadyOnGrid} />
          </div>
        ) : null}

        {mode === 'import' ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/60 p-5 text-center">
              <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" aria-hidden />
              <p className="text-xs text-gray-600 mb-3">
                A CSV, TSV or text file. If a column heading contains &ldquo;serial&rdquo; that column is read; otherwise
                every line is taken as one serial number.
              </p>
              <label className="inline-flex">
                <span className="sr-only">Choose a file of serial numbers</span>
                <input
                  type="file"
                  accept={ACCEPTED_FILE}
                  className="block text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-200 file:text-xs file:font-medium file:bg-white hover:file:border-primary/40 file:cursor-pointer"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void readFile(file)
                  }}
                />
              </label>
              {fileName ? <p className="mt-2 text-[11px] text-gray-500">Read {fileName}</p> : null}
              {fileError ? <p className="mt-2 text-[11px] text-red-600">{fileError}</p> : null}
            </div>
            <Button variant="ghost" size="xs" icon={Download} onClick={downloadTemplate}>
              Download template
            </Button>
            <IntakeCounts parsed={parsed} alreadyOnGrid={alreadyOnGrid} />
          </div>
        ) : null}

        {checking && progress ? (
          <div>
            <p className="text-[11px] text-gray-500 mb-1">
              Checking {progress.done} of {progress.total}…
            </p>
            <ProgressBar value={progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)} />
          </div>
        ) : null}

        {results ? (
          <div>
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              {counts.ok > 0 ? <Badge tone="success" size="xs">{counts.ok} found</Badge> : null}
              {counts.warning > 0 ? <Badge tone="warning" size="xs">{counts.warning} to review</Badge> : null}
              {counts.duplicate > 0 ? <Badge tone="neutral" size="xs">{counts.duplicate} already added</Badge> : null}
              {counts.missing > 0 ? <Badge tone="danger" size="xs">{counts.missing} not found</Badge> : null}
              {counts.error > 0 ? <Badge tone="danger" size="xs">{counts.error} failed</Badge> : null}
            </div>
            <ResultList results={results} />
          </div>
        ) : null}
      </div>
    </Drawer>
  )
}

function IntakeCounts({ parsed, alreadyOnGrid }: { parsed: ReturnType<typeof parseSerialList>; alreadyOnGrid: number }) {
  if (parsed.serials.length === 0 && parsed.duplicates.length === 0 && parsed.tooLong.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone="info" size="xs">
        {parsed.serials.length} detected
      </Badge>
      {parsed.duplicates.length > 0 ? (
        <Badge tone="neutral" size="xs">
          {parsed.duplicates.length} repeated in the list
        </Badge>
      ) : null}
      {alreadyOnGrid > 0 ? (
        <Badge tone="warning" size="xs">
          {alreadyOnGrid} already on the document
        </Badge>
      ) : null}
      {parsed.tooLong.length > 0 ? (
        <Badge tone="danger" size="xs">
          {parsed.tooLong.length} longer than {SERIAL_MAX_LENGTH} characters
        </Badge>
      ) : null}
    </div>
  )
}

function ResultList({ results }: { results: IntakeResult[] }) {
  return (
    <ul className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100 list-none p-0 m-0">
      {results.map((r, i) => {
        const style = STATE_STYLE[r.state]
        return (
          <li key={`${r.serial_no}-${i}`} className="flex items-center gap-2 px-2.5 py-1.5">
            {r.state === 'ok' ? (
              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden />
            ) : r.state === 'duplicate' ? (
              <Copy className="w-3.5 h-3.5 text-gray-400 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className={cx('w-3.5 h-3.5 shrink-0', r.state === 'warning' ? 'text-amber-500' : 'text-red-500')} aria-hidden />
            )}
            <span className="font-mono text-[11.5px] text-gray-900 truncate">{r.serial_no}</span>
            <span className="text-[11px] text-gray-500 truncate min-w-0 flex-1">
              {r.row?.item_name ?? r.message ?? ''}
              {r.row && r.message ? ` · ${r.message}` : ''}
            </span>
            {r.row?.status ? <StatusBadge value={r.row.status} size="xs" /> : <Badge tone={style.tone} size="xs">{style.label}</Badge>}
          </li>
        )
      })}
    </ul>
  )
}
