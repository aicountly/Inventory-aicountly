import { useAccess } from '../access/AccessContext'
import { useAuth } from '../auth/AuthProvider'
import { AppLauncher } from '../components/AppLauncher'
import { ContextSelectors } from './ContextSelectors'

interface HeaderProps {
  onToggleMenu: () => void
}

export function Header({ onToggleMenu }: HeaderProps) {
  const { signOut } = useAuth()
  const { profile, member } = useAccess()
  const who = member?.display_name || member?.email || null

  return (
    <header className="app-header">
      <button type="button" className="btn btn-ghost app-menu-toggle" aria-label="Open navigation" onClick={onToggleMenu}>
        ☰
      </button>
      <AppLauncher />
      <ContextSelectors />
      <div className="grow" />
      <div className="app-user">
        {profile?.profile_name ? (
          <span className="app-user-profile" title={who ?? undefined}>
            {who ? `${who} · ` : ''}
            {profile.profile_name}
          </span>
        ) : null}
        <button type="button" className="btn btn-sm" onClick={signOut}>
          Log out
        </button>
      </div>
    </header>
  )
}
