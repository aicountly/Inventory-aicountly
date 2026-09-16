import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Hold a page while it has unsaved edits.
 *
 * ## Why it is a click listener and not `useBlocker`
 *
 * React Router only offers `useBlocker` under a data router; this app mounts a plain
 * `<BrowserRouter>` with a `<Routes>` table (see App.tsx), so there is no blocker to subscribe to
 * and nothing to add one to short of converting the whole route table. What every in-app
 * navigation DOES go through is an anchor: the sidebar, the topbar, the breadcrumbs, the settings
 * tabs and the quick links are all `<Link>` / `<NavLink>`, which render real `<a href>`. A
 * capture-phase listener on the document sees that click before React's delegated handler at the
 * root container, so stopping it there stops the navigation without touching the shell.
 *
 * ## What it deliberately does NOT catch
 *
 * The browser's own Back button. A popstate has already happened by the time a non-data router
 * hears about it, and the usual workaround — pushing a sentinel entry so Back lands on it — makes
 * the history of every page with a dirty form a lie. Back therefore leaves the draft behind, which
 * is what it does on every other form in this app today.
 *
 * A full page unload (reload, close, an external link) is caught, by the browser's own dialog.
 */
export interface UnsavedChangesOptions {
  /** Hold navigation while true. */
  when: boolean
  /**
   * Somebody tried to leave. `proceed` performs the navigation that was stopped; do nothing to
   * stay put. Called with the in-app path, so a dialog can name where they were going.
   */
  onBlocked: (to: string, proceed: () => void) => void
  /** Escape hatch for a link that must always work — the sign-out link, say. */
  ignoreSelector?: string
}

const ALWAYS_ALLOWED = '[data-unsaved-allow]'

function inAppTarget(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute('href')
  if (!href || href.startsWith('#')) return null
  if (anchor.hasAttribute('download')) return null
  const target = anchor.getAttribute('target')
  if (target && target !== '_self') return null
  let url: URL
  try {
    url = new URL(anchor.href, window.location.href)
  } catch {
    return null
  }
  if (url.origin !== window.location.origin) return null
  const to = `${url.pathname}${url.search}${url.hash}`
  // Clicking the tab you are already on is not leaving the page.
  const here = `${window.location.pathname}${window.location.search}`
  return to === here || to === `${here}${window.location.hash}` ? null : to
}

export function useUnsavedChanges({ when, onBlocked, ignoreSelector }: UnsavedChangesOptions): void {
  const navigate = useNavigate()
  // Held in refs so turning the guard on does not re-register the listeners on every keystroke.
  const onBlockedRef = useRef(onBlocked)
  onBlockedRef.current = onBlocked
  const ignoreRef = useRef(ignoreSelector)
  ignoreRef.current = ignoreSelector
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  useEffect(() => {
    if (!when) return undefined

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Chrome still wants the legacy assignment; the string itself is never shown.
      e.returnValue = ''
    }

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const target = e.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a')
      if (!anchor || !(anchor instanceof HTMLAnchorElement)) return
      if (anchor.closest(ALWAYS_ALLOWED)) return
      if (ignoreRef.current && anchor.closest(ignoreRef.current)) return
      const to = inAppTarget(anchor)
      if (to === null) return

      e.preventDefault()
      e.stopPropagation()
      // Replayed through the router rather than by re-clicking the anchor: `proceed` is called
      // from the dialog, while the guard is still mounted and still dirty (the caller has not
      // re-rendered yet), so a second click would simply be caught again.
      onBlockedRef.current(to, () => navigateRef.current(to))
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [when])
}

export default useUnsavedChanges
