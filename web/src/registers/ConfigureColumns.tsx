import { useState } from 'react'
import type { ReactNode } from 'react'
import { Columns3 } from 'lucide-react'
import { Modal } from '../components/Modal'
import { Button } from '../ui/Button'
import { columnPrefsAreDefault, defaultColumnVisibility, isColumnVisible } from './columnPrefs'
import type { ColumnVisibility } from './columnPrefs'

export interface ConfigurableColumn {
  key: string
  header?: ReactNode
  alwaysVisible?: boolean
  defaultVisible?: boolean
  configureLabel?: string
  configureHint?: string
}

export interface ConfigureColumnsProps {
  columns: readonly ConfigurableColumn[]
  visibility: ColumnVisibility
  onChange: (next: ColumnVisibility) => void
  disabled?: boolean
  title?: string
  description?: string
  /**
   * Drive the dialog from outside.
   *
   * The register offers the same dialog from two places — the toolbar, and
   * "Customize columns" over the table — and two components each holding their
   * own `open` would be two dialogs that can both be open at once over the
   * same preference. Pass this pair and the caller owns the one flag; leave
   * them out and the component keeps its own, which is what every other caller
   * does.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function labelFor(col: ConfigurableColumn): string {
  if (col.configureLabel) return col.configureLabel
  if (typeof col.header === 'string') return col.header
  return col.key
}

/**
 * Configure Columns — the button and its dialog.
 *
 * Columns that identify the row are listed as fixed rather than as a checkbox
 * that cannot be cleared: the reader is told why they are not on offer instead
 * of discovering that clicking does nothing. A grid of numbers with no name
 * against them is not a register.
 *
 * What is chosen here is what the export writes — the same visible-column list
 * feeds the table, the CSV and the print sheet.
 */
export function ConfigureColumns({
  columns,
  visibility,
  onChange,
  disabled = false,
  title = 'Configure columns',
  description = 'Choose the columns to show. The choice is remembered for your own sign-in, and the export and print follow it.',
  open: openProp,
  onOpenChange,
}: ConfigureColumnsProps) {
  const [ownOpen, setOwnOpen] = useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : ownOpen
  const setOpen = (next: boolean) => {
    if (!controlled) setOwnOpen(next)
    onOpenChange?.(next)
  }

  const fixed = columns.filter((col) => col.alwaysVisible === true)
  const configurable = columns.filter((col) => col.alwaysVisible !== true)
  const shown = configurable.filter((col) => isColumnVisible(col, visibility)).length
  const isDefault = columnPrefsAreDefault(columns, visibility)

  return (
    <>
      <Button
        variant="secondary"
        size="xs"
        icon={Columns3}
        onClick={() => setOpen(true)}
        disabled={disabled || configurable.length === 0}
        title="Choose which columns to show"
      >
        Columns{shown < configurable.length ? ` (${shown}/${configurable.length})` : ''}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        size="sm"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onChange(defaultColumnVisibility(columns))}
              disabled={isDefault}
            >
              Reset to default
            </Button>
            <Button variant="primary" size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        }
      >
        <div className="space-y-1">
          {configurable.map((col) => (
            <label
              key={col.key}
              className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-700 cursor-pointer hover:bg-gray-50"
            >
              <input
                type="checkbox"
                className="mt-0.5 rounded border-gray-300 text-primary focus:ring-primary/30"
                checked={isColumnVisible(col, visibility)}
                onChange={(e) => onChange({ ...visibility, [col.key]: e.target.checked })}
                // The wrapping label also carries the hint underneath, and an
                // accessible name built from both would run them together —
                // indistinguishable from a column whose name is this one plus
                // more words. Name the checkbox explicitly.
                aria-label={labelFor(col)}
              />
              <span>
                {labelFor(col)}
                {col.configureHint ? (
                  <span className="mt-0.5 block text-xs text-gray-500">{col.configureHint}</span>
                ) : null}
              </span>
            </label>
          ))}
          {fixed.length ? (
            <p className="border-t border-gray-100 pt-2 text-xs text-gray-500">
              Always shown: {fixed.map((col) => labelFor(col)).join(', ')}.
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  )
}

export default ConfigureColumns
