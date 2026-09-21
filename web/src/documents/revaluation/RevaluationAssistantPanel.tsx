import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Info, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react'
import { errorMessage, isAbortError } from '../../services/api'
import { Badge, Button, Skeleton, Tooltip } from '../../ui'
import { INSIGHTS, insightById, runInsight } from './revaluationInsights'
import type { InsightId, InsightResult } from './revaluationInsights'
import type { MoneyFormat } from './revaluationFormat'
import type { RevaluationLine, StockContextMap, ValuationScope } from './revaluationModel'

export interface RevaluationAssistantPanelProps {
  lines: readonly RevaluationLine[]
  contexts: StockContextMap
  scope: ValuationScope
  asOf: string
  money: MoneyFormat
  disabled?: boolean
  /** Write the suggested rates onto those lines. Always an explicit user action. */
  onApplyRates: (rates: { lineKey: string; newUnitCost: number }[]) => void
  /** Mark those lines in the grid so the reader can find what was flagged. */
  onFocusLines: (lineKeys: string[]) => void
}

/**
 * The assistant card.
 *
 * Every suggestion here is a deterministic analysis over this document's own lines, run against
 * endpoints the app already serves — it is not a model, and the panel says which read produced
 * each finding. Nothing it returns is written anywhere until the user presses Apply, and it can
 * never post: posting is the footer's job and it re-validates from scratch.
 */
export function RevaluationAssistantPanel({ lines, contexts, scope, asOf, money, disabled, onApplyRates, onFocusLines }: RevaluationAssistantPanelProps) {
  const [active, setActive] = useState<InsightId | null>(null)
  const [result, setResult] = useState<InsightResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const subjects = lines.filter((l) => l.itemId !== null)
  const subjectCount = subjects.length

  useEffect(() => () => abortRef.current?.abort(), [])

  // A finding names a line; when the lines change underneath it, the finding is no longer about
  // what is on screen, so it is dropped rather than left to mislead.
  const lineSignature = subjects.map((l) => `${l.key}:${l.itemId}:${l.warehouseId ?? ''}`).join(',')
  const lastSignature = useRef(lineSignature)
  if (lastSignature.current !== lineSignature) {
    lastSignature.current = lineSignature
    if (result) setResult(null)
  }

  const run = useCallback(
    (id: InsightId) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setActive(id)
      setResult(null)
      setError(null)
      setBusy(true)
      runInsight(id, subjects, contexts, scope, { asOf, signal: controller.signal })
        .then((res) => {
          if (controller.signal.aborted) return
          setResult(res)
          setBusy(false)
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || isAbortError(err)) return
          setError(errorMessage(err, 'That analysis could not be run.'))
          setBusy(false)
        })
    },
    [subjects, contexts, scope, asOf],
  )

  const definition = active ? insightById(active) : null
  const appliable = (result?.findings ?? []).filter((f) => f.suggestedUnitCost !== null && f.suggestedUnitCost !== f.currentUnitCost)

  return (
    <section className="relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-card" aria-labelledby="revaluation-assistant-heading">
      <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-violet-500 to-indigo-500" aria-hidden />
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 text-white">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id="revaluation-assistant-heading" className="text-sm font-semibold text-gray-900">
                Assistant
              </h2>
              <Badge tone="beta" size="xs">
                Beta
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-gray-500">Smart suggestions for this revaluation.</p>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {INSIGHTS.map((insight) => {
            const isActive = active === insight.id
            return (
              <button
                key={insight.id}
                type="button"
                onClick={() => run(insight.id)}
                disabled={busy || subjectCount === 0}
                aria-expanded={isActive}
                className={[
                  'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-colors',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                  isActive ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-gray-200 bg-white text-gray-700 hover:border-violet-200 hover:bg-violet-50',
                ].join(' ')}
              >
                <span className="min-w-0">{insight.title}</span>
                <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
              </button>
            )
          })}
        </div>

        <div aria-live="polite" className="mt-3">
          {subjectCount === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2.5 text-[11px] leading-relaxed text-gray-500">
              These run over the lines in this document. Add an item and they will have something to look at.
            </p>
          ) : busy ? (
            <div className="space-y-2">
              <Skeleton height="h-3" className="w-3/4" />
              <Skeleton height="h-3" className="w-1/2" />
              <Skeleton height="h-12" />
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden />
              <div className="min-w-0 text-[11px] text-red-700">
                <p>{error}</p>
                {active ? (
                  <button type="button" className="mt-1 inline-flex items-center gap-1 font-semibold underline" onClick={() => run(active)}>
                    <RotateCcw className="h-3 w-3" aria-hidden /> Try again
                  </button>
                ) : null}
              </div>
            </div>
          ) : result && definition ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2.5">
              <p className="text-[11px] font-semibold text-gray-900">
                {result.findings.length === 0 ? 'Nothing to flag' : `${result.findings.length} of ${result.examined} line${result.examined === 1 ? '' : 's'} flagged`}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{definition.logic}</p>

              {result.findings.length > 0 ? (
                <ul className="mt-2 max-h-52 space-y-1.5 overflow-y-auto scrollbar-thin pr-0.5">
                  {result.findings.map((finding) => (
                    <li key={finding.lineKey} className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5">
                      <p className="truncate text-[11px] font-semibold text-gray-900">{finding.itemName}</p>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">{finding.detail}</p>
                      {finding.suggestedUnitCost !== null ? (
                        <p className="mt-1 text-[10px] tabular-nums text-gray-600">
                          {money.amount(finding.currentUnitCost)} <span className="text-gray-400">→</span>{' '}
                          <strong className="text-gray-900">{money.amount(finding.suggestedUnitCost)}</strong>
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {result.skipped > 0 ? (
                <p className="mt-2 text-[10px] text-gray-500">
                  {result.skipped} line{result.skipped === 1 ? '' : 's'} had no data for this and {result.skipped === 1 ? 'was' : 'were'} left alone.
                </p>
              ) : null}

              {result.findings.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {appliable.length > 0 ? (
                    <Button
                      size="xs"
                      variant="primary"
                      disabled={disabled}
                      onClick={() => onApplyRates(appliable.map((f) => ({ lineKey: f.lineKey, newUnitCost: f.suggestedUnitCost as number })))}
                    >
                      Apply to {appliable.length} line{appliable.length === 1 ? '' : 's'}
                    </Button>
                  ) : null}
                  <Button size="xs" variant="secondary" onClick={() => onFocusLines(result.findings.map((f) => f.lineKey))}>
                    Highlight in the grid
                  </Button>
                </div>
              ) : null}

              <p className="mt-2.5 flex items-start gap-1.5 border-t border-gray-200 pt-2 text-[10px] leading-relaxed text-gray-500">
                <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
                <span>Source: {definition.source}</span>
              </p>
            </div>
          ) : (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500">
              <Tooltip label="These are deterministic reads of your own inventory data, not a language model. Nothing is applied or posted without you.">
                <Info className="mt-px h-3 w-3 shrink-0 text-gray-400" aria-hidden />
              </Tooltip>
              <span>Computed from your own stock movements and valuation — reviewed by you, applied only when you say so.</span>
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

export default RevaluationAssistantPanel
