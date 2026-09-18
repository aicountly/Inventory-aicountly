import { Copy, Plus, Trash2 } from 'lucide-react'
import { AMOUNT_CELL_CLASS, TABLE_HEADER, TABLE_ROW_HOVER } from '../styles/designTokens'
import type { FormOptionWarehouse } from '../services/items'
import type { ItemSearchRow } from '../services/lookupApi'
import type { AvailabilityCheckResult } from '../services/stockApi'
import { shortBy } from '../services/stockApi'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { cx } from '../ui/cx'
import { formatQty } from '../utils/format'
import { BatchPicker } from './BatchPicker'
import { LineItemPicker } from './LineItemPicker'
import { SerialPicker } from './SerialPicker'
import { WarehouseSelect } from './WarehouseSelect'
import { countDifference, draftTotals, lineAmount, lineBaseQty, newLine, nextLineKey, unitOptionsFrom } from './formModel'
import type { HeaderDraft, LineDraft } from './formModel'
import type { DocumentTypeSpec } from './registry'

interface LineEditorProps {
  spec: DocumentTypeSpec
  header: HeaderDraft
  lines: LineDraft[]
  onChange: (lines: LineDraft[]) => void
  warehouses: FormOptionWarehouse[]
  availability: Record<string, AvailabilityCheckResult>
  checking: boolean
  offendingKeys: ReadonlySet<string>
  disabled?: boolean
  /** The most recently added line's item search gets focus (Add line / Alt+L). */
  focusKey?: string | null
}

function valuationLabel(spec: DocumentTypeSpec): string {
  switch (spec.formKind) {
    case 'revaluation':
      return 'New unit cost'
    case 'production':
    case 'job_work_in':
      return 'Unit cost (in)'
    default:
      return 'Unit cost'
  }
}

const ORIGIN_TAG: Record<string, string> = { bom: 'BOM', settlement: 'Settlement', deferred: 'Purchase', count: 'Count' }

const TH = cx(TABLE_HEADER, 'px-2.5 py-2 text-left whitespace-nowrap')
const TD = 'px-2.5 py-1.5 align-middle'

