import { useEffect, useState } from 'react'
import { useAccess } from '../access/AccessContext'
import { useCompany } from '../company/CompanyContext'
import { P } from '../services/access'
import { settingsApi } from '../services/settingsApi'

/**
 * The company's base currency code, or null while it is unknown.
 *
 * Aicountly is multi-currency, so a money field may not assume rupees; the code
 * is a company setting and `GET /v1/settings` is the only place Inventory holds
 * it. That endpoint is behind `settings.read`, which the person entering an
 * item may well not have — so the read is GATED on the permission and every
 * failure resolves to null. A money field then renders without an adornment,
 * exactly as every other money field in this app does today. Never a hardcoded
 * symbol: a wrong currency on a cost field is worse than no currency at all.
 *
 * Cached per company for the session like `useFormOptions`, so opening five
 * item forms is one request.
 */
const cache = new Map<number, Promise<string | null>>()

function load(cmpId: number): Promise<string | null> {
  const hit = cache.get(cmpId)
  if (hit) return hit
  const promise = settingsApi
    .get()
    .then((s) => {
      const code = String(s.base_currency_code ?? '').trim().toUpperCase()
      return /^[A-Z]{3}$/.test(code) ? code : null
    })
    .catch(() => null)
  cache.set(cmpId, promise)
  return promise
}

export function useBaseCurrency(): string | null {
  const { scope } = useCompany()
  const { can } = useAccess()
  const cmpId = scope?.cmp_id ?? null
  const allowed = can(P.settingsRead)
  const [code, setCode] = useState<string | null>(null)

  useEffect(() => {
    if (cmpId === null || !allowed) {
      setCode(null)
      return undefined
    }
    let active = true
    void load(cmpId).then((c) => {
      if (active) setCode(c)
    })
    return () => {
      active = false
    }
  }, [cmpId, allowed])

  return code
}

export default useBaseCurrency
