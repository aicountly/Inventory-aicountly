import { useCallback, useState } from 'react'
import { ArrowRight, Send, Sparkles } from 'lucide-react'
import { Badge, Button, Drawer, cx } from '../../../ui'
import { Notice } from '../../../components/Notice'
import {
  WarehouseIntelligenceUnavailableError,
  warehouseIntelligenceService,
} from '../../../services/warehouseIntelligence'
import type { WarehouseAiAnswer, WarehouseFact } from '../../../services/warehouseIntelligence'
import { errorMessage } from '../../../services/api'

/**
 * "Ask Aicountly AI", and the panel behind it.
 *
 * The panel is wired to `warehouseIntelligenceService`, which answers what it
 * can from the warehouse figures the page already holds and refuses the rest
 * until an assistant endpoint is configured. That refusal is shown as a plain
 * status — "AI connection not configured" — and never as a sentence that looks
 * like an answer. A fabricated reply about which warehouse to transfer stock to
 * is not a demo, it is a wrong instruction to an operations team.
 *
 * Nothing on this screen is blocked by it: every figure the panel reasons over
 * is already visible in the table, the KPI strip and the cards below.
 */

interface Exchange {
  id: number
  question: string
  answer: WarehouseAiAnswer | null
  error: string | null
  pending: boolean
}

export interface WarehouseAiAssistantProps {
  facts: readonly WarehouseFact[]
  open: boolean
  onOpenChange: (open: boolean) => void
  className?: string
}

/**
 * The header card. A button, not a decorated div, so it is reachable by Tab and
 * activates on Enter and Space like every other control on the page.
 */
export function WarehouseAiCard({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        // A flat wash, not a gradient: dark-overrides.css can remap `bg-emerald-50`,
        // but nothing can reach a `--tw-gradient-from`, so a gradient card would stay
        // pale green on a dark page.
        'group aic flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50',
        'px-3 py-2.5 text-left transition-all hover:-translate-y-px hover:border-emerald-300 hover:shadow-card',
        'min-w-0 sm:min-w-[320px]',
        className,
      )}
    >
      <AiOrb />
      <span className="min-w-0 flex-1 grid gap-0.5">
        <span className="text-[13px] font-semibold text-gray-900">Ask Aicountly AI</span>
        <span className="text-[11px] text-gray-500 truncate">Get insights, find stock, suggest locations…</span>
      </span>
      <span className="w-7 h-7 shrink-0 grid place-items-center rounded-lg bg-white text-sky-600 transition-transform group-hover:translate-x-0.5" aria-hidden>
        <ArrowRight className="w-3.5 h-3.5" />
      </span>
    </button>
  )
}

/**
 * The pulse. `motion-safe:` keeps it out of the way of anyone who has asked
 * their system for reduced motion — the orb is still there, it simply stops
 * breathing.
 */
function AiOrb() {
  return (
    <span className="relative w-9 h-9 shrink-0 grid place-items-center" aria-hidden>
      <span className="absolute inset-0 rounded-full bg-emerald-400/30 motion-safe:animate-ping" />
      <span className="absolute inset-1 rounded-full bg-gradient-to-br from-emerald-300 to-emerald-500" />
      <Sparkles className="relative w-3.5 h-3.5 text-white" />
    </span>
  )
}

export function WarehouseAiAssistant({ facts, open, onOpenChange }: WarehouseAiAssistantProps) {
  const [question, setQuestion] = useState('')
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const configured = warehouseIntelligenceService.isConfigured()

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (trimmed === '') return
      const id = Date.now()
      setExchanges((prev) => [...prev, { id, question: trimmed, answer: null, error: null, pending: true }])
      setQuestion('')
      try {
        const answer = await warehouseIntelligenceService.ask({ question: trimmed, facts })
        setExchanges((prev) => prev.map((e) => (e.id === id ? { ...e, answer, pending: false } : e)))
      } catch (err) {
        const message =
          err instanceof WarehouseIntelligenceUnavailableError
            ? 'AI connection not configured. This question needs the Aicountly AI service, which is not connected in this environment yet.'
            : errorMessage(err)
        setExchanges((prev) => prev.map((e) => (e.id === id ? { ...e, error: message, pending: false } : e)))
      }
    },
    [facts],
  )

  return (
    <Drawer
      open={open}
      title="Ask Aicountly AI"
      description="Answers are computed from this company's live warehouse figures."
      badge={<Badge tone={configured ? 'success' : 'neutral'} size="xs">{configured ? 'Connected' : 'Local answers only'}</Badge>}
      onClose={() => onOpenChange(false)}
      width="md"
      footer={
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void ask(question)
          }}
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about capacity, stock or locations…"
            aria-label="Ask Aicountly AI a question about your warehouses"
            className="flex-1 h-9 min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-900 outline-none focus:border-primary/50"
          />
          <Button type="submit" size="sm" icon={Send} disabled={question.trim() === ''}>
            Ask
          </Button>
        </form>
      }
    >
      {!configured ? (
        <Notice kind="info">
          The Aicountly AI service is not connected in this environment. Questions that can be answered from the figures on this
          screen — capacity, stock on hand, negative balances — are answered here; anything else will say so rather than guess.
        </Notice>
      ) : null}

      <div className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Try asking</p>
        <ul className="flex flex-wrap gap-1.5">
          {warehouseIntelligenceService.suggestions().map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => void ask(s)}
                className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-600 transition-colors hover:border-primary/40 hover:bg-primary-light/40"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <ul className="mt-4 space-y-3" aria-live="polite">
        {exchanges.map((e) => (
          <li key={e.id} className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-900">{e.question}</p>
            {e.pending ? (
              <p className="text-xs text-gray-500">Thinking…</p>
            ) : e.error ? (
              <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">{e.error}</p>
            ) : (
              <p className="rounded-lg bg-gray-50 px-2.5 py-2 text-[11px] leading-relaxed text-gray-700">{e.answer?.text}</p>
            )}
          </li>
        ))}
      </ul>

      {exchanges.length === 0 ? (
        <p className="mt-4 text-[11px] text-gray-500">
          Every answer is derived from the {facts.length} warehouse{facts.length === 1 ? '' : 's'} currently in scope, and you can
          check any of them against the table behind this panel.
        </p>
      ) : null}
    </Drawer>
  )
}
