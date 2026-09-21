import { Select } from '../../ui/Select'
import type { FormOptionWarehouse } from '../../services/items'

export interface GrnWarehouseSelectProps {
  id?: string
  value: number | null
  onChange: (id: number | null) => void
  warehouses: FormOptionWarehouse[]
  emptyLabel?: string
  size?: 'sm' | 'md'
  disabled?: boolean
  invalid?: boolean
  className?: string
  'aria-label'?: string
}

/**
 * The same warehouse choice as `documents/WarehouseSelect`, drawn in the Books-language kit.
 *
 * The shared component renders the hand-written `.select` from `components/ui.css`, which is
 * correct on the ten screens still styled that way and visibly wrong in the middle of this one —
 * a taller box with a different border radius and a different focus ring in every row of the
 * grid. Re-skinning the shared one would re-style those ten screens, so the receiving grid
 * brings its own. The behaviour is deliberately identical, including keeping an unknown id
 * selectable so a warehouse the user cannot see is never silently reassigned.
 */
export function GrnWarehouseSelect({
  id,
  value,
  onChange,
  warehouses,
  emptyLabel = 'Select warehouse…',
  size = 'sm',
  disabled,
  invalid,
  className,
  'aria-label': ariaLabel,
}: GrnWarehouseSelectProps) {
  const known = value !== null && warehouses.some((w) => w.warehouse_id === value)
  return (
    <Select
      id={id}
      size={size}
      className={className}
      aria-label={ariaLabel}
      value={value ?? ''}
      disabled={disabled}
      invalid={invalid}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">{emptyLabel}</option>
      {value !== null && !known ? <option value={value}>Warehouse #{value}</option> : null}
      {warehouses.map((warehouse) => (
        <option key={warehouse.warehouse_id} value={warehouse.warehouse_id}>
          {warehouse.warehouse_name}
          {warehouse.warehouse_code ? ` (${warehouse.warehouse_code})` : ''}
        </option>
      ))}
    </Select>
  )
}

export default GrnWarehouseSelect
