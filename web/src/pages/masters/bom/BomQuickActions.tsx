import { useState } from 'react'
import {
  ArrowRight,
  FileBarChart,
  GitCompare,
  IndianRupee,
  LayoutTemplate,
  Lightbulb,
  PlayCircle,
  Plus,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '../../../ui/Card'
import { AIC, cx } from '../../../ui/cx'

/**
 * The contextual column beside the table.
 *
 * A utility panel, not a second navigation: everything in it acts on the screen
 * you are already on. On a wide desktop it sits in a rail to the right; below
 * `wide` the page drops it under the table as a row of cards, so the table gets
 * the full width where width is scarce.
 */

const TIP_KEY = 'inventory.bom.proTip.dismissed'

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(TIP_KEY) === '1'
  } catch {
    // Private mode or blocked storage. The tip simply shows again next visit.
    return false
  }
}

function writeDismissed(): void {
  try {
    window.sessionStorage.setItem(TIP_KEY, '1')
  } catch {
    /* Nothing to do: it still stays shut for this page view. */
  }
}

interface QuickAction {
  key: string
  icon: LucideIcon
  title: string
  subtitle: string
  onSelect: () => void
  hidden?: boolean
}

export interface BomQuickActionsProps {
  onNew: () => void
  onImport: () => void
  onTemplates: () => void
  onCostEstimation: () => void
  onCompare: () => void
  onReport: () => void
  onTryAi: () => void
  onPlayVideo: () => void
  canWrite: boolean
  canImport: boolean
  canViewCost: boolean
  className?: string
}

export function BomQuickActions({
  onNew,
  onImport,
  onTemplates,
  onCostEstimation,
  onCompare,
  onReport,
  onTryAi,
  onPlayVideo,
  canWrite,
  canImport,
  canViewCost,
  className,
}: BomQuickActionsProps) {
  const [tipDismissed, setTipDismissed] = useState(readDismissed)

  const actions: QuickAction[] = [
    { key: 'new', icon: Plus, title: 'New BOM', subtitle: 'Create from scratch', onSelect: onNew, hidden: !canWrite },
    { key: 'import', icon: Upload, title: 'Import BOM', subtitle: 'From Excel/CSV', onSelect: onImport, hidden: !canImport },
    { key: 'templates', icon: LayoutTemplate, title: 'BOM templates', subtitle: 'Use pre-defined', onSelect: onTemplates, hidden: !canWrite },
    { key: 'cost', icon: IndianRupee, title: 'Cost estimation', subtitle: 'Estimate material cost', onSelect: onCostEstimation, hidden: !canViewCost },
    { key: 'compare', icon: GitCompare, title: 'Compare BOMs', subtitle: 'Two bills side by side', onSelect: onCompare },
    { key: 'report', icon: FileBarChart, title: 'BOM report', subtitle: 'Analysis & export', onSelect: onReport },
  ].filter((a) => !a.hidden)

  return (
    <aside
      className={cx(
        AIC,
        // Stacked in the rail; a row across the foot of the page below `wide`.
        'grid content-start gap-2.5 sm:grid-cols-2 wide:grid-cols-1',
        className,
      )}
      aria-label="Bill of materials tools"
    >
      <Card padding="sm" as="section">
        <h2 className="mb-2.5 text-[12px] font-bold text-gray-900">Quick actions</h2>
        <div className="grid grid-cols-2 gap-1.5">
          {actions.map(({ key, icon: Icon, title, subtitle, onSelect }) => (
            <button
              key={key}
              type="button"
              onClick={onSelect}
              className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-1.5 rounded-lg border border-transparent p-2 text-left transition-colors hover:border-gray-200 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <span
                className="row-span-2 grid h-7 w-7 place-items-center rounded-lg bg-primary-light text-primary"
                aria-hidden
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="truncate text-[10.5px] font-semibold text-gray-900">{title}</span>
              <span className="truncate text-[9px] leading-tight text-gray-400">{subtitle}</span>
            </button>
          ))}
        </div>
      </Card>

      {!tipDismissed ? (
        <Card padding="sm" as="section" className="border-violet-200 bg-violet-50">
          <div className="flex items-start gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-violet-600" aria-hidden>
              <Lightbulb className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[12px] font-bold text-gray-900">Pro tip</h3>
              <p className="mt-1 text-[10.5px] leading-relaxed text-gray-600">
                Use AI to create a bill of materials from an existing item or an uploaded
                drawing. It will suggest components and quantities for you to review.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onTryAi}
                  className="inline-flex items-center gap-1 text-[10.5px] font-bold text-violet-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                >
                  Try AI now
                  <ArrowRight className="h-3 w-3" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    writeDismissed()
                    setTipDismissed(true)
                  }}
                  className="text-[10.5px] font-medium text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      <Card padding="sm" as="section" className="border-amber-200 bg-amber-50">
        <div className="flex items-start gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-amber-700" aria-hidden>
            <PlayCircle className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[12px] font-bold text-gray-900">Need help?</h3>
            <p className="mt-1 text-[10.5px] leading-relaxed text-gray-600">
              Watch a quick walkthrough of bills of materials.
            </p>
            {/* No walkthrough has been recorded yet, so this says so rather than
                linking somewhere that is not it. */}
            <button
              type="button"
              onClick={onPlayVideo}
              className="mt-2 inline-flex items-center gap-1 text-[10.5px] font-bold text-amber-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              Play video (2 min)
              <ArrowRight className="h-3 w-3" aria-hidden />
            </button>
          </div>
        </div>
      </Card>
    </aside>
  )
}

export default BomQuickActions
