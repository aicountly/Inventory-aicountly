import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Plus } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { AIC, cx } from '../../ui/cx'
import { MASTER_DEFINITIONS, canWriteMaster } from './masterDefinitions'

/**
 * The fourth summary card: "Quick Create", and the panel it opens.
 *
 * Every entry is an existing create route — `/items/new` and the bill-of-
 * materials form page go straight there, and the masters whose form is a modal
 * are deep-linked with `?new=1`, which MasterPage opens on arrival. No new
 * creation path is introduced here.
 *
 * A master the profile cannot write is not listed. When it can write none, the
 * card still renders and the panel says so: a control that disappears is read
 * as a feature that was never built, which is the mistake NewDocumentMenu
 * already learned from.
 */
export function QuickCreateMenu({ className }: { className?: string }) {
  const { can, profile } = useAccess()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  const creatable = useMemo(
    () => MASTER_DEFINITIONS.filter((master) => can(canWriteMaster(master))),
    [can],
  )

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      // Escape puts focus back where it came from, not at the top of the page.
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={cx(AIC, 'relative', className)} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'group flex h-full w-full items-center gap-3 rounded-xl border p-4 text-left transition-all duration-200',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          'border-primary/30 bg-primary-light/60 hover:border-primary/50 hover:bg-primary-light',
        )}
      >
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white">
          <Plus className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-900">Quick Create</span>
          <span className="mt-0.5 block truncate text-xs text-gray-500">Create a new master</span>
        </span>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-primary transition-transform duration-200 group-hover:translate-x-0.5"
          aria-hidden
        />
      </button>

      {open ? (
        <div
          id={panelId}
          role="menu"
          aria-label="Create a new master"
          className="absolute right-0 z-20 mt-2 max-h-80 w-64 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-overlay"
        >
          {creatable.length === 0 ? (
            <p role="note" className="px-2.5 py-2 text-xs leading-relaxed text-gray-500">
              You cannot create any master in this company
              {profile?.profile_name ? ` — the ${profile.profile_name} profile holds no write permission` : ''}
              . Ask an administrator to change your access profile.
            </p>
          ) : (
            creatable.map((master) => {
              const Icon = master.icon
              return (
                <Link
                  key={master.key}
                  to={master.createRoute}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-gray-700 no-underline transition-colors hover:bg-primary-light/60 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Icon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                  <span className="truncate">{master.title}</span>
                </Link>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}

export default QuickCreateMenu
