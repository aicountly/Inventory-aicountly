import type { ReactNode } from 'react'
import { Card } from '../../ui/Card'
import { formatQty, toNumber } from '../../utils/format'
import { isBlankLine } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { estimateVolumeM3, packageInfoOf } from './packingMetadata'

export interface PackingSummaryPanelProps {
  header: HeaderDraft
  lines: LineDraft[]
}

/**
 * Real-time KPIs computed straight from the draft — never hardcoded. Total qty is summed
 * directly rather than through `formModel.draftTotals`: that helper buckets by `direction`,
 * which a packing line never sets (packing is `lineMode: 'status_only'`), so it would always read
 * zero here even though every active line is, in effect, being packed out.
 */
export function PackingSummaryPanel({ header, lines }: PackingSummaryPanelProps) {
  const active = lines.filter((l) => !isBlankLine(l))
  const totalQty = active.reduce((sum, l) => sum + (toNumber(l.qty) ?? 0), 0)
  const pkg = packageInfoOf(header)
  const volumeM3 = estimateVolumeM3(pkg.dimensions_cm, pkg.boxes)

  return (
    <Card padding="md">
      <div className="mb-1 border-b border-gray-100 pb-3">
        <h3 className="text-sm font-semibold text-gray-900">Packing summary</h3>
        <p className="mt-0.5 text-xs text-gray-500">Real-time overview</p>
      </div>
      <div className="grid grid-cols-3 divide-x divide-gray-100 py-2 text-center">
        <SummaryKpi label="Items" value={active.length} />
        <SummaryKpi label="Total qty" value={formatQty(totalQty)} />
        <SummaryKpi label="Boxes" value={pkg.boxes ?? '—'} />
      </div>
      <div className="mt-2 grid grid-cols-2 divide-x divide-gray-100 rounded-lg border border-gray-100 bg-gray-50/60">
        <SummarySecondary label="Total weight" value={pkg.total_weight_kg ? `${formatQty(pkg.total_weight_kg)} kg` : '—'} />
        <SummarySecondary label="Total volume" value={volumeM3 !== null ? `${volumeM3.toFixed(3)} m³` : '—'} />
      </div>
    </Card>
  )
}

function SummaryKpi({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="px-1">
      <p className="text-xl font-bold tabular-nums text-primary">{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
    </div>
  )
}

function SummarySecondary({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="p-3">
      <p className="text-[9px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900">{value}</p>
    </div>
  )
}

export default PackingSummaryPanel
