import { useEffect, useMemo, useState } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Button } from '../../ui'
import { errorMessage, isAbortError } from '../../services/api'
import { RATE_SOURCES, ratesFromSource } from './revaluationApi'
import type { RateSourceId } from './revaluationApi'
import type { MoneyFormat } from './revaluationFormat'
import { contextFor, lineImpact, scopeWarehouseId } from './revaluationModel'
import type { RevaluationLine, StockContextMap, ValuationScope } from './revaluationModel'

export type CopyRatesTarget = 'all' | 'blank' | 'visible'

export interface CopyRatesModalProps {
  open: boolean
  onClose: () => void
  lines: readonly RevaluationLine[]
  /** The lines the grid is showing right now — the stand-in for "selected lines". */
  visibleKeys: ReadonlySet<string>
  contexts: StockContextMap
  scope: ValuationScope
  asOf: string
  money: MoneyFormat
  /** Pre-selected source when the dialog was opened from a template. */
  initialSource?: RateSourceId
  onApply: (rates: { lineKey: string; newUnitCost: number }[]) => void
}

interface Proposal {
  lineKey: string
  itemName: string
  currentUnitCost: number | null
  newUnitCost: number
  impact: number | null
}

/**
 * Fill the New cost column from a rate the API can actually answer for.
 *
 * Every source here is a real read — the valuation snapshot under a chosen method, or the last
 * posted purchase receipt. Nothing is derived from what happens to be on screen, and the proposal
 * is shown in full before a single cell changes.
 */
export function CopyRatesModal({ open, onClose, lines, visibleKeys, contexts, scope, asOf, money, initialSource, onApply }: CopyRatesModalProps) {
  const [source, setSource] = useState<RateSourceId>(initialSource ?? 'last_purchase')
  const [target, setTarget] = useState<CopyRatesTarget>('blank')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposals, setProposals] = useState<Proposal[] | null>(null)
  const [missing, setMissing] = useState(0)

  const targets = useMemo(() => {
    return lines.filter((line) => {
      if (line.itemId === null) return false
      if (target === 'blank') return line.newUnitCost.trim() === ''
      if (target === 'visible') return visibleKeys.has(line.key)
      return true
    })
  }, [lines, target, visibleKeys])

  useEffect(() => {
    if (!open) return
    setProposals(null)
    setError(null)
    setMissing(0)
  }, [open, source, target])

  // Opening from a template means "this source", so the dialog honours it each time it opens.
  useEffect(() => {
    if (open && initialSource) setSource(initialSource)
  }, [open, initialSource])

  const preview = () => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    ratesFromSource(
      source,
      targets.map((line) => ({ itemId: line.itemId as number, warehouseId: scopeWarehouseId(scope, line.warehouseId) })),
      { asOf, signal: controller.signal },
    )
      .then(({ rates, missing: none }) => {
        const out: Proposal[] = []
        for (const line of targets) {
          const rate = rates.get(line.itemId as number)
          if (rate === undefined) continue
          const ctx = contextFor(line, contexts, scope)
          out.push({
            lineKey: line.key,
            itemName: line.itemName,
            currentUnitCost: ctx?.currentUnitCost ?? null,
            newUnitCost: rate,
            impact: lineImpact(rate, ctx?.currentUnitCost ?? null, ctx?.onHandQty ?? null),
          })
        }
        setProposals(out)
        setMissing(none.length)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return
        setError(errorMessage(err, 'Those rates could not be read.'))
        setLoading(false)
      })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Copy rates"
      description="Fill the new cost column from a rate Inventory already holds, then edit whatever needs editing."
      size="lg"
      busy={loading}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          {proposals === null ? (
            <Button variant="primary" loading={loading} disabled={targets.length === 0} onClick={preview}>
              Preview {targets.length} line{targets.length === 1 ? '' : 's'}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={proposals.length === 0}
              onClick={() => {
                onApply(proposals.map((p) => ({ lineKey: p.lineKey, newUnitCost: p.newUnitCost })))
                onClose()
              }}
            >
              Apply to {proposals.length} line{proposals.length === 1 ? '' : 's'}
            </Button>
          )}
        </>
      }
    >
      <fieldset>
        <legend className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Copy from</legend>
        <div className="mt-2 space-y-1.5">
          {RATE_SOURCES.map((s) => (
            <label
              key={s.id}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors ${source === s.id ? 'border-primary bg-primary-light/50' : 'border-gray-200 hover:border-primary/40'}`}
            >
              <input type="radio" name="copy-rates-source" className="aic mt-0.5 h-3.5 w-3.5 accent-[rgb(var(--color-primary))]" checked={source === s.id} onChange={() => setSource(s.id)} />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-gray-900">{s.label}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-500">{s.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Apply to</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(
            [
              { value: 'blank', label: 'Lines with no new cost yet' },
              { value: 'visible', label: 'Lines currently shown' },
              { value: 'all', label: 'All lines' },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${target === option.value ? 'border-primary bg-primary-light/50 text-primary' : 'border-gray-200 text-gray-700 hover:border-primary/40'}`}
            >
              <input type="radio" name="copy-rates-target" className="sr-only" checked={target === option.value} onChange={() => setTarget(option.value)} />
              {option.label}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-gray-500">
          {targets.length} line{targets.length === 1 ? '' : 's'} would be looked up.
        </p>
      </fieldset>

      {error ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Reading the rates…
        </p>
      ) : null}

      {proposals !== null && !loading ? (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">What would change</p>
          {proposals.length === 0 ? (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              This source has no rate for any of those lines, so nothing would change.
            </p>
          ) : (
            <div className="mt-2 max-h-56 overflow-y-auto scrollbar-thin rounded-xl border border-gray-200">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-2.5 py-1.5 text-left font-semibold text-gray-500">
                      Item
                    </th>
                    <th scope="col" className="px-2.5 py-1.5 text-right font-semibold text-gray-500">
                      Current
                    </th>
                    <th scope="col" className="px-2.5 py-1.5 text-right font-semibold text-gray-500">
                      New
                    </th>
                    <th scope="col" className="px-2.5 py-1.5 text-right font-semibold text-gray-500">
                      Impact
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((p) => (
                    <tr key={p.lineKey} className="border-t border-gray-100">
                      <td className="max-w-[16rem] truncate px-2.5 py-1.5 text-gray-900">{p.itemName}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums text-gray-500">{money.amount(p.currentUnitCost)}</td>
                      <td className="px-2.5 py-1.5 text-right font-semibold tabular-nums text-gray-900">{money.amount(p.newUnitCost)}</td>
                      <td className={`px-2.5 py-1.5 text-right font-semibold tabular-nums ${p.impact === null ? 'text-gray-400' : p.impact > 0 ? 'text-emerald-600' : p.impact < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                        {money.signed(p.impact)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {missing > 0 ? (
            <p className="mt-2 text-[11px] text-gray-500">
              {missing} line{missing === 1 ? '' : 's'} had no rate from this source and would be left exactly as {missing === 1 ? 'it is' : 'they are'}.
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}

export default CopyRatesModal
