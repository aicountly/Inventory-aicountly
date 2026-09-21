import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { Input } from '../../../ui/Input'
import { SearchBox } from '../../../ui/SearchBox'
import { Select } from '../../../ui/Select'
import { cx } from '../../../ui/cx'
import { ItemFilter } from '../../../components/ItemFilter'
import { WarehouseSelect } from '../../../documents/WarehouseSelect'
import { useReferenceData } from '../../../documents/useReferenceData'
import {
  RECALC_DATE_FIELDS,
  RECALC_STATUS_FILTERS,
  RECALC_TRIGGER_KINDS,
} from '../../../services/valuationApi'
import { humanize } from '../../../utils/format'
import { triggerLabel } from './recalculationModel'

const LABEL = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500'

export interface RecalcFilterValues {
  status: string
  q: string
  from: string
  to: string
  all_fy: string
  item_id: string
  warehouse_id: string
  trigger_kind: string
  dry_run: string
  has_cogs_impact: string
  date_field: string
}

export interface ActiveChip {
  key: keyof RecalcFilterValues
  label: string
  /** The value to write back when the chip is dismissed. */
  cleared: string
}

/** Which of the advanced filters a reader has actually set. */
const ADVANCED_KEYS: (keyof RecalcFilterValues)[] = [
  'item_id',
  'warehouse_id',
  'trigger_kind',
  'dry_run',
  'has_cogs_impact',
  'date_field',
]

const DRY_RUN_OPTIONS = [
  { value: '', label: 'Any mode' },
  { value: '0', label: 'Live runs only' },
  { value: '1', label: 'Dry runs only' },
]

const DATE_FIELD_LABEL: Record<string, string> = Object.fromEntries(
  RECALC_DATE_FIELDS.map((f) => [f.value, f.label]),
)

/**
 * The chips above the table: every narrowing currently in force, each removable.
 *
 * Only ADVANCED filters get a chip. Status, search, the dates and the all-years
 * toggle already have a visible control two inches above, and a chip for a
 * `<select>` the reader can see is noise; the advanced ones are behind a
 * popover and would otherwise be invisible once it closes.
 */
export function activeChips(values: RecalcFilterValues, warehouseName: (id: number) => string): ActiveChip[] {
  const chips: ActiveChip[] = []
  if (values.item_id) chips.push({ key: 'item_id', label: `Item #${values.item_id}`, cleared: '' })
  if (values.warehouse_id) {
    chips.push({ key: 'warehouse_id', label: warehouseName(Number(values.warehouse_id)) || `Warehouse #${values.warehouse_id}`, cleared: '' })
  }
  if (values.trigger_kind) chips.push({ key: 'trigger_kind', label: triggerLabel(values.trigger_kind), cleared: '' })
  if (values.dry_run) {
    chips.push({ key: 'dry_run', label: values.dry_run === '1' ? 'Dry runs only' : 'Live runs only', cleared: '' })
  }
  if (values.has_cogs_impact === '1') chips.push({ key: 'has_cogs_impact', label: 'Has COGS impact', cleared: '' })
  if (values.date_field && values.date_field !== 'queued') {
    chips.push({ key: 'date_field', label: `Dated by ${(DATE_FIELD_LABEL[values.date_field] ?? humanize(values.date_field)).toLowerCase()}`, cleared: '' })
  }
  return chips
}

export function countAdvanced(values: RecalcFilterValues): number {
  return ADVANCED_KEYS.filter((k) => {
    if (k === 'date_field') return Boolean(values[k]) && values[k] !== 'queued'
    return Boolean(values[k])
  }).length
}

export interface RecalculationFiltersProps {
  values: RecalcFilterValues
  /** One key. */
  onChange: (key: keyof RecalcFilterValues, value: string) => void
  /** Several keys in ONE navigation — see useListParams.setFilters. */
  onChangeMany: (patch: Partial<Record<keyof RecalcFilterValues, string>>) => void
  onSearch: (q: string) => void
  onClearAll: () => void
  /** Bound to `/` and Ctrl+F by the page. */
  searchInputRef?: RefObject<HTMLInputElement | null>
  disabled?: boolean
}

/**
 * The register's one filter card: the four controls a reader reaches for every
 * time, and a popover holding the ones they reach for occasionally.
 *
 * Filters apply AS THEY CHANGE and are held in the URL, which is how every
 * other list in this product behaves — so a filtered register can be
 * bookmarked, shared and reloaded, and the dashboard can link straight to
 * `?status=QUEUED,RUNNING`. "Apply" is therefore not a gate: the popover has a
 * Done button that closes it, not one that submits it.
 */
