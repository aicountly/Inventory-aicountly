import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, ExternalLink, FileText, History, PackageSearch, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../../ui/Badge'
import type { BadgeTone } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorState } from '../../ui/ErrorState'
import { LoadingState } from '../../ui/LoadingState'
import { ProgressBar } from '../../ui/ProgressBar'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { AIC, cx } from '../../ui/cx'
import { FIELD_BASE, FIELD_OK } from '../../ui/Input'
import { formatDate, formatQty, toNumber } from '../../utils/format'
import type { JobWorkSettlement } from '../types'
import { PENDING_STATE_LABEL, groupByDocument } from './jobWorkModel'
import type { JobWorkMode, PendingState, PendingView } from './jobWorkModel'

const STATE_TONE: Record<PendingState, BadgeTone> = {
  open: 'neutral',
  partial: 'info',
  due: 'warning',
  overdue: 'danger',
}

type StateFilter = 'all' | 'overdue' | 'partial'

const STATE_FILTERS: readonly { value: StateFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'partial', label: 'Partial' },
]

interface RowPick {
  qty: string
  type: 'consumed' | 'returned'
}

export interface PendingJobWorkDrawerProps {
  open: boolean
  onClose: () => void
  mode: JobWorkMode
  rows: readonly PendingView[]
  loading: boolean
  error: string | null
  onRetry: () => void
  /** What the draft already settles, so reopening shows the current picks. */
  value: readonly JobWorkSettlement[]
  onApply: (settlements: JobWorkSettlement[], picked: PendingView[]) => void
  /** The job worker whose position this is, for the empty state's wording. */
  workerName: string | null
}

/**
 * What is still with the job worker, and — on a receipt — what this document
 * settles of it.
 *
 * Grouped by the dispatch that opened the quantities, because that is the unit
 * an operator and a job worker both talk in: "challan 41 is half back". Each
 * row is settled as `consumed` (the job worker used the material up: an out
 * line is generated so it is valued and expensed) or `returned` (it came back
 * unused: the pending quantity closes and the goods are available again).
 * Finished goods are separate lines on the document — they are usually a
 * different item, and nothing here guesses what they are.
 *
 * On a dispatch the same panel is read-only: it answers "what is this worker
 * already holding" before more material is sent.
 */
