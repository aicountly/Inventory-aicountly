import { useState } from 'react'
import { Coins, Lightbulb, MessageSquareText, Sparkles, Target, TriangleAlert, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { classifyReason, computePostingReminder, computeRiskChecks } from './lineFormInsights'
import type { CostConfidence, InsightTone } from './lineFormInsights'
import { isBlankLine } from './formModel'
import type { HeaderDraft, LineDraft } from './formModel'
import type { DocumentTypeSpec } from './registry'
import { Badge } from '../ui/Badge'
import type { BadgeTone } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { IconTile } from '../ui/IconTile'
import { AIC, cx } from '../ui/cx'
import { formatMoney, toNumber } from '../utils/format'

const TONE_BADGE: Record<InsightTone, BadgeTone> = { neutral: 'neutral', success: 'success', info: 'info', warning: 'warning' }

const COST_SOURCE_LABEL: Record<string, string> = {
  AS_PER_MASTER: 'Standard Cost',
  FIFO: 'Last Purchase Cost',
  LIFO: 'Last Purchase Cost',
  WAC: 'Weighted Average',
}

interface InsightRowProps {
  icon: LucideIcon
  title: string
  message: ReactNode
  badge?: { label: string; tone: BadgeTone }
  action?: ReactNode
  extra?: ReactNode
}

function InsightRow({ icon: Icon, title, message, badge, action, extra }: InsightRowProps) {
  return (
    <div className={cx(AIC, 'flex items-start gap-3 px-4 py-3.5 border-b border-gray-100 last:border-b-0')}>
      <IconTile icon={Icon} tone="violet" size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-semibold text-gray-900">{title}</p>
          {badge ? (
            <Badge tone={badge.tone} size="xs" className="shrink-0">
              {badge.label}
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{message}</p>
        {extra}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  )
}

export interface InventoryAssistantPanelProps {
  spec: DocumentTypeSpec
  header: HeaderDraft
  lines: LineDraft[]
  costConfidence: CostConfidence
  referenceCosts: ReadonlyMap<number, number>
  referenceMethods: ReadonlyMap<number, string>
  negativeLineKeys?: ReadonlySet<string>
  /** Fills rate (and amount) on every line whose item has a usable reference cost but no rate yet. */
  onApplyReferenceCost: () => void
  disabled?: boolean
  className?: string
}

/**
 * The right-hand assistant panel for a "lines"-form document. Every section is computed from the
 * draft already in DocumentForm plus a live valuation lookup — see lineFormInsights.ts — so it
 * reflects what is actually on the form, not a canned demo message.
 */
export function InventoryAssistantPanel({
  spec,
  header,
  lines,
  costConfidence,
  referenceCosts,
  referenceMethods,
  negativeLineKeys,
  onApplyReferenceCost,
  disabled,
  className,
}: InventoryAssistantPanelProps) {
  const [tipDismissed, setTipDismissed] = useState(false)

  const activeLines = lines.filter((l) => !isBlankLine(l))
  const hasLines = activeLines.length > 0

  const classification = classifyReason(spec, header)
  const reminder = computePostingReminder(header, hasLines)
  const risks = computeRiskChecks(spec, header, lines, { referenceCosts, negativeLineKeys })

  // ---- valuation suggestion -------------------------------------------------------------
  const withItem = activeLines.filter((l): l is LineDraft & { item_id: number } => l.item_id !== null)
  const missingRate = spec.rate ? withItem.filter((l) => (toNumber(l.rate) ?? 0) <= 0) : []
  const suggestable = missingRate.filter((l) => (referenceCosts.get(l.item_id) ?? 0) > 0)
  const suggestedMethod = suggestable.length > 0 ? referenceMethods.get(suggestable[0].item_id) : undefined
  const sourceLabel = suggestedMethod ? (COST_SOURCE_LABEL[suggestedMethod] ?? 'Reference Cost') : 'Reference Cost'

  let valuationMessage: ReactNode
  let valuationAction: ReactNode = null
  if (!spec.valuation) {
    valuationMessage = 'This document type does not carry a valuation.'
  } else if (!hasLines || withItem.length === 0) {
    valuationMessage = 'Add an item to see a valuation suggestion.'
  } else if (!spec.rate) {
    valuationMessage = "Priced automatically by each item's valuation method (FIFO / LIFO / weighted average) when posted."
  } else if (suggestable.length > 0) {
    valuationMessage =
      suggestable.length === 1
        ? `Use the ${sourceLabel.toLowerCase()} (₹ ${formatMoney(referenceCosts.get(suggestable[0].item_id))}) for ${suggestable[0].item_name || 'this item'}.`
        : `${suggestable.length} line${suggestable.length === 1 ? '' : 's'} have a ${sourceLabel.toLowerCase()} available but no rate entered yet.`
    valuationAction = (
      <Button size="xs" variant="outline" icon={Coins} onClick={onApplyReferenceCost} disabled={disabled}>
        Use {sourceLabel}
      </Button>
    )
  } else if (missingRate.length > 0) {
    valuationMessage = 'No reference cost available yet for these items — enter a manual rate.'
  } else {
    valuationMessage = 'Entered rates look consistent with the reference cost.'
  }

  // ---- risk check -------------------------------------------------------------------------
  const warningCount = risks.filter((r) => r.tone === 'warning').length
  const topRisk = risks.find((r) => r.tone === 'warning') ?? risks[0]
  const riskBadge: { label: string; tone: BadgeTone } = !hasLines
    ? { label: 'Waiting', tone: 'neutral' }
    : risks.length === 0
      ? { label: 'Low Risk', tone: 'success' }
      : { label: `${risks.length} to review`, tone: warningCount > 0 ? 'warning' : 'info' }
  const riskMessage = !hasLines ? 'Add items to run a risk check.' : risks.length === 0 ? 'No issues found. Looks good!' : topRisk.message
  const riskExtra =
    risks.length > 1 ? (
      <ul className="mt-1.5 space-y-1">
        {risks.slice(0, 4).map((r) => (
          <li key={r.id} className={cx('text-[11px] leading-snug', r.tone === 'warning' ? 'text-amber-700' : 'text-gray-500')}>
            • {r.message}
          </li>
        ))}
        {risks.length > 4 ? <li className="text-[11px] text-gray-400">+{risks.length - 4} more</li> : null}
      </ul>
    ) : null

  return (
    <Card padding="none" className={cx('overflow-hidden', className)}>
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100 bg-violet-50">
        <IconTile icon={Sparkles} tone="violet" size="md" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold text-gray-900">AI Inventory Assistant</h2>
            <Badge tone="beta" size="xs">
              BETA
            </Badge>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">Get intelligent suggestions for accurate posting.</p>
        </div>
      </div>

      <InsightRow icon={Target} title="Reason Classification" message={classification.hint} badge={{ label: classification.label, tone: TONE_BADGE[classification.tone] }} />
      <InsightRow icon={Coins} title="Valuation Suggestion" message={valuationMessage} action={valuationAction} />
      <InsightRow icon={TriangleAlert} title="Risk Check" message={riskMessage} badge={riskBadge} extra={riskExtra} />
      <InsightRow icon={MessageSquareText} title="Posting Reminder" message={reminder.message} badge={{ label: reminder.badge, tone: TONE_BADGE[reminder.tone] }} />
      {costConfidence.level === 'low' || costConfidence.level === 'medium' ? (
        <p className="px-4 pb-3 -mt-2 text-[11px] text-gray-400">Cost confidence: {costConfidence.label.toLowerCase()} — {costConfidence.hint}</p>
      ) : null}

      {!tipDismissed ? (
        <div className="m-3 flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 text-[11px] leading-relaxed text-violet-700">
          <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
          <span className="flex-1">Tip: You can also scan barcodes or import items to save time.</span>
          <button type="button" className="shrink-0 rounded p-0.5 text-violet-400 transition-colors hover:bg-white/60 hover:text-gray-600" aria-label="Dismiss tip" onClick={() => setTipDismissed(true)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : null}
    </Card>
  )
}

export default InventoryAssistantPanel
