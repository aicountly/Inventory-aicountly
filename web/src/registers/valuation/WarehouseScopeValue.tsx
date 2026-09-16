import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { useFormOptions } from '../../hooks/useFormOptions'
import { formatInt } from '../../utils/format'

/**
 * How many warehouses the register is reading across.
 *
 * A count of the warehouses in scope — active, in the selected branch, and
 * within this member's `allowed_warehouses` — not a count of warehouses
 * *holding stock*, which no endpoint reports and which this card must
 * therefore not claim. The hint underneath says which scope is being counted,
 * so the figure cannot be read as the other thing.
 *
 * It renders as a live value rather than as part of the config's static KPI
 * map because the warehouse list is loaded master data, not part of the
 * valuation summary. The printed sheet carries the warehouse filter on its
 * own scope line, so nothing is lost on paper.
 *
 * The filter is read from the URL, which is where the register keeps it
 * (`useListParams`), so the card needs nothing passed down through the config.
 */
export function WarehouseScopeValue() {
  const warehouseId = useSearchParams()[0].get('warehouse_id') ?? ''
  const { options, loading } = useFormOptions()
  const { allowedWarehouses } = useAccess()
  const { scope } = useCompany()

  const count = useMemo(() => {
    const all = options?.warehouses ?? []
    const boId = scope?.bo_id ?? 0
    const permitted = all.filter((w) => {
      if (allowedWarehouses && !allowedWarehouses.includes(w.warehouse_id)) return false
      if (boId > 0 && Number(w.bo_id) > 0 && Number(w.bo_id) !== boId) return false
      return true
    })
    // One warehouse chosen is one warehouse read, whatever else exists.
    return warehouseId ? permitted.filter((w) => String(w.warehouse_id) === warehouseId).length : permitted.length
  }, [options, allowedWarehouses, scope?.bo_id, warehouseId])

  if (loading && !options) {
    return <span className="skeleton inline-block w-10 rounded text-transparent">&nbsp;</span>
  }
  return <>{formatInt(count)}</>
}

/** "Whole company" or the chosen warehouse's name — the card's hint line. */
export function WarehouseScopeHint() {
  const warehouseId = useSearchParams()[0].get('warehouse_id') ?? ''
  const { options } = useFormOptions()
  if (!warehouseId) return <>Whole company</>
  const match = (options?.warehouses ?? []).find((w) => String(w.warehouse_id) === warehouseId)
  return <>{match ? match.warehouse_name : 'Selected warehouse'}</>
}
