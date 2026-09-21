import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock,
  Copy,
  Info,
  Loader2,
  ScanBarcode,
  Sparkles,
  Workflow,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { cx } from '../../ui/cx'
import { formatCurrency, formatQty } from '../../utils/format'
import type { Insight, InsightTone } from './insights'
import type { StockImpactGroup, ValueSummary } from './model'

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------

export interface QuickAction {
  key: string
  label: string
  icon: LucideIcon
  onSelect: () => void
  disabled?: boolean
  title?: string
}

export function QuickActionsCard({ actions }: { actions: readonly QuickAction[] }) {
  return (
    <Card padding="md">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">Quick actions</h3>
      <div className="grid grid-cols-4 gap-2">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={action.onSelect}
            disabled={action.disabled}
            title={action.title}
            className="flex flex-col items-center gap-1.5 rounded-lg p-1 text-[10px] font-medium text-gray-600 transition-colors hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary-light text-primary">
              <action.icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-center leading-tight">{action.label}</span>
          </button>
        ))}
      </div>
    </Card>
  )
}

export const QUICK_ACTION_ICONS = { bom: Workflow, scan: ScanBarcode, recent: Clock, copy: Copy }

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

const TONE: Record<InsightTone, { icon: LucideIcon; cls: string; label: string }> = {
  ok: { icon: CheckCircle2, cls: 'text-emerald-600', label: 'Checked' },
  warn: { icon: AlertTriangle, cls: 'text-amber-600', label: 'Attention' },
  risk: { icon: AlertTriangle, cls: 'text-red-600', label: 'Blocking' },
  info: { icon: Info, cls: 'text-sky-600', label: 'Information' },
  pending: { icon: Loader2, cls: 'text-gray-400', label: 'Pending' },
}

export interface AiInsightsCardProps {
  insights: readonly Insight[]
  assistantAvailable: boolean
  assistantReason: string
  canAutoFill: boolean
  autoFillHint: string
  onAutoFill: () => void
  onOpenAssistant: () => void
}

