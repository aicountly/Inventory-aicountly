import type { FormOptionWarehouse } from '../services/items'
import type { ItemSearchRow, ItemUnitRow } from '../services/lookupApi'
import type { AvailabilityCheckResult } from '../services/stockApi'
import { shortBy } from '../services/stockApi'
import { formatQty } from '../utils/format'
import { BatchPicker } from './BatchPicker'
import { LineItemPicker } from './LineItemPicker'
import { SerialPicker } from './SerialPicker'
import { WarehouseSelect } from './WarehouseSelect'
import { countDifference, draftTotals, lineAmount, lineBaseQty, newLine } from './formModel'
import type { HeaderDraft, LineDraft, UnitOption } from './formModel'
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
}

export function unitOptionsFrom(row: Pick<ItemSearchRow, 'units' | 'unit_id' | 'unit_symbol'>): UnitOption[] {
  const rows: ItemUnitRow[] = row.units ?? []
  const out = rows.map((u) => ({ unit_id: u.unit_id, unit_symbol: u.unit_symbol, unit_name: u.unit_name, conversion_factor: Number(u.conversion_factor) || 1, is_default: Number(u.is_default) === 1 }))
  if (out.length === 0 && row.unit_id) out.push({ unit_id: row.unit_id, unit_symbol: row.unit_symbol ?? null, unit_name: null, conversion_factor: 1, is_default: true })
  return out
}

function valuationLabel(spec: DocumentTypeSpec): string {
  switch (spec.formKind) {
    case 'revaluation':
      return 'New unit cost'
    case 'production':
      return 'Unit cost (in)'
    default:
      return 'Unit cost'
  }
}

const ORIGIN_TAG: Record<string, string> = { bom: 'BOM', settlement: 'Settlement', deferred: 'Purchase', count: 'Count' }

