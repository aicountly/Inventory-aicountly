import type { FormOptionWarehouse } from '../services/items'
import { Select } from '../ui/Select'

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
  /**
   * Which field styling to use.
   *
   * `legacy` is the hand-written `.select` of components/ui.css that every existing document
   * editor is laid out against — left as the default so this component's ~10 current call sites
   * are untouched. `field` renders the Books-language `ui/Select` primitive, for screens built on
   * the new design system. One component, two skins, rather than a second warehouse dropdown.
   */
  variant?: 'legacy' | 'field'
  size?: 'sm' | 'md'
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
  size = 'sm',
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
  const handleChange = (raw: string) => onChange(raw === '' ? null : Number(raw))

  if (variant === 'field') {
    return (
      <Select id={id} className={className} size={size} value={value ?? ''} disabled={disabled} invalid={invalid} onChange={(e) => handleChange(e.target.value)}>
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
      onChange={(e) => handleChange(e.target.value)}
    >
      {options}
    </select>
  )
}
