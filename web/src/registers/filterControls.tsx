import type { RefObject } from 'react'
import { ItemFilter } from '../components/ItemFilter'
import { SearchInput } from '../components/SearchInput'
import { WarehouseSelect } from '../documents/WarehouseSelect'
import { useReferenceData } from '../documents/useReferenceData'
import { useFormOptions } from '../hooks/useFormOptions'
import { FilterField } from '../ui/shell/FilterBar'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { cx } from '../ui/cx'
import { BatchFilter } from './BatchFilter'
import { DateRangeFilter } from './DateRangeFilter'
import { useDocumentTypeOptions } from './useDocumentTypeOptions'
import type { DateRangeContext } from './dateRangePresets'
import type { ReportFilter } from '../reports/types'

/**
 * One declared `ReportFilter`, rendered.
 *
 * Extracted out of `RegisterFilterBar` so the toolbar every register has always
 * used and the filter *panel* the documents register uses render the SAME
 * control from the SAME declaration — a filter gains a second look, never a
 * second implementation. `layout` is the only difference between them:
 *
 *  - `inline`   — label beside the control, control at its natural width. This
 *                 is the toolbar, and its markup is unchanged.
 *  - `stacked`  — label above the control, control filling its grid cell.
 *
 * The reference-data hooks moved in here with the controls they feed, which
 * means `/v1/document-types` is now fetched by the registers that declare a
 * `document_type` filter rather than by every register that renders a toolbar.
 * Each kind is its own component for that reason: a hook cannot live behind a
 * `switch`.
 */

export type FilterControlLayout = 'inline' | 'stacked'

export interface FilterControlProps {
  filter: ReportFilter
  /** The filter's own value. */
  value: string
  /** Every resolved value — a batch belongs to the filtered item and warehouse. */
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  /** Both ends of a period, in one navigation. */
  setRange: (fromKey: string, toKey: string, range: { from: string; to: string }) => void
  ctx: DateRangeContext
  layout?: FilterControlLayout
  /**
   * `/` focuses this control.
   *
   * The caller decides which control gets it: the first text filter, or — on a
   * register that declares none — the item typeahead, which is then the only
   * free-text box on the screen. Without that second case `/` on Stock
   * balances fell through to the command palette while the control the reader
   * meant sat right there.
   */
  searchInputRef?: RefObject<HTMLInputElement | null>
}

/** Width of a select: its own content inline, the whole cell in a grid. */
function selectWidth(layout: FilterControlLayout, min: string): string {
  return layout === 'stacked' ? 'w-full' : `w-auto ${min}`
}

function fieldProps(layout: FilterControlLayout) {
  return layout === 'stacked' ? { stacked: true, className: 'min-w-0 w-full' } : {}
}

