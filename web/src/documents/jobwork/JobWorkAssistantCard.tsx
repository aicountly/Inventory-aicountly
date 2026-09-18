import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, ChevronRight, ClipboardList, History, PackageSearch, Sparkles, Wand2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Drawer } from '../../ui/Drawer'
import { EmptyState } from '../../ui/EmptyState'
import { Skeleton } from '../../ui/Skeleton'
import { errorMessage, isAbortError } from '../../services/api'
import { availabilityApi } from '../../services/stockApi'
import type { AvailabilityRow, PendingRow } from '../../services/stockApi'
import { formatDate, formatQty } from '../../utils/format'
import type { DocumentListRow } from '../types'
import type { LineDraft } from '../formModel'

type ActionId = 'pending' | 'availability' | 'history' | 'jobOrder'

interface Action {
  id: ActionId
  icon: LucideIcon
  label: string
}

const ACTIONS: Action[] = [
  { id: 'pending', icon: ClipboardList, label: 'Suggest items from pending job work' },
  { id: 'availability', icon: PackageSearch, label: 'Check stock availability' },
  { id: 'history', icon: History, label: 'Show past transactions' },
  { id: 'jobOrder', icon: Wand2, label: 'Auto-fill from job order' },
]

const TITLES: Record<ActionId, string> = {
  pending: 'Items still out with this job worker',
  availability: 'Stock availability for this document',
  history: 'Past job work with this job worker',
  jobOrder: 'Auto-fill from job order',
}

export interface AssistantSuggestion {
  item_id: number
  item_name: string | null
  unit_id: number | null
  warehouse_id: number | null
  qty: number
}

interface JobWorkAssistantCardProps {
  partyRef: number | null
  partyName: string
  /** Open job-work pending rows for this company (already loaded by the page). */
  pending: PendingRow[]
  /** Job-work documents on record (already loaded by the page). */
  documents: DocumentListRow[]
  lines: LineDraft[]
  onAdd: (suggestions: AssistantSuggestion[]) => void
  disabled?: boolean
}

/**
 * Shortcuts into the data this document is about.
 *
 * Every panel is a read of a live endpoint, labelled with where the figures came from, and
 * nothing is applied to the document until the user presses Add. There is no generative
 * endpoint behind this screen, so nothing here invents a quantity, a date or an item — the one
 * action that would need a model Inventory does not have says so plainly instead of guessing.
 */
