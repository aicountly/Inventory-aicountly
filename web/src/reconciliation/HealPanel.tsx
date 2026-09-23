import { useCallback, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { reconciliationApi } from '../services/reconciliationApi'
import type { HealResult } from '../services/reconciliationApi'
import { Button } from '../ui/Button'
import { formatMoney } from '../utils/format'

/**
 * "Fix what's safe" — and it says what it is NOT fixing, in the same breath.
 *
 * Everything it does is delivery: Inventory already holds the right answer and Books has not been
 * told, so re-telling changes no figure on either side and is idempotent. What it refuses to
 * touch is the more important half of the screen — a manual journal is somebody's decision, a
 * missing source is a document only a person can identify, a valuation variance is a cost layer,
 * and an unacknowledged revision is Books' to acknowledge, not Inventory's. A button that
 * silently skipped those while reporting success would be worse than no button.
 *
 * Nothing runs until the plan has been shown: the first press is always a dry run.
 */
export function HealPanel({ onHealed }: { onHealed?: () => void }) {
  const [plan, setPlan] = useState<HealResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const preview = useCallback(async () => {
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      setPlan(await reconciliationApi.heal(true))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not work out what is safe to fix')
    } finally {
      setBusy(false)
    }
  }, [])

  const apply = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setPlan(await reconciliationApi.heal(false))
      setDone(true)
      onHealed?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The repair did not complete')
    } finally {
      setBusy(false)
    }
  }, [onHealed])

  return (
    <div className="space-y-2">
      <Button variant="secondary" size="md" icon={ShieldCheck} loading={busy && !plan} onClick={preview}>
        Fix what&apos;s safe
      </Button>

      {error ? <p className="text-xs text-red-700">{error}</p> : null}

      {plan ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-xs">
          {plan.actions.length === 0 ? (
            <p className="text-gray-700">
              Nothing here is safe to fix automatically
              {plan.skipped.length ? ' — everything outstanding needs a person.' : '. The two systems already agree.'}
            </p>
          ) : (
            <>
              <p className="font-semibold text-gray-900">
                {done ? 'Done' : 'This will'}
              </p>
              <ul className="mt-1 space-y-1.5">
                {plan.actions.map((action) => (
                  <li key={action.action} className="text-gray-700">
                    <span className="font-medium text-gray-900">{action.detail}</span>
                    {Math.abs(action.amount) >= 1 ? (
                      <span className="text-gray-500"> ({formatMoney(action.amount)})</span>
                    ) : null}
                    {action.result ? <span className="text-gray-500"> — {action.result}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          )}

          {plan.skipped.length ? (
            <>
              <p className="mt-3 font-semibold text-gray-900">Left alone, deliberately</p>
              <ul className="mt-1 space-y-1.5">
                {plan.skipped.map((skip) => (
                  <li key={skip.bucket} className="text-gray-600">
                    <span className="font-medium text-gray-800">{skip.bucket.replace(/_/g, ' ')}</span>{' '}
                    <span className="text-gray-500">({formatMoney(skip.amount)})</span> — {skip.reason}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <div className="mt-3 flex items-center gap-2">
            {plan.dry_run && plan.actions.length ? (
              <Button variant="primary" size="xs" loading={busy} onClick={apply}>
                Do it
              </Button>
            ) : null}
            <Button variant="secondary" size="xs" disabled={busy} onClick={() => setPlan(null)}>
              {done || !plan.actions.length ? 'Close' : 'Cancel'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default HealPanel
