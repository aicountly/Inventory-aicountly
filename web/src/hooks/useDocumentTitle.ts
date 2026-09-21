import { useEffect } from 'react'

/** What the tab says when a screen has not asked for anything else. */
export const APP_TITLE = 'Inventory · Aicountly'

/**
 * Set the browser tab's title while a screen is mounted, and put it back on the
 * way out.
 *
 * Restoring the PREVIOUS title rather than a constant matters: two screens can
 * be mounted at once (a routed page under a modal route), and a component that
 * always reset to the app title would blank the title of whatever was still on
 * screen when the inner one unmounted.
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (typeof document === 'undefined' || !title) return undefined
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])
}
