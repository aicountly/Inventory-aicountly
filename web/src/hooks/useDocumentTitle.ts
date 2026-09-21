import { useEffect } from 'react'

/**
 * Set the browser tab's title while a screen is mounted, and put back whatever
 * it was on the way out.
 *
 * A reader with eight tabs open needs to be able to tell them apart, and an
 * app that titles every one of them "Aicountly Inventory" makes that
 * impossible. Restoring the previous title rather than a constant keeps a
 * screen that does not set one from inheriting the last one that did.
 */
export function useDocumentTitle(title: string | null, suffix = 'Aicountly Inventory'): void {
  useEffect(() => {
    if (typeof document === 'undefined' || !title) return undefined
    const previous = document.title
    document.title = suffix ? `${title} | ${suffix}` : title
    return () => {
      document.title = previous
    }
  }, [title, suffix])
}

export default useDocumentTitle