export function JobWorkAssistantCard({
  partyRef,
  partyName,
  pending,
  documents,
  lines,
  onAdd,
  disabled = false,
}: JobWorkAssistantCardProps) {
  const [open, setOpen] = useState<ActionId | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [availability, setAvailability] = useState<AvailabilityRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mine = partyRef === null ? [] : pending.filter((p) => Number(p.party_ref) === partyRef)
  const onDocument = new Set(lines.map((l) => l.item_id).filter((id): id is number => id !== null))
  const history = partyRef === null ? [] : documents.filter((d) => Number(d.party_ref) === partyRef)
  const itemIds = [...onDocument]

  useEffect(() => {
    if (open !== 'availability' || itemIds.length === 0) return undefined
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    availabilityApi
      .forItems(itemIds, null, false, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return
        setAvailability(rows)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setError(errorMessage(err, 'Could not read stock availability.'))
        setLoading(false)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- itemIds is derived; the drawer opening is the trigger
  }, [open])

  const close = () => {
    setOpen(null)
    setPicked(new Set())
    setAvailability(null)
    setError(null)
  }

  const toggle = (pendingId: number) =>
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(pendingId)) next.delete(pendingId)
      else next.add(pendingId)
      return next
    })

  const applyPending = () => {
    const chosen = mine.filter((p) => picked.has(p.pending_id))
    if (chosen.length === 0) return
    onAdd(
      chosen.map((p) => ({
        item_id: p.item_id,
        item_name: p.item_name,
        unit_id: p.unit_id,
        warehouse_id: p.warehouse_id,
        // The quantity still open is a starting point the user edits, never a commitment.
        qty: Number(p.qty_open) || 0,
      })),
    )
    close()
  }

  const nameOf = (itemId: number) =>
    lines.find((l) => l.item_id === itemId)?.item_name ?? mine.find((p) => p.item_id === itemId)?.item_name ?? `Item #${itemId}`

  return (
    <>
      <Card padding="md">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />
              <h3 className="text-[13px] font-semibold text-gray-900">AI Assistant</h3>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
              Grounded in your live inventory data. Nothing is added until you say so.
            </p>
          </div>
          <Badge tone="beta" size="xs" className="shrink-0">
            Beta
          </Badge>
        </div>

        <ul className="space-y-1.5">
          {ACTIONS.map((action) => {
            const Icon = action.icon
            const needsParty = action.id === 'pending' || action.id === 'history'
            const blocked = needsParty && partyRef === null
            return (
              <li key={action.id}>
                <button
                  type="button"
                  disabled={disabled || blocked}
                  onClick={() => setOpen(action.id)}
                  title={blocked ? 'Pick a job worker first' : undefined}
                  className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-2 text-left text-[11px] font-medium text-gray-700 transition-colors hover:border-violet-200 hover:bg-violet-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-violet-600" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{action.label}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      </Card>

      <Drawer
        open={open !== null}
        onClose={close}
        width="lg"
        title={open ? TITLES[open] : ''}
        badge={
          open === 'jobOrder' ? null : (
            <Badge tone="info" size="xs" className="normal-case tracking-normal">
              Live data
            </Badge>
          )
        }
        description={
          open === 'jobOrder'
            ? undefined
            : partyName || partyRef
              ? `${partyName || `Ledger #${partyRef}`} · read from this company's inventory records`
              : "Read from this company's inventory records"
        }
        footer={
          open === 'pending' ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-gray-500">
                {picked.size} selected — review the quantity after adding
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={close}>
                  Cancel
                </Button>
                <Button onClick={applyPending} disabled={picked.size === 0}>
                  Add {picked.size > 0 ? `${picked.size} ` : ''}to document
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button variant="secondary" onClick={close}>
                Close
              </Button>
            </div>
          )
        }
      >
        {open === 'pending' ? (
          mine.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              size="sm"
              title="Nothing is open with this job worker"
              description="Every quantity sent so far has been settled by a job work inward."
            />
          ) : (
            <ul className="space-y-2">
              {mine.map((p) => (
                <li key={p.pending_id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-3 transition-colors hover:border-primary/40 hover:bg-primary-light/30">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-current text-primary"
                      checked={picked.has(p.pending_id)}
                      onChange={() => toggle(p.pending_id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">
                        {p.item_name ?? `Item #${p.item_id}`}
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-500">
                        {formatQty(p.qty_open)} {p.unit_symbol ?? ''} still open of {formatQty(p.qty_original)} sent
                        {p.warehouse_name ? ` · ${p.warehouse_name}` : ''}
                      </span>
                      <span className="mt-1 block text-[11px] text-gray-400">
                        Source: {p.document_no ?? `document #${p.document_id}`}
                        {p.document_date ? ` · ${formatDate(p.document_date)}` : ''}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {open === 'availability' ? (
          itemIds.length === 0 ? (
            <EmptyState
              icon={PackageSearch}
              size="sm"
              title="No items on the document yet"
              description="Add an item line and this will show what is on hand across every warehouse."
            />
          ) : loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height="h-16" />
              ))}
            </div>
          ) : error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          ) : (
            <ul className="space-y-2">
              {(availability ?? []).map((row) => (
                <li key={`${row.item_id}-${row.warehouse_id ?? 'all'}`} className="rounded-xl border border-gray-200 p-3">
                  <p className="truncate text-sm font-medium text-gray-900">{nameOf(row.item_id)}</p>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-gray-500">Available</dt>
                      <dd className="font-semibold tabular-nums text-emerald-700">{formatQty(row.available)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-gray-500">On hand</dt>
                      <dd className="font-semibold tabular-nums text-gray-900">{formatQty(row.on_hand)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-gray-500">With job workers</dt>
                      <dd className="font-semibold tabular-nums text-violet-700">{formatQty(row.job_worker)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {open === 'history' ? (
          history.length === 0 ? (
            <EmptyState
              icon={History}
              size="sm"
              title="No job work on record"
              description="This will be the first job work document for this job worker."
            />
          ) : (
            <ul className="divide-y divide-gray-100">
              {history.slice(0, 25).map((d) => (
                <li key={d.document_id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link
                      to={`/documents/${d.document_id}`}
                              className="truncate text-sm font-medium text-primary no-underline hover:underline"
                    >
                      {d.document_no ?? `#${d.document_id}`}
                    </Link>
                    <p className="mt-0.5 text-[11px] text-gray-500">
                      {d.document_type_label ?? d.document_type} · {formatDate(d.document_date)} · {d.status}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-gray-500">
                    {formatQty(d.line_count)} line{Number(d.line_count) === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {open === 'jobOrder' ? (
          <EmptyState
            icon={BarChart3}
            size="sm"
            title="Not configured"
            description="Inventory holds no job-order document, and there is no endpoint to read one from, so there is nothing to auto-fill from yet. The other three actions read data this company already has."
          />
        ) : null}
      </Drawer>
    </>
  )
}

export default JobWorkAssistantCard
