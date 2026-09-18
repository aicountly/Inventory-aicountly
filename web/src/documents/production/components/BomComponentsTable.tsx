import { AlertTriangle, ArrowDownToLine, CircleCheck, CircleHelp, Layers, MapPin, ScanLine, TriangleAlert, Warehouse } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { FormOptionWarehouse } from '../../../services/items'
import { Badge } from '../../../ui/Badge'
import type { BadgeTone } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Input } from '../../../ui/Input'
import { Select } from '../../../ui/Select'
import { Skeleton } from '../../../ui/Skeleton'
import { Tooltip } from '../../../ui/Tooltip'
import { cx } from '../../../ui/cx'
import { formatMoney, formatQty } from '../../../utils/format'
import type { LineDraft } from '../../formModel'
import type { ComponentRow, StockStatus } from '../productionModel'

const STATUS_META: Record<StockStatus, { label: string; tone: BadgeTone; icon: LucideIcon; hint: string }> = {
  in_stock: { label: 'In stock', tone: 'success', icon: CircleCheck, hint: 'Available in the selected warehouse covers this line with room to spare.' },
  tight: { label: 'Low stock', tone: 'warning', icon: TriangleAlert, hint: 'This line is covered, but what is left will not cover another finished unit.' },
  insufficient: { label: 'Insufficient', tone: 'danger', icon: AlertTriangle, hint: 'Available in the selected warehouse is less than this line needs.' },
  no_warehouse: { label: 'Warehouse required', tone: 'warning', icon: Warehouse, hint: 'Nothing can be issued until the line names a warehouse.' },
  unknown: { label: 'Not checked', tone: 'neutral', icon: CircleHelp, hint: 'Stock availability has not been read for this line.' },
  receipt: { label: 'Received in', tone: 'info', icon: ArrowDownToLine, hint: 'A by-product this run yields — it comes into stock rather than out of it.' },
}

export interface BomComponentsTableProps {
  rows: ComponentRow[]
  warehouses: FormOptionWarehouse[]
  warehouseName: (id: number | null) => string
  currency: string
  costHidden: boolean
  loading: boolean
  disabled: boolean
  /** Lines the user has re-typed the quantity on, so the BOM figure is no longer what posts. */
  editedKeys: ReadonlySet<string>
  /** Lines a negative-stock block named, highlighted until the next attempt. */
  offendingKeys: ReadonlySet<string>
  /** Briefly tinted after a re-explosion, so a changed quantity is noticed. */
  flashKeys: ReadonlySet<string>
  onPatchLine: (key: string, patch: Partial<LineDraft>) => void
  onOpenBatch: (key: string) => void
  onOpenSerials: (key: string) => void
  onOpenAlternates: (key: string) => void
  empty: ReactNode
}

function unitSymbol(line: LineDraft): string {
  const unit = line.units.find((u) => u.unit_id === line.unit_id)
  return unit?.unit_symbol ?? unit?.unit_name ?? ''
}

const TH = 'whitespace-nowrap border-y border-gray-200 bg-gray-50 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500'
const TD = 'border-b border-gray-100 px-3 py-2 align-middle text-gray-700'

/**
 * The exploded bill of materials, line by line, with what the warehouse actually holds beside
 * what the run needs.
 *
 * Quantities stay editable — the same contract the previous editor had, because a run rarely
 * consumes exactly what the BOM says — and an edited line is tagged so nobody mistakes it for the
 * BOM's own figure. Status is never colour alone: every badge carries a word and an icon.
 */
