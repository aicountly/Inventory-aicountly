import { useCallback, useEffect, useState } from 'react'
import { useCompany } from '../company/CompanyContext'
import { errorMessage, isAbortError } from '../services/api'
import { fetchItemFormOptions } from '../services/items'
import type { ItemFormOptions } from '../services/items'

/**
 * `GET /v1/items/form-options`, cached per company for a short while so every
 * master form does not refetch the same dropdown lists. Saving a master calls
 * `invalidateFormOptions()` so the next form sees the new row.
 */

interface CacheEntry {
  promise: Promise<ItemFormOptions>
  at: number
}

const TTL_MS = 60_000
const cache = new Map<number, CacheEntry>()

export function invalidateFormOptions(): void {
  cache.clear()
}

function load(cmpId: number): Promise<ItemFormOptions> {
  const hit = cache.get(cmpId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise
  const promise = fetchItemFormOptions().catch((err: unknown) => {
    cache.delete(cmpId)
    throw err
  })
  cache.set(cmpId, { promise, at: Date.now() })
  return promise
}

export interface FormOptionsState {
  options: ItemFormOptions | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useFormOptions(): FormOptionsState {
  const { scope } = useCompany()
  const cmpId = scope?.cmp_id ?? null
  const [options, setOptions] = useState<ItemFormOptions | null>(null)
  const [loading, setLoading] = useState(cmpId !== null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (cmpId === null) return undefined
    let active = true
    setLoading(true)
    setError(null)
    load(cmpId)
      .then((o) => {
        if (!active) return
        setOptions(o)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setError(errorMessage(err, 'Could not load form options.'))
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [cmpId, tick])

  const reload = useCallback(() => {
    invalidateFormOptions()
    setTick((t) => t + 1)
  }, [])

  return { options, loading, error, reload }
}
