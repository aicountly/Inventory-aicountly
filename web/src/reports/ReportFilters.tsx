import { ItemFilter } from '../components/ItemFilter'
import { SearchInput } from '../components/SearchInput'
import { WarehouseSelect } from '../documents/WarehouseSelect'
import { useReferenceData } from '../documents/useReferenceData'
import { useFormOptions } from '../hooks/useFormOptions'
import type { ReportFilter } from './types'

interface ReportFiltersProps {
  filters: readonly ReportFilter[]
  /** Effective values (URL merged with defaults). */
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  onReset?: () => void
  showReset?: boolean
}

/** Toolbar rendered from a report's declarative filter list. */
export function ReportFilters({ filters, values, onChange, onReset, showReset }: ReportFiltersProps) {
  const { warehouses } = useReferenceData()
  const { options } = useFormOptions()

  return (
    <div className="toolbar">
      {filters.map((f) => {
        const value = values[f.key] ?? ''
        switch (f.kind) {
          case 'item':
            return <ItemFilter key={f.key} value={value} onChange={(v) => onChange(f.key, v)} placeholder={f.placeholder ?? 'Filter by item…'} />
          case 'warehouse':
            return <WarehouseSelect key={f.key} value={value ? Number(value) : null} onChange={(id) => onChange(f.key, id ? String(id) : '')} warehouses={warehouses} emptyLabel={f.placeholder ?? 'All warehouses'} />
          case 'item_group':
            return (
              <select key={f.key} className="select" value={value} onChange={(e) => onChange(f.key, e.target.value)} aria-label={f.label}>
                <option value="">All item groups</option>
                {(options?.item_groups ?? []).map((g) => (
                  <option key={g.item_grp_id} value={g.item_grp_id}>
                    {g.grp_name}
                  </option>
                ))}
              </select>
            )
          case 'stock_category':
            return (
              <select key={f.key} className="select" value={value} onChange={(e) => onChange(f.key, e.target.value)} aria-label={f.label}>
                <option value="">All categories</option>
                {(options?.stock_categories ?? []).map((c) => (
                  <option key={c.stock_cat_id} value={c.stock_cat_id}>
                    {c.cat_name}
                  </option>
                ))}
              </select>
            )
          case 'date':
            return (
              <label key={f.key} className="toolbar-label">
                {f.label}
                <input type="date" className="input date" value={value} onChange={(e) => onChange(f.key, e.target.value)} aria-label={f.label} />
              </label>
            )
          case 'select':
            return (
              <select key={f.key} className="select" value={value} onChange={(e) => onChange(f.key, e.target.value)} aria-label={f.label}>
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )
          case 'number':
            return (
              <label key={f.key} className="toolbar-label">
                {f.label}
                <input className="input short" inputMode="numeric" value={value} onChange={(e) => onChange(f.key, e.target.value.replace(/[^\d]/g, ''))} aria-label={f.label} placeholder={f.placeholder} />
              </label>
            )
          case 'toggle':
            return (
              <label key={f.key} className="checkbox">
                <input type="checkbox" checked={value === '1'} onChange={(e) => onChange(f.key, e.target.checked ? '1' : '0')} />
                {f.label}
              </label>
            )
          case 'text':
            return <SearchInput key={f.key} value={value} onChange={(v) => onChange(f.key, v)} placeholder={f.placeholder ?? f.label} />
          default:
            return null
        }
      })}
      {showReset && onReset ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>
          Reset
        </button>
      ) : null}
    </div>
  )
}
