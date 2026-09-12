import { useMemo, useState } from 'react'
import { useCan } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { DataTable } from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { FormField } from '../../components/FormField'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { RequirePermission } from '../../components/RequirePermission'
import { StatusBadge } from '../../components/StatusBadge'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { accessAdminApi } from '../../services/accessAdminApi'
import type { AccessProfileRow, MemberRow } from '../../services/accessAdminApi'
import { ApiError } from '../../services/api'
import { useToast } from '../../ui/ToastContext'
import { formatDateTime, formatInt, isOn } from '../../utils/format'
import '../views.css'

const MEMBER_TONE: Record<string, 'good' | 'info' | 'critical'> = { active: 'good', invited: 'info', revoked: 'critical' }

export function AccessPage() {
  const { scope } = useCompany()
  const toast = useToast()
  const canProfiles = useCan(P.accessManage)
  const canMembers = useCan([P.accessManage, P.accessMembersManage])
  const catalog = useQuery((signal) => accessAdminApi.catalog(signal), [scope?.cmp_id], { enabled: scope !== null })
  const profiles = useQuery((signal) => accessAdminApi.profiles(signal), [scope?.cmp_id], { enabled: scope !== null })
  const members = useQuery((signal) => accessAdminApi.members(signal), [scope?.cmp_id], { enabled: scope !== null })
  const [editing, setEditing] = useState<AccessProfileRow | 'new' | null>(null)
  const [memberForm, setMemberForm] = useState<{ open: boolean; uuid: string; profile_id: string; display_name: string; email: string }>({ open: false, uuid: '', profile_id: '', display_name: '', email: '' })
  const [removing, setRemoving] = useState<MemberRow | null>(null)
  const [busy, setBusy] = useState(false)

  const profileColumns = useMemo<Column<AccessProfileRow>[]>(
    () => [
      { key: 'profile_name', header: 'Profile', render: (r) => <span><strong>{r.profile_name}</strong>{isOn(r.is_system) ? <span className="muted"> · system</span> : null}{r.template_key ? <span className="muted"> · from {r.template_key}</span> : null}</span> },
      { key: 'description', header: 'Description', render: (r) => r.description ?? <span className="muted">—</span> },
      { key: 'permissions', header: 'Permissions', align: 'right', render: (r) => formatInt(r.permissions?.length ?? 0) },
      { key: 'member_count', header: 'Members', align: 'right', render: (r) => formatInt(r.member_count) },
      { key: 'is_active', header: 'Status', render: (r) => <StatusBadge value={isOn(r.is_active) ? 'active' : 'inactive'} tone={isOn(r.is_active) ? 'good' : 'neutral'} /> },
    ],
    [],
  )
  const memberColumns = useMemo<Column<MemberRow>[]>(
    () => [
      { key: 'display_name', header: 'Member', render: (r) => <span><strong>{r.display_name ?? r.email ?? r.uuid}</strong>{r.email && r.display_name ? <span className="muted"> · {r.email}</span> : null}<div className="muted small">{r.uuid}</div></span> },
      { key: 'profile_name', header: 'Profile', render: (r) => r.profile_name ?? `#${r.profile_id}` },
      { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} tone={MEMBER_TONE[r.status] ?? 'neutral'} /> },
      { key: 'allowed_warehouses', header: 'Warehouses', render: (r) => (r.allowed_warehouses?.length ? `${r.allowed_warehouses.length} restricted` : 'all') },
      { key: 'invited_at', header: 'Invited', render: (r) => `${formatDateTime(r.invited_at)}${r.invited_by ? ` · ${r.invited_by}` : ''}` },
      { key: 'accepted_at', header: 'Accepted', render: (r) => formatDateTime(r.accepted_at) },
    ],
    [],
  )

  const provision = async () => {
    setBusy(true)
    try {
      await accessAdminApi.provisionMember({ uuid: memberForm.uuid.trim(), profile_id: memberForm.profile_id ? Number(memberForm.profile_id) : undefined, display_name: memberForm.display_name || null, email: memberForm.email || null })
      toast.success('Member added.')
      setMemberForm({ open: false, uuid: '', profile_id: '', display_name: '', email: '' })
      members.reload()
      profiles.reload()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not add the member.')
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await accessAdminApi.removeMember(removing.uuid)
      toast.success('Member removed.')
      setRemoving(null)
      members.reload()
      profiles.reload()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not remove the member.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Access" subtitle="Profiles bundle permissions; members of this company get one profile each and, optionally, a warehouse restriction. The portal owner always has full access." actions={<>{canProfiles ? <button type="button" className="btn" onClick={() => setEditing('new')}>New profile</button> : null}{canMembers ? <button type="button" className="btn btn-primary" onClick={() => setMemberForm({ ...memberForm, open: true })}>Add member</button> : null}</>} />
      <RequirePermission permission={[P.accessManage, P.accessMembersManage, P.settingsRead]} what="access settings">
        <section className="card">
          <div className="card-body">
            <h2 className="card-title">Profiles</h2>
            <DataTable columns={profileColumns} rows={profiles.data ?? []} rowKey={(r) => r.profile_id} loading={profiles.loading} error={profiles.error} rowActions={(r) => (canProfiles ? <button type="button" className="btn btn-sm" onClick={() => setEditing(r)}>Edit</button> : null)} />
          </div>
        </section>
        <section className="card">
          <div className="card-body">
            <h2 className="card-title">Members</h2>
            <DataTable columns={memberColumns} rows={members.data ?? []} rowKey={(r) => r.id} loading={members.loading} error={members.error} emptyMessage="No members yet — the portal owner can still sign in." rowActions={(r) => (canMembers && r.status !== 'revoked' ? <button type="button" className="btn btn-sm btn-danger" onClick={() => setRemoving(r)}>Remove</button> : null)} />
          </div>
        </section>
      </RequirePermission>

      {editing ? <ProfileEditor profile={editing === 'new' ? null : editing} groups={catalog.data?.groups ?? []} templates={catalog.data?.templates ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); profiles.reload() }} /> : null}

      <Modal open={memberForm.open} title="Add member" onClose={() => setMemberForm({ ...memberForm, open: false })} busy={busy} footer={<><button type="button" className="btn" onClick={() => setMemberForm({ ...memberForm, open: false })}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy || !memberForm.uuid.trim() || !memberForm.profile_id} onClick={provision}>Add</button></>}>
        <div className="form-grid">
          <FormField label="Portal user uuid" htmlFor="m-uuid" required help="The AICOUNTLY account uuid (my.aicountly.com) of the person; they must already belong to this company in Manage." className="span-2">
            <input id="m-uuid" className="input" value={memberForm.uuid} onChange={(e) => setMemberForm({ ...memberForm, uuid: e.target.value })} />
          </FormField>
          <FormField label="Profile" htmlFor="m-profile" required>
            <select id="m-profile" className="select" value={memberForm.profile_id} onChange={(e) => setMemberForm({ ...memberForm, profile_id: e.target.value })}>
              <option value="">Choose…</option>
              {(profiles.data ?? []).filter((p) => isOn(p.is_active)).map((p) => (
                <option key={p.profile_id} value={p.profile_id}>
                  {p.profile_name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Display name" htmlFor="m-name">
            <input id="m-name" className="input" value={memberForm.display_name} onChange={(e) => setMemberForm({ ...memberForm, display_name: e.target.value })} />
          </FormField>
          <FormField label="Email" htmlFor="m-email">
            <input id="m-email" className="input" type="email" value={memberForm.email} onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })} />
          </FormField>
        </div>
      </Modal>
      <ConfirmDialog open={removing !== null} title="Remove this member?" message={removing ? `${removing.display_name ?? removing.uuid} loses access to this company's inventory immediately.` : ''} confirmLabel="Remove" danger busy={busy} onConfirm={remove} onCancel={() => setRemoving(null)} />
    </>
  )
}

