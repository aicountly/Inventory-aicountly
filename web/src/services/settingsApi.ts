/** `/v1/settings`, period locks and the document-type registry. */

import { api } from './api'
import type { ItemResponse } from './api'

export type ValuationMethod = 'FIFO' | 'LIFO' | 'WAC'
export const VALUATION_METHODS: ValuationMethod[] = ['FIFO', 'LIFO', 'WAC']
export type ValuationScope = 'company' | 'warehouse'
export type NegativeStockPolicy = 'allow' | 'warn' | 'block'
export const NEGATIVE_STOCK_POLICIES: NegativeStockPolicy[] = ['allow', 'warn', 'block']
export type CogsRevisionMode = 'inline' | 'adjustment'

export interface CompanySettings {
  cmp_id: number
  default_valuation_method: ValuationMethod | string
  valuation_scope: ValuationScope | string
  negative_stock_policy: NegativeStockPolicy | string
  approval_required: number | string | boolean
  fefo_enabled: number | string | boolean
  cogs_revision_mode: CogsRevisionMode | string
  base_currency_code: string
  settings: Record<string, unknown>
  created_at?: string | null
  updated_at?: string | null
  updated_by?: string | null
}

export interface SettingsPatch {
  default_valuation_method?: string
  valuation_scope?: ValuationScope
  negative_stock_policy?: NegativeStockPolicy
  approval_required?: boolean
  fefo_enabled?: boolean
  cogs_revision_mode?: CogsRevisionMode
  base_currency_code?: string
}

export interface PeriodLock {
  lock_id: number
  cmp_id: number
  bo_id: number
  locked_upto_date: string
  reason: string | null
  locked_by: string | null
  locked_at: string
  released_by: string | null
  released_at: string | null
}

export interface DocumentTypeInfo {
  code: string
  label: string
  line_mode: string
  valuation: boolean
  cogs: boolean
  native: boolean
  legacy_vch_type: number | null
}

export const settingsApi = {
  async get(signal?: AbortSignal): Promise<CompanySettings> {
    const res = await api.get<ItemResponse<CompanySettings>>('v1/settings', { signal })
    return res.data
  },

  async update(patch: SettingsPatch): Promise<CompanySettings> {
    const res = await api.put<ItemResponse<CompanySettings>>('v1/settings', patch)
    return res.data
  },

  async periodLocks(signal?: AbortSignal): Promise<PeriodLock[]> {
    const res = await api.get<{ data: PeriodLock[] }>('v1/settings/period-locks', { signal })
    return Array.isArray(res.data) ? res.data : []
  },

  async lockPeriod(body: { locked_upto_date: string; bo_id?: number; reason?: string }): Promise<{ lock_id: number }> {
    const res = await api.post<ItemResponse<{ lock_id: number }>>('v1/settings/period-locks', body)
    return res.data
  },

  async releasePeriodLock(lockId: number): Promise<{ lock_id: number; released: boolean }> {
    const res = await api.delete<ItemResponse<{ lock_id: number; released: boolean }>>(`v1/settings/period-locks/${lockId}`)
    return res.data
  },

  async documentTypes(signal?: AbortSignal): Promise<DocumentTypeInfo[]> {
    const res = await api.get<{ data: DocumentTypeInfo[] }>('v1/document-types', { signal })
    return Array.isArray(res.data) ? res.data : []
  },
}
