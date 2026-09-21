import { Check } from 'lucide-react'
import { cx } from '../../../ui/cx'

export type StepKey = 'details' | 'bom' | 'lines' | 'review'
export type StepState = 'done' | 'active' | 'todo'

export interface StepSpec {
  key: StepKey
  label: string
  hint: string
  state: StepState
}

export interface ProductionStepperProps {
  steps: readonly StepSpec[]
  onSelect: (key: StepKey) => void
}

/**
 * Where the run has got to, on one screen.
 *
 * Guidance, not a wizard: every field stays reachable at all times and a step is a scroll target,
 * not a route. A storekeeper entering the twentieth run of the shift should never be made to
 * click "next" four times, and the stepper is there for the one who is entering their first.
 */
export function ProductionStepper({ steps, onSelect }: ProductionStepperProps) {
  return (
    <ol className="aic relative mb-5 grid grid-cols-2 gap-y-3 sm:grid-cols-4" aria-label="Production progress">
      <span
        aria-hidden
        className="pointer-events-none absolute left-[12.5%] right-[12.5%] top-[15px] hidden h-px bg-gray-200 sm:block"
      />
      {steps.map((step, i) => (
        <li key={step.key} className="relative z-[1] flex min-w-0 flex-col items-center gap-1.5 text-center">
          <button
            type="button"
            onClick={() => onSelect(step.key)}
            aria-current={step.state === 'active' ? 'step' : undefined}
            title={step.hint}
            className={cx(
              'grid h-[30px] w-[30px] place-items-center rounded-full border text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
              step.state === 'active'
                ? 'border-primary bg-primary text-white shadow-[0_0_0_4px_rgb(var(--color-primary)/0.10)]'
                : step.state === 'done'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-gray-300 bg-white text-gray-500 hover:border-gray-400',
            )}
          >
            {step.state === 'done' ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
            <span className="sr-only">{`Step ${i + 1}: ${step.label}`}</span>
          </button>
          <button
            type="button"
            onClick={() => onSelect(step.key)}
            tabIndex={-1}
            className={cx(
              'max-w-full truncate px-1 text-[11px] leading-tight transition-colors',
              step.state === 'active' ? 'font-semibold text-primary' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            {step.label}
          </button>
        </li>
      ))}
    </ol>
  )
}

export default ProductionStepper
