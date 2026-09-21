import { useRef, useState } from 'react'
import { ArrowRight, Sparkles } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'
import { Textarea } from '../../ui/Textarea'
import { AIC, cx } from '../../ui/cx'
import { errorMessage, isAbortError } from '../../services/api'
import type { AssistResponse } from './assistant'

interface StockJournalAssistantProps {
  onGenerate: (prompt: string, signal: AbortSignal) => Promise<AssistResponse>
  /** Called with the suggestions once they come back; the page turns them into rows. */
  onSuggestions: (response: AssistResponse) => void
  disabled?: boolean
}

/**
 * Describe the movement in words; get draft lines back.
 *
 * The panel is careful about what it claims. It says where the draft came from,
 * it repeats every warning the generator produced, and the rows it adds are
 * marked "review" on the grid until the user has looked at them. It cannot post
 * anything — it only ever appends editable lines.
 */
export function StockJournalAssistant({ onGenerate, onSuggestions, disabled }: StockJournalAssistantProps) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const controllerRef = useRef<AbortController | null>(null)

  const run = async () => {
    const text = prompt.trim()
    if (!text || busy) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setError(null)
    setWarnings([])
    try {
      const response = await onGenerate(text, controller.signal)
      if (controller.signal.aborted) return
      setWarnings(response.warnings)
      onSuggestions(response)
      if (response.suggestions.length > 0) setPrompt('')
    } catch (err) {
      if (isAbortError(err)) return
      setError(errorMessage(err, 'Could not draft those lines.'))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return (
    <Card padding="md" data-sj-assistant className={cx(AIC, 'bg-primary-light/30')}>
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold text-gray-900">AI Assistant</h3>
      </div>

      <p className="text-[13px] font-semibold text-gray-900">Need help?</p>
      <p className="mb-2.5 mt-1 text-xs leading-relaxed text-gray-500">
        Explain what you want to do in simple language.
      </p>

      <Textarea
        rows={4}
        value={prompt}
        disabled={disabled || busy}
        aria-label="Describe the stock movement"
        placeholder="e.g. Transfer 10 units of Item ABC from Main to Branch 2 due to damage"
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl+Enter drafts the lines. The page binds the same combo to the
          // post confirmation on a window listener in the CAPTURE phase, which
          // no handler here can stop — so the page checks for this wrapper's
          // data attribute and stands down instead.
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault()
            void run()
          }
        }}
      />

      <Button
        block
        className="mt-2"
        loading={busy}
        disabled={disabled || !prompt.trim()}
        iconRight={busy ? undefined : ArrowRight}
        onClick={() => void run()}
      >
        {busy ? 'Drafting…' : 'Generate Entries'}
      </Button>

      {error ? (
        <p className="mt-2 text-[11px] text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="mt-2 space-y-1" aria-live="polite">
          {warnings.map((w) => (
            <li key={w} className="text-[11px] leading-relaxed text-amber-700">
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-2.5 border-t border-primary/15 pt-2 text-[11px] leading-relaxed text-gray-500">
        Generated lines are drafts. They stay editable, are validated like any other line, and are
        never posted for you.
      </p>
    </Card>
  )
}
