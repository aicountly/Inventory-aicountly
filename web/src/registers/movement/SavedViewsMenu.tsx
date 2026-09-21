import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bookmark, BookmarkCheck, Check, ChevronDown, Info, Plus, Trash2, X } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { cx } from '../../ui/cx'
import { notify } from '../../ui/notify'
import {
  MAX_SAVED_VIEWS,
  deleteView,
  loadSavedViews,
  saveView,
  viewMatchesQuery,
} from './savedViews'
import type { SavedView } from './savedViews'

/**
 * The register's "Saved views" control.
 *
 * A view is the filter set a reader keeps coming back to — "Chennai receipts this month",
 * "everything the POS raised" — saved under a name and reapplied in one click. It is the
 * URL that is stored, so applying one is an ordinary navigation: the back button undoes
 * it, the address bar can be shared with a colleague, and every other part of the register
 * reacts exactly as it does to the filters being set by hand.
 *
 * The panel states plainly that the views live in this browser, under this sign-in. The
 * API has no saved-view resource yet (see savedViews.ts), and a control that let a reader
 * believe a view was filed with their team — to be found on a colleague's screen, or on
 * their own laptop tomorrow — would be a promise this product cannot keep.
 */
export interface SavedViewsMenuProps {
  /** Scopes the stored views. The register's column-preference key. */
  registerKey: string
}

export function SavedViewsMenu({ registerKey }: SavedViewsMenuProps) {
  const { member } = useAccess()
  const uuid = member?.uuid ?? null
  const navigate = useNavigate()
  const location = useLocation()
  const panelId = useId()
  const nameId = useId()

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [views, setViews] = useState<SavedView[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // Read when the panel opens rather than on every render: nothing else on this screen
  // writes the store, and re-reading under the reader's own typing is how a name box
  // loses a keystroke.
  useEffect(() => {
    if (open) setViews(loadSavedViews(registerKey, uuid))
  }, [open, registerKey, uuid])

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setOpen(false)
      }
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

  useEffect(() => {
    if (open) nameRef.current?.focus()
  }, [open])

  const current = location.search
  const active = useMemo(() => views.find((v) => viewMatchesQuery(v, current)) ?? null, [views, current])

  const commit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setViews(saveView(registerKey, uuid, trimmed, current))
    setName('')
    notify.success(`Saved “${trimmed}” on this browser`)
  }

  const apply = (view: SavedView) => {
    navigate({ search: view.query ? `?${view.query}` : '' })
    setOpen(false)
  }

  const remove = (view: SavedView) => {
    setViews(deleteView(registerKey, uuid, view.id))
  }

  // The store is keyed by the member uuid, so a view saved before `/v1/access/me`
  // answers has nowhere to be written. Waiting is better than dropping it silently.
  const ready = uuid !== null
  const full = views.length >= MAX_SAVED_VIEWS

  return (
    <div className="relative" ref={rootRef}>
      <Button
        variant="secondary"
        size="sm"
        icon={active ? BookmarkCheck : Bookmark}
        iconRight={ChevronDown}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        disabled={!ready}
        title={ready ? undefined : 'Available once your profile has loaded'}
        onClick={() => setOpen((v) => !v)}
      >
        {active ? active.name : 'Saved views'}
      </Button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Saved views"
          className="absolute right-0 top-[calc(100%+0.375rem)] z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-3 shadow-overlay"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Saved views</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close saved views"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {views.length === 0 ? (
            <p className="mb-3 text-xs leading-relaxed text-gray-500">
              Nothing saved yet. Set the filters you want, then name them below to come back
              to this view in one click.
            </p>
          ) : (
            <ul className="mb-3 max-h-56 list-none overflow-y-auto p-0">
              {views.map((view) => {
                const isActive = active?.id === view.id
                return (
                  <li key={view.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => apply(view)}
                      aria-current={isActive ? 'true' : undefined}
                      className={cx(
                        'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                        isActive
                          ? 'bg-primary-light font-semibold text-primary'
                          : 'text-gray-700 hover:bg-gray-50',
                      )}
                    >
                      {isActive ? (
                        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      ) : (
                        <Bookmark className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
                      )}
                      <span className="truncate">{view.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(view)}
                      aria-label={`Delete view ${view.name}`}
                      className="rounded p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <form
            className="flex items-end gap-2 border-t border-gray-100 pt-3"
            onSubmit={(e) => {
              e.preventDefault()
              commit()
            }}
          >
            <div className="min-w-0 flex-1">
              <label htmlFor={nameId} className="text-[11px] font-semibold text-gray-600">
                Save these filters as
              </label>
              <Input
                id={nameId}
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Chennai receipts"
                maxLength={60}
                disabled={full}
                className="mt-1 w-full"
              />
            </div>
            <Button type="submit" size="sm" icon={Plus} disabled={!name.trim() || full}>
              Save
            </Button>
          </form>

          {full ? (
            <p className="mt-2 text-[11px] text-amber-700">
              {MAX_SAVED_VIEWS} views is the limit here. Delete one to save another.
            </p>
          ) : null}

          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500">
            <Info className="mt-px h-3 w-3 shrink-0 text-gray-400" aria-hidden />
            <span>
              Saved in this browser, under your sign-in — not shared with your team and not
              carried to another device. To hand a view to a colleague, send them the page
              address instead: it carries the same filters.
            </span>
          </p>
        </div>
      ) : null}
    </div>
  )
}

export default SavedViewsMenu
