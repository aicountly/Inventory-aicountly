import { useMemo } from 'react'
import { useAccess } from '../../../access/AccessContext'
import { useCompany } from '../../../company/CompanyContext'
import { useQuery } from '../../../hooks/useQuery'
import type { QueryState } from '../../../hooks/useQuery'
import { P } from '../../../services/access'
import type { ListResponse, SortOrder } from '../../../services/api'
import { bomApi } from '../../../services/masters'
import type { Bom, BomListQuery, BomSummary } from '../../../services/masters'
import { toListQuery } from './bomFilters'
import type { BomFilters } from './bomFilters'

/**
 * The data behind the bill-of-materials workspace.
 *
 * Three hooks rather than one call: the list moves whenever a reader types,
 * pages or sorts, the summary only when the records themselves change, and the
 * permissions once per company. Folding them together would refetch the KPI
 * strip on every keystroke.
 *
 * All three are scoped: the active company / financial year / branch rides on
 * every request through `services/api`, and it is passed to `useQuery` as the
 * reset key so a company switch drops the previous tenant's rows in render
 * rather than showing them for a frame under the new company's name.
 */

export interface BomPermissions {
  loading: boolean
  canRead: boolean
  canWrite: boolean
  canDelete: boolean
  /** Costing reads valuation, which is its own permission on the API. */
  canViewCost: boolean
  canImport: boolean
  canExport: boolean
}

export function useBomPermissions(): BomPermissions {
  const { can, loading } = useAccess()
  const canRead = can(P.masters('bill_of_materials', 'read'))
  const canWrite = can(P.masters('bill_of_materials', 'write'))
  return {
    loading,
    canRead,
    canWrite,
    canDelete: can(P.masters('bill_of_materials', 'delete')),
    // The figures come from the BOM endpoint, so reading bills is enough; the
    // API is still the authority and will refuse what this lets through.
    canViewCost: canRead,
    canImport: canWrite,
    canExport: canRead,
  }
}

export function useBomSummary(enabled: boolean): QueryState<BomSummary> {
  const { scope } = useCompany()
  return useQuery<BomSummary>(
    (signal) => bomApi.summary(signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    { enabled: !!scope && enabled, resetKey: scope?.cmp_id ?? null },
  )
}

export interface BomListParams {
  search: string
  filters: BomFilters
  page: number
  limit: number
  sort: string
  order: SortOrder
  enabled: boolean
}

export function useBomList({
  search,
  filters,
  page,
  limit,
  sort,
  order,
  enabled,
}: BomListParams): QueryState<ListResponse<Bom>> {
  const { scope } = useCompany()

  const query = useMemo<BomListQuery>(
    () => ({
      q: search || undefined,
      page,
      limit,
      sort,
      order,
      // One request brings the rows AND the component chips; without it the
      // Components column would be a fetch per row.
      with_preview: 1,
      ...toListQuery(filters),
    }),
    [search, page, limit, sort, order, filters],
  )

  return useQuery<ListResponse<Bom>>(
    (signal) => bomApi.list(query, signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id, query],
    { enabled: !!scope && enabled, resetKey: scope?.cmp_id ?? null },
  )
}
