import { Select } from '../../ui/Select'
import type { FormOptionWarehouse } from '../../services/items'

interface WarehouseFieldProps {
  value: number | null
  onChange: (id: number | null) => void
  warehouses: readonly FormOptionWarehouse[]
  id?: string
  disabled?: boolean
  invalid?: boolean
  emptyLabel?: string
  size?: 'sm' | 'md'
  'aria-label'?: string
}

/**
 * Warehouse picker in the Books design language.
 *
 * Same contract as `documents/WarehouseSelect` — including keeping an unknown id
 * selectable so a stored line never loses its warehouse just because the option
 * list was filtered by branch or by warehouse access — but rendered on the `ui`
 * `Select` primitive so it matches the rest of this screen. The legacy component
 * stays exactly as it is for the twenty document types still on `LineEditor`.
 */
export function WarehouseField({
  value,
  onChange,
  warehouses,
  id,
  disabled,
  invalid,
  emptyLabel = 'Select warehouse…',
  size = 'sm',
  'aria-label': ariaLabel,
}: WarehouseFieldProps) {
  const known = value !== null && warehouses.some((w) => w.warehouse_id === value)
  return (
    <Select
      id={id}
      size={size}
      disabled={disabled}
      invalid={invalid}
      aria-label={ariaLabel}
      value={value ?? ''}
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
