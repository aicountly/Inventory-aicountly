import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '../../../ui/Badge'
import { cx } from '../../../ui/cx'
import { formatMoney, formatQty, toNumber } from '../../../utils/format'
import { lineBaseQty } from '../../formModel'
import type { LineDraft } from '../../formModel'
import { lineKind } from '../productionModel'

export interface ProductionLinesTableProps {
  lines: LineDraft[]
  warehouseName: (id: number | null) => string
  currency: string
  /** Inventory cost of a consumption line, keyed by draft line key; null when not readable. */
  costByKey: Map<string, number | null>
  costHidden: boolean
  fallbackWarehouseId: number | null
  empty: ReactNode
}

const TH = 'whitespace-nowrap border-y border-gray-200 bg-gray-50 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500'
const TD = 'border-b border-gray-100 px-3 py-2 align-middle text-gray-700'

const KIND_LABEL: Record<string, string> = { component: 'Component', by_product: 'By-product', finished: 'Finished goods', manual: 'Added by hand' }

/**
 * The physical stock movements this document will make when it posts: components and their
 * batches out, by-products and the finished goods in.
 *
 * Read-only by design. These rows are the consequence of the BOM explosion and the edits made on
 * the Bill of materials tab; a second editable grid over the same lines is how two figures for
 * one movement get entered.
 */
export function ProductionLinesTable({ lines, warehouseName, currency, costByKey, costHidden, fallbackWarehouseId, empty }: ProductionLinesTableProps) {
  if (lines.length === 0) return <>{empty}</>

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[60rem] border-collapse text-xs">
        <thead>
          <tr>
            <th scope="col" className={cx(TH, 'w-10')}>#</th>
            <th scope="col" className={TH}>Item</th>
            <th scope="col" className={TH}>Role</th>
            <th scope="col" className={TH}>Direction</th>
            <th scope="col" className={TH}>Warehouse</th>
            <th scope="col" className={TH}>Batch</th>
            <th scope="col" className={cx(TH, 'text-right')}>Serials</th>
            <th scope="col" className={cx(TH, 'text-right')}>Qty</th>
            <th scope="col" className={TH}>Unit</th>
            <th scope="col" className={cx(TH, 'text-right')}>Rate</th>
            <th scope="col" className={cx(TH, 'text-right')}>Value</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            const kind = lineKind(line)
            const inbound = line.direction === 'in'
            const unit = line.units.find((u) => u.unit_id === line.unit_id)
            const rate = toNumber(line.rate)
            const cost = costByKey.get(line.key) ?? null
            const value = inbound ? (rate !== null && rate > 0 ? rate * (toNumber(line.qty) ?? 0) : null) : cost
            return (
              <tr key={line.key} className="transition-colors hover:bg-gray-50/70">
                <td className={cx(TD, 'text-gray-400 tabular-nums')}>{i + 1}</td>
                <td className={cx(TD, 'min-w-[14rem]')}>
                  <span className="truncate font-medium text-gray-900">{line.item_name || `Item #${line.item_id ?? '?'}`}</span>
                  {line.item_sku ? <div className="truncate text-[11px] text-gray-500">{line.item_sku}</div> : null}
                </td>
                <td className={cx(TD, 'whitespace-nowrap text-gray-500')}>{KIND_LABEL[kind] ?? kind}</td>
                <td className={TD}>
                  <Badge tone={inbound ? 'success' : 'warning'} size="xs">
                    {inbound ? <ArrowDownToLine className="h-3 w-3" aria-hidden /> : <ArrowUpFromLine className="h-3 w-3" aria-hidden />}
                    {inbound ? 'In' : 'Out'}
                  </Badge>
                </td>
                <td className={cx(TD, 'whitespace-nowrap')}>{warehouseName(line.warehouse_id ?? fallbackWarehouseId) || '—'}</td>
                <td className={cx(TD, 'whitespace-nowrap')}>{line.batch_no ?? <span className="text-gray-400">—</span>}</td>
                <td className={cx(TD, 'text-right tabular-nums')}>{line.serials.length > 0 ? line.serials.length : <span className="text-gray-400">—</span>}</td>
                <td className={cx(TD, 'text-right font-medium tabular-nums text-gray-900')}>{formatQty(line.qty)}</td>
                <td className={cx(TD, 'whitespace-nowrap text-gray-500')}>
                  {unit?.unit_symbol ?? unit?.unit_name ?? '—'}
                  {unit && unit.conversion_factor !== 1 ? (
                    <span className="ml-1 text-[10px] text-gray-400">= {formatQty(lineBaseQty(line))} base</span>
                  ) : null}
                </td>
                <td className={cx(TD, 'text-right tabular-nums')}>
                  {inbound && rate !== null && rate > 0 ? formatMoney(rate) : <span className="text-gray-400">—</span>}
                </td>
                <td className={cx(TD, 'text-right tabular-nums')}>
                  {value === null ? (
                    <span className="text-gray-400" title={costHidden ? 'Cost is not visible to your profile.' : inbound ? 'Costed by the posting engine from the item’s own cost.' : 'Valued FIFO / LIFO / WAC when the document posts.'}>
                      —
                    </span>
                  ) : (
                    `${currency} ${formatMoney(value)}`
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] leading-relaxed text-gray-500">
        Consumption is valued by the posting engine under this company&rsquo;s valuation method; the figures above are the inventory cost as at the document date and are a preview, not the posted value.
      </p>
    </div>
  )
}

export default ProductionLinesTable
