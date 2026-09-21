import { useId } from 'react'
import { Download, SlidersHorizontal, Table2 } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Notice } from '../../components/Notice'
import { FormField, FormSectionCard } from '../../ui/shell'
import { cx } from '../../ui/cx'
import type { FormOptionWarehouse } from '../../services/items'
import { WarehouseField } from './WarehouseField'

export interface CountSetup {
  warehouseId: number | null
  includeZeroBookQty: boolean
  loadBatchWise: boolean
  loadSerialWise: boolean
}

export const DEFAULT_SETUP: CountSetup = {
  warehouseId: null,
  includeZeroBookQty: false,
  loadBatchWise: false,
  loadSerialWise: false,
}

interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint: string
  disabled?: boolean
}

/**
 * A real checkbox with a switch painted over it.
 *
 * Not a `div role="switch"`: the native control brings keyboard activation,
 * form semantics and the label association for free, and the visible track is
 * driven off `peer-checked`. The input is `sr-only` rather than `hidden` so it
 * still takes focus, and the track carries the focus ring.
 */
function Toggle({ checked, onChange, label, hint, disabled = false }: ToggleProps) {
  const id = useId()
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label
        htmlFor={id}
        aria-hidden
        className={cx(
          'mt-0.5 h-[18px] w-8 shrink-0 rounded-full p-0.5 transition-colors',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 peer-focus-visible:ring-offset-1',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          checked ? 'bg-primary' : 'bg-gray-300',
        )}
      >
        <span
          className={cx(
            'block h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform',
            checked && 'translate-x-[14px]',
          )}
        />
      </label>
      <label htmlFor={id} className={cx('min-w-0 leading-tight', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
        <span className="block text-xs font-semibold text-gray-800">{label}</span>
        <span className="mt-0.5 block text-[11px] text-gray-500">{hint}</span>
      </label>
    </div>
  )
}

export interface PhysicalCountSetupProps {
  setup: CountSetup
  onChange: (patch: Partial<CountSetup>) => void
  warehouses: FormOptionWarehouse[]
  onLoad: () => void
  onImport: () => void
  loading: boolean
  disabled?: boolean
  /** Shown after a load: how many lines arrived, and anything that was capped. */
  notes: string[]
  loadedCount: number | null
  error: string | null
  onRetry?: () => void
  canImport: boolean
}

export function PhysicalCountSetup({
  setup,
  onChange,
  warehouses,
  onLoad,
  onImport,
  loading,
  disabled = false,
  notes,
  loadedCount,
  error,
  onRetry,
  canImport,
}: PhysicalCountSetupProps) {
  const id = useId()
  const busy = disabled || loading

  return (
    <FormSectionCard
      icon={SlidersHorizontal}
      title="Count setup"
      description="Pick what to count, then load the book quantity the count is measured against."
    >
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <FormField
          label="Warehouse"
          htmlFor={`${id}-wh`}
          hint="Leave empty to count every warehouse."
          className="w-full sm:w-56"
        >
          <WarehouseField
            id={`${id}-wh`}
            value={setup.warehouseId}
            onChange={(warehouseId) => onChange({ warehouseId })}
            warehouses={warehouses}
            emptyLabel="All warehouses"
            disabled={busy}
          />
        </FormField>

        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Toggle
            checked={setup.includeZeroBookQty}
            onChange={(includeZeroBookQty) => onChange({ includeZeroBookQty })}
            label="Include zero book quantity"
            hint="Load items even where the book figure is nil."
            disabled={busy}
          />
          <Toggle
            checked={setup.loadBatchWise}
            onChange={(loadBatchWise) => onChange({ loadBatchWise })}
            label="Load batch-wise"
            hint="One line per batch, with expiry checks."
            disabled={busy}
          />
          <Toggle
            checked={setup.loadSerialWise}
            onChange={(loadSerialWise) => onChange({ loadSerialWise })}
            label="Load serial-wise"
            hint="Read the serial numbers on hand for tracked items."
            disabled={busy}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 self-end">
          <Button icon={Table2} onClick={onLoad} loading={loading} disabled={disabled} size="md">
            {loading ? 'Loading…' : 'Load book quantities'}
          </Button>
          <Button
            variant="secondary"
            icon={Download}
            onClick={onImport}
            disabled={busy || !canImport}
            size="md"
            title={canImport ? 'Read counted quantities from a handheld export' : 'Load book quantities first'}
          >
            Import from handheld / CSV
          </Button>
        </div>
      </div>

      {error ? (
        <Notice
          kind="error"
          actions={
            onRetry ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : undefined
          }
        >
          {error}
        </Notice>
      ) : null}

      {loadedCount !== null && !loading && !error ? (
        <p className="mt-3 text-[11px] text-gray-500">
          {loadedCount.toLocaleString()} line{loadedCount === 1 ? '' : 's'} loaded. Loading again refreshes the book
          quantities and keeps the counts already entered.
        </p>
      ) : null}

      {notes.length > 0 && !loading ? (
        <ul className="mt-2 space-y-1">
          {notes.map((note) => (
            <li key={note} className="text-[11px] text-amber-700">
              {note}
            </li>
          ))}
        </ul>
      ) : null}
    </FormSectionCard>
  )
}

export default PhysicalCountSetup
