import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Info } from 'lucide-react'
import { Skeleton } from '../../ui/Skeleton'
import { Tooltip } from '../../ui/Tooltip'
import { cx } from '../../ui/cx'
import { formatDate, formatInt, formatMoney, humanize } from '../../utils/format'
import type { BucketDocument, PostingStatusEntry } from '../../services/reconciliationApi'
import type { BucketRow, UnexplainedExplanation } from './reconciliationModel'
import { UNEXPLAINED_ACTION, UNEXPLAINED_ACTION_HREF, UNEXPLAINED_WHY, formatPercent } from './reconciliationModel'

/**
 * How the gap is explained.
 *
 * There is no item-wise Books figure to compare against, and this file will not
 * invent one: Books publishes ONE Stock-in-Hand balance for the company, not a
 * balance per item, so the honest unit of explanation is the bucket the server
 * computed — pending postings, failed postings, cancellations, unapplied
 * valuation revisions — each with the documents behind it.
 */

/** The bucket's own documents, whichever shape the server used for them. */
export function bucketDocuments(row: BucketRow): BucketDocument[] {
  const bucket = row.bucket
  if (Array.isArray(bucket.documents)) return bucket.documents
  if (Array.isArray(bucket.entries)) {
    return (bucket.entries as PostingStatusEntry[])
      .map((entry) => {
        const inv = entry.inventory
        return {
          document_id: inv?.document_id ?? entry.source.source_document_id ?? 0,
          document_type: inv?.document_type ?? entry.source.source_document_type ?? null,
          document_no: inv?.document_no ?? entry.source.source_document_no ?? null,
          document_date: inv?.document_date ?? entry.books?.document_date ?? '',
          status: inv?.status ?? entry.books?.status ?? undefined,
          source_app: entry.source.source_app,
          source_document_no: entry.source.source_document_no,
          amount: entry.books?.amount ?? undefined,
          reason: entry.sync_status ? humanize(entry.sync_status) : null,
        } satisfies BucketDocument
      })
      .filter((d) => d.document_id !== 0 || d.document_no !== null)
  }
  return []
}

function ShareBar({ share }: { share: number | null }) {
  if (share === null) return null
  return (
    <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-gray-100" aria-hidden>
      <span className="block h-full rounded-full bg-violet-400" style={{ width: `${Math.min(100, Math.max(2, share))}%` }} />
    </span>
  )
}

export interface TopVariancesProps {
  rows: readonly BucketRow[]
  loading: boolean
  /** Shown when there is no breakdown at all (no run, or an old run without one). */
  emptyMessage: string
  limit?: number
}

/** The five biggest contributions to the latest run's difference. */
export function TopVariances({ rows, loading, emptyMessage, limit = 5 }: TopVariancesProps) {
  if (loading) {
    return (
      <div className="space-y-3" aria-hidden>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-40" rounded="md" />
            <Skeleton className="h-2 w-full" rounded="full" />
          </div>
        ))}
      </div>
    )
  }
  if (rows.length === 0) {
    return <p className="py-8 text-center text-xs text-gray-500">{emptyMessage}</p>
  }

  return (
    <ul className="m-0 list-none space-y-2.5 p-0">
      {rows.slice(0, limit).map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3">
            <Tooltip label={row.help}>
              <span className="truncate text-[13px] font-medium text-gray-800">{row.label}</span>
            </Tooltip>
            <span
              className={cx(
                'shrink-0 text-[13px] font-semibold tabular-nums',
                Math.abs(row.amount) < 0.005 ? 'text-gray-500' : row.amount > 0 ? 'text-emerald-700' : 'text-red-600',
              )}
            >
              ₹ {formatMoney(row.amount)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px] text-gray-500">
            <span>
              {row.count > 0 ? `${formatInt(row.count)} item${row.count === 1 ? '' : 's'}` : 'No items counted'}
              {row.documents > 0 ? ` · ${formatInt(row.documents)} document${row.documents === 1 ? '' : 's'}` : ''}
            </span>
            <span className="tabular-nums">{formatPercent(row.share)}</span>
          </div>
          <ShareBar share={row.share} />
        </li>
      ))}
    </ul>
  )
}

/**
 * Why this run's `unexplained` figure looks the way it does, and what to do
 * about it — the content behind the info icon on that one row.
 *
 * `info` is undefined when the caller has not computed it (a screen that only
 * has the rows, not the full breakdown); the row still expands, just without
 * the driver paragraph a full breakdown would add.
 */
function UnexplainedInfoPanel({ info }: { info: UnexplainedExplanation | undefined }) {
  if (info && !info.active) {
    return (
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-gray-600">
        Nothing left over on this run — every bucket above already nets to the difference, so there is nothing here to
        explain.
      </p>
    )
  }
  return (
    <div className="mt-2 max-w-2xl space-y-2 text-xs leading-relaxed text-gray-600">
      <p className="m-0">{UNEXPLAINED_WHY}</p>
      {info?.driver ? (
        <p className="m-0">
          In this run, the gap lines up with Inventory's own internal diagnostic — valuation_method_variance of ₹{' '}
          {formatMoney(info.driver.amount)}
          {info.driver.unvaluedMovements ? ` across ${formatInt(info.driver.unvaluedMovements)} movement${info.driver.unvaluedMovements === 1 ? '' : 's'} costed with no real rate on record` : ''}{' '}
          — rather than a posting that never reached Books. Every other bucket above is already clear.
        </p>
      ) : null}
      <p className="m-0">
        {UNEXPLAINED_ACTION}{' '}
        <Link to={UNEXPLAINED_ACTION_HREF} className="font-semibold text-primary hover:underline">
          Review negative &amp; zero-cost layers →
        </Link>
      </p>
    </div>
  )
}

