import { Filter, X } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { ItemFilter } from '../components/ItemFilter'
import { BatchFilter } from './BatchFilter'
import { SearchInput } from '../components/SearchInput'
import { WarehouseSelect } from '../documents/WarehouseSelect'
import { useReferenceData } from '../documents/useReferenceData'
import { useFormOptions } from '../hooks/useFormOptions'
import { FilterField } from '../ui/shell/FilterBar'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { cx } from '../ui/cx'
import { FILTER_ROW } from '../styles/designTokens'
import { DateRangeFilter } from './DateRangeFilter'
import { useDocumentTypeOptions } from './useDocumentTypeOptions'
import type { DateRangeContext } from './dateRangePresets'
import type { ReportFilter } from '../reports/types'

export interface RegisterFilterBarProps {
  filters: readonly ReportFilter[]
  /** Effective values: URL merged with the declared defaults. */
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  /** Several keys at once — a date range writes both ends in one navigation. */
  onChangeMany?: (patch: Record<string, string>) => void
  onReset?: () => void
  showReset?: boolean
  ctx: DateRangeContext
  /** `/` focuses the first text filter. */
  searchInputRef?: RefObject<HTMLInputElement | null>
  /** Right-aligned slot: export, columns, view switches, counts. */
  trailing?: ReactNode
  /**
   * Lay the filters out as a labelled grid instead of one flowing line.
   *
   * The flowing row is right for a register read as a list — it costs one line
   * and each control sits beside its label. A register whose filters *are* the
   * question being asked (a date and a costing method decide every figure on a
   * valuation screen) gives each one a column with its label above it, which is
   * also the layout that survives a narrow viewport without the controls
   * wrapping into a zigzag.
   */
  stacked?: boolean
}

/**
 * The register toolbar, rendered from the declarative `ReportFilter[]` a config
 * already declares.
 *
 * Port of books-react-app/web/src/modules/registers/RegisterFilterBar.jsx, but
 * driven by Inventory's filter model instead of Books' fixed one — so every
 * report that exists today keeps exactly the filters it has, and gains the
 * period presets and the Books styling for free.
 */
