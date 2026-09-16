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
   * Stack each label over its control and drop the leading funnel.
   *
   * What RegisterFilterCard uses: the card's own header carries the funnel and
   * the word "Filters", so repeating both inside the row is noise, and a column
   * of labelled controls reads far better than a wrapping line of
   * `LABEL [control] LABEL [control]` once there are six of them.
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
  /*
   * Which control `/` and the Search button focus.
   *
   * A text filter takes it when there is one. Otherwise the item typeahead
   * does: on the stock balance register the item picker IS the free-text box,
   * and before this `/` fell through to the command palette while a "Search"
   * button sat over a register it could not search.
   */
  const searchRefGoesToItem = !visible.some((f) => f.kind === 'text')

  // Stacked, every field claims an equal share of the row and its control
  // fills it, so six filters line up as a grid instead of as a ragged
  // left-to-right run of differently sized boxes.
  const fieldCls = stacked ? 'min-w-[10.5rem] flex-1' : undefined
  const controlCls = (inline: string) => (stacked ? 'w-full' : inline)
  const controlSize = stacked ? 'md' : 'sm'

  const setRange = (fromKey: string, toKey: string, range: { from: string; to: string }) => {
    if (onChangeMany) onChangeMany({ [fromKey]: range.from, [toKey]: range.to })
    else {
      onChange(fromKey, range.from)
      onChange(toKey, range.to)
    }
  }

  return (
    <div
      className={cx(
        FILTER_ROW,
        'w-full gap-y-2',
        stacked && 'items-end gap-x-4 gap-y-3',
      )}
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
                size={controlSize}
                onChange={(range) => setRange(f.key, toKey, range)}
              />
            )
          }

          case 'item': {
            const picker = (
              <ItemFilter
                ref={searchRefGoesToItem ? searchInputRef : undefined}
                value={value}
                onChange={(id) => onChange(f.key, id)}
                placeholder={f.placeholder ?? `${f.label}…`}
              />
            )
            // Stacked, the control gets the same label treatment as every
            // other field; inline it keeps the bare-typeahead shape it has
            // always had, so the existing registers do not shift.
            return stacked ? (
              <FilterField key={f.key} label={f.label} stacked className="min-w-[14rem] max-w-[24rem] grow">
                {picker}
              </FilterField>
            ) : (
              <div key={f.key} className="min-w-[13rem] max-w-[22rem] grow">
                {picker}
              </div>
            )
          }

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
                stacked={stacked}
              />
            )

          case 'warehouse':
            return (
              <FilterField key={f.key} label={f.label} stacked={stacked} className={fieldCls}>
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
              <FilterField key={f.key} label={f.label} stacked={stacked} className={fieldCls}>
                <Select
                  size={controlSize}
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  aria-label={f.label}
                  className={controlCls("w-auto min-w-[9rem]")}
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
              <FilterField key={f.key} label={f.label} stacked={stacked} className={fieldCls}>
                <Select
                  size={controlSize}
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  aria-label={f.label}
                  className={controlCls("w-auto min-w-[9rem]")}
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
              <FilterField key={f.key} label={f.label} stacked={stacked} className={fieldCls}>
                <Input
                  size={controlSize}
                  type="date"
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  aria-label={f.label}
                  className={controlCls('w-[8.5rem]')}
                />
              </FilterField>
            )

          case 'document_type':
            return (
              <FilterField key={f.key} label={f.label} stacked={stacked} className={fieldCls}>
                <Select
                  size={controlSize}
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  aria-label={f.label}
                  className={controlCls("w-auto min-w-[10rem]")}
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
              <FilterField key={f.key} label={f.label} stacked={stacked} className={fieldCls}>
                <Select
                  size={controlSize}
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  aria-label={f.label}
                  className={controlCls("w-auto min-w-[8rem]")}
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
              <FilterField key={f.key} label={f.label} stacked={stacked} className={fieldCls}>
                <Input
                  size={controlSize}
                  inputMode="numeric"
                  value={value}
                  onChange={(e) => onChange(f.key, e.target.value.replace(/[^\d]/g, ''))}
                  aria-label={f.label}
                  placeholder={f.placeholder}
                  className={controlCls('w-[5.5rem]')}
                />
              </FilterField>
            )

          case 'toggle':
            return (
              <label
                key={f.key}
                className={cx(
                  'inline-flex cursor-pointer select-none items-center gap-2 text-xs text-gray-600',
                  // Matches the control height so a checkbox sits on the same
                  // baseline as the inputs it stands beside, not above them.
                  stacked && 'h-9 whitespace-nowrap',
                )}
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
              <FilterField key={f.key} label={f.label} stacked={stacked} className={fieldCls}>
                {/* Debounced: every keystroke here is a navigation and a fetch,
                    and the value comes back asynchronously through the URL. */}
                <SearchInput
                  ref={isFirst ? searchInputRef : undefined}
                  value={value}
                  onChange={(next) => onChange(f.key, next)}
                  placeholder={f.placeholder ?? f.label}
                  className={controlCls('w-[12rem]')}
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

      {trailing ? (
        <div
          className={cx(
            'flex flex-wrap items-center gap-2',
            // Stacked, the trailing slot holds another labelled field (Group
            // by) and belongs in the run of controls, not pushed to the far
            // right away from them.
            stacked ? 'min-w-[10.5rem] flex-1' : 'ml-auto',
          )}
        >
          {trailing}
        </div>
      ) : null}
    </div>
  )
}

export default RegisterFilterBar
