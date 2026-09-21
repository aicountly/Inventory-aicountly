import { useEffect, useState } from 'react'

/**
 * `true` while the media query matches.
 *
 * Defensive about `matchMedia` for the same reason AppSidebar is: the DOM the
 * tests run in (happy-dom) does not implement it, and a layout hook that throws
 * there would take every render test on the page down with it. The fallback is
 * the caller's `initial`, which should be the state that needs no special
 * handling — the desktop one, normally.
 */
export function useMediaQuery(query: string, initial = false): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return initial
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mql = window.matchMedia(query)
    setMatches(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

export default useMediaQuery

/*
 * Breakpoints named rather than retyped.
 *
 * These are Tailwind's own `md` and `xl`, so a component that mounts one layout
 * or the other in JavaScript stays in step with the `md:` / `xl:` classes
 * beside it. A hand-typed "(min-width: 768px)" in one file and "(min-width:
 * 767px)" in the next is a one-pixel band where the page renders neither
 * layout, and nobody finds it on purpose.
 */

/** Tailwind `md` — where the item table becomes readable at all. */
export const MD_UP = '(min-width: 768px)'

/** Tailwind `xl` — where a dense table has room for every column. */
export const XL_UP = '(min-width: 1280px)'
