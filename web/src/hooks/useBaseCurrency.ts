import { useEffect, useState } from 'react'
import { useAccess } from '../access/AccessContext'
import { useCompany } from '../company/CompanyContext'
import { P } from '../services/access'
import { settingsApi } from '../services/settingsApi'
import { currencySymbol } from '../utils/format'

/**
 * The symbol the selected company keeps its books in — `₹`, `$`, `AED` — or null when it is not
 * known here.
 *
 * Aicountly is multi-currency, so a screen that wants to label a money field cannot assume a rupee
 * (utils/format is explicit about this). The base currency lives on `GET /v1/settings`, which is
 * behind `settings.read`: a warehouse clerk editing an item may well not have it.
 *
 * So this resolves to null rather than to a guess, and every caller is expected to render the
 * label without a symbol in that case. A failure — a 403, an outage — is swallowed on purpose:
 * this is a label, and a red banner about the company settings on top of the item form would be a
 * cosmetic detail reported as a problem.
 *
 * One request per company per session, shared by every screen that asks, in the same shape as
 * `useFormOptions`.
 */
const cache = new Map<number, Promise<string | null>>()

function load(cmpId: number): Promise<string | null> {
  const hit = cache.get(cmpId)
  if (hit) return hit
  const promise = settingsApi
    .get()
    .then((s) => (s.base_currency_code ? currencySymbol(s.base_currency_code) : null))
    .catch(() => {
      cache.delete(cmpId)
      return null
    })
  cache.set(cmpId, promise)
  return promise
}

export function useBaseCurrencySymbol(): string | null {
  const { scope } = useCompany()
  const { can, loading } = useAccess()
  const cmpId = scope?.cmp_id ?? null
  const mayRead = !loading && can(P.settingsRead)
  const [symbol, setSymbol] = useState<string | null>(null)

  useEffect(() => {
    if (cmpId === null || !mayRead) {
      setSymbol(null)
      return undefined
    }
    let active = true
    load(cmpId).then((s) => {
      if (active) setSymbol(s)
    })
    return () => {
      active = false
    }
  }, [cmpId, mayRead])

  return symbol
}

export default useBaseCurrencySymbol
