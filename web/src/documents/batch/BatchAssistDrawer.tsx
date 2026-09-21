import { CircleAlert, Lightbulb, Sparkles, TriangleAlert, Wand2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { EmptyState } from '../../ui/EmptyState'
import { cx } from '../../ui/cx'
import type { AssistItem, AssistReport, AssistSeverity } from './batchAssist'

const SECTIONS: { severity: AssistSeverity; title: string; icon: LucideIcon; iconClass: string; empty: string }[] = [
  { severity: 'critical', title: 'Critical issues', icon: CircleAlert, iconClass: 'text-red-600', empty: 'Nothing blocking a post.' },
  { severity: 'warning', title: 'Warnings', icon: TriangleAlert, iconClass: 'text-amber-600', empty: 'No warnings on this document.' },
  { severity: 'suggestion', title: 'Suggestions', icon: Lightbulb, iconClass: 'text-sky-600', empty: 'Nothing further to suggest.' },
]

export interface BatchAssistDrawerProps {
  open: boolean
  report: AssistReport
  onClose: () => void
  /** Scroll to and highlight the line an item names. */
  onFocus: (item: AssistItem) => void
  /** Create the in line that receives what an unmatched out line releases. Omitted when the
      document can no longer be edited, which also takes the offer off the suggestion. */
  onPair?: (lineKey: string) => void
}

/**
 * The full Batch Assist read-out.
 *
 * The rules are named plainly at the foot: this is the draft measured against a checklist, in this
 * browser, not a model's opinion. Presenting it as anything else would make every line it prints
 * less trustworthy, not more.
 */
export function BatchAssistDrawer({ open, report, onClose, onFocus, onPair }: BatchAssistDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="md"
      title="Batch Assist"
      badge={
        <Badge tone="beta" size="xs">
          Beta
        </Badge>
      }
      description={report.headline}
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] leading-snug text-gray-500">
            Deterministic checks against the draft on screen. The server re-validates everything on post.
          </p>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {report.items.length === 0 ? (
        <EmptyState icon={Sparkles} size="sm" title="Nothing to flag" description="Add a line and Batch Assist will check it as you type." />
      ) : (
        <div className="space-y-4">
          {SECTIONS.map((section) => {
            const items = report.items.filter((i) => i.severity === section.severity)
            const Icon = section.icon
            return (
              <section key={section.severity}>
                <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <Icon className={cx('h-3.5 w-3.5', section.iconClass)} aria-hidden />
                  {section.title}
                  <span className="rounded-full bg-gray-100 px-1.5 text-[10px] tabular-nums text-gray-600">{items.length}</span>
                </h3>
                {items.length === 0 ? (
                  <p className="px-1 text-[11px] text-gray-400">{section.empty}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {items.map((item) => (
                      <li key={item.id} className="rounded-lg border border-gray-200 px-3 py-2">
                        <p className="text-xs leading-snug text-gray-800">{item.title}</p>
                        {item.detail ? <p className="mt-0.5 text-[11px] leading-snug text-gray-500">{item.detail}</p> : null}
                        {item.action || item.lineKey ? (
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            {item.action?.kind === 'pair' && onPair ? (
                              <Button size="xs" variant="outline" icon={Wand2} onClick={() => onPair((item.action as { kind: 'pair'; lineKey: string }).lineKey)}>
                                Create matching in line
                              </Button>
                            ) : null}
                            {item.lineKey ? (
                              <Button size="xs" variant="ghost" onClick={() => onFocus(item)}>
                                Go to line
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </Drawer>
  )
}

export default BatchAssistDrawer
