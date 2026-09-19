/** `/v1/settings`, period locks and the document-type registry. */

import { api } from './api'
import type { ItemResponse } from './api'
import type { LandedCostPolicy, LandedCostType } from '../documents/landedCost'

export type ValuationMethod = 'FIFO' | 'LIFO' | 'WAC'
export const VALUATION_METHODS: ValuationMethod[] = ['FIFO', 'LIFO', 'WAC']
export type ValuationScope = 'company' | 'warehouse'
export type NegativeStockPolicy = 'allow' | 'warn' | 'block'
export const NEGATIVE_STOCK_POLICIES: NegativeStockPolicy[] = ['allow', 'warn', 'block']
export type CogsRevisionMode = 'inline' | 'adjustment'

export interface CompanySettings {
  cmp_id: number
  /** Comma-separated cost types NOT capitalised into stock; '' or null = none excluded. */
  landed_cost_excluded_types?: string | null
  /** The same thing resolved into sets, as GET /v1/settings returns it alongside the raw column. */
  landed_cost_policy?: LandedCostPolicy
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
  /**
   * The cost types this company does NOT capitalise into stock. Sent as a list; the server stores
   * it normalised and REFUSES `non_creditable_tax` — a tax that cannot be recovered is part of the
   * cost of purchase under AS-2, so it is not a switch.
   */
  landed_cost_excluded_types?: LandedCostType[]
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

export interface DocumentPartyInfo {
  party_ref: number
  /** The name captured on the document; null when it was raised without one. */
  party_name: string | null
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

  /**
   * Which landed cost types this company capitalises into stock — the list a screen should OFFER.
   * It is not the enforcement: Inventory refuses an excluded type on the way in whatever any screen
   * showed, because a cached or bypassed UI must not be able to put a charge into stock value.
   */
  async landedCostPolicy(signal?: AbortSignal): Promise<LandedCostPolicy> {
    const res = await api.get<ItemResponse<LandedCostPolicy>>('v1/settings/landed-cost-policy', { signal })
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

  /**
   * The parties Inventory's own documents reference, for a register's party
   * filter. A picker over `inv_documents.party_ref`, not a party master —
   * customers, suppliers and job workers belong to Books.
   */
  async documentParties(signal?: AbortSignal): Promise<DocumentPartyInfo[]> {
    const res = await api.get<{ data: DocumentPartyInfo[] }>('v1/document-parties', { signal })
    return Array.isArray(res.data) ? res.data : []
  },
}
