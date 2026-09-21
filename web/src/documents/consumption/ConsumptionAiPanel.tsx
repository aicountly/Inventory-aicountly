import { useState } from 'react'
import { AlertTriangle, ArrowRight, Boxes, Clock, Sparkles, Tags } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { Button } from '../../ui/Button'
import { errorMessage } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import { formatDate, formatQty } from '../../utils/format'
import { unitOptionsFrom } from '../LineEditor'
import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import { detectConsumptionAnomalies, recentlyConsumedItems, suggestItemsForReason } from './consumptionAi'
import type { ConsumptionAnomaly, ConsumptionItemSuggestion } from './consumptionAi'

interface ConsumptionAiPanelProps {
  spec: DocumentTypeSpec
  reasonCode: string
  lines: LineDraft[]
  defaultWarehouseId: number | null
  disabled?: boolean
  onAddLines: (lines: LineDraft[]) => void
  onOpenBom: () => void
}

type PickerKind = 'reason' | 'recent'

/** Builds real, editable lines from a suggestion by re-checking the item live (units, batch/serial flags may have changed since the historical document). */
async function buildLinesFromSuggestions(spec: DocumentTypeSpec, selected: ConsumptionItemSuggestion[], defaultWarehouseId: number | null): Promise<LineDraft[]> {
  const items = await lookupApi.itemsByIds(selected.map((s) => s.item_id))
  const byId = new Map(items.map((it) => [it.item_id, it]))
  return selected.map((s) => {
    const it = byId.get(s.item_id)
    const units = it ? unitOptionsFrom(it) : []
    const def = units.find((u) => u.is_default) ?? units[0]
    return newLine(spec, {
      item_id: s.item_id,
      item_name: it?.print_name || it?.item_name || s.item_name,
      item_sku: it?.item_sku ?? s.item_sku,
      track_batch: it ? Number(it.track_batch) === 1 : false,
      track_serial: it ? Number(it.track_serial) === 1 : false,
      units,
      unit_id: def?.unit_id ?? s.unit_id ?? null,
      warehouse_id: defaultWarehouseId,
    })
  })
}

