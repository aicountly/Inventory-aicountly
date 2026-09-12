import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAccess } from '../access/AccessContext'
import { useCompany } from '../company/CompanyContext'
import { Notice } from '../components/Notice'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { useQuery } from '../hooks/useQuery'
import { P } from '../services/access'
import { errorMessage } from '../services/api'
import { fetchDashboard } from '../services/dashboard'
import type { DashboardData } from '../services/dashboard'
import { formatDate, formatDateTime, formatInt, formatMoney, formatQty, humanize } from '../utils/format'
import './dashboard.css'

const NEAR_EXPIRY_CHOICES = [15, 30, 60, 90]

interface TileProps {
  label: string
  value: ReactNode
  foot?: ReactNode
  to?: string
  /** Show an "attention" chip when the number is worth acting on. */
  attention?: boolean
  attentionLabel?: string
}

function Tile({ label, value, foot, to, attention, attentionLabel = 'Needs attention' }: TileProps) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {attention || foot ? (
        <span className="kpi-foot">
          {attention ? <StatusBadge value="warning" tone="warning" label={attentionLabel} /> : null}
          {foot}
        </span>
      ) : null}
    </>
  )
  return to ? (
    <Link className="kpi-tile" to={to}>
      {body}
    </Link>
  ) : (
    <div className="kpi-tile">{body}</div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="kpi-section">
      <h2 className="kpi-section-title">{title}</h2>
      {children}
    </section>
  )
}

