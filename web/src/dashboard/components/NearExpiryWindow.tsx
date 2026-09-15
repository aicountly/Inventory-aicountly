import { FILTER_LABEL_COMPACT } from '../../styles/designTokens'

/**
 * The expiry-window picker, lifted out of the old dashboard header so it can
 * sit among the shared header's actions.
 *
 * It tunes one widget and one pair of KPIs, not the whole page — which is why
 * it lives beside the other filters rather than looking like a page-wide scope
 * control.
 */
export interface NearExpiryWindowProps {
  value: number
  choices: readonly number[]
  onChange: (days: number) => void
}

export function NearExpiryWindow({ value, choices, onChange }: NearExpiryWindowProps) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1">
      <span className={FILTER_LABEL_COMPACT}>Expiry window</span>
      <div className="inline-flex rounded-md bg-gray-100 p-0.5" role="group" aria-label="Expiry window">
        {choices.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onChange(d)}
            aria-pressed={d === value}
            className={`rounded px-1.5 py-0.5 text-[11px] font-semibold transition-colors ${
              d === value ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {d}d
          </button>
        ))}
      </div>
    </div>
  )
}

export default NearExpiryWindow