export function AiInsightsCard({ insights, assistantAvailable, canAutoFill, autoFillHint, onAutoFill, onOpenAssistant }: AiInsightsCardProps) {
  return (
    <Card padding="md">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold text-gray-900">Aicountly insights</h3>
        <Badge tone="beta" size="xs">
          Beta
        </Badge>
      </div>
      <ul className="space-y-2">
        {insights.map((insight) => {
          const tone = TONE[insight.tone]
          const Icon = tone.icon
          return (
            <li key={insight.id} className="flex items-start gap-2 text-[12px] leading-snug text-gray-700">
              <Icon className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', tone.cls, insight.tone === 'pending' && 'animate-spin')} aria-hidden />
              <span>
                <span className="sr-only">{tone.label}: </span>
                {insight.text}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="mt-3 rounded-lg border border-primary/20 bg-primary-light/60 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-gray-900">Save time</p>
            <p className="mt-0.5 text-[11px] text-gray-600">{autoFillHint}</p>
          </div>
          <Button size="xs" onClick={onAutoFill} disabled={!canAutoFill}>
            Try now
          </Button>
        </div>
        {!assistantAvailable ? (
          <button type="button" onClick={onOpenAssistant} className="mt-2 text-[11px] font-medium text-primary underline-offset-2 hover:underline">
            Why is the AI assistant unavailable?
          </button>
        ) : null}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Stock impact
// ---------------------------------------------------------------------------

export function StockImpactCard({ groups, posted }: { groups: readonly StockImpactGroup[]; posted: boolean }) {
  const out = groups.filter((g) => g.direction === 'out')
  const incoming = groups.filter((g) => g.direction === 'in')
  return (
    <Card padding="md">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">
        Stock impact <span className="font-normal text-gray-500">(live)</span>
      </h3>
      {groups.length === 0 ? (
        <p className="text-[12px] text-gray-500">Nothing moves yet. Enter a quantity to see the effect.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          <ImpactRows label="Finished product" rows={out} direction="out" />
          <ImpactRows label="Components" rows={incoming} direction="in" />
        </div>
      )}
      <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-sky-50 px-2.5 py-2 text-[11px] text-sky-800">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        {posted ? 'This document has posted; the figures above are what it moved.' : 'Stock is updated when the document posts. A draft moves nothing.'}
      </p>
    </Card>
  )
}

function ImpactRows({ label, rows, direction }: { label: string; rows: readonly StockImpactGroup[]; direction: 'in' | 'out' }) {
  const Icon = direction === 'out' ? ArrowDown : ArrowUp
  const cls = direction === 'out' ? 'text-red-600' : 'text-emerald-600'
  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-between gap-2 py-2 text-[12px]">
        <span className="text-gray-600">{label}</span>
        <span className="text-gray-400">—</span>
      </div>
    )
  }
  return (
    <div className="py-2">
      {rows.map((row, i) => (
        <div key={`${row.unit}-${i}`} className="flex items-center justify-between gap-2 py-0.5 text-[12px]">
          <span className="min-w-0 truncate text-gray-600">
            {i === 0 ? label : ''}
            {rows.length > 1 ? <span className="ml-1 text-gray-400">{row.unit || 'no unit'}</span> : null}
          </span>
          <span className={cx('flex shrink-0 items-center gap-1 font-semibold tabular-nums', cls)}>
            <Icon className="h-3 w-3" aria-hidden />
            {direction === 'out' ? '−' : '+'}
            {formatQty(row.qty)} {row.unit}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Value summary
// ---------------------------------------------------------------------------

export interface ValueSummaryCardProps {
  summary: ValueSummary
  currencyCode: string | null
  method: string | null
  loading: boolean
  /** Set when the valuation read was refused or failed. */
  error: string | null
}

export function ValueSummaryCard({ summary, currencyCode, method, loading, error }: ValueSummaryCardProps) {
  const currency = currencyCode ?? undefined
  return (
    <Card padding="md">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          Value summary <span className="font-normal text-gray-500">(estimated)</span>
        </h3>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" aria-hidden /> : null}
      </div>
      {error ? (
        <p className="text-[12px] text-gray-500">
          This document cannot be priced here: {error}. The posting engine still values it.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          <ValueRow label="Recovered component value" value={formatCurrency(summary.componentsValue, currency)} strong />
          <ValueRow label="Average unit cost" value={summary.averageUnitCost === null ? '—' : formatCurrency(summary.averageUnitCost, currency)} />
          <ValueRow label="Finished product value" value={summary.parentValue === null ? 'Not costed yet' : formatCurrency(summary.parentValue, currency)} />
          <ValueRow
            label="Variance"
            value={summary.variance === null ? '—' : formatCurrency(summary.variance, currency)}
            tone={summary.variance === null ? undefined : summary.variance < 0 ? 'down' : summary.variance > 0 ? 'up' : undefined}
          />
        </div>
      )}
      <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-sky-50 px-2.5 py-2 text-[11px] text-sky-800">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        Indicative, based on current inventory cost{method ? ` (${method})` : ''}. The posting engine computes the figures that are recorded.
      </p>
    </Card>
  )
}

function ValueRow({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'up' | 'down' }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2 text-[12px]">
      <span className="min-w-0 truncate text-gray-600">{label}</span>
      <span
        className={cx(
          'shrink-0 tabular-nums',
          strong ? 'text-sm font-bold text-gray-900' : 'font-semibold text-gray-800',
          tone === 'down' && 'text-red-600',
          tone === 'up' && 'text-emerald-600',
        )}
      >
        {tone === 'down' ? <ArrowDown className="mr-0.5 inline h-3 w-3" aria-hidden /> : null}
        {tone === 'up' ? <ArrowUp className="mr-0.5 inline h-3 w-3" aria-hidden /> : null}
        {value}
      </span>
    </div>
  )
}
