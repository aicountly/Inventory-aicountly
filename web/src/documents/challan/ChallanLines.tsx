import { useState } from 'react'
import { Boxes, ChevronDown, Hash, Layers, Pencil, Plus, Trash2, Warehouse } from 'lucide-react'
import type { FormOptionWarehouse } from '../../services/items'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { shortBy } from '../../services/stockApi'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Tooltip } from '../../ui/Tooltip'
import { cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import type { LineDraft } from '../formModel'
import { isBlankLine, lineBaseQty } from '../formModel'
import type { LineBatchFact } from './insights'
import { ChallanBatchSelect, ChallanWarehouseSelect } from './fields'
import { SerialDrawer } from './SerialDrawer'

export interface ChallanLinesProps {
  lines: LineDraft[]
  onChange: (lines: LineDraft[]) => void
  warehouses: FormOptionWarehouse[]
  warehouseName: (id: number | null | undefined) => string
  defaultWarehouseId: number | null
  availability: Record<string, AvailabilityCheckResult>
  checking: boolean
  /** Lines an insight or a posting conflict points at. */
  highlightKeys: ReadonlySet<string>
  offendingKeys: ReadonlySet<string>
  onBatchFact: (key: string, fact: LineBatchFact | null) => void
  onOpenStockTools: (line: LineDraft) => void
  onAddBlankLine: () => void
  disabled?: boolean
}

type AvailabilityTone = 'ok' | 'short' | 'unknown' | 'checking'

function availabilityTone(result: AvailabilityCheckResult | undefined, checking: boolean): AvailabilityTone {
  if (!result) return checking ? 'checking' : 'unknown'
  return result.ok ? 'ok' : 'short'
}

const DOT: Record<AvailabilityTone, string> = {
  ok: 'bg-emerald-500',
  short: 'bg-red-500',
  unknown: 'bg-gray-300',
  checking: 'bg-sky-400 animate-pulse',
}

/**
 * The dispatch lines.
 *
 * Availability is never computed here: the figures are whatever the live
 * `POST /v1/availability/check` last answered for the line's own item,
 * warehouse, batch and base quantity, and a line the check has not covered yet
 * says so rather than showing a stale number as fact. Colour is never the only
 * signal — every state is also a word.
 */
export function ChallanLines({
  lines,
  onChange,
  warehouses,
  warehouseName,
  defaultWarehouseId,
  availability,
  checking,
  highlightKeys,
  offendingKeys,
  onBatchFact,
  onOpenStockTools,
  onAddBlankLine,
  disabled,
}: ChallanLinesProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [serialFor, setSerialFor] = useState<LineDraft | null>(null)

  const update = (key: string, patch: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const remove = (key: string) => {
    onBatchFact(key, null)
    onChange(lines.filter((l) => l.key !== key))
  }

  const filled = lines.filter((l) => !isBlankLine(l))

  if (lines.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40">
        <EmptyState
          icon={Boxes}
          size="sm"
          title="No items on this challan yet"
          description="Search or scan an item above, add several at once, or paste a SKU and quantity list."
          action={
            <Button variant="secondary" size="sm" icon={Plus} onClick={onAddBlankLine} disabled={disabled}>
              Add a blank line
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[68rem] border-collapse text-left">
            <thead>
              <tr className="bg-gray-50 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                <th scope="col" className="w-10 px-2.5 py-2 text-center">
                  #
                </th>
                <th scope="col" className="px-2.5 py-2">
                  Item
                </th>
                <th scope="col" className="w-32 px-2.5 py-2">
                  SKU
                </th>
                <th scope="col" className="w-40 px-2.5 py-2">
                  Warehouse
                </th>
                <th scope="col" className="w-40 px-2.5 py-2">
                  Batch
                </th>
                <th scope="col" className="w-24 px-2.5 py-2">
                  Unit
                </th>
                <th scope="col" className="w-24 px-2.5 py-2 text-right">
                  Qty
                </th>
                <th scope="col" className="w-28 px-2.5 py-2">
                  Serials
                </th>
                <th scope="col" className="w-36 px-2.5 py-2">
                  Availability
                </th>
                <th scope="col" className="w-20 px-2.5 py-2 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((line, i) => {
                const result = availability[line.key]
                const tone = availabilityTone(result, checking)
                const lineWarehouse = line.warehouse_id ?? defaultWarehouseId
                const required = lineBaseQty(line)
                const serialsOk = !line.track_serial || (required > 0 && line.serials.length === required)
                const isOpen = expanded === line.key
                return (
                  <tr
                    key={line.key}
                    className={cx(
                      'align-middle transition-colors',
                      offendingKeys.has(line.key)
                        ? 'bg-red-50'
                        : highlightKeys.has(line.key)
                          ? 'bg-amber-50'
                          : 'hover:bg-gray-50/70',
                    )}
                  >
                    <td className="px-2.5 py-2 text-center text-[11px] tabular-nums text-gray-400">{i + 1}</td>
                    <td className="px-2.5 py-2">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-400">
                          <Boxes className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium text-gray-900" title={line.item_name}>
                            {line.item_name || <span className="text-amber-700">No item picked</span>}
                          </span>
                          <span className="flex items-center gap-1 truncate text-[10px] text-gray-500">
                            {line.description ? <span className="truncate">{line.description}</span> : null}
                            {line.track_batch ? <Layers className="h-2.5 w-2.5 text-amber-500" aria-label="Batch tracked" /> : null}
                            {line.track_serial ? <Hash className="h-2.5 w-2.5 text-violet-500" aria-label="Serial tracked" /> : null}
                          </span>
                        </span>
                      </div>
                      {isOpen ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
                          <Input
                            className="min-w-[14rem] flex-1"
                            size="sm"
                            value={line.description}
                            maxLength={200}
                            placeholder="Line note (printed on the challan)"
                            aria-label={`Note for line ${i + 1}`}
                            disabled={disabled}
                            onChange={(e) => update(line.key, { description: e.target.value })}
                          />
                          <Button variant="secondary" size="xs" icon={Warehouse} onClick={() => onOpenStockTools(line)} disabled={!line.item_id}>
                            Stock across warehouses
                          </Button>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2.5 py-2 font-mono text-[11px] text-gray-600">{line.item_sku ?? '—'}</td>
                    <td className="px-2.5 py-2">
                      <ChallanWarehouseSelect
                        value={line.warehouse_id}
                        warehouses={warehouses}
                        disabled={disabled}
                        emptyLabel="(header default)"
                        aria-label={`Warehouse for line ${i + 1}`}
                        onChange={(id) => {
                          onBatchFact(line.key, null)
                          update(line.key, { warehouse_id: id, batch_id: null, batch_no: null, serials: [] })
                        }}
                      />
                    </td>
                    <td className="px-2.5 py-2">
                      {line.item_id && line.track_batch ? (
                        <ChallanBatchSelect
                          itemId={line.item_id}
                          warehouseId={lineWarehouse}
                          value={line.batch_id}
                          disabled={disabled}
                          invalid={line.batch_id === null}
                          onChange={(batch) => {
                            onBatchFact(line.key, batch ? { batch_no: batch.batch_no, expiry_date: batch.expiry_date, available: batch.stock ? Number(batch.stock.available) : null } : null)
                            update(line.key, { batch_id: batch?.batch_id ?? null, batch_no: batch?.batch_no ?? null, serials: [] })
                          }}
                        />
                      ) : (
                        <span className="text-[11px] text-gray-400">{line.batch_no ?? '—'}</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2">
                      {line.units.length > 0 ? (
                        <Select
                          value={line.unit_id ?? ''}
                          disabled={disabled}
                          aria-label={`Unit for line ${i + 1}`}
                          onChange={(e) => update(line.key, { unit_id: e.target.value === '' ? null : Number(e.target.value) })}
                        >
                          {line.units.map((u) => (
                            <option key={u.unit_id} value={u.unit_id}>
                              {u.unit_symbol ?? u.unit_name ?? u.unit_id}
                              {u.conversion_factor !== 1 ? ` ×${formatQty(u.conversion_factor)}` : ''}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-[11px] text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2">
                      <Input
                        size="sm"
                        inputMode="decimal"
                        value={line.qty}
                        disabled={disabled}
                        aria-label={`Quantity for line ${i + 1}`}
                        invalid={line.qty.trim() !== '' && !(Number(line.qty) > 0)}
                        className="text-right tabular-nums"
                        onChange={(e) => update(line.key, { qty: e.target.value })}
                      />
                    </td>
                    <td className="px-2.5 py-2">
                      {line.item_id && line.track_serial ? (
                        <button
                          type="button"
                          className={cx(
                            'rounded-md px-1.5 py-1 text-left transition-colors hover:bg-gray-100',
                            serialsOk ? 'text-gray-700' : 'text-amber-700',
                          )}
                          onClick={() => setSerialFor(line)}
                          disabled={disabled}
                        >
                          <span className="block text-xs font-semibold tabular-nums">
                            {line.serials.length} / {formatQty(required)}
                          </span>
                          <span className="block text-[10px] text-primary underline-offset-2 hover:underline">View / edit</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2">
                      <div className="flex items-center gap-2">
                        <span className={cx('h-2 w-2 shrink-0 rounded-full', DOT[tone])} aria-hidden />
                        <span className="min-w-0">
                          <span className={cx('block text-xs font-semibold tabular-nums', tone === 'short' ? 'text-red-700' : tone === 'ok' ? 'text-emerald-700' : 'text-gray-500')}>
                            {tone === 'checking'
                              ? 'Checking…'
                              : tone === 'unknown'
                                ? 'Not checked'
                                : tone === 'ok'
                                  ? formatQty(result?.available)
                                  : `Short ${formatQty(shortBy(result as AvailabilityCheckResult))}`}
                          </span>
                          <span className="block truncate text-[10px] text-gray-500">{warehouseName(lineWarehouse) || 'No warehouse'}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-2.5 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <Tooltip label={isOpen ? 'Hide line detail' : 'Edit line detail'}>
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
                            aria-label={`${isOpen ? 'Hide' : 'Edit'} detail for line ${i + 1}`}
                            aria-expanded={isOpen}
                            onClick={() => setExpanded(isOpen ? null : line.key)}
                          >
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                          </button>
                        </Tooltip>
                        <Tooltip label="Remove line">
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-red-500 transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                            aria-label={`Remove line ${i + 1}`}
                            disabled={disabled}
                            onClick={() => remove(line.key)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-gray-50/60 px-2.5 py-1.5">
          <Button variant="ghost" size="xs" icon={Plus} onClick={onAddBlankLine} disabled={disabled}>
            Add another line
          </Button>
          <span className="text-[11px] text-gray-500">
            Total lines <strong className="text-gray-900 tabular-nums">{filled.length}</strong>
          </span>
        </div>
      </div>

      {serialFor ? (
        <SerialDrawer
          open
          onClose={() => setSerialFor(null)}
          itemId={serialFor.item_id as number}
          itemName={serialFor.item_name}
          warehouseId={serialFor.warehouse_id ?? defaultWarehouseId}
          batchId={serialFor.batch_id}
          requiredCount={lineBaseQty(lines.find((l) => l.key === serialFor.key) ?? serialFor)}
          value={lines.find((l) => l.key === serialFor.key)?.serials ?? []}
          onChange={(serials) => update(serialFor.key, { serials })}
        />
      ) : null}
    </>
  )
}
