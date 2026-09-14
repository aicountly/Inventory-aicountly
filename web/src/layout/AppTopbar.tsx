import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, LogOut, Menu, Moon, Search, Settings, Sun, UserRound } from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { useAuth } from '../auth/AuthProvider'
import { AppLauncher } from '../components/AppLauncher'
import { useTheme } from '../theme/ThemeProvider'
import { openCommandPalette } from '../keyboard/shortcutRegistry'
import { Kbd } from '../ui/Kbd'
import { Tooltip } from '../ui/Tooltip'
import { cx } from '../ui/cx'
import { CompanySwitcher } from './CompanySwitcher'

function UserMenu() {
  const { signOut } = useAuth()
  const { profile, member } = useAccess()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const name = member?.display_name || member?.email || 'Signed in'

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="aic relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white pl-1.5 pr-2 transition-colors hover:border-primary/40 hover:bg-primary-light/40"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-light text-primary">
          <UserRound className="h-3 w-3" aria-hidden />
        </span>
        <span className="hidden max-w-[10rem] truncate text-xs font-medium text-gray-700 lg:block">
          {name}
        </span>
        <ChevronDown className="h-3 w-3 text-gray-400" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-60 animate-rise-in rounded-xl border border-gray-200 bg-white p-1.5 shadow-overlay"
        >
          <div className="border-b border-gray-100 px-2 pb-2 pt-1">
            <p className="truncate text-sm font-semibold text-gray-900">{name}</p>
            {profile?.profile_name ? (
              <p className="truncate text-[11px] text-gray-500">{profile.profile_name}</p>
            ) : null}
          </div>
          <Link
            to="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-700 no-underline transition-colors hover:bg-gray-50"
          >
            <Settings className="h-3.5 w-3.5 text-gray-400" aria-hidden />
            Company settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-gray-700 transition-colors hover:bg-red-50 hover:text-red-700"
          >
            <LogOut className="h-3.5 w-3.5 text-gray-400" aria-hidden />
            Log out
          </button>
        </div>
      ) : null}
    </div>
  )
}

interface AppTopbarProps {
  onToggleMobileNav: () => void
}

/**
 * The 3rem sticky bar: navigation toggle, app launcher, the scope switcher,
 * command search, appearance, and the user menu. Everything global lives here
 * so no page has to draw its own chrome.
 */
export function AppTopbar({ onToggleMobileNav }: AppTopbarProps) {
  const { isDark, setMode, setSettingsOpen } = useTheme()

  return (
    <header className="aic app-topbar sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-2 md:px-3 print:hidden">
      <button
        type="button"
        onClick={onToggleMobileNav}
        aria-label="Open navigation"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 md:hidden"
      >
        <Menu className="h-4 w-4" />
      </button>

      <AppLauncher />
      <CompanySwitcher />

      <button
        type="button"
        onClick={() => openCommandPalette()}
        className="ml-auto inline-flex h-8 items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 text-gray-400 transition-colors hover:border-primary/40 hover:text-gray-600 md:ml-2 md:w-72"
        aria-label="Search anything"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="hidden text-sm md:inline">Search anything…</span>
        <Kbd className="ml-auto hidden md:inline-flex">Ctrl K</Kbd>
      </button>

      <div className="ml-auto flex items-center gap-1 md:ml-0">
        <Tooltip label={isDark ? 'Switch to light' : 'Switch to dark'} placement="bottom">
          <button
            type="button"
            onClick={() => setMode(isDark ? 'light' : 'dark')}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </Tooltip>
        <Tooltip label="Appearance" placement="bottom">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Appearance settings"
            className={cx(
              'inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800',
            )}
          >
            <Settings className="h-4 w-4" />
          </button>
        </Tooltip>
        <UserMenu />
      </div>
    </header>
  )
}

export default AppTopbar
