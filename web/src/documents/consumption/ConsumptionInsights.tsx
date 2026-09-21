import { AlertTriangle, Boxes, Layers, Warehouse } from 'lucide-react'
import { FormSectionCard } from '../../ui/shell/FormSectionCard'
import { StatCard } from '../../ui/StatCard'
import { EmptyState } from '../../ui/EmptyState'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { formatQty } from '../../utils/format'
import { draftTotals, isBlankLine } from '../formModel'
import type { LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'

interface ConsumptionInsightsProps {
  spec: DocumentTypeSpec
  lines: LineDraft[]
  availability: Record<string, AvailabilityCheckResult>
  warehouseName: (id: number | null | undefined) => string
}

interface ImpactRow {
  key: string
  itemName: string
  unit: string
  before: number
  consume: number
  after: number
  negative: boolean
  short: boolean
}

/** "Stock Impact Preview" + "Consumption Summary" — both read only real API-returned figures. */
export function ConsumptionInsights({ spec, lines, availability, warehouseName }: ConsumptionInsightsProps) {
  const active = lines.filter((l) => !isBlankLine(l))
  const totals = draftTotals(lines, spec)
  const warehouseCount = new Set(active.map((l) => l.warehouse_id).filter((id): id is number => id !== null)).size

  const impact: ImpactRow[] = active
    .filter((l) => l.item_id !== null)
    .map((l) => {
      const r = availability[l.key]
      if (!r) return null
      const unit = l.units.find((u) => u.unit_id === l.unit_id)?.unit_symbol ?? ''
      const after = r.on_hand - r.requested
      return { key: l.key, itemName: l.item_name || `Item #${l.item_id}`, unit: unit ?? '', before: r.on_hand, consume: r.requested, after, negative: after < 0, short: !r.ok }
    })
    .filter((r): r is ImpactRow => r !== null)

  const negativeCount = impact.filter((r) => r.negative).length
  const shortCount = impact.filter((r) => r.short).length

  return (
    <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1fr)_minmax(19rem,26rem)]">
      <FormSectionCard title="Stock Impact Preview" description="Preview the impact on stock levels" icon={Layers}>
        {impact.length === 0 ? (
          <EmptyState size="sm" icon={Layers} title="No impact to preview yet" description="Add an item and quantity to see how it changes stock on hand." />
        ) : (
          <div className="divide-y divide-gray-100">
            {impact.map((r) => (
              <div key={r.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-gray-700">{r.itemName}</span>
                <span className="flex shrink-0 items-center gap-1.5 font-medium tabular-nums text-gray-900">
                  {formatQty(r.before)}
                  <span className={r.negative ? 'font-semibold text-red-600' : 'text-red-500'}>−{formatQty(r.consume)}</span>
                  <span className={r.negative ? 'font-semibold text-red-600' : ''}>= {formatQty(r.after)}</span>
                  <span className="text-gray-400">{r.unit}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {negativeCount > 0 || shortCount > 0 ? (
          <div className="mt-3 space-y-1.5">
            {shortCount > 0 ? (
              <div className="flex items-center gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Insufficient stock on {shortCount} line{shortCount === 1 ? '' : 's'}
              </div>
            ) : null}
            {negativeCount > 0 ? (
              <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Negative stock risk on {negativeCount} line{negativeCount === 1 ? '' : 's'} after posting
              </div>
            ) : null}
          </div>
        ) : null}
      </FormSectionCard>

      <FormSectionCard title="Consumption Summary" bodyClassName="grid grid-cols-1 gap-2.5 sm:grid-cols-3 xl:grid-cols-1">
        <StatCard label="Items" value={totals.lines} icon={Boxes} tone="primary" layout="metric" />
        <StatCard label="Total Quantity" value={formatQty(totals.qtyOut)} icon={Layers} tone="info" layout="metric" />
        <StatCard label="Warehouse" value={warehouseCount || '—'} icon={Warehouse} tone="slate" layout="metric" hint={warehouseCount === 1 ? warehouseName(active.find((l) => l.warehouse_id !== null)?.warehouse_id) : undefined} />
      </FormSectionCard>
    </div>
  )
}

export default ConsumptionInsights
