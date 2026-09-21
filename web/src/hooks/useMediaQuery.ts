import { useEffect, useState } from 'react'

/**
 * Whether a CSS media query currently matches, as state.
 *
 * For the cases where a layout choice has to be made in JavaScript rather than
 * in CSS — that is, where the two layouts must not BOTH exist. Tailwind's
 * `hidden md:block` is the right tool when one of the alternatives is cheap;
 * it is the wrong one when each alternative is a hundred rows, because
 * `display:none` hides a subtree from the eye while leaving every node in the
 * document, doubling the DOM and making a screen reader read the whole list
 * twice.
 *
 * `fallback` is the answer before the first paint and wherever `matchMedia` is
 * missing (jsdom, an old browser). It defaults to false — the narrow layout —
 * because that is the safe one: a card list on a wide screen looks roomy, a
 * 15-column table on a phone is unusable.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return fallback
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

/** Tailwind's `md` breakpoint — where the item table becomes readable. */
export const MD_UP = '(min-width: 768px)'

/** Tailwind's `xl` breakpoint — where a dense table has room for every column. */
export const XL_UP = '(min-width: 1280px)'
