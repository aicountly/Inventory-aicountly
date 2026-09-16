import type { ReactNode } from 'react'
import { CalendarRange } from 'lucide-react'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { cx } from '../ui/cx'
import {
  ALL_DATES_PRESET_ID,
  CUSTOM_PRESET_ID,
  DATE_RANGE_PRESETS,
  getDateRangeForPreset,
  matchDateRangePreset,
} from './dateRangePresets'
import type { DateRangeContext } from './dateRangePresets'

export interface DateRangeFilterProps {
  from: string
  to: string
  ctx: DateRangeContext
  onChange: (range: { from: string; to: string }) => void
  label?: string
  /** Offer "All dates". Off for registers that must always be bounded. */
  allowAllDates?: boolean
  /**
   * Label above the control rather than beside it — the filter panel's grid.
   *
   * The panel's own cell prints the label, so the inline icon and caption are
   * dropped here instead of being repeated, and the preset select takes the
   * full cell with the two dates on the line beneath it.
   */
  stacked?: boolean
  className?: string
  id?: string
}

const GROUP_LABELS: Record<string, string> = {
  quick: 'Recent',
  month: 'Months',
  quarter: 'Quarters',
  half: 'Half years',
  year: 'Financial year',
  special: '',
}

/**
 * The two date boxes: a row of their own under the preset when the control is
 * stacked in a grid cell, and nothing at all when it is inline — the toolbar's
 * own flex row already spaces them, and an extra wrapper there would break the
 * wrapping the bar has always had.
 */
function Dates({ stacked, children }: { stacked: boolean; children: ReactNode }) {
  if (!stacked) return <>{children}</>
  return <div className="flex w-full min-w-0 items-center gap-1.5">{children}</div>
}

/**
 * Preset dropdown plus From / To.
 *
 * This replaces the two bare `<input type="date">` boxes every Inventory list
 * ships today. Picking a preset writes both dates at once, and typing a date
 * moves the dropdown to "Custom…" — the dropdown is a view of the two dates,
 * never a third piece of state that can disagree with them.
 */
export function DateRangeFilter({
  from,
  to,
  ctx,
  onChange,
  label = 'Period',
  allowAllDates = true,
  stacked = false,
  className,
  id,
}: DateRangeFilterProps) {
  const presetId = matchDateRangePreset(from, to, ctx)
  const presets = DATE_RANGE_PRESETS.filter(
    (p) => allowAllDates || p.id !== ALL_DATES_PRESET_ID,
  )

  const groups: { key: string; label: string; items: typeof presets }[] = []
  for (const preset of presets) {
    const last = groups[groups.length - 1]
    if (last && last.key === preset.group) last.items.push(preset)
    else groups.push({ key: preset.group, label: GROUP_LABELS[preset.group] ?? '', items: [preset] })
  }

  const applyPreset = (id: string) => {
    const range = getDateRangeForPreset(id, ctx)
    // "Custom…" resolves to null: keep whatever is typed and let the reader
    // edit the dates. Switching to it must not blank the period.
    if (range) onChange(range)
  }

  return (
    <div
      className={cx(
        stacked ? 'flex w-full min-w-0 flex-col gap-1' : 'flex flex-wrap items-center gap-1.5',
        className,
      )}
    >
      {stacked ? (
        <label
          htmlFor={id}
          className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-gray-500"
        >
          <CalendarRange className="w-3.5 h-3.5 shrink-0 text-gray-400" aria-hidden />
          {label}
        </label>
      ) : (
        <>
          <CalendarRange className="w-3.5 h-3.5 shrink-0 text-gray-400" aria-hidden />
          <span className="text-label-xs font-semibold uppercase tracking-wide text-gray-400">
            {label}
          </span>
        </>
      )}
      <Select
        id={id}
        value={presetId}
        onChange={(e) => applyPreset(e.target.value)}
        aria-label={`${label} preset`}
        className={stacked ? 'w-full' : 'w-auto min-w-[8.5rem]'}
      >
        {groups.map((group, idx) =>
          group.label ? (
            <optgroup key={`${group.key}-${idx}`} label={group.label}>
              {group.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          ) : (
            group.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))
          ),
        )}
      </Select>
      {presetId === ALL_DATES_PRESET_ID ? null : (
        <Dates stacked={stacked}>
          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => onChange({ from: e.target.value, to })}
            aria-label={`${label} from`}
            className={stacked ? 'w-full min-w-0' : 'w-[8.5rem]'}
          />
          <span className="text-xs text-gray-400">to</span>
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => onChange({ from, to: e.target.value })}
            aria-label={`${label} to`}
            className={stacked ? 'w-full min-w-0' : 'w-[8.5rem]'}
          />
        </Dates>
      )}
      {presetId === CUSTOM_PRESET_ID ? (
        <span className="text-[11px] text-gray-400">custom</span>
      ) : null}
    </div>
  )
}

export default DateRangeFilter
