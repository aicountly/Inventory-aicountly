import { useEffect, useState } from 'react'

/**
 * Whether a CSS media query matches, as a value React can branch on.
 *
 * For the cases where CSS alone is not enough: a grid and a card list are not
 * two skins of the same markup, they are two trees, and rendering both and
 * hiding one with `hidden lg:block` means every row mounts twice — two item
 * typeaheads, two batch pickers and two rounds of the requests they make. This
 * mounts the one the viewport is actually going to show.
 *
 * `fallback` is the answer before the query can be asked (a test environment
 * without matchMedia). Pass the desktop answer where the desktop layout is the
 * richer one, so nothing is lost when the question cannot be answered.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return fallback
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const list = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(list.matches)
    // Safari below 14 only has the deprecated listener pair.
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    }
    list.addListener(onChange)
    return () => list.removeListener(onChange)
  }, [query])

  return matches
}

export default useMediaQuery
