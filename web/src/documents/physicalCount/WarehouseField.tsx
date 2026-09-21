import { Select } from '../../ui/Select'
import type { FormOptionWarehouse } from '../../services/items'

/**
 * The warehouse dropdown, in the Books design language.
 *
 * `documents/WarehouseSelect` renders the legacy `.select` class and is used by
 * every other document editor; re-skinning it here would change all of them. So
 * this is the same control and the same contract — including the placeholder
 * option for a warehouse the user can no longer choose but the document still
 * references — drawn with the shared `Select` primitive instead.
 */
export interface WarehouseFieldProps {
  value: number | null
  onChange: (id: number | null) => void
  warehouses: readonly FormOptionWarehouse[]
  emptyLabel?: string
  id?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
  'aria-label'?: string
}

export function WarehouseField({
  value,
  onChange,
  warehouses,
  emptyLabel = 'Select warehouse…',
  id,
  disabled,
  invalid,
  className,
  'aria-label': ariaLabel,
}: WarehouseFieldProps) {
  const known = value !== null && warehouses.some((w) => w.warehouse_id === value)
  return (
    <Select
      id={id}
      aria-label={ariaLabel}
      value={value ?? ''}
      disabled={disabled}
      invalid={invalid}
      className={className}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">{emptyLabel}</option>
      {/* A warehouse the profile may no longer post to still has to be nameable,
          or editing an old draft silently re-points its lines. */}
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

export default WarehouseField
