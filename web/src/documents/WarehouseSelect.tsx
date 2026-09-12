import type { FormOptionWarehouse } from '../services/items'

interface WarehouseSelectProps {
  value: number | null
  onChange: (id: number | null) => void
  warehouses: FormOptionWarehouse[]
  /** Label of the empty option; omit to force a choice (still renders an empty option until chosen). */
  emptyLabel?: string
  id?: string
  disabled?: boolean
  className?: string
  invalid?: boolean
}

export function WarehouseSelect({ value, onChange, warehouses, emptyLabel = 'Select warehouse…', id, disabled, className, invalid }: WarehouseSelectProps) {
  const known = value !== null && warehouses.some((w) => w.warehouse_id === value)
  return (
    <select
      id={id}
      className={`select${className ? ` ${className}` : ''}`}
      value={value ?? ''}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">{emptyLabel}</option>
      {value !== null && !known ? <option value={value}>Warehouse #{value}</option> : null}
      {warehouses.map((w) => (
        <option key={w.warehouse_id} value={w.warehouse_id}>
          {w.warehouse_name}
          {w.warehouse_code ? ` (${w.warehouse_code})` : ''}
        </option>
      ))}
    </select>
  )
}
