import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccess } from '../access/AccessContext'
import { allowedTypeCount, buildEntryHub } from './entryHub'

/**
 * The "New document" control in the documents register header.
 *
 * It used to `return null` whenever nothing passed the permission filter, which
 * is indistinguishable from a feature that was never built — and that is
 * precisely how it was read. It now always renders: the button is there, and a
 * profile that may raise nothing gets a panel that says so and names the
 * profile, rather than an absence.
 *
 * The full grouped list lives at `/documents/new` (DocumentEntryHubPage). This
 * dropdown is the shortcut for someone already on the register, so it offers
 * the types this user can raise and links to the hub for the rest.
 */
export function NewDocumentMenu() {
  const { can, profile } = useAccess()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  const groups = useMemo(() => buildEntryHub(can), [can])
  const allowed = allowedTypeCount(groups)
  const totalTypes = groups.reduce((n, g) => n + g.entries.length, 0)

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menu" ref={rootRef}>
      <button
        type="button"
        className="btn btn-primary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        New document ▾
      </button>
      {open ? (
        <div className="menu-panel" id={panelId} role="menu">
          {allowed === 0 ? (
            <div className="menu-note" role="note">
              <strong>No document type is available to you</strong>
              <span>
                All {totalTypes} inventory document types exist
                {profile?.profile_name ? `, but the ${profile.profile_name} profile holds no create permission for any of them` : ', but your profile holds no create permission for any of them'}
                . Open the list below to see each one and what it is for.
              </span>
            </div>
          ) : (
            groups
              .filter((group) => group.entries.some((e) => e.allowed))
              .map((group) => (
                <div key={group.key} className="menu-group">
                  <div className="menu-group-label">{group.label}</div>
                  {group.entries
                    .filter((e) => e.allowed)
                    .map((entry) => (
                      <Link
                        key={entry.spec.code}
                        className="menu-item"
                        role="menuitem"
                        to={entry.to}
                        onClick={() => setOpen(false)}
                      >
                        <strong>{entry.spec.label}</strong>
                        <span>{entry.spec.description}</span>
                      </Link>
                    ))}
                </div>
              ))
          )}
          <Link className="menu-item menu-item-footer" role="menuitem" to="/documents/new" onClick={() => setOpen(false)}>
            <strong>All document types{allowed < totalTypes ? ` (${allowed} of ${totalTypes} available)` : ''}</strong>
            <span>Every type, grouped, with the reason beside any you cannot raise.</span>
          </Link>
        </div>
      ) : null}
    </div>
  )
}
