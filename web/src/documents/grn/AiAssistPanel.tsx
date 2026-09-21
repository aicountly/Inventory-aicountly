import { useCallback, useRef, useState } from 'react'
import { AlertTriangle, Check, CloudUpload, FileSearch, Info, Sparkles } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { ProgressBar } from '../../ui/ProgressBar'
import { AIC, cx } from '../../ui/cx'
import { isAbortError } from '../../services/api'
import { ACCEPTED_UPLOAD_LABEL, UploadRejected, aiDocumentApi } from '../../services/aiDocumentApi'
import type { GrnExtraction } from '../../services/aiDocumentApi'

export type AiPanelState = 'idle' | 'uploading' | 'processing' | 'success' | 'partial' | 'unavailable' | 'error'

export interface AiAssistPanelProps {
  /** Called once an extraction comes back. The caller must get the user's approval before use. */
  onExtracted: (extraction: GrnExtraction, fileName: string) => void
  disabled?: boolean
}

const BENEFITS = [
  'Reads supplier, items and quantities',
  'Matches with open purchase orders',
  'Detects discrepancies',
  'Suggests correct warehouse & tax details',
]

/**
 * Aicountly AI — read the supplier's challan instead of typing it.
 *
 * The panel does one thing: turn a file into a *suggestion*. It never writes to the form
 * directly and it never posts. Whatever comes back goes to `onExtracted`, which opens the review
 * drawer where each value is accepted or rejected by the person receiving the goods. A document
 * that moves stock on the strength of an OCR pass nobody read is not a feature.
 *
 * Every state the upload can be in is drawn here — including "the extraction service is not
 * connected to this company yet", which is the honest answer while the endpoint is pending and
 * is far better than a spinner that never resolves.
 */
export function AiAssistPanel({ onExtracted, disabled }: AiAssistPanelProps) {
  const [state, setState] = useState<AiPanelState>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const run = useCallback(
    async (file: File) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      setFileName(file.name)
      setMessage(null)
      setState('uploading')
      try {
        // The read + transfer is the "uploading" half; the model's pass is the "processing"
        // half. There is no progress event to hang this on, so the state flips once the request
        // is in flight rather than pretending to a percentage nobody measured.
        const pending = aiDocumentApi.extractGrn(file, controller.signal)
        setState('processing')
        const result = await pending
        if (controller.signal.aborted) return
        if (!result.available) {
          setState('unavailable')
          setMessage(result.message)
          return
        }
        const extraction = result.data
        const complete = extraction.lines.length > 0 && extraction.supplier !== null
        setState(complete ? 'success' : 'partial')
        setMessage(
          complete
            ? `Read ${extraction.lines.length} line${extraction.lines.length === 1 ? '' : 's'} from ${file.name}.`
            : `Only part of ${file.name} could be read. Review what was found and fill the rest.`,
        )
        onExtracted(extraction, file.name)
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) return
        setState('error')
        setMessage(err instanceof UploadRejected ? err.message : 'The document could not be processed. Try again, or enter the challan by hand.')
      }
    },
    [onExtracted],
  )

  const busy = state === 'uploading' || state === 'processing'

  const onFiles = (files: FileList | null) => {
    const file = files?.[0]
    if (file) void run(file)
  }

  return (
    <section
      className={cx(AIC, 'rounded-xl border border-gray-200 bg-white p-3.5 shadow-card')}
      aria-labelledby="grn-ai-title"
    >
      <div className="flex items-start gap-2.5">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-800 text-white"
          aria-hidden
        >
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 id="grn-ai-title" className="truncate text-sm font-semibold text-gray-900">
              Aicountly AI
            </h2>
            <Badge tone="beta" size="xs">
              Beta
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-gray-500">Scan, match and fill your GRN automatically.</p>
        </div>
      </div>

      <div
        className={cx(
          'mt-3 flex flex-col items-center gap-1.5 rounded-xl border border-dashed px-3 py-5 text-center transition-colors',
          dragging ? 'border-violet-400 bg-violet-50' : 'border-violet-200 bg-violet-50/40',
        )}
        onDragOver={(e) => {
          if (disabled || busy) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (disabled || busy) return
          e.preventDefault()
          setDragging(false)
          onFiles(e.dataTransfer.files)
        }}
      >
        <CloudUpload className="h-6 w-6 text-violet-500" aria-hidden />
        <p className="text-xs font-semibold text-gray-700">Drag &amp; drop challan / invoice</p>
        <p className="text-[10px] text-gray-500">({ACCEPTED_UPLOAD_LABEL}, up to 10 MB)</p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="sr-only"
          disabled={disabled || busy}
          onChange={(e) => {
            onFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <Button
          className="mt-1.5 bg-violet-600 text-white hover:bg-violet-700"
          icon={Sparkles}
          size="sm"
          loading={busy}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (state === 'uploading' ? 'Uploading…' : 'Reading document…') : 'Upload & Auto-Fill'}
        </Button>
      </div>

      {busy ? (
        <div className="mt-2.5">
          <ProgressBar value={state === 'uploading' ? 35 : 75} />
          <p className="mt-1 truncate text-[11px] text-gray-500">{fileName}</p>
        </div>
      ) : null}

      {message ? <StatusNote state={state} message={message} /> : null}

      <ul className="mt-3.5 space-y-2.5">
        {BENEFITS.map((benefit) => (
          <li key={benefit} className="flex items-start gap-2 text-[11px] leading-snug text-gray-600">
            <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600" aria-hidden>
              <Check className="h-2.5 w-2.5" strokeWidth={3} />
            </span>
            {benefit}
          </li>
        ))}
      </ul>

      <p className="mt-3 flex items-start gap-1.5 border-t border-gray-100 pt-2.5 text-[10px] leading-snug text-gray-500">
        <FileSearch className="mt-px h-3 w-3 shrink-0" aria-hidden />
        Everything read from a document is shown for your approval first. Nothing is saved or posted until you say so.
      </p>
    </section>
  )
}

function StatusNote({ state, message }: { state: AiPanelState; message: string }) {
  const tone =
    state === 'success'
      ? { cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', Icon: Check }
      : state === 'error'
        ? { cls: 'border-red-200 bg-red-50 text-red-800', Icon: AlertTriangle }
        : state === 'partial'
          ? { cls: 'border-amber-200 bg-amber-50 text-amber-800', Icon: AlertTriangle }
          : { cls: 'border-sky-200 bg-sky-50 text-sky-800', Icon: Info }
  const { cls, Icon } = tone
  return (
    <p className={cx('mt-2.5 flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] leading-snug', cls)} role="status">
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">{message}</span>
    </p>
  )
}

export default AiAssistPanel
