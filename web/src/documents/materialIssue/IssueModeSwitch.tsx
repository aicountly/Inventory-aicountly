import { AIC, cx } from '../../ui/cx'
import { ISSUE_MODES } from './issueMode'
import type { IssueMode } from './issueMode'

export interface IssueModeSwitchProps {
  value: IssueMode
  onChange: (mode: IssueMode) => void
  disabled?: boolean
}

/**
 * Which kind of issue this is.
 *
 * Its own control rather than the shared `SegmentedControl`: this one is a
 * primary choice on the document — it decides what the Reference means and it
 * is saved with the record — so it reads at field size and in the brand green,
 * not at the filter-chip size the shared control is drawn for. It uses the
 * theme's own tokens, so it stays one design language.
 *
 * `role="tablist"` with `aria-selected` is how the shared control announces
 * itself too, so a screen reader hears the same thing in both places.
 */
export function IssueModeSwitch({ value, onChange, disabled = false }: IssueModeSwitchProps) {
  return (
    <div
      role="tablist"
      aria-label="Material issue type"
      className={cx(
        AIC,
        // Scrolls rather than wraps under ~900px: four pills stacked two-by-two
        // read as two rows of choices, which is not what a one-of-four control is.
        'inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-gray-200 bg-gray-50 p-1',
      )}
    >
      {ISSUE_MODES.map((mode) => {
        const active = mode.value === value
        return (
          <button
            key={mode.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={mode.hint}
            disabled={disabled}
            onClick={() => {
              if (!active) onChange(mode.value)
            }}
            className={cx(
              'whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 md:text-sm',
              active
                ? 'bg-primary text-white shadow-sm'
                : 'text-gray-600 hover:bg-white hover:text-gray-900',
            )}
          >
            {mode.label}
          </button>
        )
      })}
    </div>
  )
}

export default IssueModeSwitch
