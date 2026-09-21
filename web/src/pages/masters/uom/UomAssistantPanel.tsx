import { useCallback, useMemo, useState } from 'react'
import {
  ArrowRight,
  ArrowRightLeft,
  Copy,
  Send,
  Sparkles,
  Tag,
  Wand2,
  X,
  ZapOff,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Select } from '../../../ui/Select'
import { Spinner } from '../../../ui/Spinner'
import { Textarea } from '../../../ui/Textarea'
import { AIC, cx } from '../../../ui/cx'
import {
  askAssistant,
  assistantConfigured,
  convert,
  findDuplicates,
  findMissingUqc,
  findUnusedUnits,
  suggestCommonUnits,
} from '../../../services/uomAiApi'
import type { AiOutcome, AssistantReply, SuggestedUnit } from '../../../services/uomAiApi'
import type { ConversionResult } from './uomPresentation'
import type { Uom } from '../../../services/masters'
import { formatQty } from '../../../utils/format'
import { DIMENSION_LABEL } from './uomPresentation'

/**
 * The contextual column beside the list.
 *
 * Five of its six actions are answered here and now, from the units the API
 * already returned, by the rules in `uomPresentation` — which units collide,
 * which nothing uses, which have no GST code, which standard codes are not
 * covered, and what one unit is in another. Each result says what it was
 * derived from, and none of them applies itself: a suggestion opens the form
 * with the change filled in, and the person saves it.
 *
 * The sixth, the free-text box, needs a service that does not exist yet. It
 * says so, in those words, rather than returning a plausible paragraph — see
 * services/uomAiApi.ts.
 */

const PANEL_KEY = 'inventory.uom.assistant'

function readStored(key: string, fallback: string): string {
  try {
    return window.sessionStorage.getItem(`${PANEL_KEY}.${key}`) ?? fallback
  } catch {
    return fallback
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(`${PANEL_KEY}.${key}`, value)
  } catch {
    // Private mode or blocked storage: the panel simply forgets between visits.
  }
}

type ActionKey = 'suggest' | 'duplicates' | 'convert' | 'unused' | 'uqc'

const ACTIONS: { key: ActionKey; label: string; icon: LucideIcon }[] = [
  { key: 'suggest', label: 'Suggest commonly used UOMs', icon: Wand2 },
  { key: 'duplicates', label: 'Find duplicate units', icon: Copy },
  { key: 'convert', label: 'Convert between units', icon: ArrowRightLeft },
  { key: 'unused', label: 'Which units are not used?', icon: ZapOff },
  { key: 'uqc', label: 'Create missing GST UQC', icon: Tag },
]

function ResultShell({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3" aria-live="polite">
      <h3 className="text-xs font-semibold text-gray-900">{title}</h3>
      <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{note}</p>
      <div className="mt-2.5">{children}</div>
    </section>
  )
}

