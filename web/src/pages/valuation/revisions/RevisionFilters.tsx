import { useId } from 'react'
import type { ReactNode, RefObject } from 'react'
import { RotateCcw, Search, SlidersHorizontal } from 'lucide-react'
import { Card } from '../../../ui/Card'
import { Button } from '../../../ui/Button'
import { cx } from '../../../ui/cx'
import { ItemFilter } from '../../../components/ItemFilter'
import { FILTER_DATE_INPUT, FILTER_INPUT, FILTER_LABEL } from '../../../styles/designTokens'
import type { DocumentTypeInfo } from '../../../services/settingsApi'
import type { FormOptionWarehouse } from '../../../services/items'
import {
  BOOKS_FILTER_OPTIONS,
  DEFAULT_BOOKS_FILTER,
  DELTA_FILTER_OPTIONS,
  clearPatch,
  isQuickFilterActive,
  quickFilters,
} from './revisionsModel'

export interface RevisionFiltersProps {
  filters: Record<string, string>
  search: string
  onSearch: (value: string) => void
  onFilter: (key: string, value: string) => void
  onFilters: (patch: Record<string, string>) => void
  onReset: () => void
  warehouses: readonly FormOptionWarehouse[]
  documentTypes: readonly DocumentTypeInfo[]
  searchInputRef?: RefObject<HTMLInputElement | null>
  /** Count of filters the reader has set, default excluded. */
  activeCount: number
  currencySymbol: string
}

function Field({ label, htmlFor, children, className }: { label: string; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <label className={FILTER_LABEL} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * The filter workspace.
 *
 * It writes straight through to the URL (see useListParams on the page), which is what makes
 * a filtered view something an operator can bookmark, send to a colleague, or come back to
 * after opening a document and pressing Back.
 */
export function RevisionFilters({
  filters,
  search,
  onSearch,
  onFilter,
  onFilters,
  onReset,
  warehouses,
  documentTypes,
  searchInputRef,
  activeCount,
  currencySymbol,
}: RevisionFiltersProps) {
  const id = useId()
  const chips = quickFilters()

  return (
    <Card padding="none" className="px-3 py-2.5 print:hidden">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <SlidersHorizontal className="h-3.5 w-3.5 text-gray-400" aria-hidden />
          Filters
          {activeCount > 0 ? (
            <span className="rounded-full bg-primary-light px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {activeCount}
            </span>
          ) : null}
        </h2>
        <Button variant="ghost" size="xs" icon={RotateCcw} onClick={onReset} disabled={activeCount === 0}>
          Reset filters
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Field label="Books status" htmlFor={`${id}-books`}>
          <select
            id={`${id}-books`}
            className={FILTER_INPUT}
            value={filters.books ?? DEFAULT_BOOKS_FILTER}
            onChange={(e) => onFilter('books', e.target.value)}
          >
            {BOOKS_FILTER_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Search" htmlFor={`${id}-q`} className="xl:col-span-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" aria-hidden />
            <input
              id={`${id}-q`}
              ref={searchInputRef}
              type="search"
              className={cx(FILTER_INPUT, 'pl-8')}
              placeholder="Item, SKU or document no…"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
        </Field>

        <Field label="Warehouse" htmlFor={`${id}-wh`}>
          <select
            id={`${id}-wh`}
            className={FILTER_INPUT}
            value={filters.warehouse_id ?? ''}
            onChange={(e) => onFilter('warehouse_id', e.target.value)}
          >
            <option value="">All warehouses</option>
            {warehouses.map((w) => (
              <option key={w.warehouse_id} value={w.warehouse_id}>
                {w.warehouse_name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Source document" htmlFor={`${id}-type`}>
          <select
            id={`${id}-type`}
            className={FILTER_INPUT}
            value={filters.document_type ?? ''}
            onChange={(e) => onFilter('document_type', e.target.value)}
          >
            <option value="">All sources</option>
            {documentTypes.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Movement" htmlFor={`${id}-delta`}>
          <select
            id={`${id}-delta`}
            className={FILTER_INPUT}
            value={filters.delta ?? ''}
            onChange={(e) => onFilter('delta', e.target.value)}
          >
            {DELTA_FILTER_OPTIONS.map((o) => (
              <option key={o.value || 'any'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Item" className="sm:col-span-2 xl:col-span-2">
          <ItemFilter
            value={filters.item_id ?? ''}
            onChange={(itemId) => onFilter('item_id', itemId)}
            placeholder="Any item…"
          />
        </Field>

        <Field label="Job #" htmlFor={`${id}-job`}>
          <input
            id={`${id}-job`}
            className={FILTER_INPUT}
            inputMode="numeric"
            placeholder="Job #"
            value={filters.job_id ?? ''}
            onChange={(e) => onFilter('job_id', e.target.value.replace(/[^\d]/g, ''))}
          />
        </Field>

        <Field label="Document #" htmlFor={`${id}-doc`}>
          <input
            id={`${id}-doc`}
            className={FILTER_INPUT}
            inputMode="numeric"
            placeholder="Document id"
            value={filters.document_id ?? ''}
            onChange={(e) => onFilter('document_id', e.target.value.replace(/[^\d]/g, ''))}
          />
        </Field>

        <Field label={`Min. delta (${currencySymbol})`} htmlFor={`${id}-min`}>
          <input
            id={`${id}-min`}
            className={FILTER_INPUT}
            inputMode="decimal"
            placeholder="Any value"
            value={filters.min_abs_delta ?? ''}
            onChange={(e) => onFilter('min_abs_delta', e.target.value.replace(/[^\d.]/g, ''))}
          />
        </Field>

        <Field label="Created between" className="sm:col-span-2">
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              className={FILTER_DATE_INPUT}
              value={filters.from ?? ''}
              onChange={(e) => onFilter('from', e.target.value)}
              aria-label="Created from"
            />
            <span className="text-xs text-gray-400" aria-hidden>
              →
            </span>
            <input
              type="date"
              className={FILTER_DATE_INPUT}
              value={filters.to ?? ''}
              onChange={(e) => onFilter('to', e.target.value)}
              aria-label="Created to"
            />
          </div>
        </Field>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2">
        <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Quick filters</span>
        {chips.map((chip) => {
          const active = isQuickFilterActive(chip, filters)
          return (
            <button
              key={chip.key}
              type="button"
              title={chip.title}
              aria-pressed={active}
              onClick={() => onFilters(active ? clearPatch(chip) : chip.patch)}
              className={cx(
                'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                active
                  ? 'border-primary/30 bg-primary-light text-primary'
                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-gray-100',
              )}
            >
              {chip.label}
            </button>
          )
        })}
      </div>
    </Card>
  )
}

export default RevisionFilters
