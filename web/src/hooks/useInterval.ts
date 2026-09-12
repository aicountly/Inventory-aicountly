import { useEffect, useRef } from 'react'

/** Run `callback` every `delayMs`; pass null to pause. */
export function useInterval(callback: () => void, delayMs: number | null): void {
  const saved = useRef(callback)
  saved.current = callback
  useEffect(() => {
    if (delayMs === null) return undefined
    const id = setInterval(() => saved.current(), delayMs)
    return () => clearInterval(id)
  }, [delayMs])
}
