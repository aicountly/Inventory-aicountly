import { Filter, X } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { cx } from '../ui/cx'
import { FILTER_ROW } from '../styles/designTokens'
import { FilterControl } from './filterControls'
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
 *
 * The controls themselves live in `filterControls.tsx`, shared with
 * `RegisterFilterPanel`: one declaration, one control, two arrangements.
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
        const isFirstText = f.kind === 'text' && firstText
        if (f.kind === 'text') firstText = false
        return (
          <FilterControl
            key={f.key}
            filter={f}
            value={values[f.key] ?? ''}
            values={values}
            onChange={onChange}
            setRange={setRange}
            ctx={ctx}
            layout="inline"
            searchInputRef={isFirstText ? searchInputRef : undefined}
          />
        )
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
