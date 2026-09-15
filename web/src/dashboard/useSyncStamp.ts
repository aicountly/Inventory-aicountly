import { useEffect, useRef, useState } from 'react'

/**
 * When the data currently on screen actually landed.
 *
 * Stamped on the FALLING edge of `loading`, not when a refresh is asked for:
 * "Synced 4m ago" has to describe the figures a reader is looking at. Stamping
 * it at the start of a request would make a refresh that is still running — or
 * one that failed — read as fresh data.
 *
 * `null` until the first load completes, which the header renders as an em
 * dash rather than "just now".
 */
export function useSyncStamp(loading: boolean): number | null {
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const wasLoading = useRef(false)

  useEffect(() => {
    if (wasLoading.current && !loading) setLastSyncedAt(Date.now())
    wasLoading.current = loading
  }, [loading])

  return lastSyncedAt
}

/** The same stamp across several independent queries — the latest completion. */
export function useSyncStampFor(loadings: readonly boolean[]): number | null {
  return useSyncStamp(loadings.some(Boolean))
}