export interface BucketBreakdownProps {
  rows: readonly BucketRow[]
  loading: boolean
  emptyMessage: string
  /** Powers the `unexplained` row's info panel; omit to leave that row's expand plain. */
  unexplained?: UnexplainedExplanation
}

/**
 * Every bucket, with the documents behind it one click away.
 *
 * `unexplained` is called out rather than sorted like the rest: it is the one
 * row that must be zero before anybody signs the reconciliation off. It also
 * gets its own info icon — the other buckets are self-explanatory from their
 * "What it means" text, but "what is left after everything else" needs a
 * reader to know WHY a residual can exist at all before "must be zero" means
 * anything actionable.
 */
export function BucketBreakdown({ rows, loading, emptyMessage, unexplained }: BucketBreakdownProps) {
  const [open, setOpen] = useState<string | null>(null)
  const documents = useMemo(() => new Map(rows.map((row) => [row.key, bucketDocuments(row)])), [rows])

  if (loading) {
    return (
      <div className="space-y-2" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" rounded="lg" />
        ))}
      </div>
    )
  }
  if (rows.length === 0) {
    return <p className="py-10 text-center text-xs text-gray-500">{emptyMessage}</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th scope="col" className="px-3 py-2 text-left text-label-sm font-semibold uppercase tracking-wide text-gray-500">
              Bucket
            </th>
            <th scope="col" className="px-3 py-2 text-left text-label-sm font-semibold uppercase tracking-wide text-gray-500">
              What it means
            </th>
            <th scope="col" className="px-3 py-2 text-right text-label-sm font-semibold uppercase tracking-wide text-gray-500">
              Items
            </th>
            <th scope="col" className="px-3 py-2 text-right text-label-sm font-semibold uppercase tracking-wide text-gray-500">
              Contribution (₹)
            </th>
            <th scope="col" className="px-3 py-2 text-right text-label-sm font-semibold uppercase tracking-wide text-gray-500">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const docs = documents.get(row.key) ?? []
            const isUnexplained = row.key === 'unexplained'
            const expanded = open === row.key
            const critical = isUnexplained && Math.abs(row.amount) >= 0.005
            const expandable = docs.length > 0 || isUnexplained
            return (
              <tr key={row.key} className={cx('border-b border-gray-100 align-top', critical && 'bg-red-50/40')}>
                <td className="px-3 py-2">
                  {expandable ? (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : row.key)}
                      className="inline-flex items-center gap-1 font-semibold text-gray-900 hover:text-primary"
                    >
                      {expanded ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                      {row.label}
                      {isUnexplained ? (
                        <Tooltip label="Why this can be nonzero, and what to do about it">
                          <Info className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                        </Tooltip>
                      ) : null}
                    </button>
                  ) : (
                    <span className="font-semibold text-gray-900">{row.label}</span>
                  )}
                  {expanded && docs.length > 0 ? (
                    <ul className="mt-2 max-h-72 list-none space-y-1 overflow-y-auto p-0 text-xs text-gray-600">
                      {docs.slice(0, 200).map((d, i) => (
                        <li key={`${row.key}-${d.document_id}-${i}`} className="border-l-2 border-gray-200 pl-2">
                          {d.document_id ? (
                            <Link to={`/documents/${d.document_id}`}>{d.document_no ?? `#${d.document_id}`}</Link>
                          ) : (
                            <span>{d.document_no ?? '—'}</span>
                          )}
                          {d.document_type ? ` · ${humanize(d.document_type)}` : ''}
                          {d.document_date ? ` · ${formatDate(d.document_date)}` : ''}
                          {d.status ? ` · ${humanize(d.status)}` : ''}
                          {d.source_document_no ? ` · from ${d.source_app ?? 'Books'} ${d.source_document_no}` : ''}
                          {d.amount !== undefined ? ` · ₹ ${formatMoney(d.amount)}` : d.stock_effect !== undefined ? ` · ₹ ${formatMoney(d.stock_effect)}` : ''}
                          {d.gap !== undefined ? ` · gap ₹ ${formatMoney(d.gap)}` : ''}
                          {d.reason ? ` — ${d.reason}` : ''}
                        </li>
                      ))}
                      {docs.length > 200 ? <li className="text-gray-400">… and {formatInt(docs.length - 200)} more</li> : null}
                    </ul>
                  ) : null}
                  {expanded && isUnexplained ? <UnexplainedInfoPanel info={unexplained} /> : null}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">{row.help}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">{formatInt(row.count)}</td>
                <td
                  className={cx(
                    'px-3 py-2 text-right font-semibold tabular-nums',
                    Math.abs(row.amount) < 0.005 ? 'text-gray-500' : critical ? 'text-red-600' : 'text-gray-900',
                  )}
                >
                  {formatMoney(row.amount)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500">{formatPercent(row.share)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default BucketBreakdown
