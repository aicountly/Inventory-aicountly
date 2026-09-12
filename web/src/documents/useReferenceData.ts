import { useCallback, useMemo } from 'react'
import { useAccess } from '../access/AccessContext'
import { useCompany } from '../company/CompanyContext'
import { useFormOptions } from '../hooks/useFormOptions'
import type { FormOptionUnit, FormOptionWarehouse } from '../services/items'

export interface ReferenceData {
  /** Warehouses the user may post to (allowed_warehouses) in the selected branch (bo_id 0 = shared). */
  warehouses: FormOptionWarehouse[]
  units: FormOptionUnit[]
  defaultWarehouseId: number | null
  warehouseName: (id: number | null | undefined) => string
  unitSymbol: (id: number | null | undefined) => string
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * Warehouses and units for the document editors, from the cached `items/form-options`,
 * narrowed to what this user is allowed to touch and to the selected branch.
 */
export function useReferenceData(): ReferenceData {
  const { options, loading, error, reload } = useFormOptions()
  const { allowedWarehouses } = useAccess()
  const { scope } = useCompany()
  const boId = scope?.bo_id ?? 0

  const warehouses = useMemo(() => {
    const all = options?.warehouses ?? []
    return all.filter((w) => {
      if (allowedWarehouses && !allowedWarehouses.includes(w.warehouse_id)) return false
      if (boId > 0 && Number(w.bo_id) > 0 && Number(w.bo_id) !== boId) return false
      return true
    })
  }, [options, allowedWarehouses, boId])

  const allWarehouses = options?.warehouses ?? []
  const units = options?.units ?? []

  const warehouseName = useCallback(
    (id: number | null | undefined) => {
      if (!id) return ''
      const w = allWarehouses.find((x) => x.warehouse_id === id)
      return w ? w.warehouse_name : `Warehouse #${id}`
    },
    [allWarehouses],
  )

  const unitSymbol = useCallback(
    (id: number | null | undefined) => {
      if (!id) return ''
      const u = units.find((x) => x.unit_id === id)
      return u ? (u.unit_symbol ?? u.unit_name) : ''
    },
    [units],
  )

  const defaultWarehouseId = useMemo(() => {
    const def = warehouses.find((w) => Number(w.is_default) === 1)
    return def?.warehouse_id ?? (warehouses.length === 1 ? warehouses[0].warehouse_id : null)
  }, [warehouses])

  return { warehouses, units, defaultWarehouseId, warehouseName, unitSymbol, loading, error, reload }
}
