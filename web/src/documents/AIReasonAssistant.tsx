import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Sparkles } from 'lucide-react'
import { isAbortError } from '../services/api'
import { aiApi } from '../services/aiApi'
import type { WriteOffReasonSuggestion } from '../services/aiApi'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { cx } from '../ui/cx'

const CONFIDENCE_TONE: Record<WriteOffReasonSuggestion['confidence'], string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-amber-50 text-amber-700',
  high: 'bg-emerald-50 text-emerald-700',
}

type Status = 'idle' | 'loading' | 'unavailable' | 'ready'

interface AIReasonAssistantProps {
  warehouseId: number | null
  onApply: (suggestion: { reasonCode: string; remark: string | null }) => void
  disabled?: boolean
}

/**
 * Advisory reason-code helper. It never posts the document and never changes a
 * field on its own — a suggestion only reaches the form when the user clicks
 * "Use this suggestion". See services/aiApi.ts for why this calls an endpoint
 * that does not exist yet, and why that failure is handled quietly here.
 */
export function AIReasonAssistant({ warehouseId, onApply, disabled }: AIReasonAssistantProps) {
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<WriteOffReasonSuggestion | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => controllerRef.current?.abort(), [])

  const ask = async () => {
    const text = description.trim()
    if (!text) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setStatus('loading')
    setResult(null)
    try {
      const suggestion = await aiApi.suggestWriteOffReason({ description: text, warehouseId }, controller.signal)
      if (controller.signal.aborted) return
      setResult(suggestion)
      setStatus('ready')
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) return
      // Expected today — no AI endpoint exists in server-php yet. Degrade
      // quietly: the reason-code field above still works without this panel.
      setStatus('unavailable')
    }
  }

  return (
    <aside className="aic flex h-full flex-col gap-2 rounded-xl border border-violet-200 bg-violet-50 p-3.5">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white text-violet-600">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
        </span>
        <strong className="text-sm text-gray-900">Aicountly AI</strong>
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-700">Not sure which reason to use?</p>
        <p className="mt-0.5 text-xs text-gray-500">Describe the issue and I&rsquo;ll suggest the best option. Nothing changes until you accept it.</p>
      </div>

      {/* A <form> nested inside DocumentForm's own <form> is invalid HTML (and
          browsers silently hoist it out, breaking Enter-to-submit) — so this
          is a plain row with an Enter-key handler, not a second form. */}
      <div className="mt-auto flex items-center gap-1.5">
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void ask()
            }
          }}
          placeholder="e.g. Items damaged due to water…"
          aria-label="Describe the stock write-off issue for Aicountly AI"
          disabled={disabled}
        />
        <Button
          type="button"
          onClick={() => void ask()}
          variant="primary"
          size="sm"
          className="shrink-0 !px-2.5"
          loading={status === 'loading'}
          disabled={disabled || !description.trim()}
          aria-label="Suggest a reason code"
        >
          {status !== 'loading' ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
        </Button>
      </div>

      {status === 'unavailable' ? <p className="text-[11px] text-gray-500">Aicountly AI suggestions aren&rsquo;t available in this workspace yet — pick a reason above.</p> : null}

      {status === 'ready' && result ? (
        <div className="rounded-lg border border-violet-200 bg-white p-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-500">Suggested reason</span>
            <span className={cx('rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', CONFIDENCE_TONE[result.confidence])}>{result.confidence} confidence</span>
          </div>
          <p className="mt-0.5 text-sm font-semibold text-gray-900">{result.reason_code}</p>
          {result.remark ? <p className="mt-1 text-gray-600">{result.remark}</p> : null}
          <Button variant="outline" size="xs" className="mt-2" onClick={() => onApply({ reasonCode: result.reason_code, remark: result.remark })}>
            Use this suggestion
          </Button>
        </div>
      ) : null}
    </aside>
  )
}