function DocumentTypeControl({ filter, value, onChange, layout }: FilterControlProps & { layout: FilterControlLayout }) {
  const documentTypes = useDocumentTypeOptions()
  return (
    <FilterField label={filter.label} {...fieldProps(layout)}>
      <Select
        value={value}
        onChange={(e) => onChange(filter.key, e.target.value)}
        aria-label={filter.label}
        className={selectWidth(layout, 'min-w-[10rem]')}
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
}

function WarehouseControl({ filter, value, onChange, layout }: FilterControlProps & { layout: FilterControlLayout }) {
  const { warehouses } = useReferenceData()
  return (
    <FilterField label={filter.label} {...fieldProps(layout)}>
      <WarehouseSelect
        value={value ? Number(value) : null}
        onChange={(id) => onChange(filter.key, id ? String(id) : '')}
        warehouses={warehouses}
        emptyLabel={filter.placeholder ?? 'All warehouses'}
        className={layout === 'stacked' ? 'w-full' : undefined}
      />
    </FilterField>
  )
}

function ItemGroupControl({ filter, value, onChange, layout }: FilterControlProps & { layout: FilterControlLayout }) {
  const { options } = useFormOptions()
  return (
    <FilterField label={filter.label} {...fieldProps(layout)}>
      <Select
        value={value}
        onChange={(e) => onChange(filter.key, e.target.value)}
        aria-label={filter.label}
        className={selectWidth(layout, 'min-w-[9rem]')}
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
}

function StockCategoryControl({ filter, value, onChange, layout }: FilterControlProps & { layout: FilterControlLayout }) {
  const { options } = useFormOptions()
  return (
    <FilterField label={filter.label} {...fieldProps(layout)}>
      <Select
        value={value}
        onChange={(e) => onChange(filter.key, e.target.value)}
        aria-label={filter.label}
        className={selectWidth(layout, 'min-w-[9rem]')}
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
}

/**
 * The item typeahead keeps its own wrapper rather than a `FilterField`: the
 * picker swaps between an input and a chip with a clear button, and a `<label>`
 * around that would hand a click on the word "Item" to whichever of the two is
 * mounted. `htmlFor` names the input instead, which is what a screen reader
 * follows either way.
 */
function ItemControl({
  filter,
  value,
  onChange,
  layout,
  searchInputRef,
}: FilterControlProps & { layout: FilterControlLayout }) {
  const id = `filter-${filter.key}`
  if (layout === 'stacked') {
    return (
      <div className="min-w-0 w-full">
        <label
          htmlFor={id}
          className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500"
        >
          {filter.label}
        </label>
        <ItemFilter
          ref={searchInputRef}
          id={id}
          value={value}
          onChange={(next) => onChange(filter.key, next)}
          placeholder={filter.placeholder ?? `${filter.label}…`}
        />
      </div>
    )
  }
  return (
    <div className="min-w-[13rem] max-w-[22rem] grow">
      <ItemFilter
        ref={searchInputRef}
        id={id}
        value={value}
        onChange={(next) => onChange(filter.key, next)}
        placeholder={filter.placeholder ?? `${filter.label}…`}
      />
    </div>
  )
}

export function FilterControl(props: FilterControlProps) {
  const { filter: f, value, values, onChange, setRange, ctx, searchInputRef } = props
  const layout: FilterControlLayout = props.layout ?? 'inline'
  const field = fieldProps(layout)
  const full = layout === 'stacked'

  switch (f.kind) {
    case 'date_range':
      return (
        <DateRangeFilter
          label={f.label}
          from={value}
          to={values[f.toKey ?? 'to'] ?? ''}
          ctx={ctx}
          stacked={full}
          onChange={(range) => setRange(f.key, f.toKey ?? 'to', range)}
        />
      )

    case 'item':
      return <ItemControl {...props} layout={layout} />

    case 'batch':
      return (
        <BatchFilter
          label={f.label}
          value={value}
          // Batches belong to an item and are stocked in a warehouse, so the
          // control follows whatever those two filters are set to.
          itemId={Number(values.item_id) || null}
          warehouseId={Number(values.warehouse_id) || null}
          stacked={full}
          onChange={(id) => onChange(f.key, id)}
        />
      )

    case 'warehouse':
      return <WarehouseControl {...props} layout={layout} />

    case 'item_group':
      return <ItemGroupControl {...props} layout={layout} />

    case 'stock_category':
      return <StockCategoryControl {...props} layout={layout} />

    case 'document_type':
      return <DocumentTypeControl {...props} layout={layout} />

    case 'date':
      return (
        <FilterField label={f.label} {...field}>
          <Input
            type="date"
            value={value}
            onChange={(e) => onChange(f.key, e.target.value)}
            aria-label={f.label}
            className={full ? 'w-full' : 'w-[8.5rem]'}
          />
        </FilterField>
      )

    case 'select':
      return (
        <FilterField label={f.label} {...field}>
          <Select
            value={value}
            onChange={(e) => onChange(f.key, e.target.value)}
            aria-label={f.label}
            className={selectWidth(layout, 'min-w-[8rem]')}
          >
            {/* A select with no declared default needs an "any" row, or the
                first option silently becomes a filter nobody chose. */}
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
        <FilterField label={f.label} {...field}>
          <Input
            inputMode="numeric"
            value={value}
            onChange={(e) => onChange(f.key, e.target.value.replace(/[^\d]/g, ''))}
            aria-label={f.label}
            placeholder={f.placeholder}
            className={full ? 'w-full' : 'w-[5.5rem]'}
          />
        </FilterField>
      )

    case 'toggle':
      return (
        <label
          className={cx(
            'inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none',
            // Height so it lines up with the controls beside it in the grid,
            // which aligns its own cells to the bottom. NOT `self-end`: the
            // "More filters" popover stacks its controls in a column, where
            // that is the cross axis and pushes the whole label to the right.
            full && 'h-9',
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

    case 'text':
      return (
        <FilterField label={f.label} {...field}>
          {/* Debounced: every keystroke here is a navigation and a fetch, and
              the value comes back asynchronously through the URL. */}
          <SearchInput
            ref={searchInputRef}
            value={value}
            onChange={(next) => onChange(f.key, next)}
            placeholder={f.placeholder ?? f.label}
            // The panel's grid is a row of `md` controls; a search box a
            // notch shorter than the select beside it is the kind of thing
            // nobody names but everybody sees.
            size={full ? 'md' : 'sm'}
            className={full ? 'w-full' : 'w-[12rem]'}
          />
        </FilterField>
      )

    default:
      return null
  }
}

export default FilterControl
