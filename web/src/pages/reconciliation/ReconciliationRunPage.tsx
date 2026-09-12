import { Link, useParams } from 'react-router-dom'
import { useCompany } from '../../company/CompanyContext'
import { JsonBlock } from '../../components/JsonBlock'
import { Notice } from '../../components/Notice'
import { PageHeader } from '../../components/PageHeader'
import { RequirePermission } from '../../components/RequirePermission'
import { StatusBadge } from '../../components/StatusBadge'
import { SummaryStrip } from '../../components/SummaryStrip'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { reconciliationApi } from '../../services/reconciliationApi'
import type { BucketDocument, ReconciliationBucket } from '../../services/reconciliationApi'
import { formatDate, formatDateTime, formatInt, formatMoney, formatQty } from '../../utils/format'
import { differenceTone } from './ReconciliationRunsPage'
import { PostingStatusTable } from './PostingStatusTable'
import '../views.css'

/** What each bucket means and which way it moves Books towards Inventory. */
const BUCKET_HELP: Record<string, string> = {
  opening_difference: 'Opening stock differs between Inventory (openings) and the Books ledger opening balance.',
  pending_posting: 'Books vouchers whose stock lines are still queued for posting to Inventory.',
  failed_posting: 'Books vouchers Inventory refused; fix and retry from Books (books:inventory-retry).',
  cancelled_reversed: 'Documents reversed in Inventory or cancelled in Books; netted when both sides agree.',
  unacknowledged_valuation_revisions: 'COGS revisions Inventory published that Books has not applied yet.',
  revaluation: 'Revaluation journals Books recorded in adjustment mode.',
  manual_journal: 'Manual journals on the Stock-in-Hand ledger that have no stock document behind them.',
  valuation_method_variance: 'Closing snapshot versus opening + movement values — mixed methods, WAC rounding or back-dated recosts.',
  transfer_valuation_gap: 'Stock transfers whose receiving side carries no cost layer (inherited from legacy data).',
  missing_source: 'Inventory documents that claim a Books source Books cannot find.',
  rounding: 'Sub-rupee rounding between line values and ledger amounts.',
  unexplained: 'What is left after every bucket above. Must be zero before sign-off.',
}

export function ReconciliationRunPage() {
  const { id = '' } = useParams()
  const { scope } = useCompany()
  const run = useQuery((signal) => reconciliationApi.get(Number(id), signal), [id, scope?.cmp_id], { enabled: scope !== null && Number(id) > 0 })
  const r = run.data
  const bd = r?.breakdown ?? null
  const buckets = bd ? Object.entries(bd.buckets ?? {}) : []

  return (
    <>
      <PageHeader
        title={r ? `Reconciliation #${r.run_id} — as at ${formatDate(r.as_of_date)}` : 'Reconciliation run'}
        subtitle={r ? `Run ${formatDateTime(r.created_at)} by ${r.requested_by ?? 'schedule'} · ${bd?.sign_convention ?? ''}` : ''}
        actions={<Link to="/reconciliation" className="btn btn-ghost">All runs</Link>}
      />
      <RequirePermission permission={P.reconciliationRead} what="this reconciliation run">
        {run.error ? <Notice kind="error">{run.error.message}</Notice> : null}
        {r ? (
          <>
            <SummaryStrip
              items={[
                { label: 'Status', value: <StatusBadge value={r.status} tone={r.status === 'COMPLETED' ? 'good' : r.status === 'FAILED' ? 'critical' : 'warning'} /> },
                { label: 'Inventory closing', value: formatMoney(r.inventory_closing_value), hint: `${formatQty(r.inventory_closing_qty)} qty` },
                { label: 'Books stock ledger', value: formatMoney(r.books_stock_ledger_balance) },
                { label: 'Difference', value: formatMoney(r.difference), tone: differenceTone(r.difference) },
                { label: 'Explained', value: formatMoney(bd?.explained_total), tone: 'neutral' },
                { label: 'Unexplained', value: formatMoney(bd?.residual ?? bd?.buckets?.unexplained?.amount), tone: differenceTone(bd?.residual ?? bd?.buckets?.unexplained?.amount ?? null) },
              ]}
            />
            {bd && !bd.books.available ? <Notice kind="warning" title="Books was not reachable">{bd.books.error ?? `HTTP ${bd.books.status}`} — only the Inventory side of this run is meaningful.</Notice> : null}
            {bd?.error ? <Notice kind="error">{bd.error}</Notice> : null}
            <section className="card">
              <div className="card-body">
                <h2 className="card-title">Breakdown</h2>
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Bucket</th>
                      <th className="num">Amount</th>
                      <th className="num">Count</th>
                      <th>Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buckets.map(([key, b]) => (
                      <BucketRow key={key} name={key} bucket={b} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            {r.document_status ? (
              <section className="card">
                <div className="card-body">
                  <h2 className="card-title">Posting status of Books vouchers</h2>
                  <p className="muted">
                    {Object.entries(r.document_status.summary ?? {}).map(([k, n]) => `${k.replace(/_/g, ' ')}: ${formatInt(n)}`).join(' · ')}
                    {r.document_status.truncated ? ' · list truncated — use the posting status page for the full set' : ''}
                  </p>
                  <PostingStatusTable entries={r.document_status.entries ?? []} />
                </div>
              </section>
            ) : null}
            <JsonBlock value={r} label="Raw run" />
          </>
        ) : null}
      </RequirePermission>
    </>
  )
}

function BucketRow({ name, bucket }: { name: string; bucket: ReconciliationBucket }) {
  const docs: BucketDocument[] = Array.isArray(bucket.documents) ? bucket.documents : []
  const nonzero = Math.abs(bucket.amount ?? 0) >= 0.005
  return (
    <>
      <tr className={name === 'unexplained' && nonzero ? 'row-critical' : undefined}>
        <td>
          <strong>{name.replace(/_/g, ' ')}</strong>
        </td>
        <td className="num">{formatMoney(bucket.amount)}</td>
        <td className="num">{formatInt(bucket.count)}</td>
        <td className="muted">{BUCKET_HELP[name] ?? ''}</td>
      </tr>
      {docs.length > 0 ? (
        <tr>
          <td colSpan={4}>
            <details>
              <summary>{docs.length} document{docs.length === 1 ? '' : 's'}</summary>
              <ul className="plain-list">
                {docs.slice(0, 200).map((d) => (
                  <li key={d.document_id}>
                    <Link to={`/documents/${d.document_id}`}>{d.document_no ?? `#${d.document_id}`}</Link> · {d.document_type ?? ''} · {formatDate(d.document_date)}{d.status ? ` · ${d.status}` : ''}{d.source_document_no ? ` · from ${d.source_app ?? ''} ${d.source_document_no}` : ''}
                    {d.amount !== undefined ? ` · ${formatMoney(d.amount)}` : d.stock_effect !== undefined ? ` · ${formatMoney(d.stock_effect)}` : ''}{d.gap !== undefined ? ` · gap ${formatMoney(d.gap)}` : ''}{d.reason ? ` — ${d.reason}` : ''}
                  </li>
                ))}
                {docs.length > 200 ? <li className="muted">… and {docs.length - 200} more</li> : null}
              </ul>
            </details>
          </td>
        </tr>
      ) : null}
    </>
  )
}