function ProfileEditor({ profile, groups, templates, onClose, onSaved }: { profile: AccessProfileRow | null; groups: { id: string; label: string; permissions: { key: string; label: string; action: string }[] }[]; templates: { template_key: string; profile_name: string; description: string }[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(profile?.profile_name ?? '')
  const [description, setDescription] = useState(profile?.description ?? '')
  const [active, setActive] = useState(profile ? isOn(profile.is_active) : true)
  const [perms, setPerms] = useState<Set<string>>(new Set(profile?.permissions ?? []))
  const [busy, setBusy] = useState(false)
  const system = profile ? isOn(profile.is_system) : false

  const toggle = (key: string) => setPerms((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const toggleGroup = (keys: string[], on: boolean) => setPerms((prev) => { const next = new Set(prev); for (const k of keys) { if (on) next.add(k); else next.delete(k) } return next })
  const save = async () => {
    setBusy(true)
    try {
      if (profile) {
        await accessAdminApi.updateProfile(profile.profile_id, { profile_name: name, description: description || null, is_active: active })
        if (!system) await accessAdminApi.setPermissions(profile.profile_id, Array.from(perms))
      } else {
        await accessAdminApi.createProfile({ profile_name: name, description: description || null, permissions: Array.from(perms) })
      }
      toast.success('Profile saved.')
      onSaved()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save the profile.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title={profile ? `Edit profile — ${profile.profile_name}` : 'New profile'} onClose={onClose} size="xl" busy={busy} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}>Save</button></>}>
      <div className="form-grid">
        <FormField label="Name" htmlFor="p-name" required>
          <input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Description" htmlFor="p-desc">
          <input id="p-desc" className="input" value={description ?? ''} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        {profile ? (
          <label className="checkbox span-2">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
          </label>
        ) : null}
        {system ? <p className="muted span-all">System profiles keep their permission set; rename or deactivate only.</p> : null}
        {templates.length > 0 && !profile ? (
          <p className="muted span-all">Templates: {templates.map((t) => `${t.profile_name} (${t.description})`).join(' · ')} — pick permissions below or start from a template by creating a member with a template key.</p>
        ) : null}
      </div>
      {!system ? (
        <div className="perm-groups">
          {groups.map((g) => {
            const keys = g.permissions.map((p) => p.key)
            const all = keys.every((k) => perms.has(k))
            return (
              <fieldset key={g.id} className="perm-group">
                <legend>
                  <label className="checkbox">
                    <input type="checkbox" checked={all} onChange={(e) => toggleGroup(keys, e.target.checked)} /> {g.label}
                  </label>
                </legend>
                <div className="perm-list">
                  {g.permissions.map((p) => (
                    <label key={p.key} className="checkbox">
                      <input type="checkbox" checked={perms.has(p.key)} onChange={() => toggle(p.key)} /> {p.label} <span className="muted small">({p.action})</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )
          })}
        </div>
      ) : null}
    </Modal>
  )
}
