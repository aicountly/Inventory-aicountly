import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Which anchored section the reader is currently in, and how to jump to one.
 *
 * ## Why IntersectionObserver and not a scroll handler
 *
 * The app's scroll container is `main` (AppShell), not the window, and a `scroll` listener on it
 * would run layout maths on every frame of every scroll for the whole time this page is open.
 * IntersectionObserver does the same work off the main thread and only calls back when the answer
 * changes. The root stays `null` (the viewport) deliberately: an element inside an
 * internally-scrolling container still intersects the viewport correctly, so this works whether or
 * not the shell keeps its own scrollport.
 *
 * ## The band
 *
 * `rootMargin` shrinks the viewport to a band just under the sticky nav. Without it the section
 * that is 5% visible at the bottom of a tall screen competes with the one filling it, and the
 * highlight flickers between them. With it, "current" means "the topmost section crossing the line
 * the reader is actually looking at", and the last known answer is kept when a very tall section
 * means nothing crosses it at all.
 */
export interface SectionSpy {
  active: string
  scrollTo: (id: string) => void
  /** Call after the user picks a tab, so the spy does not fight the smooth scroll. */
  register: (id: string, el: HTMLElement | null) => void
}

/**
 * Where the band starts, measured from the top of the VIEWPORT.
 *
 * The app's chrome above the scrollport is 48px and the sticky nav inside it is another ~44px, so
 * 110px is just below both. `ItemSectionCard`'s `scroll-mt-24` (96px, inside the scrollport) lands
 * a jumped-to section at ~144px, comfortably inside the band.
 */
const OFFSET_PX = 110

export function useSectionSpy(ids: readonly string[], enabled = true): SectionSpy {
  const [active, setActive] = useState(ids[0] ?? '')
  const elements = useRef(new Map<string, HTMLElement>())
  // While a click-driven smooth scroll is in flight the observer sees every section between here
  // and there. Pinning the answer until it settles stops the nav strobing through all of them.
  const pinned = useRef<string | null>(null)
  const pinTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) elements.current.set(id, el)
    else elements.current.delete(id)
  }, [])

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined') return undefined
    const order = new Map(ids.map((id, i) => [id, i]))
    const visible = new Set<string>()

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id
          if (entry.isIntersecting) visible.add(id)
          else visible.delete(id)
        }
        if (pinned.current) return
        if (visible.size === 0) return
        const topmost = [...visible].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))[0]
        setActive((current) => (current === topmost ? current : topmost))
      },
      { rootMargin: `-${OFFSET_PX}px 0px -55% 0px`, threshold: 0 },
    )

    for (const el of elements.current.values()) observer.observe(el)
    return () => observer.disconnect()
    // `ids` is a module constant mapped per render; joining it keeps the effect from re-running
    // on every render while still reacting if the set of sections ever changes.
  }, [ids.join('|'), enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (pinTimer.current) clearTimeout(pinTimer.current)
    },
    [],
  )

  const scrollTo = useCallback((id: string) => {
    const el = elements.current.get(id)
    if (!el) return
    setActive(id)
    pinned.current = id
    if (pinTimer.current) clearTimeout(pinTimer.current)
    pinTimer.current = setTimeout(() => {
      pinned.current = null
    }, 700)
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    // Move the keyboard on with the eye: the first control of the section the reader jumped to.
    const focusable = el.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
    )
    focusable?.focus({ preventScroll: true })
  }, [])

  return { active, scrollTo, register }
}
