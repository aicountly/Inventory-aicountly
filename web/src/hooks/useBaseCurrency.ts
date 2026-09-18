import { useEffect, useState } from 'react'
import { useCompany } from '../company/CompanyContext'
import { currencySymbol } from '../utils/format'
import { isAbortError } from '../services/api'
import { settingsApi } from '../services/settingsApi'

/**
 * The selected company's base currency (`GET /v1/settings` → `base_currency_code`), cached per
 * company for as long as the tab lives.
 *
 * Aicountly is multi-currency: the rupee is a company SETTING, not an assumption, so a screen
 * that prints an amount has to ask. It is one small read shared by every caller, and a profile
 * without `settings.read` falls back to INR rather than losing the symbol altogether — the
 * figures are the company's own either way, and a bare number is worse than a wrong symbol.
 */

const cache = new Map<number, Promise<string>>()

function load(cmpId: number): Promise<string> {
  const hit = cache.get(cmpId)
  if (hit) return hit
  const promise = settingsApi
    .get()
    .then((s) => (s.base_currency_code || 'INR').trim().toUpperCase())
    .catch(() => 'INR')
  cache.set(cmpId, promise)
  return promise
}

export interface BaseCurrency {
  code: string
  symbol: string
}

export function useBaseCurrency(): BaseCurrency {
  const { scope } = useCompany()
  const cmpId = scope?.cmp_id ?? null
  const [code, setCode] = useState('INR')

  useEffect(() => {
    if (cmpId === null) return undefined
    let active = true
    load(cmpId)
      .then((c) => {
        if (active) setCode(c)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setCode('INR')
      })
    return () => {
      active = false
    }
  }, [cmpId])

  return { code, symbol: currencySymbol(code) }
}

export default useBaseCurrency
