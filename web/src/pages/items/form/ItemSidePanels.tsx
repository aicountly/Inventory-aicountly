import { AlertTriangle, Box, Check, CircleDashed, Info, Lightbulb, ListChecks, Minus } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { ProgressBar } from '../../../ui/ProgressBar'
import { AIC, cx } from '../../../ui/cx'
import { formatMoney } from '../../../utils/format'
import type { ItemFormState } from '../itemForm'
import { SidePanel } from './FormControls'
import type { Completeness, GroupState, Insight, StepId } from './itemIntelligence'

// ---------------------------------------------------------------------------
// Completeness
// ---------------------------------------------------------------------------

const GROUP_ICON: Record<GroupState, typeof Check> = {
  complete: Check,
  partial: Minus,
  todo: CircleDashed,
  error: AlertTriangle,
}

const GROUP_CLS: Record<GroupState, string> = {
  complete: 'bg-primary-light text-primary',
  partial: 'bg-amber-50 text-amber-700',
  todo: 'bg-gray-100 text-gray-400',
  error: 'bg-red-50 text-red-600',
}

const GROUP_WORD: Record<GroupState, string> = {
  complete: 'complete',
  partial: 'partly filled',
  todo: 'not started',
  error: 'has errors',
}

export interface ItemCompletenessCardProps {
  completeness: Completeness
  onSelectStep: (id: StepId) => void
}

/** How much of the item is described, and which part is thinnest. */
export function ItemCompletenessCard({ completeness, onSelectStep }: ItemCompletenessCardProps) {
  return (
    <SidePanel title="Item setup" icon={ListChecks}>
      <div className="mt-3 flex items-end justify-between">
        <strong className="text-2xl font-bold leading-none text-primary">{completeness.percent}%</strong>
        <span className="text-[10px] uppercase tracking-wide text-gray-400">complete</span>
      </div>
      <ProgressBar value={completeness.percent} size="sm" className="mt-2" aria-label="Item setup completeness" />
      <ul className={cx(AIC, 'mt-3 flex list-none flex-col gap-1 p-0')}>
        {completeness.groups.map((group) => {
          const Icon = GROUP_ICON[group.state]
          return (
            <li key={group.id}>
              <button
                type="button"
                onClick={() => onSelectStep(group.id)}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-[11px] text-gray-600 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <span className={cx('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full', GROUP_CLS[group.state])} aria-hidden>
                  <Icon className="h-2.5 w-2.5" />
                </span>
                <span className="truncate">{group.label}</span>
                <span className="sr-only">— {GROUP_WORD[group.state]}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </SidePanel>
  )
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

const INSIGHT_ICON = { good: Check, warning: AlertTriangle, info: Info } as const
const INSIGHT_CLS = {
  good: 'bg-primary-light text-primary',
  warning: 'bg-amber-50 text-amber-700',
  info: 'bg-sky-50 text-sky-700',
} as const
const INSIGHT_WORD = { good: 'Looks right', warning: 'Check this', info: 'Note' } as const

export interface InventoryIntelligencePanelProps {
  insights: Insight[]
  onSelectStep: (id: StepId) => void
}

export function InventoryIntelligencePanel({ insights, onSelectStep }: InventoryIntelligencePanelProps) {
  return (
    <SidePanel
      title="Recommendations"
      icon={Lightbulb}
      accent
      badge={<Badge tone="beta">Beta</Badge>}
      subtitle="Derived from this draft — nothing here is a claim about other businesses."
    >
      {insights.length === 0 ? (
        <p className="mt-3 text-[11px] leading-relaxed text-gray-500">Nothing to flag yet. Start with the item name and its base unit.</p>
      ) : (
        <ul className={cx(AIC, 'mt-3 flex list-none flex-col gap-2 p-0')}>
          {insights.map((insight) => {
            const Icon = INSIGHT_ICON[insight.tone]
            const body = (
              <>
                <span className={cx('mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full', INSIGHT_CLS[insight.tone])} aria-hidden>
                  <Icon className="h-2.5 w-2.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="sr-only">{INSIGHT_WORD[insight.tone]}: </span>
                  {insight.text}
                </span>
              </>
            )
            return (
              <li key={insight.id} className="text-[11px] leading-relaxed text-gray-600">
                {insight.step ? (
                  <button
                    type="button"
                    onClick={() => onSelectStep(insight.step as StepId)}
                    className="flex w-full items-start gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    {body}
                  </button>
                ) : (
                  <span className="flex items-start gap-2 px-1 py-0.5">{body}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </SidePanel>
  )
}

// ---------------------------------------------------------------------------
// Live preview
// ---------------------------------------------------------------------------

export interface ItemPreviewCardProps {
  form: ItemFormState
  baseUnitLabel: string | null
  groupLabel: string | null
  categoryLabel: string | null
  currencyCode: string | null
}

function PreviewCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[9px] uppercase tracking-wide text-gray-400">{label}</span>
      <strong className="mt-0.5 block truncate text-[11px] font-semibold text-gray-900">{value}</strong>
    </div>
  )
}

/** What the item will look like in every picker, updated as the form is filled. */
export function ItemPreviewCard({ form, baseUnitLabel, groupLabel, categoryLabel, currencyCode }: ItemPreviewCardProps) {
  const name = form.item_name.trim() || 'Untitled item'
  const secondary = [form.item_alias.trim(), form.print_name.trim()].find((v) => v !== '') ?? '—'
  const money = form.mrp.trim() === '' ? '—' : `${currencyCode ? `${currencyCode} ` : ''}${formatMoney(form.mrp)}`
  return (
    <SidePanel title="Preview" icon={Box}>
      <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary" aria-hidden>
            <Box className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <strong className={cx('block truncate text-xs font-semibold', form.item_name.trim() ? 'text-gray-900' : 'text-gray-400')}>{name}</strong>
            <span className="mt-0.5 block truncate text-[10px] text-gray-500">{secondary}</span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <PreviewCell label="SKU" value={form.item_sku.trim() || '—'} />
          <PreviewCell label="Base unit" value={baseUnitLabel ?? '—'} />
          <PreviewCell label="Group" value={groupLabel ?? '—'} />
          <PreviewCell label="Category" value={categoryLabel ?? '—'} />
          <PreviewCell label="Valuation" value={form.valuation_method || '—'} />
          <PreviewCell label="MRP" value={money} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge tone={form.is_active ? 'success' : 'neutral'} dot>
            {form.is_active ? 'Active' : 'Inactive'}
          </Badge>
          {form.track_batch ? <Badge tone="info">Batch</Badge> : null}
          {form.track_serial ? <Badge tone="info">Serial</Badge> : null}
          {form.track_expiry ? <Badge tone="info">Expiry</Badge> : null}
        </div>
      </div>
    </SidePanel>
  )
}