export function PendingJobWorkDrawer({ open, onClose, mode, rows, loading, error, onRetry, value, onApply, workerName }: PendingJobWorkDrawerProps) {
  const readOnly = mode === 'out'
  const [picks, setPicks] = useState<Record<number, RowPick>>({})
  const [query, setQuery] = useState('')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')

  // Seed from the draft every time the drawer opens, so what is shown ticked is
  // what the document actually settles — not what was ticked last time.
  useEffect(() => {
    if (!open) return
    const seeded: Record<number, RowPick> = {}
    for (const s of value) seeded[s.pending_id] = { qty: String(s.qty), type: s.settlement_type }
    setPicks(seeded)
    setQuery('')
  }, [open, value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (stateFilter === 'overdue' && row.state !== 'overdue') return false
      if (stateFilter === 'partial' && row.received <= 0) return false
      if (q === '') return true
      return (
        row.itemName.toLowerCase().includes(q) ||
        (row.itemSku ?? '').toLowerCase().includes(q) ||
        row.documentNo.toLowerCase().includes(q) ||
        (row.warehouseName ?? '').toLowerCase().includes(q)
      )
    })
  }, [rows, query, stateFilter])

  const groups = useMemo(() => groupByDocument(filtered), [filtered])

  const setPick = (row: PendingView, patch: Partial<RowPick> | null) => {
    setPicks((current) => {
      if (patch === null) {
        const { [row.pendingId]: _removed, ...rest } = current
        return rest
      }
      const existing = current[row.pendingId] ?? { qty: String(row.open), type: 'consumed' as const }
      return { ...current, [row.pendingId]: { ...existing, ...patch } }
    })
  }

  const receiveAll = (rowsOfGroup: readonly PendingView[]) => {
    setPicks((current) => {
      const next = { ...current }
      for (const row of rowsOfGroup) {
        if (row.open <= 0) continue
        next[row.pendingId] = next[row.pendingId] ?? { qty: String(row.open), type: 'consumed' }
      }
      return next
    })
  }

  const chosen = useMemo(() => {
    const settlements: JobWorkSettlement[] = []
    const picked: PendingView[] = []
    for (const row of rows) {
      const pick = picks[row.pendingId]
      if (!pick) continue
      const qty = toNumber(pick.qty)
      if (qty === null || qty <= 0) continue
      settlements.push({ pending_id: row.pendingId, qty, settlement_type: pick.type })
      picked.push(row)
    }
    return { settlements, picked }
  }, [rows, picks])

  const chosenQty = chosen.settlements.reduce((t, s) => t + s.qty, 0)

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="xl"
      title={readOnly ? 'Material with this job worker' : 'Pending job work'}
      description={
        readOnly
          ? 'What this job worker is already holding. Settle it on a Job Work Inward.'
          : 'Tick what this receipt settles. Quantities left open stay with the job worker.'
      }
      badge={
        rows.length > 0 ? (
          <Badge tone="info" size="xs">
            {formatQty(rows.reduce((t, r) => t + r.open, 0))} open
          </Badge>
        ) : null
      }
      footer={
        readOnly ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-gray-500">{groups.length} open dispatch{groups.length === 1 ? '' : 'es'}</span>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-gray-600">
              {chosen.settlements.length === 0 ? (
                'Nothing selected yet.'
              ) : (
                <>
                  <strong className="tabular-nums text-gray-900">{chosen.settlements.length}</strong> row
                  {chosen.settlements.length === 1 ? '' : 's'} ·{' '}
                  <strong className="tabular-nums text-gray-900">{formatQty(chosenQty)}</strong> to settle
                </>
              )}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  onApply(chosen.settlements, chosen.picked)
                  onClose()
                }}
              >
                Apply to document
              </Button>
            </div>
          </div>
        )
      }
    >
      <div className={cx(AIC, 'space-y-3')}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by item, SKU, challan or warehouse"
              aria-label="Filter pending job work"
              className={cx(FIELD_BASE, FIELD_OK, 'h-8 pl-8 pr-3 text-sm')}
            />
          </div>
          <SegmentedControl value={stateFilter} onChange={setStateFilter} options={STATE_FILTERS} />
        </div>

        {loading && rows.length === 0 ? <LoadingState label="Loading open job work…" /> : null}
        {error && rows.length === 0 ? (
          <ErrorState title="Unable to load pending job work." description={error} onRetry={onRetry} />
        ) : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title="No open job-work quantities"
            description={
              workerName
                ? `Nothing is outstanding with ${workerName}. A Job Work Outward opens the quantities a receipt settles.`
                : 'Nothing is outstanding with any job worker. A Job Work Outward opens the quantities a receipt settles.'
            }
            action={
              <Link to="/documents/new/job_work_out" className="aic inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-white no-underline hover:bg-primary-hover">
                Create Job Work Outward
              </Link>
            }
          />
        ) : null}
        {!loading && rows.length > 0 && groups.length === 0 ? (
          <EmptyState compact icon={Search} title="Nothing matches that filter" description="Clear the search or switch back to All." />
        ) : null}

        {groups.map((group) => (
          <section key={group.documentId} className="rounded-xl border border-gray-200">
            <header className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/documents/${group.documentId}`} className="text-sm font-semibold text-gray-900 no-underline hover:text-primary">
                    {group.documentNo}
                  </Link>
                  <Badge tone={STATE_TONE[group.state]} size="xs" dot>
                    {PENDING_STATE_LABEL[group.state]}
                  </Badge>
                </div>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  {formatDate(group.documentDate)}
                  {group.ageDays !== null ? ` · ${group.ageDays} day${group.ageDays === 1 ? '' : 's'} old` : ''}
                  {group.expectedReturnDate ? ` · expected ${formatDate(group.expectedReturnDate)}` : ' · no return date promised'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to={`/documents/${group.documentId}`}
                  className="aic inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-gray-600 no-underline hover:bg-gray-100 hover:text-gray-900"
                  title="Open the dispatch this quantity came from"
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                  Outward
                </Link>
                {!readOnly ? (
                  <Button size="xs" variant="outline" onClick={() => receiveAll(group.rows)}>
                    Receive all
                  </Button>
                ) : null}
              </div>
            </header>

            <div className="px-3 py-2">
              <div className="mb-2 flex items-center gap-2">
                <ProgressBar value={group.completion * 100} className="flex-1" />
                <span className="shrink-0 text-[11px] tabular-nums text-gray-500">
                  {formatQty(group.received)} of {formatQty(group.sent)} back
                </span>
              </div>

              <ul className="divide-y divide-gray-100">
                {group.rows.map((row) => {
                  const pick = picks[row.pendingId]
                  const overOpen = pick !== undefined && (toNumber(pick.qty) ?? 0) > row.open + 0.0001
                  return (
                    <li key={row.pendingId} className={cx('flex flex-wrap items-center gap-2 py-2', pick ? 'bg-primary-light/30' : undefined)}>
                      {!readOnly ? (
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-[rgb(var(--color-primary))]"
                          checked={pick !== undefined}
                          onChange={(e) => setPick(row, e.target.checked ? {} : null)}
                          aria-label={`Settle ${row.itemName} from ${row.documentNo}`}
                          disabled={row.open <= 0}
                        />
                      ) : null}
                      <div className="min-w-[10rem] flex-1">
                        <p className="truncate text-sm text-gray-900" title={row.itemName}>
                          {row.itemName}
                        </p>
                        <p className="text-[11px] text-gray-500">
                          {[row.itemSku, row.warehouseName].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                      <dl className="flex shrink-0 items-center gap-3 text-[11px] text-gray-500">
                        <div className="text-right">
                          <dt>Sent</dt>
                          <dd className="tabular-nums text-gray-700">{formatQty(row.sent)}</dd>
                        </div>
                        <div className="text-right">
                          <dt>Back</dt>
                          <dd className="tabular-nums text-gray-700">{formatQty(row.received)}</dd>
                        </div>
                        <div className="text-right">
                          <dt>Open</dt>
                          <dd className="tabular-nums font-semibold text-gray-900">
                            {formatQty(row.open)} {row.unitSymbol ?? ''}
                          </dd>
                        </div>
                      </dl>
                      {!readOnly ? (
                        <div className="flex shrink-0 items-center gap-1.5">
                          <input
                            inputMode="decimal"
                            value={pick?.qty ?? String(row.open)}
                            disabled={pick === undefined}
                            aria-label={`Quantity to settle for ${row.itemName}`}
                            aria-invalid={overOpen || undefined}
                            onChange={(e) => setPick(row, { qty: e.target.value })}
                            className={cx(FIELD_BASE, overOpen ? 'border-red-300' : FIELD_OK, 'h-8 w-20 min-w-[5rem] shrink-0 px-2 text-right text-sm tabular-nums')}
                          />
                          <select
                            value={pick?.type ?? 'consumed'}
                            disabled={pick === undefined}
                            aria-label={`How ${row.itemName} is settled`}
                            onChange={(e) => setPick(row, { type: e.target.value === 'returned' ? 'returned' : 'consumed' })}
                            className={cx(FIELD_BASE, FIELD_OK, 'h-8 w-28 min-w-[7rem] shrink-0 px-2 text-sm')}
                          >
                            <option value="consumed">Consumed</option>
                            <option value="returned">Returned</option>
                          </select>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          </section>
        ))}

        {!readOnly && rows.length > 0 ? (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500">
            <History className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              <strong className="font-semibold text-gray-700">Consumed</strong> adds a valued out line — the material is gone into the
              job. <strong className="font-semibold text-gray-700">Returned</strong> closes the pending quantity and makes the goods
              available again; nothing moves. The finished goods themselves are lines on this document.
            </span>
          </p>
        ) : null}
        {readOnly && rows.length > 0 ? (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500">
            <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Settle these on a Job Work Inward.{' '}
              <Link to="/documents/new/job_work_in" className="font-semibold text-primary no-underline hover:underline">
                Open one
                <ExternalLink className="ml-0.5 inline h-3 w-3" aria-hidden />
              </Link>
            </span>
          </p>
        ) : null}
      </div>
    </Drawer>
  )
}
