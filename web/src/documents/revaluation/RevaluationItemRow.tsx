import { memo } from 'react'
import { Copy, Layers, MoveRight, Package, ScanLine, Trash2, TrendingDown, TrendingUp } from 'lucide-react'
import { Skeleton, Tooltip } from '../../ui'
import { METHOD_LABELS } from '../../services/valuationApi'
import type { FormOptionWarehouse } from '../../services/items'
import { formatQty } from '../../utils/format'
import { isEnterableCost } from './revaluationFormat'
import type { MoneyFormat } from './revaluationFormat'
import { impactDirection, lineImpact } from './revaluationModel'
import type { RevaluationLine, StockContext, ValuationScope } from './revaluationModel'

export interface RevaluationItemRowProps {
  line: RevaluationLine
  /** 1-based position in the document, not in the filtered view. */
  position: number
  context: StockContext | null
  scope: ValuationScope
  money: MoneyFormat
  warehouses: readonly FormOptionWarehouse[]
  disabled?: boolean
  invalid?: boolean
  /** Highlighted by an assistant finding or a rate that was just applied. */
  flagged?: boolean
  /**
   * Whether a second line for this item could ever be valid.
   *
   * It can only be under per-warehouse valuation, where the copy re-prices another warehouse's
   * layers. Company-wide, both lines would re-price the same layers and the second would simply
   * overwrite the first — so the action is not offered at all rather than offered and refused.
   */
  canDuplicate?: boolean
  onPatch: (key: string, patch: Partial<RevaluationLine>) => void
  onDuplicate: (key: string) => void
  onRemove: (key: string) => void
}

const CELL = 'px-2.5 py-1.5 border-b border-gray-100 align-middle'
const INPUT =
  'aic block h-8 w-full rounded-lg border bg-white px-2 text-xs text-gray-900 transition-colors placeholder:text-gray-400 focus:outline-none focus:ring-2 disabled:bg-gray-50 disabled:text-gray-500'
const INPUT_OK = 'border-gray-200 focus:border-primary focus:ring-primary/30'
const INPUT_BAD = 'border-red-300 focus:border-red-500 focus:ring-red-300/40'

/**
 * One editable line.
 *
 * Memoised on its own props: a keystroke in one row's New cost box must not re-render the other
 * forty. Only the quantity-bearing cells are read-only, and deliberately so — a revaluation may
 * change a cost and nothing else.
 */