/** Editable document lines. Column set follows the type spec; each row keeps its own pickers. */
export function LineEditor({ spec, header, lines, onChange, warehouses, availability, checking, offendingKeys, disabled }: LineEditorProps) {
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
    if (effectiveDirection(line) !== 'out' || !line.item_id) return <span className="avail avail-pending">—</span>
    const r = availability[line.key]
    if (!r) return <span className="avail avail-pending">{checking ? 'checking…' : '—'}</span>
    return r.ok ? <span className="avail avail-ok">avail {formatQty(r.available)}</span> : <span className="avail avail-short">short by {formatQty(shortBy(r))}</span>
  }

  const outWarehouse = (line: LineDraft) => (isTransfer ? (line.from_warehouse_id ?? header.from_warehouse_id) : line.warehouse_id)

  return (
    <div className="table-wrap">
      <table className="table lines-table">
        <thead>
          <tr>
            <th style={{ width: '2rem' }}>#</th>
            <th>Item</th>
            {isTransfer ? (
              <>
                <th>From</th>
                <th>To</th>
              </>
            ) : (
              <th>Warehouse</th>
            )}
            <th>Batch</th>
            <th>Unit</th>
            {showDirection ? <th>Dir.</th> : null}
            {isCount ? (
              <>
                <th className="align-right">Book qty</th>
                <th className="align-right">Counted</th>
                <th className="align-right">Diff.</th>
              </>
            ) : (
              <th className="align-right">Qty</th>
            )}
            {showRate ? (
              <>
                <th className="align-right">Rate</th>
                <th className="align-right">Amount</th>
              </>
            ) : null}
            {showValuation ? <th className="align-right">{valuationLabel(spec)}</th> : null}
            <th>Serials</th>
            {showAvailability ? <th>Availability</th> : null}
            <th aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            const dir = effectiveDirection(line)
            const diff = isCount ? countDifference(line.book_qty, line.physical_qty) : null
            const cls = [offendingKeys.has(line.key) ? 'line-offending' : '', line.origin !== 'manual' ? 'line-auto' : ''].filter(Boolean).join(' ') || undefined
            return (
              <tr key={line.key} className={cls}>
                <td className="muted">{i + 1}</td>
                <td className="item-cell">
                  <LineItemPicker itemId={line.item_id} itemName={line.item_name} itemSku={line.item_sku} warehouseId={outWarehouse(line) ?? header.default_warehouse_id} onPick={(row) => pick(line, row)} onClear={() => clear(line)} disabled={disabled} invalid={offendingKeys.has(line.key)} />
                  {line.origin !== 'manual' && ORIGIN_TAG[line.origin] ? <span className="line-tag">{ORIGIN_TAG[line.origin]}</span> : null}
                  {line.description ? <div className="hint">{line.description}</div> : null}
                </td>
                {isTransfer ? (
                  <>
                    <td className="wh-cell">
                      <WarehouseSelect value={line.from_warehouse_id} onChange={(id) => update(line.key, { from_warehouse_id: id })} warehouses={warehouses} emptyLabel="(header source)" disabled={disabled} />
                    </td>
                    <td className="wh-cell">
                      <WarehouseSelect value={line.warehouse_id} onChange={(id) => update(line.key, { warehouse_id: id })} warehouses={warehouses} emptyLabel="(header destination)" disabled={disabled} />
                    </td>
                  </>
                ) : (
                  <td className="wh-cell">
                    <WarehouseSelect value={line.warehouse_id} onChange={(id) => update(line.key, { warehouse_id: id, batch_id: null, batch_no: null, serials: [] })} warehouses={warehouses} disabled={disabled} />
                  </td>
                )}
                <td>
                  {line.item_id && line.track_batch ? (
                    <BatchPicker itemId={line.item_id} warehouseId={outWarehouse(line)} value={line.batch_id} onChange={(b) => update(line.key, { batch_id: b?.batch_id ?? null, batch_no: b?.batch_no ?? null })} allowCreate={dir === 'in'} disabled={disabled} />
                  ) : (
                    <span className="muted">{line.batch_no ?? '—'}</span>
                  )}
                </td>
                <td className="unit-cell">
                  {line.units.length > 0 ? (
                    <select className="select" value={line.unit_id ?? ''} disabled={disabled} aria-label="Unit" onChange={(e) => update(line.key, { unit_id: e.target.value === '' ? null : Number(e.target.value) })}>
                      {line.units.map((u) => (
                        <option key={u.unit_id} value={u.unit_id}>
                          {u.unit_symbol ?? u.unit_name ?? u.unit_id}
                          {u.conversion_factor !== 1 ? ` ×${formatQty(u.conversion_factor)}` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                {showDirection ? (
                  <td className="dir-cell">
                    <select className="select" value={line.direction ?? ''} disabled={disabled} aria-label="Direction" onChange={(e) => update(line.key, { direction: e.target.value === 'in' ? 'in' : e.target.value === 'out' ? 'out' : null, serials: [] })}>
                      <option value="">—</option>
                      <option value="in">In</option>
                      <option value="out">Out</option>
                    </select>
                  </td>
                ) : null}
                {isCount ? (
                  <>
                    <td className="qty-cell">
                      <input className="input" inputMode="decimal" value={line.book_qty} disabled={disabled} aria-label="Book quantity" onChange={(e) => update(line.key, { book_qty: e.target.value })} />
                    </td>
                    <td className="qty-cell">
                      <input className="input" inputMode="decimal" value={line.physical_qty} disabled={disabled} aria-label="Counted quantity" onChange={(e) => update(line.key, { physical_qty: e.target.value })} />
                    </td>
                    <td className="align-right">
                      {diff === null ? <span className="muted">—</span> : <span className={`count-diff ${diff > 0 ? 'in' : diff < 0 ? 'out' : ''}`}>{diff > 0 ? '+' : ''}{formatQty(diff)}</span>}
                    </td>
                  </>
                ) : (
                  <td className="qty-cell">
                    <input className="input" inputMode="decimal" value={line.qty} disabled={disabled} aria-label="Quantity" onChange={(e) => update(line.key, { qty: e.target.value, amount: line.rate ? String(lineAmount(e.target.value, line.rate) ?? '') : line.amount })} />
                  </td>
                )}
                {showRate ? (
                  <>
                    <td className="qty-cell">
                      <input className="input" inputMode="decimal" value={line.rate} disabled={disabled} aria-label="Rate" onChange={(e) => update(line.key, { rate: e.target.value, amount: String(lineAmount(line.qty, e.target.value) ?? '') })} />
                    </td>
                    <td className="qty-cell">
                      <input className="input" inputMode="decimal" value={line.amount} disabled={disabled} aria-label="Amount" onChange={(e) => update(line.key, { amount: e.target.value })} />
                    </td>
                  </>
                ) : null}
                {showValuation ? (
                  <td className="qty-cell">
                    <input className="input" inputMode="decimal" value={line.valuation_rate} disabled={disabled || (spec.formKind === 'production' && dir === 'out')} aria-label={valuationLabel(spec)} onChange={(e) => update(line.key, { valuation_rate: e.target.value })} />
                  </td>
                ) : null}
                <td>
                  {line.item_id && line.track_serial && dir ? (
                    <SerialPicker itemId={line.item_id} itemName={line.item_name} warehouseId={outWarehouse(line)} batchId={line.batch_id} direction={dir} value={line.serials} onChange={(serials) => update(line.key, { serials })} requiredCount={lineBaseQty(line)} disabled={disabled} />
                  ) : (
                    <span className="muted">{line.serials.length > 0 ? `${line.serials.length}` : '—'}</span>
                  )}
                </td>
                {showAvailability ? <td>{availabilityCell(line)}</td> : null}
                <td className="action">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(line.key)} disabled={disabled} aria-label={`Remove line ${i + 1}`}>
                    ×
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="lines-footer">
        <button type="button" className="btn btn-sm" onClick={add} disabled={disabled}>
          + Add line
        </button>
        <div className="lines-totals">
          <span>
            Lines <strong>{totals.lines}</strong>
          </span>
          {totals.qtyIn > 0 || spec.lineMode === 'by_line' ? (
            <span>
              In <strong>{formatQty(totals.qtyIn)}</strong>
            </span>
          ) : null}
          {totals.qtyOut > 0 || spec.lineMode === 'by_line' || isTransfer ? (
            <span>
              Out <strong>{formatQty(totals.qtyOut)}</strong>
            </span>
          ) : null}
          {showRate ? (
            <span>
              Amount <strong>{formatQty(totals.amount)}</strong>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
