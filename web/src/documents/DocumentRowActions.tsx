import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Copy, ExternalLink, MoreVertical, Pencil, Printer } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { cx } from '../ui/cx'
import { notify } from '../ui/notify'
import { allowedActions } from './actions'
import type { DocumentListRow } from './types'

/**
 * The per-row action menu on the documents register.
 *
 * Every entry is something the app can already do and this user is already
 * allowed to do — Edit is offered exactly when `allowedActions` offers it on the
 * document screen, which is the same status gate and the same permission keys
 * the server enforces. Nothing here is a new capability, and nothing appears
 * that would 403 on the click.
 *
 * Portalled to `document.body` and positioned against the viewport for the same
 * reason the export menu is: the table body scrolls inside a card with
 * `overflow: auto`, and an absolutely positioned menu in a scrolling ancestor is
 * clipped by it at the last two rows — exactly where a reader reaches for it.
 */

const MENU_WIDTH = 208
const MENU_GAP = 4
const VIEWPORT_MARGIN = 8

interface MenuStyle {
  top: number
  left: number
}

function computeStyle(anchor: HTMLElement | null, height: number): MenuStyle | null {
  if (!anchor) return null
  const rect = anchor.getBoundingClientRect()
  const upward = window.innerHeight - rect.bottom < height + MENU_GAP + VIEWPORT_MARGIN
  const top = upward ? rect.top - height - MENU_GAP : rect.bottom + MENU_GAP
  return {
    top: Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - height - VIEWPORT_MARGIN)),
    left: Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN),
    ),
  }
}

interface Entry {
  key: string
  label: string
  icon: LucideIcon
  run: () => void
}

export function DocumentRowActions({ row }: { row: DocumentListRow }) {
  const { can } = useAccess()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<MenuStyle | null>(null)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  useLayoutEffect(() => {
    if (!open) return
    setStyle(computeStyle(anchorRef.current, menuRef.current?.offsetHeight ?? 0))
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e: MouseEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
        anchorRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open, close])

  const number = row.document_no ?? `#${row.document_id}`
  const canEdit = allowedActions(row.status, row.document_type, can).includes('edit')

  const entries: Entry[] = [
    {
      key: 'open',
      label: 'Open document',
      icon: ExternalLink,
      run: () => navigate(`/documents/${row.document_id}`),
    },
    ...(canEdit
      ? [
          {
            key: 'edit',
            label: 'Edit document',
            icon: Pencil,
            run: () => navigate(`/documents/${row.document_id}/edit`),
          },
        ]
      : []),
    {
      key: 'print',
      label: 'Print document',
      icon: Printer,
      run: () => navigate(`/documents/${row.document_id}/print`),
    },
    {
      key: 'copy',
      label: 'Copy number',
      icon: Copy,
      run: () => {
        // Not every browser or context gives a page the clipboard (it needs a
        // secure origin), so a failure says so rather than looking like it
        // worked and leaving the reader to paste the last thing they copied.
        navigator.clipboard
          ?.writeText(number)
          .then(() => notify.success(`${number} copied.`))
          .catch(() => notify.error('The number could not be copied to the clipboard.'))
      },
    },
  ]

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${number}`}
        title={`Actions for ${number}`}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        onClick={(e) => {
          // The row opens the document on click and on Enter; the menu button
          // sits inside it and must not do both.
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <MoreVertical className="h-4 w-4" aria-hidden />
      </button>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={`Actions for ${number}`}
              style={{
                position: 'fixed',
                width: MENU_WIDTH,
                top: style?.top ?? -9999,
                left: style?.left ?? -9999,
                visibility: style ? 'visible' : 'hidden',
              }}
              className="aic z-50 rounded-xl border border-gray-200 bg-white p-1 shadow-overlay"
              onClick={(e) => e.stopPropagation()}
            >
              {entries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  role="menuitem"
                  className={cx(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-gray-700',
                    'hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50',
                  )}
                  onClick={() => {
                    close()
                    entry.run()
                  }}
                >
                  <entry.icon className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
                  {entry.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

export default DocumentRowActions
