import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AgeBucketKey, StockHealthStatus } from '../../services/reportsApi'

/**
 * Clicking a bar, a slice or a health card filters the register underneath it.
 *
 * It writes the register's own declared `age_bucket` / `health_status` filters into
 * the URL, which is the only place this screen keeps its question — so the drill-down
 * is bookmarkable, survives a refresh, shows up in the panel's "filters set" count and
 * is undone by the same Reset button as every other filter. Clicking the active bucket
 * again clears it, so the chart is a toggle rather than a one-way door.
 *
 * Page is reset because a drill-down is a new question, not a different page of the
 * old one.
 */
export interface AgeingDrilldown {
  bucket: AgeBucketKey | null
  health: StockHealthStatus | null
  toggleBucket: (bucket: AgeBucketKey) => void
  toggleHealth: (status: StockHealthStatus) => void
}

export function useAgeingDrilldown(): AgeingDrilldown {
  const [params, setParams] = useSearchParams()

  const toggle = useCallback(
    (key: 'age_bucket' | 'health_status', value: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (next.get(key) === value) next.delete(key)
          else next.set(key, value)
          next.delete('page')
          return next
        },
        { replace: false },
      )
    },
    [setParams],
  )

  return {
    bucket: (params.get('age_bucket') as AgeBucketKey | null) || null,
    health: (params.get('health_status') as StockHealthStatus | null) || null,
    toggleBucket: useCallback((bucket: AgeBucketKey) => toggle('age_bucket', bucket), [toggle]),
    toggleHealth: useCallback((status: StockHealthStatus) => toggle('health_status', status), [toggle]),
  }
}

export default useAgeingDrilldown
