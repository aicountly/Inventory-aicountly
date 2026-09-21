import { Select } from '../../ui/Select'
import type { FormOptionWarehouse } from '../../services/items'

export interface WarehousePickerProps {
  value: number | null
  onChange: (id: number | null) => void
  warehouses: FormOptionWarehouse[]
  emptyLabel?: string
  id?: string
  disabled?: boolean
  invalid?: boolean
  size?: 'sm' | 'md'
  className?: string
  'aria-label'?: string
}

/**
 * The warehouse a line posts to.
 *
 * Same behaviour as the shared `documents/WarehouseSelect` — including keeping
 * a warehouse the profile can no longer see, so editing an old receipt never
 * silently moves the stock somewhere else — expressed with the Books-language
 * Select so it lines up with the inputs beside it on this screen.
 */
export function WarehousePicker({
  value,
  onChange,
  warehouses,
  emptyLabel = 'Select warehouse',
  id,
  disabled,
  invalid,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: WarehousePickerProps) {
  const known = value !== null && warehouses.some((w) => w.warehouse_id === value)
  return (
    <Select
      id={id}
      size={size}
      className={className}
      invalid={invalid}
      aria-label={ariaLabel}
      value={value ?? ''}
      disabled={disabled}
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
    </Select>
  )
}

export default WarehousePicker
