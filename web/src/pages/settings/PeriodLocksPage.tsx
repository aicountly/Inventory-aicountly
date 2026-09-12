import { useState } from 'react'
import { useCan } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { DataTable } from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { FormField } from '../../components/FormField'
import { PageHeader } from '../../components/PageHeader'
import { RequirePermission } from '../../components/RequirePermission'
import { StatusBadge } from '../../components/StatusBadge'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { ApiError } from '../../services/api'
import { settingsApi } from '../../services/settingsApi'
import type { PeriodLock } from '../../services/settingsApi'
import { useToast } from '../../ui/ToastContext'
import { formatDate, formatDateTime } from '../../utils/format'
import '../views.css'

export function PeriodLocksPage() {
  const { scope, branches } = useCompany()
  const toast = useToast()
  const canLock = useCan(P.periodsLock)
  const locks = useQuery((signal) => settingsApi.periodLocks(signal), [scope?.cmp_id, scope?.bo_id], { enabled: scope !== null })
  const [form, setForm] = useState({ locked_upto_date: '', bo_id: String(scope?.bo_id ?? 0), reason: '' })
  const [busy, setBusy] = useState(false)
  const [release, setRelease] = useState<PeriodLock | null>(null)

  const lock = async () => {
    setBusy(true)
    try {
      await settingsApi.lockPeriod({ locked_upto_date: form.locked_upto_date, bo_id: Number(form.bo_id) || 0, reason: form.reason || undefined })
      toast.success(`Stock locked up to ${formatDate(form.locked_upto_date)}.`)
      setForm({ ...form, locked_upto_date: '', reason: '' })
      locks.reload()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not lock the period.')
    } finally {
      setBusy(false)
    }
  }
  const doRelease = async () => {
    if (!release) return
    setBusy(true)
    try {
      await settingsApi.releasePeriodLock(release.lock_id)
      toast.success('Lock released.')
      setRelease(null)
      locks.reload()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not release the lock.')
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<PeriodLock>[] = [
    { key: 'locked_upto_date', header: 'Locked up to', render: (r) => <strong>{formatDate(r.locked_upto_date)}</strong> },
    { key: 'bo_id', header: 'Branch', render: (r) => (r.bo_id === 0 ? 'All branches' : branches.find((b) => b.boId === r.bo_id)?.name ?? `Branch #${r.bo_id}`) },
    { key: 'status', header: 'Status', render: (r) => (r.released_at ? <StatusBadge value="released" tone="neutral" /> : <StatusBadge value="active" tone="good" />) },
    { key: 'reason', header: 'Reason', render: (r) => r.reason ?? <span className="muted">—</span> },
    { key: 'locked_at', header: 'Locked', render: (r) => `${formatDateTime(r.locked_at)}${r.locked_by ? ` · ${r.locked_by}` : ''}` },
    { key: 'released_at', header: 'Released', render: (r) => (r.released_at ? `${formatDateTime(r.released_at)}${r.released_by ? ` · ${r.released_by}` : ''}` : '—') },
  ]

  return (
    <>
      <PageHeader title="Period locks" subtitle="No stock document can be created, posted, reversed or back-dated on or before a locked date. Lock a period after the accountant has signed off its reconciliation." />
      <RequirePermission permission={P.settingsRead} what="period locks">
        {canLock ? (
          <section className="card">
            <div className="card-body form-grid">
              <FormField label="Lock up to" htmlFor="lock-date" required>
                <input id="lock-date" className="input" type="date" value={form.locked_upto_date} onChange={(e) => setForm({ ...form, locked_upto_date: e.target.value })} />
              </FormField>
              <FormField label="Branch" htmlFor="lock-bo">
                <select id="lock-bo" className="select" value={form.bo_id} onChange={(e) => setForm({ ...form, bo_id: e.target.value })}>
                  <option value="0">All branches</option>
                  {branches.map((b) => (
                    <option key={b.boId} value={b.boId}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Reason" htmlFor="lock-reason" className="span-2">
                <input id="lock-reason" className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Q1 reconciled and signed off" />
              </FormField>
              <div className="span-all">
                <button type="button" className="btn btn-primary" disabled={busy || !form.locked_upto_date} onClick={lock}>
                  {busy ? 'Locking…' : 'Lock period'}
                </button>
              </div>
            </div>
          </section>
        ) : null}
        <DataTable columns={columns} rows={locks.data ?? []} rowKey={(r) => r.lock_id} loading={locks.loading} error={locks.error} emptyMessage="No period locks." rowActions={(r) => (canLock && !r.released_at ? <button type="button" className="btn btn-sm btn-danger" onClick={() => setRelease(r)}>Release</button> : null)} />
      </RequirePermission>
      <ConfirmDialog open={release !== null} title="Release this lock?" message={release ? `Documents dated on or before ${formatDate(release.locked_upto_date)} become editable again. The release is recorded in the audit log.` : ''} confirmLabel="Release" danger busy={busy} onConfirm={doRelease} onCancel={() => setRelease(null)} />
    </>
  )
}
