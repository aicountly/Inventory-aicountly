/**
 * The company rules this screen must obey rather than assume: base currency, valuation method,
 * the negative-stock policy and the period lock.
 *
 * All four are read live — `GET /v1/settings` and `GET /v1/settings/period-locks` — because every
 * one of them is a per-company setting that another Aicountly product may change. Nothing here is
 * defaulted into a decision: a user who cannot read settings gets `null`, and the screen then
 * blocks nothing on its own and lets the server answer, which it does on every post regardless.
 */

import { useMemo } from 'react'
import { useCompany } from '../../company/CompanyContext'
import { useQuery } from '../../hooks/useQuery'
import { isApiError } from '../../services/api'
import { settingsApi } from '../../services/settingsApi'
import type { NegativeStockPolicy, ValuationMethod } from '../../services/settingsApi'

export interface PostingPolicy {
  /** ISO 4217 code of the company's base currency; null until settings load. */
  currencyCode: string | null
  valuationMethod: ValuationMethod | string | null
  negativeStockPolicy: NegativeStockPolicy | null
  /** Latest unreleased lock covering the selected branch, ISO date or null. */
  lockedUpto: string | null
  loading: boolean
}

function tolerate<T>(promise: Promise<T>): Promise<T | null> {
  // 403 is not an error on this screen: plenty of stores clerks may enter a document without
  // being allowed to read the company's settings page.
  return promise.catch((err: unknown) => {
    if (isApiError(err) && (err.status === 403 || err.status === 404)) return null
    throw err
  })
}

export function usePostingPolicy(): PostingPolicy {
  const { scope } = useCompany()
  const cmpId = scope?.cmp_id ?? null
  const boId = scope?.bo_id ?? 0

  const settings = useQuery((signal) => tolerate(settingsApi.get(signal)), [cmpId], { enabled: cmpId !== null, resetKey: cmpId })
  const locks = useQuery((signal) => tolerate(settingsApi.periodLocks(signal)), [cmpId], { enabled: cmpId !== null, resetKey: cmpId })

  const lockedUpto = useMemo(() => {
    const rows = locks.data ?? []
    let latest: string | null = null
    for (const lock of rows) {
      if (lock.released_at) continue
      if (lock.bo_id > 0 && boId > 0 && lock.bo_id !== boId) continue
      const date = String(lock.locked_upto_date ?? '').slice(0, 10)
      if (!date) continue
      if (latest === null || date > latest) latest = date
    }
    return latest
  }, [locks.data, boId])

  const row = settings.data
  return {
    currencyCode: row?.base_currency_code ? String(row.base_currency_code).toUpperCase() : null,
    valuationMethod: row?.default_valuation_method ?? null,
    negativeStockPolicy: (row?.negative_stock_policy as NegativeStockPolicy | undefined) ?? null,
    lockedUpto,
    loading: settings.loading || locks.loading,
  }
}
