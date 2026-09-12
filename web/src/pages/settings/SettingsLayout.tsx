import { Outlet } from 'react-router-dom'
import { SubNav } from '../../components/SubNav'
import { P } from '../../services/access'

const ITEMS = [
  { to: '/settings', label: 'Company', end: true, permission: P.settingsRead },
  { to: '/settings/period-locks', label: 'Period locks', permission: P.settingsRead },
  { to: '/settings/access', label: 'Access', permission: [P.accessManage, P.accessMembersManage, P.settingsRead] as const },
  { to: '/settings/document-types', label: 'Document types', permission: P.settingsRead },
] as const

export function SettingsLayout() {
  return (
    <div className="page">
      <SubNav items={ITEMS} label="Settings" />
      <Outlet />
    </div>
  )
}
