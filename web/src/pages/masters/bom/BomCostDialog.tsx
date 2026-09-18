import { CircleAlert, Info } from 'lucide-react'
import { useCompany } from '../../../company/CompanyContext'
import { useQuery } from '../../../hooks/useQuery'
import { Modal } from '../../../components/Modal'
import { Notice } from '../../../components/Notice'
import { Button } from '../../../ui/Button'
import { ErrorState } from '../../../ui/ErrorState'
import { LoadingState } from '../../../ui/LoadingState'
import { Tooltip } from '../../../ui/Tooltip'
import { bomApi } from '../../../services/masters'
import type { BomCost } from '../../../services/masters'
import { formatQty } from '../../../utils/format'
import { COST_SOURCE_LABEL, COST_UNAVAILABLE, exactCost } from './bomPresentation'

/**
 * What one bill costs in material, line by line.
 *
 * Every rate here comes from Inventory's own valuation state — the weighted
 * average the engine maintains, or the item's standard cost where it has never
 * moved — and each line says which. A component with neither shows a dash and
 * the word "No cost on record", never a zero: a production manager reading ₹0
 * against a component concludes it is free, and prices a job accordingly.
 *
 * The totals under the table are the same arithmetic the API did, echoed rather
 * than recomputed here, so the drawer and the KPI card cannot drift apart.
 */

function Box({ label, value, tone }: { label: string; value: string; tone?: 'muted' }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <small className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</small>
      <strong className={tone === 'muted' ? 'text-[13px] font-semibold text-gray-400' : 'text-[15px] font-bold text-gray-900'}>
        {value}
      </strong>
    </div>
  )
}

function CostTable({ cost }: { cost: BomCost }) {
  const components = cost.lines.filter((l) => (l.line_kind ?? 'component') === 'component')
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full border-collapse text-[11.5px]">
        <caption className="sr-only">Component costs for {cost.bom_name}</caption>
        <thead>
          <tr className="bg-gray-50 text-[9.5px] uppercase tracking-wide text-gray-500">
            <th scope="col" className="px-2.5 py-2 text-left font-bold">Component</th>
            <th scope="col" className="px-2.5 py-2 text-right font-bold">Qty</th>
            <th scope="col" className="px-2.5 py-2 text-right font-bold">Scrap %</th>
            <th scope="col" className="px-2.5 py-2 text-right font-bold">Gross qty</th>
            <th scope="col" className="px-2.5 py-2 text-right font-bold">Cost / unit</th>
            <th scope="col" className="px-2.5 py-2 text-right font-bold">Estimated cost</th>
          </tr>
        </thead>
        <tbody>
          {components.map((line, i) => (
            <tr key={line.bom_line_id ?? `${line.item_id}-${i}`} className="border-t border-gray-100">
              <td className="px-2.5 py-2">
                <span className="block font-semibold text-gray-900">{line.item_name ?? `#${line.item_id}`}</span>
                {line.item_sku ? <span className="block text-[10px] text-gray-400">{line.item_sku}</span> : null}
              </td>
              <td className="px-2.5 py-2 text-right tabular-nums">
                {formatQty(line.qty)}
                {line.unit_symbol ? ` ${line.unit_symbol}` : ''}
              </td>
              <td className="px-2.5 py-2 text-right tabular-nums text-gray-500">
                {line.scrap_percent ? `${formatQty(line.scrap_percent)}%` : '—'}
              </td>
              <td className="px-2.5 py-2 text-right tabular-nums">{formatQty(line.gross_qty)}</td>
              <td className="px-2.5 py-2 text-right tabular-nums">
                {line.cost_per_unit === null ? (
                  <span className="text-gray-400">—</span>
                ) : (
                  <Tooltip label={line.cost_source ? COST_SOURCE_LABEL[line.cost_source] : ''}>
                    <span>{exactCost(line.cost_per_unit, cost.currency)}</span>
                  </Tooltip>
                )}
              </td>
              <td className="px-2.5 py-2 text-right font-semibold tabular-nums">
                {line.estimated_cost === null ? (
                  <span className="text-[10px] font-medium text-amber-700">No cost on record</span>
                ) : (
                  exactCost(line.estimated_cost, cost.currency)
                )}
              </td>
            </tr>
          ))}
          {components.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-2.5 py-6 text-center text-gray-500">
                This bill has no component lines.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

export interface BomCostDialogProps {
  bomId: number | null
  bomName: string
  onClose: () => void
  /** Opens the editor so a missing rate can be dealt with. */
  onEdit?: () => void
}

export function BomCostDialog({ bomId, bomName, onClose, onEdit }: BomCostDialogProps) {
  const { scope } = useCompany()
  const query = useQuery<BomCost | null>(
    (signal) => (bomId ? bomApi.cost(bomId, signal) : Promise.resolve(null)),
    [bomId, scope?.cmp_id],
    { enabled: bomId !== null && !!scope, keepData: false, resetKey: scope?.cmp_id ?? null },
  )
  const cost = query.data

  return (
    <Modal
      open={bomId !== null}
      onClose={onClose}
      size="lg"
      title={`Cost breakdown — ${cost?.bom_name ?? bomName}`}
      description="Material cost of one yield, valued from Inventory's own cost data."
      footer={
        <>
          {onEdit ? (
            <Button variant="secondary" onClick={onEdit}>
              Edit bill
            </Button>
          ) : null}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {query.loading && !cost ? (
        <LoadingState variant="skeleton" rows={6} />
      ) : query.error ? (
        <ErrorState
          title="Could not load the cost breakdown"
          description={query.error.message}
          onRetry={query.reload}
        />
      ) : !cost ? null : (
        <div className="space-y-4">
          {!cost.cost_available ? (
            <Notice kind="warning" title={COST_UNAVAILABLE}>
              None of this bill's components has a weighted-average or standard cost on record yet.
              Receive stock or set a standard cost on the items and the estimate will appear here.
            </Notice>
          ) : !cost.cost_complete ? (
            <Notice kind="warning">
              {cost.unpriced_components} of {cost.priced_components + cost.unpriced_components}{' '}
              components could not be priced, so the total below is a floor, not the full cost.
            </Notice>
          ) : null}

          <CostTable cost={cost} />

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <Box label="Raw material" value={exactCost(cost.component_cost, cost.currency)} />
            <Box label="Scrap cost" value={exactCost(cost.wastage_cost, cost.currency)} />
            <Box
              label="Estimated BOM cost"
              value={cost.cost_available ? exactCost(cost.total_cost, cost.currency) : COST_UNAVAILABLE}
              tone={cost.cost_available ? undefined : 'muted'}
            />
            <Box
              label={`Cost per ${cost.yield_unit_symbol ?? 'unit'}`}
              value={cost.cost_available ? exactCost(cost.cost_per_unit, cost.currency) : COST_UNAVAILABLE}
              tone={cost.cost_available ? undefined : 'muted'}
            />
          </div>

          <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-gray-500">
            {cost.cost_complete ? (
              <Info className="mt-px h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
            ) : (
              <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
            )}
            <span>
              Costs are per yield of {formatQty(cost.yield_qty)}
              {cost.yield_unit_symbol ? ` ${cost.yield_unit_symbol}` : ''}. Rates are the item's
              weighted-average cost where stock has moved, and the standard cost otherwise. Labour and
              overhead are not included — this is material only.
            </span>
          </p>
        </div>
      )}
    </Modal>
  )
}

export default BomCostDialog
