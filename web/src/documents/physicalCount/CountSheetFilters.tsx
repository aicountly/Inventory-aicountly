import { useEffect, useState } from 'react'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { Input } from '../../ui/Input'
import { FormField } from '../../ui/shell'
import { cx } from '../../ui/cx'
import type { FormOptionWarehouse } from '../../services/items'
import { toNumber } from '../../utils/format'
import { DEFAULT_FILTERS, PRESET_LABEL } from './countFilters'
import type { CountFilters, CountPreset } from './countFilters'
import { WarehouseField } from './WarehouseField'

const ALL_PRESETS: CountPreset[] = ['all', 'variance', 'shortage', 'excess', 'match', 'pending', 'counted', 'exceptions', 'serial']

export interface CountSheetFiltersProps {
  open: boolean
  onClose: () => void
  filters: CountFilters
  onApply: (next: CountFilters) => void
  warehouses: readonly FormOptionWarehouse[]
  /** Cost filters are hidden from a reader who may not see cost. */
  showCost: boolean
}

/**
 * The deeper filters, in a drawer.
 *
 * The six everyday choices are chips in the toolbar, one click each. What lives
 * here is the rest — warehouse, tracking, a value floor — edited as a DRAFT and
 * committed on Apply, so the sheet does not re-filter under the reader's hands
 * while they are still deciding.
 */
export function CountSheetFilters({ open, onClose, filters, onApply, warehouses, showCost }: CountSheetFiltersProps) {
  const [draft, setDraft] = useState<CountFilters>(filters)

  // Re-seed each time it opens; a drawer closed with unapplied edits must not
  // show them again as though they had taken effect.
  useEffect(() => {
    if (open) setDraft(filters)
  }, [open, filters])

  const patch = (next: Partial<CountFilters>) => setDraft((d) => ({ ...d, ...next }))

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Filter the count sheet"
      description="Narrow what is on screen. Nothing is removed from the count."
      width="md"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDraft({ ...DEFAULT_FILTERS, search: draft.search })}
          >
            Reset
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onApply(draft)
              onClose()
            }}
          >
            Apply filters
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Difference</legend>
          <div className="flex flex-wrap gap-1.5">
            {ALL_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={draft.preset === preset}
                onClick={() => patch({ preset })}
                className={cx(
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30',
                  draft.preset === preset
                    ? 'border-primary/30 bg-primary-light text-primary'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300',
                )}
              >
                {PRESET_LABEL[preset]}
              </button>
            ))}
          </div>
        </fieldset>

        <FormField label="Warehouse" htmlFor="count-filter-wh">
          <WarehouseField
            id="count-filter-wh"
            value={draft.warehouseId}
            onChange={(warehouseId) => patch({ warehouseId })}
            warehouses={warehouses}
            emptyLabel="Any warehouse"
          />
        </FormField>

        <fieldset>
          <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Tracking</legend>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-primary focus:ring-primary/30"
                checked={draft.batchTracked}
                onChange={(e) => patch({ batchTracked: e.target.checked })}
              />
              Batch-tracked items only
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-primary focus:ring-primary/30"
                checked={draft.serialTracked}
                onChange={(e) => patch({ serialTracked: e.target.checked })}
              />
              Serial-tracked items only
            </label>
          </div>
        </fieldset>

        {showCost ? (
          <FormField
            label="Minimum variance value"
            htmlFor="count-filter-value"
            hint="Absolute value. Lines with no known cost are excluded."
          >
            <Input
              id="count-filter-value"
              inputMode="decimal"
              value={draft.minVarianceValue === null ? '' : String(draft.minVarianceValue)}
              placeholder="Any"
              onChange={(e) => patch({ minVarianceValue: toNumber(e.target.value) })}
            />
          </FormField>
        ) : null}

        {draft.lineKeys ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-xs text-gray-600">
              Showing {draft.lineKeys.length} line{draft.lineKeys.length === 1 ? '' : 's'}
              {draft.lineKeysLabel ? ` from “${draft.lineKeysLabel}”` : ''}.
            </p>
            <Button
              variant="link"
              size="xs"
              className="mt-1 px-0"
              onClick={() => patch({ lineKeys: null, lineKeysLabel: null })}
            >
              Show the whole sheet
            </Button>
          </div>
        ) : null}
      </div>
    </Drawer>
  )
}

export default CountSheetFilters
