import { AlertTriangle, Check, Loader2, ShieldCheck, X } from 'lucide-react'
import { Card } from '../../ui/Card'
import { AIC, cx } from '../../ui/cx'
import type { CheckState, ReadinessCheck } from './readiness'
import { blockingIssues } from './readiness'

interface PostingReadinessProps {
  checks: ReadinessCheck[]
  onFocus: (section: 'details' | 'receipts' | 'charges' | 'review') => void
}

const STATE_ICON: Record<CheckState, { icon: typeof Check; cls: string; word: string }> = {
  ok: { icon: Check, cls: 'text-emerald-600', word: 'Ready' },
  blocked: { icon: X, cls: 'text-red-600', word: 'Needs attention' },
  warning: { icon: AlertTriangle, cls: 'text-amber-600', word: 'Warning' },
  pending: { icon: Loader2, cls: 'text-gray-400 animate-spin', word: 'Checking' },
}

/**
 * The checklist that answers "can this be posted, and if not, what is missing?"
 *
 * Every row is clickable and scrolls to the thing that needs doing. A checklist that names a
 * problem and leaves the user to hunt for the field is a list of complaints.
 *
 * State is never communicated by colour alone: each row carries an icon whose SHAPE differs (tick,
 * cross, triangle) and the word is in the row's accessible name.
 */
export function PostingReadiness({ checks, onFocus }: PostingReadinessProps) {
  const blocking = blockingIssues(checks)

  return (
    <Card padding="sm" className={AIC}>
      <div className="mb-2 flex items-center gap-1.5">
        <ShieldCheck className={cx('h-4 w-4 shrink-0', blocking.length === 0 ? 'text-emerald-600' : 'text-amber-500')} aria-hidden />
        <h3 className="text-sm font-semibold text-gray-900">Posting readiness</h3>
      </div>

      {blocking.length > 0 ? (
        <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900">
          {blocking.length === 1 ? '1 issue requires attention' : `${blocking.length} issues require attention`}
        </p>
      ) : (
        <p className="mb-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-900">Ready to post</p>
      )}

      <ul className="m-0 space-y-0.5">
        {checks.map((check) => {
          const style = STATE_ICON[check.state]
          const Icon = style.icon
          return (
            <li key={check.id}>
              <button
                type="button"
                onClick={() => check.focus && onFocus(check.focus)}
                disabled={!check.focus}
                className={cx(
                  'flex w-full items-start gap-2 rounded-md px-1 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  check.focus ? 'hover:bg-gray-50' : 'cursor-default',
                )}
              >
                <Icon className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', style.cls)} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={cx('block text-[11px] font-medium', check.state === 'blocked' ? 'text-gray-900' : 'text-gray-600')}>{check.label}</span>
                  {check.detail ? <span className="mt-0.5 block text-[10px] leading-snug text-gray-500">{check.detail}</span> : null}
                  <span className="sr-only">{style.word}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
