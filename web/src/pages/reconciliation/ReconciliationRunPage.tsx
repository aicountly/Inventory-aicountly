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
import { buildBooksAppLink } from '../../services/booksApi'
import { reconciliationApi } from '../../services/reconciliationApi'
import type { BucketDocument, ReconciliationBucket, ReconciliationRunDetail } from '../../services/reconciliationApi'
import { formatDate, formatDateTime, formatInt, formatMoney, formatQty } from '../../utils/format'
import { BUCKET_HELP, differenceTone } from './reconciliationModel'
import { PostingStatusTable } from './PostingStatusTable'
import '../views.css'


export function ReconciliationRunPage() {
  const { id = '' } = useParams()
  const { scope } = useCompany()
  const run = useQuery((signal) => reconciliationApi.get(Number(id), signal), [id, scope?.cmp_id], { enabled: scope !== null && Number(id) > 0 })
  const r = run.data
  const bd = r?.breakdown ?? null
  const buckets = bd ? Object.entries(bd.buckets ?? {}) : []

  return (
    // The module layout used to supply this wrapper; the tabs moved onto the
    // screens themselves, so the drill-down keeps its own vertical rhythm.
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: 'Inventory', to: '/' },
          { label: 'Reconciliation', to: '/reconciliation' },
          { label: r ? `Run #${r.run_id}` : 'Run' },
        ]}
        title={r ? `Reconciliation #${r.run_id} — as at ${formatDate(r.as_of_date)}` : 'Reconciliation run'}
        subtitle={r ? `Run ${formatDateTime(r.created_at)} by ${r.requested_by ?? 'an actor that was not recorded'} · ${bd?.sign_convention ?? ''}` : ''}
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
                      <BucketRow key={key} name={key} bucket={b} run={r} />
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
    </div>
  )
}

function BucketRow({ name, bucket, run }: { name: string; bucket: ReconciliationBucket; run: ReconciliationRunDetail }) {
  const docs: BucketDocument[] = Array.isArray(bucket.documents) ? bucket.documents : []
  const nonzero = Math.abs(bucket.amount ?? 0) >= 0.005
  // Books owns applying these — Inventory only publishes them and shows the count
  // still outstanding. The run's own company/FY, never a global default, so the
  // Books screen opens on the same books that produced this run's figures.
  const reviewInBooks = name === 'unacknowledged_valuation_revisions' && (bucket.count ?? 0) > 0
  return (
    <>
      <tr className={name === 'unexplained' && nonzero ? 'row-critical' : undefined}>
        <td>
          <strong>{name.replace(/_/g, ' ')}</strong>
        </td>
        <td className="num">{formatMoney(bucket.amount)}</td>
        <td className="num">{formatInt(bucket.count)}</td>
        <td className="muted">
          {BUCKET_HELP[name] ?? ''}
          {reviewInBooks ? (
            <>
              {' '}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  window.open(
                    buildBooksAppLink('/reports/cogs-revision-audit', { cmpId: run.cmp_id, fyId: run.fy_id }),
                    '_blank',
                    'noopener,noreferrer',
                  )
                }
              >
                Review in Books
              </button>
            </>
          ) : null}
        </td>
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