export function RecalculationFilters({
  values,
  onChange,
  onChangeMany,
  onSearch,
  onClearAll,
  searchInputRef,
  disabled = false,
}: RecalculationFiltersProps) {
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const { warehouses, warehouseName } = useReferenceData()

  // Local mirror so typing is not one render behind the URL. The page debounces
  // what it does with it; the box itself must stay immediate or it feels broken.
  const [draft, setDraft] = useState(values.q)
  useEffect(() => setDraft(values.q), [values.q])
  useEffect(() => {
    if (draft === values.q) return undefined
    const id = setTimeout(() => onSearch(draft), 350)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSearch is stable per render of the page
  }, [draft])

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e: MouseEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const advancedCount = countAdvanced(values)
  const chips = useMemo(() => activeChips(values, warehouseName), [values, warehouseName])
  const anyFilter =
    advancedCount > 0 || Boolean(values.status || values.q || values.from || values.to || values.all_fy)

  return (
    <Card padding="none" className="shrink-0 px-3.5 py-3 print:hidden">
      <div
        className={cx(
          'grid items-end gap-x-3 gap-y-2.5',
          'grid-cols-1 md:grid-cols-2',
          'xl:[grid-template-columns:minmax(9.5rem,12rem)_minmax(15rem,1fr)_minmax(19rem,23rem)_auto_auto]',
        )}
      >
        <div className="min-w-0">
          <label className={LABEL} htmlFor="recalc-status">
            Status
          </label>
          <Select
            id="recalc-status"
            size="md"
            value={values.status}
            disabled={disabled}
            onChange={(e) => onChange('status', e.target.value)}
          >
            {RECALC_STATUS_FILTERS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="min-w-0">
          <label className={LABEL} htmlFor="recalc-search">
            Search
          </label>
          <SearchBox
            ref={searchInputRef}
            name="recalc-search"
            size="md"
            value={draft}
            onChange={setDraft}
            onSubmit={onSearch}
            kbd="/"
            placeholder="Job no., item, trigger, reason or failure…"
            aria-label="Search recalculations"
          />
        </div>

        <div className="min-w-0">
          <span className={LABEL} id="recalc-range-label">
            {DATE_FIELD_LABEL[values.date_field || 'queued'] ?? 'Queued'} between
          </span>
          <div className="flex items-center gap-2" role="group" aria-labelledby="recalc-range-label">
            <Input
              type="date"
              size="md"
              className="min-w-0 flex-1"
              value={values.from}
              max={values.to || undefined}
              disabled={disabled}
              aria-label="From date"
              onChange={(e) => onChange('from', e.target.value)}
            />
            <span className="shrink-0 text-xs text-gray-400">to</span>
            <Input
              type="date"
              size="md"
              className="min-w-0 flex-1"
              value={values.to}
              min={values.from || undefined}
              disabled={disabled}
              aria-label="To date"
              onChange={(e) => onChange('to', e.target.value)}
            />
          </div>
        </div>

        <label className="flex h-9 items-center gap-2 whitespace-nowrap text-xs font-medium text-gray-600">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[rgb(var(--color-primary))]"
            checked={values.all_fy === '1'}
            disabled={disabled}
            onChange={(e) => onChange('all_fy', e.target.checked ? '1' : '')}
          />
          All years
        </label>

        <div className="relative">
          <Button
            ref={triggerRef}
            variant="secondary"
            size="md"
            icon={SlidersHorizontal}
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            aria-haspopup="dialog"
            onClick={() => setOpen((v) => !v)}
            className="w-full md:w-auto"
          >
            Filters
            {advancedCount > 0 ? (
              <span className="ml-1 rounded-full bg-primary-light px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                {advancedCount}
              </span>
            ) : null}
          </Button>

          {open ? (
            <div
              ref={popoverRef}
              id={panelId}
              role="dialog"
              aria-label="Advanced filters"
              className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] animate-rise-in rounded-xl border border-gray-200 bg-white p-3.5 shadow-overlay"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900">Advanced filters</h3>
                <Button variant="ghost" size="xs" icon={X} aria-label="Close advanced filters" onClick={() => setOpen(false)} />
              </div>

              <div className="space-y-3">
                <div>
                  <label className={LABEL} htmlFor="recalc-trigger">
                    Trigger
                  </label>
                  <Select
                    id="recalc-trigger"
                    size="md"
                    value={values.trigger_kind}
                    onChange={(e) => onChange('trigger_kind', e.target.value)}
                  >
                    <option value="">Any trigger</option>
                    {RECALC_TRIGGER_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {triggerLabel(kind)}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <label className={LABEL} htmlFor="recalc-mode">
                    Mode
                  </label>
                  <Select id="recalc-mode" size="md" value={values.dry_run} onChange={(e) => onChange('dry_run', e.target.value)}>
                    {DRY_RUN_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <span className={LABEL}>Item</span>
                  <ItemFilter
                    value={values.item_id}
                    onChange={(id) => onChange('item_id', id)}
                    placeholder="Any item"
                  />
                </div>

                <div>
                  <label className={LABEL} htmlFor="recalc-warehouse">
                    Warehouse
                  </label>
                  <WarehouseSelect
                    id="recalc-warehouse"
                    value={values.warehouse_id ? Number(values.warehouse_id) : null}
                    onChange={(id) => onChange('warehouse_id', id ? String(id) : '')}
                    warehouses={warehouses}
                    emptyLabel="Any warehouse"
                  />
                </div>

                <div>
                  <label className={LABEL} htmlFor="recalc-date-field">
                    Date range applies to
                  </label>
                  <Select
                    id="recalc-date-field"
                    size="md"
                    value={values.date_field || 'queued'}
                    onChange={(e) => onChange('date_field', e.target.value === 'queued' ? '' : e.target.value)}
                  >
                    {RECALC_DATE_FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                </div>

                <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[rgb(var(--color-primary))]"
                    checked={values.has_cogs_impact === '1'}
                    onChange={(e) => onChange('has_cogs_impact', e.target.checked ? '1' : '')}
                  />
                  Only jobs that moved COGS
                </label>
              </div>

              <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-gray-100 pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={advancedCount === 0}
                  onClick={() =>
                    onChangeMany({
                      item_id: '',
                      warehouse_id: '',
                      trigger_kind: '',
                      dry_run: '',
                      has_cogs_impact: '',
                      date_field: '',
                    })
                  }
                >
                  Clear advanced
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {chips.length > 0 || anyFilter ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2.5">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 py-0.5 pl-2 pr-1 text-[11px] font-medium text-gray-700"
            >
              {chip.label}
              <button
                type="button"
                className="rounded-full p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
                aria-label={`Remove filter ${chip.label}`}
                onClick={() => onChange(chip.key, chip.cleared)}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
          {anyFilter ? (
            <Button variant="ghost" size="xs" className="ml-auto" onClick={onClearAll}>
              Clear all filters
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}
