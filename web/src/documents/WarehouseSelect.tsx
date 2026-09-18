import { Select } from '../ui/Select'
import type { FormOptionWarehouse } from '../services/items'

/**
 * Which skin the control wears.
 *
 * `legacy` is the hand-styled `.select` of components/ui.css that every existing document editor
 * is drawn with; `field` is the Books-language `ui/Select`. One option list, two skins, for as
 * long as the two visual languages coexist — a second copy of "which warehouses may this line
 * name" is how the editors start disagreeing about it.
 */
export type WarehouseSelectVariant = 'legacy' | 'field'

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
  variant?: WarehouseSelectVariant
  'aria-label'?: string
}

export function WarehouseSelect({
  value,
  onChange,
  warehouses,
  emptyLabel = 'Select warehouse…',
  id,
  disabled,
  className,
  invalid,
  variant = 'legacy',
  'aria-label': ariaLabel,
}: WarehouseSelectProps) {
  const known = value !== null && warehouses.some((w) => w.warehouse_id === value)
  const options = (
    <>
      <option value="">{emptyLabel}</option>
      {value !== null && !known ? <option value={value}>Warehouse #{value}</option> : null}
      {warehouses.map((w) => (
        <option key={w.warehouse_id} value={w.warehouse_id}>
          {w.warehouse_name}
          {w.warehouse_code ? ` (${w.warehouse_code})` : ''}
        </option>
      ))}
    </>
  )
  const onSelect = (raw: string) => onChange(raw === '' ? null : Number(raw))

  if (variant === 'field') {
    return (
      <Select
        id={id}
        value={value ?? ''}
        disabled={disabled}
        invalid={invalid}
        aria-label={ariaLabel}
        className={className}
        onChange={(e) => onSelect(e.target.value)}
      >
        {options}
      </Select>
    )
  }

  return (
    <select
      id={id}
      className={`select${className ? ` ${className}` : ''}`}
      value={value ?? ''}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-label={ariaLabel}
      onChange={(e) => onSelect(e.target.value)}
    >
      {options}
    </select>
  )
}
