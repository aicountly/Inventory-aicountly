import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { ListFilter, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { cx } from '../ui/cx'
import { FilterControl } from './filterControls'
import {
  ALL_DATES_PRESET_ID,
  DATE_RANGE_PRESETS,
  getDateRangeForPreset,
  matchDateRangePreset,
} from './dateRangePresets'
import type { DateRangeContext } from './dateRangePresets'
import type { RegisterFilterPanelSpec } from './RegisterConfig'
import type { ReportFilter } from '../reports/types'

export interface RegisterFilterPanelProps {
  spec: RegisterFilterPanelSpec
  filters: readonly ReportFilter[]
  /** Effective values: URL merged with the declared defaults. */
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  /** Several keys at once — a date range writes both ends in one navigation. */
  onChangeMany?: (patch: Record<string, string>) => void
  onReset?: () => void
  /** Filters the reader has actually set, for the badge and the Clear button. */
  activeCount: number
  /** Re-runs the query behind the panel. */
  onApply?: () => void
  applying?: boolean
  ctx: DateRangeContext
  /** `/` focuses the first text filter. */
  searchInputRef?: RefObject<HTMLInputElement | null>
  /** Company · financial year · branch, printed above the grid. */
  scope?: ReactNode
}

/**
 * The register filter *panel* — the same declared `ReportFilter[]` as the
 * toolbar, arranged as a card: heading, quick period chips, a labelled grid and
 * an overflow popover for the filters a register would rather not spend a
 * column on.
 *
 * Why a second arrangement and not a second implementation: `RegisterFilterBar`
 * lays the controls out in one wrapping row, which is right for a register with
 * three filters and unreadable for one with eight — every control a different
 * width, every label competing with its neighbour's. The panel gives each
 * filter a cell, a label above it and a predictable position, which is what
 * makes a seven-filter register scannable. Both render `FilterControl`, so a
 * filter declared once behaves identically in either.
 *
 * FILTERS APPLY AS THEY CHANGE, exactly as they always have: each control
 * writes its value to the URL and the engine re-queries. "Apply filters" is
 * therefore a re-run of the current question, not a gate in front of it —
 * pressing it (or Enter in a field) fetches again, which is what a reader
 * reaches for when they want the figures as of now. Making it a gate would put
 * a click between the reader and every filter change they make, and would be a
 * regression dressed as a feature.
 */
export function RegisterFilterPanel({
  spec,
  filters,
  values,
  onChange,
  onChangeMany,
  onReset,
  activeCount,
  onApply,
  applying = false,
  ctx,
  searchInputRef,
  scope,
}: RegisterFilterPanelProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const morePanelId = useId()

  const visible = useMemo(() => filters.filter((f) => !f.hidden), [filters])
  // `/` wants a free-text box. A register that declares no text filter has one
  // anyway — the item typeahead — so it takes the ref rather than letting the
  // shortcut fall through to the command palette.
  const itemTakesSearch = useMemo(() => !visible.some((f) => f.kind === 'text'), [visible])
  const primaryKeys = spec.primaryKeys
  const primary = useMemo(
    () => (primaryKeys ? visible.filter((f) => primaryKeys.includes(f.key)) : visible),
    [visible, primaryKeys],
  )
  const overflow = useMemo(
    () => (primaryKeys ? visible.filter((f) => !primaryKeys.includes(f.key)) : []),
    [visible, primaryKeys],
  )
  const overflowActive = overflow.filter((f) =>
    f.kind === 'toggle' ? values[f.key] === '1' : Boolean(values[f.key]),
  ).length

  // The period the chips drive: the register's own declared date range.
  const range = useMemo(() => visible.find((f) => f.kind === 'date_range'), [visible])
  const rangeToKey = range?.toKey ?? 'to'
  const activePreset = range
    ? matchDateRangePreset(values[range.key] ?? '', values[rangeToKey] ?? '', ctx)
    : null

  const chips = useMemo(() => {
    if (!range || !spec.quickRanges?.length) return []
    return spec.quickRanges
      .map((id) => {
        if (id === ALL_DATES_PRESET_ID) {
          return { id, label: spec.allRangeLabel ?? 'All dates' }
        }
        const preset = DATE_RANGE_PRESETS.find((p) => p.id === id)
        return preset ? { id: preset.id, label: preset.label } : null
      })
      .filter((c): c is { id: string; label: string } => c !== null)
  }, [range, spec.quickRanges, spec.allRangeLabel])

  useEffect(() => {
    if (!moreOpen) return undefined
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && e.target instanceof Node && !moreRef.current.contains(e.target)) {
        setMoreOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  const setRange = (fromKey: string, toKey: string, next: { from: string; to: string }) => {
    if (onChangeMany) onChangeMany({ [fromKey]: next.from, [toKey]: next.to })
    else {
      onChange(fromKey, next.from)
      onChange(toKey, next.to)
    }
  }

  const applyChip = (id: string) => {
    if (!range) return
    if (id === ALL_DATES_PRESET_ID) {
      setRange(range.key, rangeToKey, { from: '', to: '' })
      return
    }
    const next = getDateRangeForPreset(id, ctx)
    if (next) setRange(range.key, rangeToKey, next)
  }

  let firstText = true
  const control = (f: ReportFilter) => {
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
        layout="stacked"
        searchInputRef={
          isFirstText || (itemTakesSearch && f.kind === 'item') ? searchInputRef : undefined
        }
      />
    )
  }

  return (
    <section
      className="aic shrink-0 rounded-xl border border-gray-200 bg-white px-4 py-3.5 shadow-card print:hidden"
      aria-label={spec.title ?? 'Filters'}
    >
      <div className="mb-3.5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary"
            aria-hidden
          >
            <ListFilter className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              {spec.title ?? 'Filters'}
              {activeCount > 0 ? (
                <span className="rounded-full bg-primary-light px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                  {activeCount}
                </span>
              ) : null}
            </h2>
            {spec.description ? (
              <p className="mt-0.5 truncate text-xs text-gray-500">{spec.description}</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {scope ? (
            <span className="mr-1 whitespace-nowrap text-xs font-semibold text-gray-500">
              {scope}
            </span>
          ) : null}
          {chips.map((chip) => {
            const active = activePreset === chip.id
            return (
              <button
                key={chip.id}
                type="button"
                aria-pressed={active}
                onClick={() => applyChip(chip.id)}
                className={cx(
                  'inline-flex h-8 items-center rounded-full border px-3 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                  active
                    ? 'border-primary/30 bg-primary-light font-semibold text-primary'
                    : 'border-gray-200 bg-gray-50 font-medium text-gray-600 hover:bg-gray-100',
                )}
              >
                {chip.label}
              </button>
            )
          })}

          {overflow.length ? (
            <div className="relative" ref={moreRef}>
              <button
                type="button"
                aria-expanded={moreOpen}
                aria-controls={morePanelId}
                onClick={() => setMoreOpen((v) => !v)}
                className={cx(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                  overflowActive || moreOpen
                    ? 'border-primary/30 bg-primary-light text-primary'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                More filters
                {overflowActive ? ` (${overflowActive})` : ''}
              </button>
              {moreOpen ? (
                <div
                  id={morePanelId}
                  className="absolute right-0 top-[calc(100%+0.375rem)] z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-3 shadow-overlay"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      More filters
                    </p>
                    <button
                      type="button"
                      onClick={() => setMoreOpen(false)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      aria-label="Close more filters"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex flex-col gap-3">{overflow.map(control)}</div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 items-end gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
        {primary.map(control)}
        <div className="flex items-end justify-end gap-2 min-w-0">
          {onReset ? (
            <Button
              variant="secondary"
              size="md"
              onClick={onReset}
              disabled={activeCount === 0}
              title={activeCount === 0 ? 'No filter is set' : 'Clear every filter'}
            >
              Clear all
            </Button>
          ) : null}
          {onApply ? (
            <Button
              variant="primary"
              size="md"
              onClick={onApply}
              loading={applying}
              title="Filters apply as you change them — this re-runs the query"
            >
              Apply filters
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export default RegisterFilterPanel
