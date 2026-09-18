import { Check } from 'lucide-react'
import { AIC, cx } from '../../../ui/cx'
import { ITEM_FORM_STEPS } from './itemIntelligence'
import type { StepId } from './itemIntelligence'

export interface ItemFormStepperProps {
  activeId: StepId
  completed: ReadonlySet<StepId>
  errored: ReadonlySet<StepId>
  onSelect: (id: StepId) => void
  /** Narrow layout: the steps are a wizard rather than page anchors. */
  wizard: boolean
}

/**
 * Identity → Classification → Units → Valuation.
 *
 * Four buttons, not four pages: on a desktop the sections are all on screen and
 * a step scrolls to one, which is why every step is always clickable. State is
 * carried by the circle AND by the word beside it — a step in error is red and
 * says so to a screen reader through `aria-invalid`, so colour is never the
 * only signal.
 */
export function ItemFormStepper({ activeId, completed, errored, onSelect, wizard }: ItemFormStepperProps) {
  return (
    <nav
      aria-label="Item setup progress"
      className={cx(
        AIC,
        'scrollbar-thin flex w-full items-center overflow-x-auto rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-card md:px-4',
      )}
    >
      {ITEM_FORM_STEPS.map((step, index) => {
        const isActive = step.id === activeId
        const hasError = errored.has(step.id)
        const isComplete = !hasError && completed.has(step.id) && !isActive
        return (
          <div key={step.id} className="flex min-w-0 flex-1 items-center last:flex-none">
            <button
              type="button"
              onClick={() => onSelect(step.id)}
              aria-current={isActive ? 'step' : undefined}
              aria-invalid={hasError || undefined}
              className={cx(
                'inline-flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 text-[0.8125rem] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                'flex-col gap-1 text-[11px] sm:flex-row sm:gap-2 sm:text-[0.8125rem]',
                hasError ? 'text-red-600' : isActive || isComplete ? 'text-primary' : 'text-gray-500 hover:text-gray-900',
              )}
            >
              <span
                aria-hidden
                className={cx(
                  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold transition-colors',
                  hasError
                    ? 'border-red-200 bg-red-50 text-red-600'
                    : isActive
                      ? 'border-primary bg-primary text-white ring-4 ring-primary/10'
                      : isComplete
                        ? 'border-primary/40 bg-primary-light text-primary'
                        : 'border-gray-200 bg-gray-50 text-gray-500',
                )}
              >
                {hasError ? '!' : isComplete ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span className="whitespace-nowrap">{step.label}</span>
              {hasError ? <span className="sr-only">(has errors)</span> : null}
            </button>
            {index < ITEM_FORM_STEPS.length - 1 ? (
              <span
                aria-hidden
                className={cx(
                  'mx-2 h-px min-w-[1.25rem] flex-1 md:mx-3',
                  isComplete && !wizard ? 'bg-primary/30' : 'bg-gray-200',
                )}
              />
            ) : null}
          </div>
        )
      })}
    </nav>
  )
}

export default ItemFormStepper
