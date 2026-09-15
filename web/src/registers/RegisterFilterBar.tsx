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
}: RegisterFilterBarProps) {
  const { warehouses } = useReferenceData()
  const { options } = useFormOptions()
  const documentTypes = useDocumentTypeOptions()
  const visible = filters.filter((f) => !f.hidden)
  let firstText = true

  const setRange = (fromKey: string, toKey: string, range: { from: string; to: string }) => {
    if (onChangeMany) onChangeMany({ [fromKey]: range.from, [toKey]: range.to })
    else {
      onChange(fromKey, range.from)
      onChange(toKey, range.to)
    }
  }

  return (
    <div className={cx(FILTER_ROW, 'gap-y-2 w-full')}>
      <Filter className="w-4 h-4 shrink-0 text-gray-400" aria-hidden />

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
              <div key={f.key} className="min-w-[13rem] max-w-[22rem] grow">
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
              <FilterField key={f.key} label={f.label}>
                <WarehouseSelect
                  value={value ? Number(value) : null}
                  onChange={(id) => onChange(f.key, id ? String(id) : '')}
                  warehouses={warehouses}
                  emptyLabel={f.placeholder ?? 'All warehouses'}
                />
              </FilterField>
            )

          case 'item_group':
            return (
              <FilterField key={f.key} label={f.label}>
                <Select
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  aria-label={f.label}
                  className="w-auto min-w-[9rem]"
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
              <FilterField key={f.key} label={f.label}>
                <Select
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  aria-label={f.label}
                  className="w-auto min-w-[9rem]"
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
              <FilterField key={f.key} label={f.label}>
                <Input
                  type="date"
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  aria-label={f.label}
                  className="w-[8.5rem]"
                />
              </FilterField>
            )

          case 'document_type':
            return (
              <FilterField key={f.key} label={f.label}>
                <Select
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  aria-label={f.label}
                  className="w-auto min-w-[10rem]"
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
              <FilterField key={f.key} label={f.label}>
                <Select
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  aria-label={f.label}
                  className="w-auto min-w-[8rem]"
                >
                  {/* A select with no declared default needs an "any" row, or
                      the first option silently becomes a filter nobody chose. */}
                  {f.options?.some((o) => o.value === '') ? null : (
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
              <FilterField key={f.key} label={f.label}>
                <Input
                  inputMode="numeric"
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value.replace(/[^\d]/g, ''))}
                  aria-label={f.label}
                  placeholder={f.placeholder}
                  className="w-[5.5rem]"
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
              <FilterField key={f.key} label={f.label}>
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

      {trailing ? <div className="ml-auto flex flex-wrap items-center gap-2">{trailing}</div> : null}
    </div>
  )
}

export default RegisterFilterBar