function SuggestionRow({ s, checked, onToggle }: { s: ConsumptionItemSuggestion; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-gray-50">
      <input type="checkbox" checked={checked} onChange={onToggle} className="h-4 w-4 shrink-0 accent-primary" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-gray-900">{s.item_name}</span>
        <span className="block truncate text-xs text-gray-500">
          {[s.item_sku, s.last_document_date ? `last ${formatDate(s.last_document_date)}` : null, `${s.occurrences}×`].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="shrink-0 text-xs tabular-nums text-gray-500">
        {formatQty(s.last_qty)} {s.unit_symbol ?? ''}
      </span>
    </label>
  )
}

/**
 * Right-hand "AI Assistant" panel. Every suggestion is computed here from real posted
 * Consumption history via consumptionAi.ts — there is no separate AI backend to feature-flag.
 * Nothing is ever inserted without the user reviewing the list and pressing Add.
 */
export function ConsumptionAiPanel({ spec, reasonCode, lines, defaultWarehouseId, disabled, onAddLines, onOpenBom }: ConsumptionAiPanelProps) {
  const [picker, setPicker] = useState<PickerKind | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<ConsumptionItemSuggestion[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [adding, setAdding] = useState(false)

  const [checking, setChecking] = useState(false)
  const [anomalies, setAnomalies] = useState<ConsumptionAnomaly[] | null>(null)
  const [anomalyError, setAnomalyError] = useState<string | null>(null)

  const openPicker = async (kind: PickerKind) => {
    setPicker(kind)
    setLoading(true)
    setError(null)
    setSuggestions([])
    setSelected(new Set())
    try {
      const rows = kind === 'reason' ? await suggestItemsForReason(reasonCode) : await recentlyConsumedItems()
      setSuggestions(rows)
      setSelected(new Set(rows.map((r) => r.item_id)))
    } catch (err) {
      setError(errorMessage(err, 'Could not load suggestions.'))
    } finally {
      setLoading(false)
    }
  }

  const toggle = (itemId: number) => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const confirmAdd = async () => {
    const picked = suggestions.filter((s) => selected.has(s.item_id))
    if (picked.length === 0) return
    setAdding(true)
    setError(null)
    try {
      const drafts = await buildLinesFromSuggestions(spec, picked, defaultWarehouseId)
      onAddLines(drafts)
      setPicker(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not add those items.'))
    } finally {
      setAdding(false)
    }
  }

  const runAnomalyCheck = async () => {
    setChecking(true)
    setAnomalyError(null)
    try {
      const found = await detectConsumptionAnomalies(lines)
      setAnomalies(found)
    } catch (err) {
      setAnomalyError(errorMessage(err, 'Could not check consumption history.'))
      setAnomalies(null)
    } finally {
      setChecking(false)
    }
  }

  const linesWithItems = lines.some((l) => l.item_id !== null)

  return (
    <aside className="aic relative flex flex-col overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary-light/60 via-[rgb(var(--color-surface))] to-sky-50 p-4">
      <div className="mb-3.5 flex items-start gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-primary text-white shadow-card">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-gray-900">AI Assistant</h3>
            <span className="rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">Beta</span>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-gray-500">Suggestions from your own consumption history. Nothing is added without your say-so.</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <AiSuggestionButton icon={Tags} label="Suggest items based on reason" onClick={() => void openPicker('reason')} disabled={disabled} />
        <AiSuggestionButton icon={Clock} label="Show recently consumed items" onClick={() => void openPicker('recent')} disabled={disabled} />
        <AiSuggestionButton icon={Boxes} label="Fill from Bill of Materials (BOM)" onClick={onOpenBom} disabled={disabled} />
        <AiSuggestionButton icon={AlertTriangle} label="Check for unusual consumption" onClick={() => void runAnomalyCheck()} disabled={disabled || !linesWithItems} loading={checking} />
      </div>

      {anomalyError ? (
        <Notice kind="warning" className="mt-3 text-xs">
          {anomalyError}
        </Notice>
      ) : anomalies !== null ? (
        <div className="mt-3 space-y-1.5">
          {anomalies.length === 0 ? (
            <p className="rounded-lg bg-white/80 px-2.5 py-2 text-[11px] text-gray-500">No unusual quantities found against recent history.</p>
          ) : (
            anomalies.map((a) => (
              <div key={a.lineKey} className={`rounded-lg px-2.5 py-2 text-[11px] leading-snug ${a.severity === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-700'}`}>
                {a.message}
              </div>
            ))
          )}
        </div>
      ) : null}

      <Modal
        open={picker !== null}
        onClose={() => setPicker(null)}
        title={picker === 'reason' ? 'Suggested items for this reason' : 'Recently consumed items'}
        description={picker === 'reason' ? `Items previously consumed under reason "${reasonCode || '—'}".` : 'Items most recently issued on posted Consumption documents.'}
        size="md"
        busy={adding}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPicker(null)} disabled={adding}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void confirmAdd()} loading={adding} disabled={selected.size === 0}>
              Add {selected.size || ''} line{selected.size === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        {error ? <Notice kind="error">{error}</Notice> : null}
        {loading ? (
          <p className="py-6 text-center text-sm text-gray-500">Looking through recent consumption history…</p>
        ) : suggestions.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            {picker === 'reason' && !reasonCode.trim() ? 'Pick a reason code first, then try again.' : 'No history to suggest from yet.'}
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {suggestions.map((s) => (
              <SuggestionRow key={s.item_id} s={s} checked={selected.has(s.item_id)} onToggle={() => toggle(s.item_id)} />
            ))}
          </div>
        )}
      </Modal>
    </aside>
  )
}

function AiSuggestionButton({ icon: Icon, label, onClick, disabled, loading }: { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; loading?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex min-h-[2.625rem] w-full items-center justify-between gap-2 rounded-xl border border-white bg-white/85 px-3 py-2 text-left text-[11px] font-semibold text-gray-800 shadow-card transition-all hover:-translate-y-px hover:bg-white hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      {loading ? (
        <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-gray-300 border-t-primary" aria-hidden />
      ) : (
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5" aria-hidden />
      )}
    </button>
  )
}

export default ConsumptionAiPanel
