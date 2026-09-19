import { Link } from 'react-router-dom'
import { AlertTriangle, ExternalLink, ShieldCheck, Sparkles } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import type { BadgeTone } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { EmptyState } from '../../../ui/EmptyState'
import { SkeletonRows } from '../../../ui/Skeleton'
import { formatDate } from '../../../utils/format'
import type { InsightSeverity, ValuationException, ValuationInsight } from '../costLayerModel'

const SEVERITY_TONE: Record<InsightSeverity, BadgeTone> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
}

const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  critical: 'Critical',
  warning: 'Review',
  info: 'Information',
}

export interface ValuationExceptionDrawerProps {
  open: boolean
  onClose: () => void
  exceptions: ValuationException[]
  insights: ValuationInsight[]
  loading: boolean
  itemName: string | null
  /** The rail read a bounded window of layers rather than all of them. */
  capped: boolean
  analysisCount: number
  analysisTotal: number
}

/**
 * Everything on this item a valuation reviewer should look at before signing
 * off, and why.
 *
 * It reports and it links. Nothing here resolves anything: a negative layer is
 * cleared by posting the receipt that was missing, a zero-cost receipt by
 * correcting the receipt — and both are then carried through by a
 * recalculation the reviewer asks for. A screen that "fixed" a valuation
 * exception would be deciding what a cost should have been, which is not a
 * decision software gets to make.
 */
export function ValuationExceptionDrawer({
  open,
  onClose,
  exceptions,
  insights,
  loading,
  itemName,
  capped,
  analysisCount,
  analysisTotal,
}: ValuationExceptionDrawerProps) {
  const critical = exceptions.filter((e) => e.severity === 'critical').length

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title="Valuation review"
      badge={
        exceptions.length > 0 ? (
          <Badge tone={critical > 0 ? 'danger' : 'warning'} size="xs" className="normal-case">
            {exceptions.length} to review
          </Badge>
        ) : null
      }
      description={
        itemName
          ? `Exceptions and readings for ${itemName}, from the layers, recalculations and revisions on record.`
          : 'Pick an item to review its valuation.'
      }
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {loading ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="space-y-4">
          <section>
            <h3 className="text-[12px] font-semibold text-gray-900">Exceptions</h3>
            {exceptions.length === 0 ? (
              <EmptyState
                size="sm"
                icon={ShieldCheck}
                title="Nothing to review"
                description="No negative balance, zero-cost receipt, failed recalculation or unacknowledged revision on this item."
              />
            ) : (
              <ul className="mt-2 space-y-2">
                {exceptions.map((e) => (
                  <li
                    key={e.key}
                    className="rounded-xl border border-gray-200 px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={SEVERITY_TONE[e.severity]} size="xs" dot className="normal-case">
                        {SEVERITY_LABEL[e.severity]}
                      </Badge>
                      <span className="text-[12.5px] font-semibold text-gray-900">{e.category}</span>
                      {e.at ? (
                        <span className="text-[10.5px] text-gray-400">{formatDate(e.at)}</span>
                      ) : null}
                    </div>
                    <dl className="mt-1.5 space-y-1 text-[11.5px] leading-relaxed">
                      <div className="flex gap-1.5">
                        <dt className="shrink-0 font-semibold text-gray-500">What</dt>
                        <dd className="text-gray-700">{e.reason}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="shrink-0 font-semibold text-gray-500">Impact</dt>
                        <dd className="text-gray-700">{e.impact}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="shrink-0 font-semibold text-gray-500">Do</dt>
                        <dd className="text-gray-700">{e.action}</dd>
                      </div>
                    </dl>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[10.5px] text-gray-500">
                      <span>{e.subject}</span>
                      {e.warehouse ? <span>· {e.warehouse}</span> : null}
                      {e.document ? <span>· {e.document}</span> : null}
                      {e.to ? (
                        <Link
                          to={e.to}
                          onClick={onClose}
                          className="inline-flex items-center gap-0.5 font-semibold text-primary no-underline hover:underline"
                        >
                          Open
                          <ExternalLink className="h-3 w-3" aria-hidden />
                        </Link>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border-t border-gray-100 pt-3.5">
            <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-900">
              <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
              Readings of this item&rsquo;s layers
            </h3>
            <p className="mt-0.5 text-[10.5px] text-gray-500">
              Arithmetic over the layers in the grid. Advisory — each names the figures it was
              computed from so you can check it against the table.
            </p>
            {insights.length === 0 ? (
              <p className="mt-2 text-[11.5px] text-gray-500">
                Nothing unusual: costs are consistent, no balance is negative and nothing has been
                sitting untouched.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {insights.map((i) => (
                  <li key={i.key} className="rounded-xl bg-gray-50 px-3 py-2.5">
                    <p className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-gray-900">
                      <Badge tone={SEVERITY_TONE[i.severity]} size="xs" dot className="normal-case">
                        {SEVERITY_LABEL[i.severity]}
                      </Badge>
                      {i.title}
                    </p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">{i.detail}</p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
                      <span className="font-semibold text-gray-700">Suggested:</span> {i.action}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {capped ? (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[10.5px] leading-relaxed text-amber-800">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              This review covers the most recent {analysisCount} of {analysisTotal} layers. Narrow
              by warehouse or financial year to review the rest.
            </p>
          ) : null}

          <p className="text-[10px] leading-relaxed text-gray-400">
            Nothing on this panel changes a valuation. Every correction is made in the document
            that caused it and carried through by a recalculation you ask for.
          </p>
        </div>
      )}
    </Drawer>
  )
}

export default ValuationExceptionDrawer
