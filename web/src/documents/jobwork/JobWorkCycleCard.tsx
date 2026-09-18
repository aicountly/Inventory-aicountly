import { Repeat } from 'lucide-react'
import { Card } from '../../ui/Card'
import { cx } from '../../ui/cx'
import type { DocumentStatus } from '../types'

export type CycleStage = 'outward' | 'processing' | 'inward' | 'reconciliation'

interface Step {
  id: CycleStage
  title: string
  description: string
}

const STEPS: Step[] = [
  { id: 'outward', title: 'Job Work Outward', description: 'Send material to the job worker' },
  { id: 'processing', title: 'Process at job worker', description: 'Track the pending quantity' },
  { id: 'inward', title: 'Job Work Inward', description: 'Receive the finished goods' },
  { id: 'reconciliation', title: 'Reconciliation', description: 'Compare sent, consumed and returned' },
]

/**
 * Where this document sits in the job-work cycle.
 *
 * The stage is read from the document's own status and its open pending quantity, not
 * decoration: a draft has not left the building, a posted dispatch is genuinely waiting at the
 * job worker, and a document whose pending rows are all settled is through the inward step.
 */
export function stageFor(status: DocumentStatus | null, openPendingQty: number | null): CycleStage {
  if (status === null || status === 'DRAFT' || status === 'PENDING_APPROVAL' || status === 'APPROVED' || status === 'FAILED') {
    return 'outward'
  }
  if (status === 'COMPLETED') return 'reconciliation'
  if (status === 'PARTIALLY_FULFILLED') return 'inward'
  // POSTED with nothing left open means the inward side has already settled it.
  if (openPendingQty !== null && openPendingQty <= 0) return 'inward'
  return 'processing'
}

interface JobWorkCycleCardProps {
  stage: CycleStage
  /** Only shown once it is a fact — a posted document with open pending quantity. */
  openPendingQty?: number | null
}

export function JobWorkCycleCard({ stage }: JobWorkCycleCardProps) {
  const currentIndex = STEPS.findIndex((s) => s.id === stage)

  return (
    <Card padding="md">
      <div className="mb-3 flex items-start gap-3 rounded-xl bg-violet-50 p-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100">
          <Repeat className="h-4 w-4 text-violet-700" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-gray-900">Track job work cycle</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
            Material goes out, finished goods come back. Stay in control.
          </p>
        </div>
      </div>

      <ol className="relative">
        {STEPS.map((step, i) => {
          const done = i < currentIndex
          const current = i === currentIndex
          return (
            <li key={step.id} className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2.5 pb-4 last:pb-0">
              {i < STEPS.length - 1 ? (
                <span
                  aria-hidden
                  className={cx(
                    'absolute left-[0.8125rem] top-7 bottom-0 w-px',
                    done ? 'bg-primary/40' : 'bg-gray-200',
                  )}
                />
              ) : null}
              <span
                className={cx(
                  'z-[1] flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-bold',
                  current
                    ? 'border-sky-600 bg-sky-600 text-white'
                    : done
                      ? 'border-primary/30 bg-primary-light text-primary'
                      : 'border-gray-200 bg-gray-100 text-gray-500',
                )}
              >
                {i + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <div className="flex items-center justify-between gap-2">
                  <strong className={cx('text-[11px] font-semibold', current ? 'text-gray-900' : 'text-gray-700')}>
                    {step.title}
                  </strong>
                  {current ? (
                    <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold text-sky-700">
                      Current
                    </span>
                  ) : done ? (
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-primary">Done</span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">{step.description}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}

export default JobWorkCycleCard
