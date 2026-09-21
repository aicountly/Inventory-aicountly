import { BadgeCheck, CircleAlert, CircleCheck, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Tooltip } from '../../ui/Tooltip'
import { cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import { checkSummary } from './batchAdjustmentModel'
import type { BatchAdjustmentMetrics, BatchIssue, ValidationCheck } from './batchAdjustmentModel'

function Row({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: string }) {
  const body = (
    <div className="flex min-h-[1.9rem] items-center justify-between gap-3 text-xs text-gray-600">
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 font-semibold tabular-nums text-gray-900">{value}</span>
    </div>
  )
  return hint ? <Tooltip label={hint}>{body}</Tooltip> : body
}

export interface BatchImpactSummaryProps {
  metrics: BatchAdjustmentMetrics
}

/**
 * What posting this document changes.
 *
 * "No impact" means no NET QUANTITY variance and nothing else — the phrase is kept off the value
 * line on purpose. The value line can be stated, though, because the server settles it and not
 * this screen: BATCH_ADJUSTMENT is declared `valuation => false` in Config\DocumentTypeRegistry
 * and `movesStockNow()` returns false for it, so posting writes no valuation and no cost layer.
 */
export function BatchImpactSummary({ metrics }: BatchImpactSummaryProps) {
  const blocked = metrics.errorCount > 0
  return (
    <Card padding="none">
      <header className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <h3 className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold text-gray-900">
          <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          Batch impact
        </h3>
        <Badge tone={blocked ? 'danger' : metrics.warningCount > 0 ? 'warning' : 'success'} size="xs" className="shrink-0">
          {blocked ? 'Issues' : metrics.warningCount > 0 ? 'Warnings' : 'Ready to validate'}
        </Badge>
      </header>
      <div className="px-4 py-2" aria-live="polite">
        <Row label="Total lines" value={metrics.totalLines} />
        <Row label="Total qty out" value={formatQty(metrics.totalQtyOut, '0')} />
        <Row label="Total qty in" value={formatQty(metrics.totalQtyIn, '0')} />
        <Row label="Affected batches" value={metrics.affectedBatches} />
        <Row label="Serial-tracked items" value={metrics.serialTrackedItems} />
        <div className="my-1.5 h-px bg-gray-100" />
        <div className="flex min-h-[1.9rem] items-center justify-between gap-2 text-xs text-gray-600">
          <span>Net quantity variance</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className={cx('font-semibold tabular-nums', metrics.variance === 0 ? 'text-gray-900' : 'text-amber-700')}>
              {metrics.variance > 0 ? '+' : ''}
              {formatQty(metrics.variance, '0')}
            </span>
            <Badge tone={metrics.variance === 0 ? 'success' : 'warning'} size="xs">
              {metrics.variance === 0 ? 'No impact' : 'Unbalanced'}
            </Badge>
          </span>
        </div>
        <Row
          label="Value impact"
          value={<span className="text-gray-500">Not valued</span>}
          hint="A batch adjustment is declared without valuation on the server, so posting moves no cost layer and writes no valuation amount."
        />
      </div>
    </Card>
  )
}

export interface BatchValidationChecksProps {
  checks: readonly ValidationCheck[]
  running: boolean
  onRun: () => void
  onFocusIssue: (issue: BatchIssue) => void
}

const STATUS_ICON = { passed: CircleCheck, warning: TriangleAlert, issue: CircleAlert } as const
const STATUS_ICON_CLASS = { passed: 'text-emerald-600', warning: 'text-amber-600', issue: 'text-red-600' } as const
const STATUS_TONE = { passed: 'success', warning: 'warning', issue: 'danger' } as const

/** The checklist. A row with something to say is a button that takes the reader to it. */
export function BatchValidationChecks({ checks, running, onRun, onFocusIssue }: BatchValidationChecksProps) {
  return (
    <Card padding="none">
      <header className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <h3 className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold text-gray-900">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          Validation checks
        </h3>
        <Button variant="secondary" size="xs" icon={RefreshCw} onClick={onRun} loading={running} className="shrink-0">
          Run
        </Button>
      </header>
      <ul className="px-2 py-1.5" aria-live="polite">
        {checks.map((check) => {
          const Icon = STATUS_ICON[check.status]
          const first = check.issues[0]
          const interactive = Boolean(first?.lineKey || first?.field)
          const content = (
            <>
              <span className="flex min-w-0 items-center gap-2">
                <Icon className={cx('h-3.5 w-3.5 shrink-0', STATUS_ICON_CLASS[check.status])} aria-hidden />
                <span className="truncate text-xs text-gray-600">{check.label}</span>
              </span>
              <Badge tone={STATUS_TONE[check.status]} size="xs" className="shrink-0">
                {checkSummary(check)}
              </Badge>
            </>
          )
          return (
            <li key={check.id}>
              {interactive ? (
                <button
                  type="button"
                  onClick={() => onFocusIssue(first)}
                  title={check.issues.map((i) => i.message).join('\n')}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-50"
                >
                  {content}
                </button>
              ) : (
                <div className="flex w-full items-center justify-between gap-2 px-2 py-1.5">{content}</div>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

export interface BatchAdjustmentSidebarProps extends BatchImpactSummaryProps, BatchValidationChecksProps {
  className?: string
}

/** The intelligence rail: what the document does, and what stands between it and a clean post. */
export function BatchAdjustmentSidebar({ metrics, checks, running, onRun, onFocusIssue, className }: BatchAdjustmentSidebarProps) {
  return (
    <aside className={cx('flex flex-col gap-3', className)} aria-label="Batch adjustment insights">
      <BatchImpactSummary metrics={metrics} />
      <BatchValidationChecks checks={checks} running={running} onRun={onRun} onFocusIssue={onFocusIssue} />
    </aside>
  )
}

export default BatchAdjustmentSidebar
