import { useEffect, useState } from 'react'
import { useCompany } from '../../company/CompanyContext'
import { isAbortError } from '../../services/api'
import { settingsApi } from '../../services/settingsApi'
import type { NegativeStockPolicy } from '../../services/settingsApi'

export interface TransferPolicy {
  /** null when this profile may not read company settings. */
  negativeStockPolicy: NegativeStockPolicy | null
  /** null when the base currency is not readable — amounts then print unsigned. */
  currencyCode: string | null
  loading: boolean
}

/**
 * The two company settings this screen behaves differently under: whether stock
 * may go negative, and what currency the estimate is in.
 *
 * `GET /v1/settings` needs `settings.read`, which an operational profile (a
 * store keeper who raises transfers all day) does not hold. That is not an
 * error to show: the screen falls back to warning instead of blocking on a
 * shortfall — the server blocks it anyway and says so — and prints amounts
 * without a currency symbol rather than guessing one.
 */
export function useTransferPolicy(): TransferPolicy {
  const { scope } = useCompany()
  const cmpId = scope?.cmp_id ?? null
  const [state, setState] = useState<Omit<TransferPolicy, 'loading'>>({ negativeStockPolicy: null, currencyCode: null })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (cmpId === null) return undefined
    const controller = new AbortController()
    setLoading(true)
    settingsApi
      .get(controller.signal)
      .then((settings) => {
        if (controller.signal.aborted) return
        const policy = String(settings.negative_stock_policy || '').toLowerCase()
        setState({
          negativeStockPolicy: policy === 'allow' || policy === 'warn' || policy === 'block' ? policy : null,
          currencyCode: String(settings.base_currency_code || '').trim().toUpperCase() || null,
        })
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setState({ negativeStockPolicy: null, currencyCode: null })
        setLoading(false)
      })
    return () => controller.abort()
  }, [cmpId])

  return { ...state, loading }
}
