import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ShieldAlert } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import type { BadgeTone } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { EmptyState } from '../../../ui/EmptyState'
import { cx } from '../../../ui/cx'
import { formatDate } from '../../../utils/format'
import type { ExceptionSeverity, LayerException } from './costLayersModel'

const SEVERITY_TONE: Record<ExceptionSeverity, BadgeTone> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
}

const SEVERITY_LABEL: Record<ExceptionSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export interface ValuationExceptionsDrawerProps {
  open: boolean
  onClose: () => void
  exceptions: readonly LayerException[]
  /** How many layers were read to find them — the scope caveat. */
  scannedCount: number
  /** True when more layers match the filters than the page has loaded. */
  partialScan: boolean
  itemName: string | null
  onOpenLayer: (layerId: number) => void
}

/**
 * The layers worth a second look.
 *
 * Every entry is a fact about a row the page already has — a negative balance,
 * a zero cost, a receipt with no document, a batch past its expiry — with what
 * it does to the valuation and what to go and check. Nothing here resolves
 * anything: a valuation exception is closed by posting the missing document or
 * running a recalculation, both of which a person has to authorise. An
 * "auto-fix" on this panel would be a silent change to the accounts.
 *
 * It says how many layers it read, and when that is fewer than the filters
 * match it says so rather than implying the item is clean.
 */
export function ValuationExceptionsDrawer({
  open,
  onClose,
  exceptions,
  scannedCount,
  partialScan,
  itemName,
  onOpenLayer,
}: ValuationExceptionsDrawerProps) {
  const [severity, setSeverity] = useState<ExceptionSeverity | 'all'>('all')

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: exceptions.length }
    for (const e of exceptions) out[e.severity] = (out[e.severity] ?? 0) + 1
    return out
  }, [exceptions])

  const shown = severity === 'all' ? exceptions : exceptions.filter((e) => e.severity === severity)

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="xl"
      title="Review exceptions"
      badge={
        exceptions.length > 0 ? (
          <Badge tone="warning" size="xs">
            {exceptions.length}
          </Badge>
        ) : null
      }
      description={
        itemName
          ? `Checks run over ${scannedCount} layer${scannedCount === 1 ? '' : 's'} of ${itemName}.`
          : 'Checks run over the layers currently loaded.'
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>Close</Button>
        </div>
      }
    >
      {exceptions.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing flagged"
          description={`All ${scannedCount} layer${
            scannedCount === 1 ? '' : 's'
          } read have a positive balance, a real unit cost, a source document behind them and no expired batch still holding value.`}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(['all', 'critical', 'high', 'medium', 'low'] as const).map((key) => {
              const count = counts[key] ?? 0
              if (key !== 'all' && count === 0) return null
              const active = severity === key
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSeverity(key)}
                  className={cx(
                    'aic inline-flex min-h-[1.75rem] items-center gap-1 rounded-lg border px-2.5 text-[11.5px] transition-colors',
                    'focus:outline-none focus:ring-2 focus:ring-primary/30',
                    active
                      ? 'border-primary/40 bg-primary-light font-bold text-primary'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100',
                  )}
                >
                  {key === 'all' ? 'All' : SEVERITY_LABEL[key]}
                  <span className="tabular-nums text-gray-400">{count}</span>
                </button>
              )
            })}
          </div>

          {partialScan ? (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11.5px] leading-relaxed text-amber-800">
              <ShieldAlert className="mt-px h-4 w-4 shrink-0" aria-hidden />
              <span>
                More layers match the current filters than are loaded. These checks cover the {scannedCount} on this
                page — raise the rows per page, or narrow the filters, to cover the rest.
              </span>
            </p>
          ) : null}

          <ul className="space-y-2">
            {shown.map((exception) => (
              <li key={exception.key} className="rounded-xl border border-gray-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={SEVERITY_TONE[exception.severity]} size="xs" dot>
                        {SEVERITY_LABEL[exception.severity]}
                      </Badge>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        {exception.category}
                      </span>
                    </div>
                    <p className="mt-1 text-[12.5px] font-semibold text-gray-900">{exception.headline}</p>
                  </div>
                  <Button variant="secondary" size="xs" onClick={() => onOpenLayer(exception.layerId)}>
                    Open layer
                  </Button>
                </div>

                <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-600">{exception.detail}</p>

                <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                  <div>
                    <dt className="text-[10.5px] font-medium uppercase tracking-wide text-gray-500">Impact</dt>
                    <dd className="text-[11.5px] leading-relaxed text-gray-700">{exception.impact}</dd>
                  </div>
                  <div>
                    <dt className="text-[10.5px] font-medium uppercase tracking-wide text-gray-500">
                      Recommended review
                    </dt>
                    <dd className="text-[11.5px] leading-relaxed text-gray-700">{exception.action}</dd>
                  </div>
                </dl>

                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 pt-2 text-[10.5px] text-gray-500">
                  <span>Layer #{exception.layerId}</span>
                  {exception.warehouse ? <span>{exception.warehouse}</span> : null}
                  {exception.at ? <span>{formatDate(exception.at)}</span> : null}
                  {exception.documentId ? (
                    <Link
                      to={`/documents/${exception.documentId}`}
                      className="font-semibold text-primary no-underline hover:underline"
                    >
                      {exception.documentNo ?? `#${exception.documentId}`}
                    </Link>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>

          <p className="border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-500">
            Nothing on this panel changes a valuation. Each exception is closed by posting the document it names or by
            running a recalculation — both recorded against the person who ran them.
          </p>
        </div>
      )}
    </Drawer>
  )
}

export default ValuationExceptionsDrawer
