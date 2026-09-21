import { Check } from 'lucide-react'
import { AIC, cx } from '../../ui/cx'

export type StepId = 'details' | 'receipts' | 'charges' | 'review' | 'post'

export interface StepDef {
  id: StepId
  title: string
  caption: string
  /** Done — the step's own requirements are met. */
  complete: boolean
}

interface LandedCostStepperProps {
  steps: StepDef[]
  /** The step the user is working in; the first incomplete one unless they clicked another. */
  current: StepId
  onSelect: (id: StepId) => void
}

/**
 * The five-step tracker across the top.
 *
 * It is a MAP, not a wizard: every section of the form is on screen at once and the tracker says
 * where you are in it, so a step is always reachable — clicking one scrolls to its card. Locking
 * step three until steps one and two are perfect is the pattern that makes accounting entry slow,
 * because the order a bill is actually keyed in is whatever order the paper is in.
 *
 * Completeness is still shown, because that is the useful half: a tick means that section has what
 * posting needs, and the readiness card beside the form says what a step without one is missing.
 *
 * Rendered as an ordered list of buttons: a row of divs with click handlers is unreachable by
 * keyboard and says nothing about position to a screen reader.
 */
export function LandedCostStepper({ steps, current, onSelect }: LandedCostStepperProps) {
  return (
    <nav aria-label="Landed cost allocation progress" className={cx(AIC, 'rounded-xl border border-gray-200 bg-white shadow-card')}>
      <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {steps.map((step, i) => {
          const active = step.id === current
          return (
            <li key={step.id} className="relative min-w-0 border-b border-gray-100 last:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0">
              <button
                type="button"
                onClick={() => onSelect(step.id)}
                aria-current={active ? 'step' : undefined}
                className={cx(
                  'flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset',
                  active ? 'bg-primary-light/50' : 'hover:bg-gray-50',
                )}
              >
                <span
                  className={cx(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                    step.complete
                      ? 'bg-emerald-600 text-white'
                      : active
                        ? 'bg-primary text-white'
                        : 'bg-gray-100 text-gray-500',
                  )}
                >
                  {/* The tick is the state; the number stays the label for anything that cannot
                      see it, which is why the step's status is also written out below. */}
                  {step.complete ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={cx('block truncate text-xs font-semibold', active ? 'text-primary' : 'text-gray-900')}>{step.title}</span>
                  <span className="block truncate text-[10px] text-gray-500">{step.caption}</span>
                </span>
                <span className="sr-only">
                  {`Step ${i + 1} of ${steps.length}. ${step.complete ? 'Complete.' : 'Not complete.'}`}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
