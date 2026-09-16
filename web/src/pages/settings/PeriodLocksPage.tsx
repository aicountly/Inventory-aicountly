import { useMemo, useState } from 'react'
import { CalendarClock, Lock } from 'lucide-react'
import { useCan } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { DataTable } from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { RequirePermission } from '../../components/RequirePermission'
import { StatusBadge } from '../../components/StatusBadge'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { ApiError } from '../../services/api'
import { settingsApi } from '../../services/settingsApi'
import type { PeriodLock } from '../../services/settingsApi'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { FormField, FormSectionCard } from '../../ui/shell/FormSectionCard'
import { useToast } from '../../ui/ToastContext'
import { formatDate, formatDateTime } from '../../utils/format'

export function PeriodLocksPage() {
  const { scope, branches } = useCompany()
  const toast = useToast()
  const canLock = useCan(P.periodsLock)
  const locks = useQuery((signal) => settingsApi.periodLocks(signal), [scope?.cmp_id, scope?.bo_id], {
    enabled: scope !== null,
    resetKey: scope?.cmp_id ?? null,
  })
  const [form, setForm] = useState({ locked_upto_date: '', bo_id: String(scope?.bo_id ?? 0), reason: '' })
  const [busy, setBusy] = useState(false)
  const [release, setRelease] = useState<PeriodLock | null>(null)
  const [confirmLock, setConfirmLock] = useState(false)

  const active = useMemo(() => (locks.data ?? []).filter((l) => !l.released_at).length, [locks.data])

  const lock = async () => {
    setBusy(true)
    try {
      await settingsApi.lockPeriod({
        locked_upto_date: form.locked_upto_date,
        bo_id: Number(form.bo_id) || 0,
        reason: form.reason || undefined,
      })
      toast.success(`Stock locked up to ${formatDate(form.locked_upto_date)}.`)
      setForm({ ...form, locked_upto_date: '', reason: '' })
      setConfirmLock(false)
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
    {
      key: 'bo_id',
      header: 'Branch',
      render: (r) => (r.bo_id === 0 ? 'All branches' : (branches.find((b) => b.boId === r.bo_id)?.name ?? `Branch #${r.bo_id}`)),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (r.released_at ? <StatusBadge value="released" tone="neutral" /> : <StatusBadge value="active" tone="good" />),
    },
    { key: 'reason', header: 'Reason', render: (r) => r.reason ?? <span className="muted">—</span> },
    { key: 'locked_at', header: 'Locked', render: (r) => `${formatDateTime(r.locked_at)}${r.locked_by ? ` · ${r.locked_by}` : ''}` },
    {
      key: 'released_at',
      header: 'Released',
      render: (r) => (r.released_at ? `${formatDateTime(r.released_at)}${r.released_by ? ` · ${r.released_by}` : ''}` : '—'),
    },
  ]

  return (
    <RequirePermission permission={P.settingsRead} what="period locks">
      <div className="flex flex-col gap-4">
        {canLock ? (
          <FormSectionCard
            icon={Lock}
            title="Lock a period"
            description="No stock document can be created, posted, reversed or back-dated on or before a locked date. Lock a period once the accountant has signed off its reconciliation."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <FormField label="Lock up to" htmlFor="lock-date" required hint="Inclusive — this date is locked too.">
                <Input
                  id="lock-date"
                  size="md"
                  type="date"
                  value={form.locked_upto_date}
                  onChange={(e) => setForm({ ...form, locked_upto_date: e.target.value })}
                />
              </FormField>
              <FormField label="Branch" htmlFor="lock-bo" hint="All branches locks the company as a whole.">
                <Select id="lock-bo" size="md" value={form.bo_id} onChange={(e) => setForm({ ...form, bo_id: e.target.value })}>
                  <option value="0">All branches</option>
                  {branches.map((b) => (
                    <option key={b.boId} value={b.boId}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Reason" htmlFor="lock-reason" className="sm:col-span-2" hint="Recorded in the audit trail with the lock.">
                <Input
                  id="lock-reason"
                  size="md"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="e.g. Q1 reconciled and signed off"
                />
              </FormField>
            </div>
            <div className="mt-4 border-t border-gray-100 pt-3">
              <Button size="md" icon={Lock} disabled={busy || !form.locked_upto_date} onClick={() => setConfirmLock(true)}>
                Lock period
              </Button>
            </div>
          </FormSectionCard>
        ) : null}

        <FormSectionCard
          icon={CalendarClock}
          title="Locks on this company"
          description="Every lock and release, with who did it and when."
          action={
            <span className="text-xs font-medium text-gray-500">
              {active} active · {(locks.data ?? []).length} total
            </span>
          }
        >
          <DataTable
            columns={columns}
            rows={locks.data ?? []}
            rowKey={(r) => r.lock_id}
            loading={locks.loading}
            error={locks.error}
            emptyMessage="No period locks — every date is still open for posting."
            rowActions={(r) =>
              canLock && !r.released_at ? (
                <Button variant="danger" size="xs" onClick={() => setRelease(r)}>
                  Release
                </Button>
              ) : null
            }
          />
        </FormSectionCard>
      </div>

      <ConfirmDialog
        open={confirmLock}
        title="Lock this period?"
        message={
          form.locked_upto_date
            ? `Documents dated on or before ${formatDate(form.locked_upto_date)} can no longer be created, posted, reversed or back-dated${Number(form.bo_id) ? ' in this branch' : ''}. The lock is recorded in the audit log and can be released later.`
            : ''
        }
        confirmLabel="Lock period"
        busy={busy}
        onConfirm={lock}
        onCancel={() => setConfirmLock(false)}
      />
      <ConfirmDialog
        open={release !== null}
        title="Release this lock?"
        message={
          release
            ? `Documents dated on or before ${formatDate(release.locked_upto_date)} become editable again. The release is recorded in the audit log.`
            : ''
        }
        confirmLabel="Release"
        danger
        busy={busy}
        onConfirm={doRelease}
        onCancel={() => setRelease(null)}
      />
    </RequirePermission>
  )
}
