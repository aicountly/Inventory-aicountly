import { FilterField } from '../ui/shell/FilterBar'
import { Select } from '../ui/Select'
import { defaultColumnVisibility, isColumnVisible } from './columnPrefs'
import type { ColumnPrefDef, ColumnVisibility } from './columnPrefs'
import type { RegisterViewPreset } from './RegisterConfig'

export interface ViewPresetSelectProps {
  presets: readonly RegisterViewPreset[]
  value: string
  onChange: (id: string) => void
  /** Stacked in the filter panel, inline in the toolbar. */
  layout?: 'inline' | 'stacked'
  label?: string
}

/**
 * The saved-view control.
 *
 * A preset is a name for a set of columns, and picking one is the same act as ticking
 * those columns in Configure Columns — which is why it writes through the SAME per-user
 * preference rather than holding a second, competing idea of what is on screen. The two
 * controls can therefore never disagree: turn a column off by hand after picking
 * "Valuation" and the columns are what you left them, with the preset name still in the
 * URL as the record of where you started.
 */
export function ViewPresetSelect({
  presets,
  value,
  onChange,
  layout = 'stacked',
  label = 'View preset',
}: ViewPresetSelectProps) {
  const active = presets.find((p) => p.id === value)
  return (
    <FilterField
      label={label}
      stacked={layout === 'stacked'}
      className={layout === 'stacked' ? 'min-w-0 w-full' : undefined}
    >
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        title={active?.description}
        className={layout === 'stacked' ? 'w-full' : 'w-auto min-w-[9rem]'}
      >
        {/* The columns on screen match no preset — because someone changed one by hand.
            Saying "Custom" is the only truthful thing the control can show; naming a
            preset the grid no longer matches would make the label a liar. */}
        {active ? null : <option value="">Custom</option>}
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
      </Select>
    </FilterField>
  )
}

/**
 * The visibility map a preset asks for.
 *
 * A preset names the columns it wants; everything else is off, except the columns that
 * identify the row and are never on offer anywhere. A preset that names no columns is the
 * register's own shipped set — which is what "Default" means, and why it does not have to
 * repeat the whole list to say so.
 */
export function visibilityForPreset(
  columns: readonly ColumnPrefDef[],
  preset: RegisterViewPreset | undefined,
): ColumnVisibility {
  if (!preset?.columns) return defaultColumnVisibility(columns)
  const wanted = new Set(preset.columns)
  const out: ColumnVisibility = {}
  for (const col of columns) {
    if (!col?.key) continue
    out[col.key] = col.alwaysVisible === true || wanted.has(col.key)
  }
  return out
}

/**
 * Which preset the columns currently on screen match, or '' when they match none.
 *
 * Used to keep the control honest after a hand edit in Configure Columns: the dropdown
 * showing "Valuation" over a grid that is no longer the valuation view would be the
 * screen's own label lying about it.
 */
export function presetMatching(
  columns: readonly ColumnPrefDef[],
  visibility: ColumnVisibility,
  presets: readonly RegisterViewPreset[],
): string {
  const on = columns.filter((col) => isColumnVisible(col, visibility)).map((col) => col.key)
  const key = on.join(',')
  const match = presets.find(
    (preset) =>
      columns
        .filter((col) => isColumnVisible(col, visibilityForPreset(columns, preset)))
        .map((col) => col.key)
        .join(',') === key,
  )
  return match?.id ?? ''
}

export default ViewPresetSelect