export function RegisterFilterBar({
  filters,
  values,
  onChange,
  onChangeMany,
  onReset,
  showReset,
  ctx,
  searchInputRef,
  trailing,
  stacked = false,
}: RegisterFilterBarProps) {
  const { warehouses } = useReferenceData()
  const { options } = useFormOptions()
  const documentTypes = useDocumentTypeOptions()
  const visible = filters.filter((f) => !f.hidden)
  let firstText = true

  // In the grid every control fills its column; in the row each keeps the width
  // its content wants. Applied to the control rather than to its wrapper so a
  // `<select>`'s intrinsic width cannot win over it.
  const wide = (w: string) => (stacked ? 'w-full' : w)
  const fieldProps = stacked ? { stacked: true, className: 'min-w-0' } : {}

  const setRange = (fromKey: string, toKey: string, range: { from: string; to: string }) => {
    if (onChangeMany) onChangeMany({ [fromKey]: range.from, [toKey]: range.to })
    else {
      onChange(fromKey, range.from)
      onChange(toKey, range.to)
    }
  }

  return (
    <div
      className={
        stacked
          ? // The approved proportions: date ~20%, method ~22%, item ~38%,
            // warehouse ~20%, collapsing to two columns and then to one.
            'grid w-full gap-x-3 gap-y-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,0.95fr)_minmax(0,1.65fr)_minmax(0,0.9fr)]'
          : cx(FILTER_ROW, 'gap-y-2 w-full')
      }
    >
      {stacked ? null : <Filter className="w-4 h-4 shrink-0 text-gray-400" aria-hidden />}

      {visible.map((f) => {
        const value = values[f.key] ?? ''

        switch (f.kind) {
          case 'date_range': {
            const toKey = f.toKey ?? 'to'
            return (
              <DateRangeFilter
                key={f.key}
                label={f.label}
                from={value}
                to={values[toKey] ?? ''}
                ctx={ctx}
                onChange={(range) => setRange(f.key, toKey, range)}
              />
            )
          }

          case 'item':
            return (
              <div
                key={f.key}
                className={stacked ? 'min-w-0' : 'min-w-[13rem] max-w-[22rem] grow'}
              >
                <ItemFilter
                  value={value}
                  onChange={(id) => onChange(f.key, id)}
                  placeholder={f.placeholder ?? `${f.label}…`}
                />
              </div>
            )

          case 'batch':
            return (
              <BatchFilter
                key={f.key}
                label={f.label}
                value={value}
                // Batches belong to an item and are stocked in a warehouse, so
                // the control follows whatever those two filters are set to.
                itemId={Number(values.item_id) || null}
                warehouseId={Number(values.warehouse_id) || null}
                onChange={(id) => onChange(f.key, id)}
              />
            )

          case 'warehouse':
            return (
              <FilterField key={f.key} label={f.label} {...fieldProps}>
                <WarehouseSelect
                  value={value ? Number(value) : null}
                  onChange={(id) => onChange(f.key, id ? String(id) : '')}
                  warehouses={warehouses}
                  emptyLabel={f.placeholder ?? 'All warehouses'}
                  className={stacked ? 'w-full' : undefined}
                />
              </FilterField>
            )

          case 'item_group':
            return (
              <FilterField key={f.key} label={f.label} {...fieldProps}>
                <Select
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  aria-label={f.label}
                  className={wide('w-auto min-w-[9rem]')}
                >
                  <option value="">All item groups</option>
                  {(options?.item_groups ?? []).map((g) => (
                    <option key={g.item_grp_id} value={g.item_grp_id}>
                      {g.grp_name}
                    </option>
                  ))}
                </Select>
              </FilterField>
            )

          case 'stock_category':
            return (
              <FilterField key={f.key} label={f.label} {...fieldProps}>
                <Select
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  aria-label={f.label}
                  className={wide('w-auto min-w-[9rem]')}
                >
                  <option value="">All categories</option>
                  {(options?.stock_categories ?? []).map((c) => (
                    <option key={c.stock_cat_id} value={c.stock_cat_id}>
                      {c.cat_name}
                    </option>
                  ))}
                </Select>
              </FilterField>
            )

          case 'date':
            return (
              <FilterField key={f.key} label={f.label} {...fieldProps}>
                <Input
                  type="date"
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  aria-label={f.label}
                  className={wide('w-[8.5rem]')}
                />
              </FilterField>
            )

          case 'document_type':
            return (
              <FilterField key={f.key} label={f.label} {...fieldProps}>
                <Select
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  aria-label={f.label}
                  className={wide('w-auto min-w-[10rem]')}
                >
                  <option value="">All document types</option>
                  {documentTypes.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </FilterField>
            )

          case 'select':
            return (
              <FilterField key={f.key} label={f.label} {...fieldProps}>
                <Select
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  aria-label={f.label}
                  className={wide('w-auto min-w-[8rem]')}
                >
                  {/* A select with no declared default needs an "any" row, or
                      the first option silently becomes a filter nobody chose.
                      One WITH a default must not have it: `resolveFilterValues`
                      reads '' as "use the default", so picking the row snaps
                      straight back to the option above it — and on a valuation
                      method it would read as "value the stock every way at
                      once", which is not a question the endpoint answers. */}
                  {f.defaultValue || f.options?.some((o) => o.value === '') ? null : (
                    <option value="">{f.placeholder ?? `All ${f.label.toLowerCase()}`}</option>
                  )}
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </FilterField>
            )

          case 'number':
            return (
              <FilterField key={f.key} label={f.label} {...fieldProps}>
                <Input
                  inputMode="numeric"
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value.replace(/[^\d]/g, ''))}
                  aria-label={f.label}
                  placeholder={f.placeholder}
                  className={wide('w-[5.5rem]')}
                />
              </FilterField>
            )

          case 'toggle':
            return (
              <label
                key={f.key}
                className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-primary focus:ring-primary/30"
                  checked={value === '1'}
                  onChange={(e) => onChange(f.key, e.target.checked ? '1' : '0')}
                />
                {f.label}
              </label>
            )

          case 'text': {
            const isFirst = firstText
            firstText = false
            return (
              <FilterField key={f.key} label={f.label} {...fieldProps}>
                {/* Debounced: every keystroke here is a navigation and a fetch,
                    and the value comes back asynchronously through the URL. */}
                <SearchInput
                  ref={isFirst ? searchInputRef : undefined}
                  value={value}
                  onChange={(next) => onChange(f.key, next)}
                  placeholder={f.placeholder ?? f.label}
                  className="w-[12rem]"
                />
              </FilterField>
            )
          }

          default:
            return null
        }
      })}

      {/* Reset and the view switches are not filters, so in the grid they get
          their own full-width row beneath the columns rather than a column of
          their own — which would leave one field narrower than the rest for a
          control that is not part of the question. */}
      {(showReset && onReset) || trailing ? (
        <div
          className={
            stacked
              ? 'col-span-full flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2'
              : 'contents'
          }
        >
          {showReset && onReset ? (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600"
              title="Clear every filter"
            >
              <X className="w-3 h-3" />
              Reset
            </button>
          ) : null}
          {trailing ? (
            <div className={cx('flex flex-wrap items-center gap-2', !stacked && 'ml-auto')}>
              {trailing}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default RegisterFilterBar