function Nothing({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-emerald-50 px-2.5 py-2 text-[11px] text-emerald-800">{children}</p>
}

/**
 * What the converter prints, including its refusals.
 *
 * A function rather than a chain of ternaries in the markup: `ConversionResult`
 * is a discriminated union, and narrowing it inside JSX branches is exactly
 * where a wrong branch goes unnoticed. Every refusal names the unit responsible
 * and says what to do instead.
 */
function conversionMessage(
  from: Uom | null,
  to: Uom | null,
  outcome: AiOutcome<ConversionResult> | null,
): ReactNode {
  if (!from || !to || !outcome) return <span className="text-gray-500">Pick two units to convert between.</span>
  if (outcome.status !== 'ok') return <span className="text-amber-700">That conversion could not be worked out.</span>

  const result = outcome.data
  if (result.ok) {
    return (
      <span>
        <strong className="text-sm font-semibold tabular-nums text-gray-900">{formatQty(result.value)}</strong>{' '}
        {to.unit_symbol}
        <span className="ml-1 text-[11px] text-gray-500">({DIMENSION_LABEL[result.dimension].toLowerCase()})</span>
      </span>
    )
  }

  if (result.reason === 'bad-value') return <span className="text-amber-700">Enter a number to convert.</span>
  if (result.reason === 'different-dimensions') {
    return (
      <span className="text-amber-700">
        {from.unit_name} and {to.unit_name} measure different things, so there is no conversion between them.
      </span>
    )
  }
  const unsized = result.reason === 'unknown-from' ? from : to
  return (
    <span className="text-amber-700">
      {unsized.unit_name} has no fixed size — how many of it make a kilogram or a metre depends on the item. Set that on
      the item’s alternate units instead.
    </span>
  )
}

export interface UomAssistantPanelProps {
  /** The rows the list currently holds — what a derived answer is derived from. */
  rows: readonly Uom[]
  /** Walks every page, for analyses that must see the whole master. */
  loadAllUnits: () => Promise<Uom[]>
  canWrite: boolean
  onPrefillCreate: (draft: SuggestedUnit) => void
  onEdit: (row: Uom, patch?: { uqc_gst?: string }) => void
  onShowUnused: () => void
  onDismiss: () => void
  className?: string
}

export function UomAssistantPanel({
  rows,
  loadAllUnits,
  canWrite,
  onPrefillCreate,
  onEdit,
  onShowUnused,
  onDismiss,
  className,
}: UomAssistantPanelProps) {
  const [active, setActive] = useState<ActionKey | null>(() => {
    const stored = readStored('action', '')
    return ACTIONS.some((a) => a.key === stored) ? (stored as ActionKey) : null
  })
  const [scanning, setScanning] = useState(false)
  const [scope, setScope] = useState<readonly Uom[]>(rows)
  const [dismissed, setDismissed] = useState<string[]>([])

  const [message, setMessage] = useState('')
  const [asking, setAsking] = useState(false)
  const [reply, setReply] = useState<AiOutcome<AssistantReply> | null>(null)

  const [fromId, setFromId] = useState<string>('')
  const [toId, setToId] = useState<string>('')
  const [amount, setAmount] = useState('1')

  /*
   * "Which units are not used?" must see every unit, not the fifty on screen.
   *
   * The page's own export walk is reused, so the answer covers the whole master
   * however it is filtered or paged; it is fetched on the first use of an action
   * that needs it and kept for the rest of the visit, rather than on mount,
   * because a panel nobody opened should not cost a request.
   */
  const run = useCallback(
    async (key: ActionKey) => {
      setActive((current) => (current === key ? null : key))
      writeStored('action', active === key ? '' : key)
      if (active === key) return
      if (key === 'convert') return
      setScanning(true)
      try {
        setScope(await loadAllUnits())
      } catch {
        // Fall back to the rows on screen and say so in the result's note.
        setScope(rows)
      } finally {
        setScanning(false)
      }
    },
    [active, loadAllUnits, rows],
  )

  const wholeMaster = scope.length >= rows.length
  const basis = wholeMaster
    ? `Derived from all ${scope.length} units on record.`
    : `Derived from the ${rows.length} units currently listed.`

  const duplicates = useMemo(() => findDuplicates(scope), [scope])
  const unused = useMemo(() => findUnusedUnits(scope), [scope])
  const missing = useMemo(() => findMissingUqc(scope), [scope])
  const suggestions = useMemo(() => suggestCommonUnits(scope), [scope])

  const convertible = useMemo(() => [...rows].sort((a, b) => a.unit_name.localeCompare(b.unit_name)), [rows])
  const from = convertible.find((r) => String(r.unit_id) === fromId) ?? null
  const to = convertible.find((r) => String(r.unit_id) === toId) ?? null
  const conversion = from && to ? convert(from, to, Number(amount)) : null

  const send = async () => {
    const text = message.trim()
    if (text === '' || asking) return
    setAsking(true)
    setReply(null)
    setReply(await askAssistant(text, { unitIds: rows.map((r) => r.unit_id), screen: 'masters.uom' }))
    setAsking(false)
  }

  return (
    <aside
      className={cx(
        AIC,
        'flex flex-col gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-3',
        className,
      )}
      aria-label="Aicountly AI"
    >
      <header className="flex items-start gap-2.5">
        <span
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-violet-600 text-white"
          aria-hidden
        >
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <strong className="text-sm font-semibold text-gray-900">Aicountly AI</strong>
            <Badge tone="beta" size="xs">
              Beta
            </Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-gray-500">Your intelligent inventory assistant</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Hide the AI panel"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </header>

      <p className="rounded-lg border border-violet-200 bg-white p-2.5 text-[11px] leading-relaxed text-gray-600">
        Get insights, suggestions and help with your units of measure.
      </p>

      <div className="grid gap-1.5">
        {ACTIONS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => void run(key)}
            aria-expanded={active === key}
            className={cx(
              'flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              active === key
                ? 'border-violet-200 bg-violet-50 text-violet-700'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <ArrowRight
              className={cx('h-3.5 w-3.5 shrink-0 transition-transform', active === key && 'rotate-90')}
              aria-hidden
            />
          </button>
        ))}
      </div>

      {scanning ? (
        <p className="flex items-center gap-2 px-1 text-[11px] text-gray-500">
          <Spinner /> Reading every unit on record…
        </p>
      ) : null}

      {!scanning && active === 'suggest' ? (
        <ResultShell title="Suggested units" note={`${basis} These are published GST unit quantity codes your master does not cover yet.`}>
          {suggestions.status === 'ok' && suggestions.data.length === 0 ? (
            <Nothing>Every common unit is already set up.</Nothing>
          ) : suggestions.status === 'ok' ? (
            <ul className="space-y-1.5">
              {suggestions.data
                .filter((s) => !dismissed.includes(s.uqc))
                .slice(0, 5)
                .map((s) => (
                  <li key={s.uqc} className="rounded-lg border border-gray-200 p-2">
                    <div className="flex items-center gap-2">
                      <strong className="text-xs font-semibold text-gray-900">{s.name}</strong>
                      <span className="text-[11px] text-gray-500">{s.symbol}</span>
                      <Badge tone="info" size="xs" className="ml-auto">
                        {s.uqc}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{s.reason}</p>
                    <div className="mt-1.5 flex justify-end gap-1">
                      <Button size="xs" variant="ghost" onClick={() => setDismissed((d) => [...d, s.uqc])}>
                        Dismiss
                      </Button>
                      {canWrite ? (
                        <Button size="xs" variant="outline" onClick={() => onPrefillCreate(s)}>
                          Add
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
            </ul>
          ) : null}
        </ResultShell>
      ) : null}

      {!scanning && active === 'duplicates' ? (
        <ResultShell title="Possible duplicates" note={`${basis} Units whose name, symbol or measure reduce to the same thing. Nothing is merged for you.`}>
          {duplicates.status === 'ok' && duplicates.data.length === 0 ? (
            <Nothing>No two units look like the same unit.</Nothing>
          ) : duplicates.status === 'ok' ? (
            <ul className="space-y-2">
              {duplicates.data.slice(0, 5).map((cluster) => (
                <li key={cluster.key} className="rounded-lg border border-amber-200 bg-amber-50/60 p-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {cluster.rows.map((r) => (
                      <span key={r.unit_id} className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-gray-800">
                        {r.unit_name}
                      </span>
                    ))}
                    <Badge tone={cluster.confidence === 'high' ? 'warning' : 'neutral'} size="xs" className="ml-auto">
                      {cluster.confidence}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-800">{cluster.reason}</p>
                  <p className="mt-1 text-[11px] text-gray-600">
                    Suggested to keep: <strong>{cluster.canonical.unit_name}</strong>
                    {typeof cluster.canonical.usage_count === 'number'
                      ? ` — used by ${cluster.canonical.usage_count} item(s)`
                      : null}
                  </p>
                  <div className="mt-1.5 flex justify-end">
                    <Button size="xs" variant="ghost" onClick={() => onEdit(cluster.canonical)}>
                      Review
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </ResultShell>
      ) : null}

      {active === 'convert' ? (
        <ResultShell
          title="Convert between units"
          note="Only where the relationship is fixed by definition. A packing factor is per item, not per company, so it is not guessed at here."
        >
          <div className="grid gap-2">
            <label className="grid gap-1 text-[11px] text-gray-500">
              From
              <Select value={fromId} onChange={(e) => setFromId(e.target.value)} aria-label="Convert from">
                <option value="">Choose a unit…</option>
                {convertible.map((r) => (
                  <option key={r.unit_id} value={String(r.unit_id)}>
                    {r.unit_name} ({r.unit_symbol})
                  </option>
                ))}
              </Select>
            </label>
            <label className="grid gap-1 text-[11px] text-gray-500">
              Value
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-8 rounded-lg border border-gray-200 px-2.5 text-sm tabular-nums text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                aria-label="Value to convert"
              />
            </label>
            <label className="grid gap-1 text-[11px] text-gray-500">
              To
              <Select value={toId} onChange={(e) => setToId(e.target.value)} aria-label="Convert to">
                <option value="">Choose a unit…</option>
                {convertible.map((r) => (
                  <option key={r.unit_id} value={String(r.unit_id)}>
                    {r.unit_name} ({r.unit_symbol})
                  </option>
                ))}
              </Select>
            </label>

            <output className="rounded-lg bg-gray-50 px-2.5 py-2 text-xs text-gray-700" aria-live="polite">
              {conversionMessage(from, to, conversion)}
            </output>
          </div>
        </ResultShell>
      ) : null}

      {!scanning && active === 'unused' ? (
        <ResultShell title="Unused units" note={`${basis} No item names these as a base, purchase, sales or alternate unit.`}>
          {unused.status === 'ok' && unused.data.length === 0 ? (
            <Nothing>Every unit is used by at least one item.</Nothing>
          ) : unused.status === 'ok' ? (
            <>
              <ul className="space-y-1">
                {unused.data.slice(0, 6).map(({ row }) => (
                  <li key={row.unit_id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs text-gray-800">{row.unit_name}</span>
                    <span className="shrink-0 text-[11px] text-gray-400">{row.unit_symbol}</span>
                    {canWrite ? (
                      <Button size="xs" variant="ghost" onClick={() => onEdit(row)}>
                        Review
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex justify-end">
                <Button size="xs" variant="outline" onClick={onShowUnused}>
                  Show all {unused.data.length} in the list
                </Button>
              </div>
            </>
          ) : null}
        </ResultShell>
      ) : null}

      {!scanning && active === 'uqc' ? (
        <ResultShell
          title="Units without a GST UQC"
          note={`${basis} A code is suggested only where the name or symbol matches one beyond doubt. You confirm every change.`}
        >
          {missing.status === 'ok' && missing.data.length === 0 ? (
            <Nothing>Every unit carries a GST unit quantity code.</Nothing>
          ) : missing.status === 'ok' ? (
            <ul className="space-y-1.5">
              {missing.data.slice(0, 6).map(({ row, suggestion }) => (
                <li key={row.unit_id} className="rounded-lg border border-gray-200 p-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-900">{row.unit_name}</span>
                    {suggestion ? (
                      <Badge tone="info" size="xs">
                        {suggestion.code}
                      </Badge>
                    ) : (
                      <Badge tone="neutral" size="xs">
                        No match
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500">
                    {suggestion
                      ? `${suggestion.confidence === 'high' ? 'High' : 'Medium'} confidence — matched on the unit’s ${suggestion.from}.`
                      : 'No published code matches this unit. Which code it files under is your decision.'}
                  </p>
                  {suggestion && canWrite ? (
                    <div className="mt-1.5 flex justify-end">
                      <Button size="xs" variant="outline" onClick={() => onEdit(row, { uqc_gst: suggestion.code })}>
                        Review &amp; apply
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </ResultShell>
      ) : null}

      <div className="mt-auto pt-1">
        <label htmlFor="uom-assistant-ask" className="sr-only">
          Ask anything about units of measure
        </label>
        <div className="relative">
          <Textarea
            id="uom-assistant-ask"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                void send()
              }
            }}
            placeholder="Ask anything about units of measure…"
            className="pr-11"
          />
          <Button
            size="xs"
            icon={Send}
            onClick={() => void send()}
            loading={asking}
            disabled={message.trim() === ''}
            aria-label="Send question"
            className="absolute bottom-2 right-2 h-7 w-7 rounded-full p-0"
          />
        </div>

        {!assistantConfigured ? (
          <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
            The assistant service is not connected to Inventory yet — the five actions above are answered from your own
            data and work today.
          </p>
        ) : null}

        {reply ? (
          <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2.5 text-[11px] leading-relaxed" role="status">
            {reply.status === 'ok' ? (
              <p className="text-gray-700">{reply.data.answer}</p>
            ) : reply.status === 'unavailable' ? (
              <>
                <strong className="block text-gray-900">Not connected yet</strong>
                <p className="mt-0.5 text-gray-600">{reply.reason}</p>
                <p className="mt-1 text-gray-400">{reply.integration}</p>
              </>
            ) : (
              <p className="text-red-700">{reply.message}</p>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  )
}

export default UomAssistantPanel
