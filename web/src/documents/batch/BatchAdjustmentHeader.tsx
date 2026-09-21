import { ArrowRight, Sparkles, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { PageHeader } from '../../ui/shell/PageHeader'
import { AIC, cx } from '../../ui/cx'
import type { AssistReport } from './batchAssist'

export interface BatchAssistStripProps {
  report: AssistReport
  onOpen: () => void
  onDismiss: () => void
  className?: string
}

/**
 * The assist strip.
 *
 * Deliberately called "Batch Assist" and not "AI": every line it shows is a rule in
 * `batchAssist.ts` running in this browser against the draft on screen. When a server-side
 * assistant exists the strip reads from it instead — the props do not change.
 */
export function BatchAssistStrip({ report, onOpen, onDismiss, className }: BatchAssistStripProps) {
  const problems = report.critical + report.warnings
  return (
    <div
      className={cx(
        AIC,
        'flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 min-w-0 w-full sm:w-auto sm:min-w-[20rem] sm:max-w-lg',
        className,
      )}
    >
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <Sparkles className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-gray-900">Batch Assist</span>
          <Badge tone="beta" size="xs">
            Beta
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-gray-600" aria-live="polite">
          {report.headline}
        </p>
      </div>
      <Button variant="link" size="xs" iconRight={ArrowRight} onClick={onOpen} className="shrink-0 whitespace-nowrap">
        {problems > 0 ? 'Review' : 'Suggestions'}
      </Button>
      <Button variant="ghost" size="xs" icon={X} onClick={onDismiss} aria-label="Hide Batch Assist" className="shrink-0" />
    </div>
  )
}

export interface BatchAdjustmentHeaderProps {
  title: string
  description: string
  badge?: ReactNode
  assist?: ReactNode
  actions?: ReactNode
  icon: Parameters<typeof PageHeader>[0]['icon']
}

/** Title card of the workspace: what the document is, and what Batch Assist makes of it. */
export function BatchAdjustmentHeader({ title, description, badge, assist, actions, icon }: BatchAdjustmentHeaderProps) {
  return (
    <Card padding="md">
      <PageHeader
        icon={icon}
        title={title}
        description={description}
        badge={badge}
        actions={
          assist || actions ? (
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              {actions}
              {assist}
            </div>
          ) : null
        }
      />
    </Card>
  )
}

export default BatchAdjustmentHeader