function KeyValues({ entries, empty = 'Nothing yet' }: { entries: [string, ReactNode][]; empty?: string }) {
  if (entries.length === 0) return <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>{empty}</p>
  return (
    <dl className="kv-list">
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function Dashboard() {
  const { scope, companyName, fy, branch } = useCompany()
  const { can, loading: accessLoading } = useAccess()
  const [nearExpiryDays, setNearExpiryDays] = useState(30)
  const allowed = can(P.dashboard)
  const { data, loading, error, reload } = useQuery((signal) => fetchDashboard(nearExpiryDays, signal), [scope?.cmp_id, scope?.fy_id, scope?.bo_id, nearExpiryDays], {
    enabled: !!scope && allowed,
  })

  const canItems = can(P.masters('items', 'read'))
  const canWarehouses = can(P.masters('warehouses', 'read'))
  const canBatches = can(P.masters('batches', 'read'))

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        subtitle={
          <>
            {companyName || 'Company'} · {fy?.label ?? 'FY'} · {branch ? branch.name : 'All branches'}
            {data?.as_of ? ` · as of ${formatDate(data.as_of)}` : ''}
          </>
        }
        actions={
          <button type="button" className="btn" onClick={reload} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {!accessLoading && !allowed ? <Notice kind="warning">You do not have the Dashboard permission in this company.</Notice> : null}
      {error ? (
        <Notice
          kind="error"
          title="Could not load the dashboard"
          actions={
            <button type="button" className="btn btn-sm" onClick={reload}>
              Retry
            </button>
          }
        >
          {errorMessage(error)}
        </Notice>
      ) : null}

      {data ? <DashboardBody data={data} nearExpiryDays={nearExpiryDays} onNearExpiryDays={setNearExpiryDays} links={{ items: canItems, warehouses: canWarehouses, batches: canBatches }} /> : loading && allowed ? <p className="muted">Loading…</p> : null}
    </div>
  )
}

interface BodyProps {
  data: DashboardData
  nearExpiryDays: number
  onNearExpiryDays: (days: number) => void
  links: { items: boolean; warehouses: boolean; batches: boolean }
}

function DashboardBody({ data, nearExpiryDays, onNearExpiryDays, links }: BodyProps) {
  const docs = data.documents
  const stock = data.stock
  const integ = data.integration
  const statusEntries = Object.entries(docs.by_status).filter(([, n]) => n > 0)
  const typeEntries = Object.entries(docs.posted_by_type).filter(([, n]) => n > 0)
  const pendingEntries = Object.entries(stock.pending_quantities).filter(([, n]) => n > 0)
  const recon = data.last_reconciliation

  return (
    <>
      <Section title="Masters">
        <div className="kpi-row">
          <Tile label="Active items" value={formatInt(data.masters.items.active)} foot={`${formatInt(data.masters.items.total)} total`} to={links.items ? '/items' : undefined} />
          <Tile label="Active warehouses" value={formatInt(data.masters.warehouses.active)} foot={`${formatInt(data.masters.warehouses.total)} total`} to={links.warehouses ? '/masters/warehouses' : undefined} />
        </div>
      </Section>

      <Section title="Documents this financial year">
        <div className="kpi-row">
          <Tile label="Documents" value={formatInt(docs.total)} />
          <Tile label="Pending approval" value={formatInt(docs.pending_approval)} attention={docs.pending_approval > 0} attentionLabel="Awaiting approval" />
          <Tile label="Failed postings" value={formatInt(docs.failed)} attention={docs.failed > 0} attentionLabel="Needs a retry" />
        </div>
        <div className="kpi-grid-2">
          <div className="card">
            <div className="card-body">
              <h3 className="card-title">By status</h3>
              <KeyValues entries={statusEntries.map(([k, n]) => [humanize(k), formatInt(n)])} empty="No documents in this year yet" />
            </div>
          </div>
          <div className="card">
            <div className="card-body">
              <h3 className="card-title">Posted, by type</h3>
              <KeyValues entries={typeEntries.map(([k, n]) => [humanize(k), formatInt(n)])} empty="Nothing posted in this year yet" />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Stock health">
        <div className="dashboard-toolbar">
          <label>
            Near-expiry window{' '}
            <select className="select" value={nearExpiryDays} onChange={(e) => onNearExpiryDays(Number(e.target.value))} aria-label="Near-expiry window in days">
              {NEAR_EXPIRY_CHOICES.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="kpi-row">
          <Tile label="Items in negative stock" value={formatInt(stock.negative_stock_items)} foot={`${formatInt(stock.negative_stock_warehouse_rows)} warehouse rows`} attention={stock.negative_stock_items > 0} attentionLabel="Below zero" />
          <Tile label={`Batches expiring in ${stock.near_expiry_days} days`} value={formatInt(stock.near_expiry_batches)} attention={stock.near_expiry_batches > 0} attentionLabel="Expiring soon" to={links.batches ? '/masters/batches' : undefined} />
          <Tile label="Expired batches" value={formatInt(stock.expired_batches)} attention={stock.expired_batches > 0} attentionLabel="Expired" to={links.batches ? '/masters/batches' : undefined} />
        </div>
        <div className="card">
          <div className="card-body">
            <h3 className="card-title">Open pending quantities</h3>
            <KeyValues entries={pendingEntries.map(([k, n]) => [humanize(k), formatInt(n)])} empty="No open challans, deferred receipts or job work" />
          </div>
        </div>
      </Section>

      <Section title="Books integration">
        <div className="kpi-row">
          <Tile label="Outbox awaiting delivery" value={formatInt(integ.outbox_pending)} attention={integ.outbox_pending > 0} attentionLabel="Pending" />
          <Tile label="Outbox failed" value={formatInt(integ.outbox_failed)} attention={integ.outbox_failed > 0} attentionLabel="Failed" />
          <Tile label="Unacknowledged revisions" value={formatInt(integ.unacknowledged_revisions.count)} foot={`Δ ${formatMoney(integ.unacknowledged_revisions.delta_total)}`} attention={integ.unacknowledged_revisions.count > 0} attentionLabel="Review" />
          <Tile label="Recalculations running" value={formatInt(integ.recalculations_in_progress)} />
        </div>
        <div className="kpi-grid-2">
          <div className="card">
            <div className="card-body">
              <h3 className="card-title">Outbox by status</h3>
              <KeyValues entries={Object.entries(integ.outbox).map(([k, n]) => [humanize(k), formatInt(n)])} />
            </div>
          </div>
          <div className="card">
            <div className="card-body">
              <h3 className="card-title">Inbound events by status</h3>
              <KeyValues entries={Object.entries(integ.inbound).map(([k, n]) => [humanize(k), formatInt(n)])} />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Last reconciliation with Books">
        <div className="card">
          <div className="card-body">
            {recon ? (
              <KeyValues
                entries={[
                  ['Status', <StatusBadge key="s" value={recon.status} />],
                  ['As of', formatDate(recon.as_of_date)],
                  ['Inventory closing value', formatMoney(recon.inventory_closing_value)],
                  ['Inventory closing quantity', formatQty(recon.inventory_closing_qty)],
                  ['Books stock ledger balance', formatMoney(recon.books_stock_ledger_balance)],
                  ['Difference', formatMoney(recon.difference)],
                  ['Run at', formatDateTime(recon.created_at)],
                ]}
              />
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
                No reconciliation has been run for this financial year yet.
              </p>
            )}
          </div>
        </div>
      </Section>
    </>
  )
}
