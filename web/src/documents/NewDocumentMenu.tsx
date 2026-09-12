import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccess } from '../access/AccessContext'
import { canCreate } from './actions'
import { HIDDEN_FROM_NEW_MENU, NATIVE_DOCUMENT_TYPES } from './registry'

/** "New document" dropdown listing the native types the user may create. */
export function NewDocumentMenu() {
  const { can } = useAccess()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const types = NATIVE_DOCUMENT_TYPES.filter((t) => !HIDDEN_FROM_NEW_MENU.has(t.code) && canCreate(t.code, can))

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

  if (types.length === 0) return null

  return (
    <div className="menu" ref={rootRef}>
      <button type="button" className="btn btn-primary" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        New document ▾
      </button>
      {open ? (
        <div className="menu-panel" id={panelId} role="menu">
          {types.map((t) => (
            <Link key={t.code} className="menu-item" role="menuitem" to={`/documents/new/${t.slug}`} onClick={() => setOpen(false)}>
              <strong>{t.label}</strong>
              <span>{t.description}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}
