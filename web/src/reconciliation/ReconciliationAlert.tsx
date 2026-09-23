import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccess } from '../access/AccessContext'
import { useCompany } from '../company/CompanyContext'
import { Notice } from '../components/Notice'
import { P } from '../services/access'
import { reconciliationApi } from '../services/reconciliationApi'
import type { ReconciliationStatusSummary } from '../services/reconciliationApi'
import { Button } from '../ui/Button'
import { formatMoney } from '../utils/format'

/** Below this the two systems agree for practical purposes. Matches ReconciliationService::ROUNDING_TOLERANCE. */
const TOLERANCE = 1

/** A verdict older than this is stated as stale rather than quietly presented as current. */
const STALE_AFTER_HOURS = 36

function hoursSince(iso: string | undefined): number | null {
  if (!iso) return null
  const then = Date.parse(iso.replace(' ', 'T'))
  if (Number.isNaN(then)) return null
  return (Date.now() - then) / 3_600_000
}

function ageLabel(hours: number | null): string {
  if (hours === null) return 'at an unknown time'
  if (hours < 1) return 'in the last hour'
  if (hours < 24) return `${Math.round(hours)} hours ago`
  return `${Math.round(hours / 24)} days ago`
}

/**
 * What the last reconciliation found, on every company load.
 *
 * It reads the LAST STORED verdict — one indexed row — and never reconciles. A fresh compute
 * calls Books over HTTP and walks every movement; doing that on page load would be self-inflicted
 * at any real company count. So the banner states how old its answer is instead of implying it is
 * live, and offers the re-run rather than performing one.
 *
 * Severity is not a style choice, it follows who owns the figure. On "Inventory Real Data" Books
 * has closed both ways a person could diverge the two, so a difference is a DEFECT and the banner
 * will not be dismissed. On "Manual Stock-in-Hand" a difference is a figure somebody chose, and
 * nagging about it every single page load would train people to ignore the banner that matters.
 */
export function ReconciliationAlert() {
  const { scope } = useCompany()
  const { can } = useAccess()
  const [status, setStatus] = useState<ReconciliationStatusSummary | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const allowed = can(P.reconciliationRead)
  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : ''

  // Keyed on the scope STRING, never the scope object: useCompany() hands back a fresh object
  // every render, so depending on it would refetch the verdict on each one.
  useEffect(() => {
    if (!allowed || !scopeKey) return
    const controller = new AbortController()
    setDismissed(false)
    reconciliationApi
      .status(controller.signal)
      .then(setStatus)
      .catch(() => setStatus(null))
    return () => controller.abort()
  }, [allowed, scopeKey])

  const verdict = useMemo(() => {
    if (!status?.has_run) return null
    const difference = status.difference
    if (difference === null || difference === undefined) return null
    if (Math.abs(difference) < TOLERANCE) return null
    const owned = status.stock_source === 'inventory'
    return {
      difference,
      owned,
      hours: hoursSince(status.ran_at),
    }
  }, [status])

  const onDismiss = useCallback(() => setDismissed(true), [])

  if (!allowed || !verdict || (dismissed && !verdict.owned)) return null

  const stale = verdict.hours !== null && verdict.hours > STALE_AFTER_HOURS
  const sign = verdict.difference > 0 ? 'above' : 'below'

  return (
    <Notice
      kind={verdict.owned ? 'error' : 'warning'}
      title={
        verdict.owned
          ? 'Inventory and Books disagree, and they should not'
          : 'Inventory and Books hold different stock values'
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/reconciliation"
            className="inline-flex h-7 items-center rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 no-underline hover:text-gray-900"
          >
            Review
          </Link>
          {/* Dismissing is offered only where a difference is a legitimate business fact. When
              Inventory owns the figure it is a defect, and a defect does not get a "not now". */}
          {verdict.owned ? null : (
            <Button variant="secondary" size="xs" onClick={onDismiss}>
              Not now
            </Button>
          )}
        </div>
      }
    >
      Inventory&apos;s closing value is {formatMoney(Math.abs(verdict.difference))} {sign} the Books
      stock ledger, as at {status?.as_of_date ?? 'the last run'} — reconciled {ageLabel(verdict.hours)}
      {stale ? ', which is old enough to be worth re-running' : ''}.
      {verdict.owned
        ? ' This company takes its Stock-in-Hand from Inventory, so the two are not meant to differ at all.'
        : ''}
    </Notice>
  )
}

export default ReconciliationAlert