export const RevaluationItemRow = memo(function RevaluationItemRow({
  line,
  position,
  context,
  scope,
  money,
  warehouses,
  disabled,
  invalid,
  flagged,
  canDuplicate = true,
  onPatch,
  onDuplicate,
  onRemove,
}: RevaluationItemRowProps) {
  const loading = context?.loading ?? context === null
  const currentCost = context?.currentUnitCost ?? null
  const onHand = context?.onHandQty ?? null
  const impact = lineImpact(line.newUnitCost, currentCost, onHand)
  const direction = impactDirection(impact)
  const changed = line.newUnitCost.trim() !== '' && currentCost !== null && impact !== null && impact !== 0
  const zeroStock = onHand !== null && onHand <= 0
  const unit = line.unitSymbol ?? ''

  return (
    <tr
      className={[
        'transition-colors',
        invalid ? 'bg-red-50/60' : flagged ? 'bg-violet-50' : 'hover:bg-primary-light/20',
      ].join(' ')}
      aria-invalid={invalid || undefined}
    >
      <td className={`${CELL} text-[11px] tabular-nums text-gray-400`}>{position}</td>

      <td className={CELL}>
        <div className="flex min-w-[13rem] items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
            <Package className="h-4 w-4 text-gray-400" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-gray-900" title={line.itemName}>
              {line.itemName || `Item #${line.itemId}`}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-gray-500">
              {[line.itemSku ? `SKU: ${line.itemSku}` : null, line.hsnSac ? `HSN: ${line.hsnSac}` : null].filter(Boolean).join('  |  ') || '—'}
            </p>
          </div>
        </div>
      </td>

      <td className={CELL}>
        <select
          className={`${INPUT} ${INPUT_OK} min-w-[8.5rem] pr-1`}
          value={line.warehouseId ?? ''}
          disabled={disabled}
          aria-label={`Warehouse for ${line.itemName}`}
          onChange={(e) => onPatch(line.key, { warehouseId: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">Select warehouse…</option>
          {line.warehouseId !== null && !warehouses.some((w) => w.warehouse_id === line.warehouseId) ? (
            <option value={line.warehouseId}>Warehouse #{line.warehouseId}</option>
          ) : null}
          {warehouses.map((w) => (
            <option key={w.warehouse_id} value={w.warehouse_id}>
              {w.warehouse_name}
            </option>
          ))}
        </select>
      </td>

      <td className={CELL}>
        <BatchSerialCell trackBatch={line.trackBatch} trackSerial={line.trackSerial} scope={scope} />
      </td>

      <td className={`${CELL} text-right`}>
        {loading ? (
          <Skeleton height="h-4" className="ml-auto w-20" />
        ) : currentCost === null ? (
          <Tooltip label={context?.error ?? 'The current cost is not available to you. Posting still re-prices from the live cost layers.'}>
            <span className="cursor-help text-xs text-gray-400">—</span>
          </Tooltip>
        ) : (
          <Tooltip
            label={`${context?.method ? `${METHOD_LABELS[context.method as keyof typeof METHOD_LABELS] ?? context.method} · ` : ''}stock value ${money.amount((onHand ?? 0) * currentCost)} over ${formatQty(onHand)} ${unit}${
              scope === 'warehouse' ? ' in this warehouse' : ' across all warehouses'
            }`}
          >
            <span className="cursor-help text-xs font-medium tabular-nums text-gray-900">{money.amount(currentCost)}</span>
          </Tooltip>
        )}
      </td>

      <td className={CELL}>
        <input
          className={`${INPUT} ${invalid ? INPUT_BAD : changed ? 'border-primary/50 bg-primary-light/40 focus:border-primary focus:ring-primary/30' : INPUT_OK} min-w-[6.5rem] text-right font-semibold tabular-nums`}
          inputMode="decimal"
          value={line.newUnitCost}
          disabled={disabled}
          placeholder={currentCost === null ? '0.00' : money.amount(currentCost).replace(money.symbol, '')}
          aria-label={`New unit cost for ${line.itemName}`}
          data-revaluation-cost="true"
          onChange={(e) => {
            if (isEnterableCost(e.target.value)) onPatch(line.key, { newUnitCost: e.target.value })
          }}
          onFocus={(e) => e.currentTarget.select()}
        />
      </td>

      <td className={`${CELL} text-right`}>
        {loading ? (
          <Skeleton height="h-4" className="ml-auto w-12" />
        ) : onHand === null ? (
          <span className="text-xs text-gray-400">—</span>
        ) : (
          <>
            <span className={`block text-xs font-semibold tabular-nums ${zeroStock ? 'text-amber-700' : 'text-gray-900'}`}>{formatQty(onHand)}</span>
            <span className="block text-[9px] text-gray-400">{zeroStock ? 'no stock' : unit || 'base'}</span>
          </>
        )}
      </td>

      <td className={`${CELL} text-right`}>
        <ImpactCell impact={impact} direction={direction} money={money} loading={loading} />
      </td>

      <td className={CELL}>
        <input
          className={`${INPUT} ${INPUT_OK} min-w-[9rem]`}
          value={line.remarks}
          disabled={disabled}
          maxLength={255}
          placeholder="Reason / remarks"
          aria-label={`Remarks for ${line.itemName}`}
          onChange={(e) => onPatch(line.key, { remarks: e.target.value })}
        />
      </td>

      <td className={`${CELL} text-right`}>
        <div className="flex items-center justify-end gap-0.5">
          {canDuplicate ? (
            <Tooltip label="Copy this line for another warehouse">
              <button
                type="button"
                className="aic inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                disabled={disabled}
                aria-label={`Duplicate line ${position}, ${line.itemName}`}
                onClick={() => onDuplicate(line.key)}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip label="Remove this line">
            <button
              type="button"
              className="aic inline-flex h-7 w-7 items-center justify-center rounded-md text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
              disabled={disabled}
              aria-label={`Remove line ${position}, ${line.itemName}`}
              onClick={() => onRemove(line.key)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </Tooltip>
        </div>
      </td>
    </tr>
  )
})

/**
 * A revaluation does not narrow by batch or serial — `applyRevaluation` re-prices every open layer
 * of the item in the valuation scope — so this column reports the item's tracking and says what the
 * document will cover. Offering a picker here would imply a choice the posting engine does not make.
 */
function BatchSerialCell({ trackBatch, trackSerial, scope }: { trackBatch: boolean; trackSerial: boolean; scope: ValuationScope }) {
  if (!trackBatch && !trackSerial) return <span className="text-xs text-gray-300">—</span>
  const label = trackBatch && trackSerial ? 'Batch + serial' : trackBatch ? 'Batch-tracked' : 'Serial-tracked'
  return (
    <Tooltip label={`Every open cost layer of this item ${scope === 'warehouse' ? 'in this warehouse' : 'across all warehouses'} is re-priced. A revaluation does not pick a batch or a serial, and it moves none of them.`}>
      <span className="inline-flex cursor-help items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
        {trackBatch ? <Layers className="h-3 w-3" aria-hidden /> : <ScanLine className="h-3 w-3" aria-hidden />}
        {label}
        <MoveRight className="h-3 w-3 opacity-70" aria-hidden />
        <span className="font-bold">all</span>
      </span>
    </Tooltip>
  )
}

/** The sign is carried by an arrow and a `+`/`−` as well as by colour. */
function ImpactCell({ impact, direction, money, loading }: { impact: number | null; direction: ReturnType<typeof impactDirection>; money: MoneyFormat; loading: boolean }) {
  if (loading) return <Skeleton height="h-4" className="ml-auto w-20" />
  if (impact === null) {
    return (
      <Tooltip label="Enter a new cost — and let the current cost and quantity load — and the impact appears here.">
        <span className="cursor-help text-xs text-gray-300">—</span>
      </Tooltip>
    )
  }
  if (direction === 'none') {
    return (
      <span className="inline-flex items-center gap-1 text-xs tabular-nums text-gray-500">
        {money.amount(0)}
        <span className="text-[9px] uppercase tracking-wide text-gray-400">no change</span>
      </span>
    )
  }
  const up = direction === 'increase'
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold tabular-nums ${up ? 'text-emerald-600' : 'text-red-600'}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {money.signed(impact)}
    </span>
  )
}

export default RevaluationItemRow