/** Editable document lines. Column set follows the type spec; each row keeps its own pickers. */
export function LineEditor({ spec, header, lines, onChange, warehouses, availability, checking, offendingKeys, disabled, focusKey }: LineEditorProps) {
  const isTransfer = spec.lineMode === 'transfer'
  const isCount = spec.formKind === 'physical_count'
  const showDirection = spec.lineMode === 'by_line' && !isCount
  const showAvailability = spec.movesStock || ['job_work_out', 'packing', 'delivery_challan'].includes(spec.formKind)
  const showRate = spec.rate
  const showValuation = spec.valuationRate
  const totals = draftTotals(lines, spec)

  const update = (key: string, patch: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const remove = (key: string) => onChange(lines.filter((l) => l.key !== key))
  const add = () => onChange([...lines, newLine(spec, { warehouse_id: isTransfer ? null : header.default_warehouse_id })])
  const duplicate = (key: string) => {
    const idx = lines.findIndex((l) => l.key === key)
    if (idx === -1) return
    const copy: LineDraft = { ...lines[idx], key: nextLineKey(), serials: [], origin: 'manual' }
    onChange([...lines.slice(0, idx + 1), copy, ...lines.slice(idx + 1)])
  }

  const pick = (line: LineDraft, row: ItemSearchRow) => {
    const units = unitOptionsFrom(row)
    const def = units.find((u) => u.is_default) ?? units[0]
    update(line.key, {
      item_id: row.item_id,
      item_name: row.print_name || row.item_name,
      item_sku: row.item_sku,
      track_batch: Number(row.track_batch) === 1,
      track_serial: Number(row.track_serial) === 1,
      units,
      unit_id: def?.unit_id ?? row.unit_id ?? null,
      warehouse_id: isTransfer ? line.warehouse_id : (line.warehouse_id ?? row.default_warehouse_id ?? header.default_warehouse_id ?? null),
      batch_id: null,
      batch_no: null,
      serials: [],
    })
  }

  const clear = (line: LineDraft) => update(line.key, { item_id: null, item_name: '', item_sku: null, track_batch: false, track_serial: false, units: [], unit_id: null, batch_id: null, batch_no: null, serials: [] })

  const effectiveDirection = (line: LineDraft): 'in' | 'out' | null => {
    if (isCount) {
      const d = countDifference(line.book_qty, line.physical_qty)
      return d === null ? null : d > 0 ? 'in' : d < 0 ? 'out' : null
    }
    if (isTransfer) return 'out'
    if (spec.formKind === 'job_work_out' || spec.formKind === 'packing' || spec.formKind === 'delivery_challan') return 'out'
    if (spec.formKind === 'inward_challan') return 'in'
    return line.direction
  }

  const availabilityCell = (line: LineDraft) => {
    if (effectiveDirection(line) !== 'out' || !line.item_id) return <span className="text-xs text-gray-300">—</span>
    const r = availability[line.key]
    if (!r) return <span className="text-xs text-gray-400">{checking ? 'checking…' : '—'}</span>
    if (!r.ok) return <span className="text-xs font-semibold text-red-600">short by {formatQty(shortBy(r))}</span>
    const low = r.available > 0 && r.available <= 5
    return <span className={cx('text-xs font-medium', low ? 'text-amber-600' : 'text-emerald-600')}>avail {formatQty(r.available)}</span>
  }

  const outWarehouse = (line: LineDraft) => (isTransfer ? (line.from_warehouse_id ?? header.from_warehouse_id) : line.warehouse_id)

  return (
    <div className="aic flex flex-col gap-2.5">
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className={cx(TH, 'w-9')}>#</th>
                <th className={cx(TH, 'min-w-[15rem]')}>Item</th>
                {isTransfer ? (
                  <>
                    <th className={cx(TH, 'min-w-[8rem]')}>From</th>
                    <th className={cx(TH, 'min-w-[8rem]')}>To</th>
                  </>
                ) : (
                  <th className={cx(TH, 'min-w-[8rem]')}>Warehouse</th>
                )}
                <th className={cx(TH, 'min-w-[9rem]')}>Batch</th>
                <th className={cx(TH, 'w-20')}>Unit</th>
                {showDirection ? <th className={cx(TH, 'w-16')}>Dir.</th> : null}
                {isCount ? (
                  <>
                    <th className={cx(TH, 'w-24 text-right')}>Book qty</th>
                    <th className={cx(TH, 'w-24 text-right')}>Counted</th>
                    <th className={cx(TH, 'w-20 text-right')}>Diff.</th>
                  </>
                ) : (
                  <th className={cx(TH, 'w-24 text-right')}>Qty</th>
                )}
                {showRate ? (
                  <>
                    <th className={cx(TH, 'w-24 text-right')}>Rate</th>
                    <th className={cx(TH, 'w-28 text-right')}>Amount</th>
                  </>
                ) : null}
                {showValuation ? <th className={cx(TH, 'w-28 text-right')}>{valuationLabel(spec)}</th> : null}
                <th className={cx(TH, 'w-24')}>Serials</th>
                {showAvailability ? <th className={cx(TH, 'w-28')}>Available</th> : null}
                <th className={cx(TH, 'w-20 text-right')}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const dir = effectiveDirection(line)
                const diff = isCount ? countDifference(line.book_qty, line.physical_qty) : null
                const isBlank = !line.item_id
                return (
                  <tr
                    key={line.key}
                    className={cx(
                      i > 0 && 'border-t border-gray-100',
                      offendingKeys.has(line.key) ? 'bg-red-50' : TABLE_ROW_HOVER,
                      'transition-colors focus-within:bg-primary-light/30',
                    )}
                  >
                    <td className={cx(TD, 'text-gray-400', line.origin !== 'manual' && 'border-l-2 border-l-sky-400')}>{i + 1}</td>
                    <td className={cx(TD, 'min-w-[15rem]')}>
                      <LineItemPicker
                        itemId={line.item_id}
                        itemName={line.item_name}
                        itemSku={line.item_sku}
                        warehouseId={outWarehouse(line) ?? header.default_warehouse_id}
                        onPick={(row) => pick(line, row)}
                        onClear={() => clear(line)}
                        disabled={disabled}
                        autoFocus={focusKey === line.key}
                        invalid={offendingKeys.has(line.key)}
                      />
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {line.origin !== 'manual' && ORIGIN_TAG[line.origin] ? (
                          <Badge tone="info" size="xs">
                            {ORIGIN_TAG[line.origin]}
                          </Badge>
                        ) : null}
                        {line.description ? <span className="text-xs text-gray-500">{line.description}</span> : null}
                      </div>
                    </td>
                    {isTransfer ? (
                      <>
                        <td className={TD}>
                          <WarehouseSelect value={line.from_warehouse_id} onChange={(id) => update(line.key, { from_warehouse_id: id })} warehouses={warehouses} emptyLabel="(header source)" disabled={disabled} />
                        </td>
                        <td className={TD}>
                          <WarehouseSelect value={line.warehouse_id} onChange={(id) => update(line.key, { warehouse_id: id })} warehouses={warehouses} emptyLabel="(header destination)" disabled={disabled} />
                        </td>
                      </>
                    ) : (
                      <td className={TD}>
                        <WarehouseSelect value={line.warehouse_id} onChange={(id) => update(line.key, { warehouse_id: id, batch_id: null, batch_no: null, serials: [] })} warehouses={warehouses} disabled={disabled} />
                      </td>
                    )}
                    <td className={TD}>
                      {line.item_id && line.track_batch ? (
                        <BatchPicker itemId={line.item_id} warehouseId={outWarehouse(line)} value={line.batch_id} onChange={(b) => update(line.key, { batch_id: b?.batch_id ?? null, batch_no: b?.batch_no ?? null })} allowCreate={dir === 'in'} disabled={disabled} />
                      ) : (
                        <span className="text-sm text-gray-300">—</span>
                      )}
                    </td>
                    <td className={TD}>
                      {line.units.length > 0 ? (
                        <Select value={line.unit_id ?? ''} disabled={disabled} aria-label="Unit" onChange={(e) => update(line.key, { unit_id: e.target.value === '' ? null : Number(e.target.value) })}>
                          {line.units.map((u) => (
                            <option key={u.unit_id} value={u.unit_id}>
                              {u.unit_symbol ?? u.unit_name ?? u.unit_id}
                              {u.conversion_factor !== 1 ? ` ×${formatQty(u.conversion_factor)}` : ''}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-sm text-gray-300">—</span>
                      )}
                    </td>
                    {showDirection ? (
                      <td className={TD}>
                        <Select value={line.direction ?? ''} disabled={disabled} aria-label="Direction" onChange={(e) => update(line.key, { direction: e.target.value === 'in' ? 'in' : e.target.value === 'out' ? 'out' : null, serials: [] })}>
                          <option value="">—</option>
                          <option value="in">In</option>
                          <option value="out">Out</option>
                        </Select>
                      </td>
                    ) : null}
                    {isCount ? (
                      <>
                        <td className={TD}>
                          <Input className="text-right tabular-nums" inputMode="decimal" value={line.book_qty} disabled={disabled} aria-label="Book quantity" onChange={(e) => update(line.key, { book_qty: e.target.value })} />
                        </td>
                        <td className={TD}>
                          <Input className="text-right tabular-nums" inputMode="decimal" value={line.physical_qty} disabled={disabled} aria-label="Counted quantity" onChange={(e) => update(line.key, { physical_qty: e.target.value })} />
                        </td>
                        <td className={cx(TD, 'text-right')}>
                          {diff === null ? (
                            <span className="text-sm text-gray-300">—</span>
                          ) : (
                            <span className={cx('text-sm font-semibold tabular-nums', diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-gray-500')}>
                              {diff > 0 ? '+' : ''}
                              {formatQty(diff)}
                            </span>
                          )}
                        </td>
                      </>
                    ) : (
                      <td className={TD}>
                        <Input
                          className="text-right tabular-nums"
                          inputMode="decimal"
                          value={line.qty}
                          disabled={disabled}
                          aria-label="Quantity"
                          invalid={offendingKeys.has(line.key)}
                          onChange={(e) => update(line.key, { qty: e.target.value, amount: line.rate ? String(lineAmount(e.target.value, line.rate) ?? '') : line.amount })}
                        />
                      </td>
                    )}
                    {showRate ? (
                      <>
                        <td className={TD}>
                          <Input className="text-right tabular-nums" inputMode="decimal" value={line.rate} disabled={disabled} aria-label="Rate" onChange={(e) => update(line.key, { rate: e.target.value, amount: String(lineAmount(line.qty, e.target.value) ?? '') })} />
                        </td>
                        <td className={TD}>
                          <Input className="text-right tabular-nums" inputMode="decimal" value={line.amount} disabled={disabled} aria-label="Amount" onChange={(e) => update(line.key, { amount: e.target.value })} />
                        </td>
                      </>
                    ) : null}
                    {showValuation ? (
                      <td className={TD}>
                        <Input
                          className="text-right tabular-nums"
                          inputMode="decimal"
                          value={line.valuation_rate}
                          disabled={disabled || (dir === 'out' && ['production', 'job_work_in'].includes(spec.formKind))}
                          aria-label={valuationLabel(spec)}
                          onChange={(e) => update(line.key, { valuation_rate: e.target.value })}
                        />
                      </td>
                    ) : null}
                    <td className={TD}>
                      {line.item_id && line.track_serial && dir ? (
                        <SerialPicker itemId={line.item_id} itemName={line.item_name} warehouseId={outWarehouse(line)} batchId={line.batch_id} direction={dir} value={line.serials} onChange={(serials) => update(line.key, { serials })} requiredCount={lineBaseQty(line)} disabled={disabled} />
                      ) : (
                        <span className="text-sm text-gray-300">{line.serials.length > 0 ? `${line.serials.length}` : '—'}</span>
                      )}
                    </td>
                    {showAvailability ? <td className={TD}>{availabilityCell(line)}</td> : null}
                    <td className={cx(TD, 'text-right')}>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          icon={Copy}
                          onClick={() => duplicate(line.key)}
                          disabled={disabled || isBlank}
                          aria-label={`Duplicate line ${i + 1}`}
                          title="Duplicate line"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          icon={Trash2}
                          className="text-red-500 hover:bg-red-50 hover:text-red-600"
                          onClick={() => remove(line.key)}
                          disabled={disabled}
                          aria-label={`Remove line ${i + 1}`}
                          title="Remove line"
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="secondary" size="sm" icon={Plus} onClick={add} disabled={disabled} kbd="Alt L">
          Add line
        </Button>
        <div className={cx('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500', AMOUNT_CELL_CLASS)}>
          <span>
            Lines <strong className="font-semibold text-gray-900">{totals.lines}</strong>
          </span>
          {totals.qtyIn > 0 || spec.lineMode === 'by_line' ? (
            <span>
              In <strong className="font-semibold text-gray-900">{formatQty(totals.qtyIn)}</strong>
            </span>
          ) : null}
          {totals.qtyOut > 0 || spec.lineMode === 'by_line' || isTransfer ? (
            <span>
              Out <strong className="font-semibold text-gray-900">{formatQty(totals.qtyOut)}</strong>
            </span>
          ) : null}
          {showRate ? (
            <span>
              Amount <strong className="font-semibold text-gray-900">{formatQty(totals.amount)}</strong>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