export function BomComponentsTable({
  rows,
  warehouses,
  warehouseName,
  currency,
  costHidden,
  loading,
  disabled,
  editedKeys,
  offendingKeys,
  flashKeys,
  onPatchLine,
  onOpenBatch,
  onOpenSerials,
  onOpenAlternates,
  empty,
}: BomComponentsTableProps) {
  if (rows.length === 0) return <>{empty}</>

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[68rem] border-collapse text-xs">
        <thead>
          <tr>
            <th scope="col" className={cx(TH, 'w-10')}>#</th>
            <th scope="col" className={TH}>Component item</th>
            <th scope="col" className={TH}>Batch / serial</th>
            <th scope="col" className={TH}>Warehouse</th>
            <th scope="col" className={cx(TH, 'text-right')}>Required qty</th>
            <th scope="col" className={TH}>Unit</th>
            <th scope="col" className={cx(TH, 'text-right')}>Available</th>
            <th scope="col" className={cx(TH, 'text-right')}>Unit cost</th>
            <th scope="col" className={cx(TH, 'text-right')}>Total cost</th>
            <th scope="col" className={TH}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = STATUS_META[row.status]
            const StatusIcon = status.icon
            const symbol = unitSymbol(row.line)
            const offending = offendingKeys.has(row.key)
            return (
              <tr
                key={row.key}
                className={cx(
                  'transition-colors duration-200',
                  offending ? 'bg-red-50' : flashKeys.has(row.key) ? 'bg-primary-light/50' : 'hover:bg-gray-50/70',
                )}
              >
                <td className={cx(TD, 'text-gray-400 tabular-nums')}>{row.index}</td>

                <td className={cx(TD, 'min-w-[14rem]')}>
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-gray-900" title={row.line.item_name}>
                      {row.line.item_name || `Item #${row.line.item_id ?? '?'}`}
                    </span>
                    {row.kind === 'by_product' ? <Badge size="xs" tone="info">By-product</Badge> : null}
                    {editedKeys.has(row.key) ? (
                      <Tooltip label="Quantity changed by hand — no longer the BOM's scaled figure.">
                        <Badge size="xs" tone="warning">Edited</Badge>
                      </Tooltip>
                    ) : null}
                  </div>
                  {row.line.item_sku ? <div className="truncate text-[11px] text-gray-500">{row.line.item_sku}</div> : null}
                </td>

                <td className={cx(TD, 'min-w-[9rem]')}>
                  <div className="flex flex-wrap items-center gap-1">
                    {row.line.track_batch ? (
                      <Button
                        variant={row.line.batch_id === null ? 'secondary' : 'ghost'}
                        size="xs"
                        icon={Layers}
                        disabled={disabled || !row.line.item_id}
                        onClick={() => onOpenBatch(row.key)}
                        className={row.line.batch_id === null ? 'border-amber-300 text-amber-700' : 'text-gray-700'}
                      >
                        {row.line.batch_no ?? 'Allocate batch'}
                      </Button>
                    ) : null}
                    {row.line.track_serial ? (
                      <Button
                        variant={row.serialMismatch ? 'danger' : row.line.serials.length === 0 ? 'secondary' : 'ghost'}
                        size="xs"
                        icon={ScanLine}
                        disabled={disabled || !row.line.item_id}
                        onClick={() => onOpenSerials(row.key)}
                      >
                        {`${row.line.serials.length} / ${formatQty(row.requiredBase, '0')}`}
                      </Button>
                    ) : null}
                    {!row.line.track_batch && !row.line.track_serial ? <span className="text-gray-400">—</span> : null}
                  </div>
                </td>

                <td className={cx(TD, 'min-w-[10rem]')}>
                  <Select
                    aria-label={`Warehouse for ${row.line.item_name || 'component'}`}
                    value={row.warehouseId ?? ''}
                    disabled={disabled}
                    invalid={row.status === 'no_warehouse'}
                    onChange={(e) =>
                      onPatchLine(row.key, {
                        warehouse_id: e.target.value === '' ? null : Number(e.target.value),
                        batch_id: null,
                        batch_no: null,
                        serials: [],
                      })
                    }
                  >
                    <option value="">Select warehouse…</option>
                    {row.warehouseId !== null && !warehouses.some((w) => w.warehouse_id === row.warehouseId) ? (
                      <option value={row.warehouseId}>{warehouseName(row.warehouseId)}</option>
                    ) : null}
                    {warehouses.map((w) => (
                      <option key={w.warehouse_id} value={w.warehouse_id}>
                        {w.warehouse_name}
                        {w.warehouse_code ? ` (${w.warehouse_code})` : ''}
                      </option>
                    ))}
                  </Select>
                </td>

                <td className={cx(TD, 'w-28')}>
                  <Input
                    aria-label={`Required quantity for ${row.line.item_name || 'component'}`}
                    inputMode="decimal"
                    value={row.line.qty}
                    disabled={disabled}
                    className="text-right tabular-nums"
                    onChange={(e) => onPatchLine(row.key, { qty: e.target.value })}
                  />
                </td>

                <td className={cx(TD, 'whitespace-nowrap text-gray-500')}>{symbol || '—'}</td>

                <td className={cx(TD, 'text-right tabular-nums')}>
                  {loading && row.availableHere === null ? (
                    <Skeleton className="ml-auto h-3 w-12" rounded="md" />
                  ) : row.availableHere === null ? (
                    <span className="text-gray-400">—</span>
                  ) : (
                    <span className={row.status === 'insufficient' ? 'font-semibold text-red-600' : 'text-gray-700'}>
                      {formatQty(row.availableHere)}
                    </span>
                  )}
                </td>

                <td className={cx(TD, 'text-right tabular-nums')}>
                  {costHidden ? (
                    <span className="text-gray-400">Hidden</span>
                  ) : row.unitCost === null ? (
                    loading ? <Skeleton className="ml-auto h-3 w-12" rounded="md" /> : <span className="text-gray-400">—</span>
                  ) : (
                    formatMoney(row.unitCost)
                  )}
                </td>

                <td className={cx(TD, 'text-right font-medium tabular-nums text-gray-900')}>
                  {row.totalCost === null ? <span className="text-gray-400">—</span> : `${currency} ${formatMoney(row.totalCost)}`}
                </td>

                <td className={cx(TD, 'min-w-[11rem]')}>
                  <div className="flex flex-col items-start gap-1">
                    <Tooltip label={status.hint}>
                      <Badge tone={status.tone} size="xs">
                        <StatusIcon className="h-3 w-3" aria-hidden />
                        {status.label}
                      </Badge>
                    </Tooltip>
                    {row.status === 'insufficient' ? (
                      <span className="text-[11px] text-red-600">Short by {formatQty(row.shortBy)}</span>
                    ) : null}
                    {row.alternates.length > 0 && (row.status === 'insufficient' || row.status === 'tight') ? (
                      <button
                        type="button"
                        onClick={() => onOpenAlternates(row.key)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      >
                        <MapPin className="h-3 w-3" aria-hidden />
                        Available in {row.alternates.length} other warehouse{row.alternates.length === 1 ? '' : 's'}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default BomComponentsTable
