import { useState } from 'react'
import { Boxes, Copy, Plus, ScanBarcode, Trash2, Upload } from 'lucide-react'
import { Button } from '../../ui/Button'
import { useToast } from '../../ui/ToastContext'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { shortBy } from '../../services/stockApi'
import type { FormOptionWarehouse } from '../../services/items'
import { formatQty } from '../../utils/format'
import { BatchPicker } from '../BatchPicker'
import { LineItemPicker } from '../LineItemPicker'
import { SerialPicker } from '../SerialPicker'
import { WarehouseSelect } from '../WarehouseSelect'
import { unitOptionsFrom } from '../LineEditor'
import { draftTotals, isBlankLine, newLine, nextLineKey } from '../formModel'
import type { LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import { BarcodeScanBar } from './BarcodeScanBar'
import { ImportLinesModal } from './ImportLinesModal'
import './consumption.css'

interface ConsumptionLinesPanelProps {
  spec: DocumentTypeSpec
  lines: LineDraft[]
  onChange: (lines: LineDraft[]) => void
  warehouses: FormOptionWarehouse[]
  defaultWarehouseId: number | null
  availability: Record<string, AvailabilityCheckResult>
  checking: boolean
  offendingKeys: ReadonlySet<string>
  disabled?: boolean
  scanOpen: boolean
  onToggleScan: () => void
  onOpenBom: () => void
}

type AvailTone = 'grey' | 'green' | 'amber' | 'red'

function availabilityTone(hasItem: boolean, r: AvailabilityCheckResult | undefined): AvailTone {
  if (!hasItem || !r) return 'grey'
  if (!r.ok) return 'red'
  const short = shortBy(r)
  if (short <= 0 && r.requested > 0 && r.available - r.requested < r.requested * 0.15) return 'amber'
  return 'green'
}

const TONE_DOT: Record<AvailTone, string> = {
  grey: 'bg-gray-300',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
}
const TONE_TEXT: Record<AvailTone, string> = {
  grey: 'text-gray-400',
  green: 'text-emerald-700',
  amber: 'text-amber-700',
  red: 'text-red-600',
}
const TONE_LABEL: Record<AvailTone, string> = { grey: '', green: 'sufficient', amber: 'low', red: 'insufficient' }

function AvailabilityCell({ hasItem, checking, result }: { hasItem: boolean; checking: boolean; result?: AvailabilityCheckResult }) {
  if (!hasItem) return <span className="text-xs text-gray-300">—</span>
  if (!result) {
    return <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">{checking ? <span className="h-2 w-2 animate-pulse rounded-full bg-gray-300" aria-hidden /> : null}checking…</span>
  }
  const tone = availabilityTone(hasItem, result)
  const label = TONE_LABEL[tone]
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold ${TONE_TEXT[tone]}`} title={label ? `Stock is ${label} for this quantity` : undefined}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
      {formatQty(result.available)}
      {tone === 'red' ? <span className="font-normal">short {formatQty(shortBy(result))}</span> : null}
      {label ? <span className="sr-only"> ({label})</span> : null}
    </span>
  )
}

/**
 * "Items to Consume": toolbar (Import / Scan / BOM / Add line) plus the editable line table.
 * Item search, warehouse, batch and serial pickers are the exact shared components every other
 * document type uses (LineItemPicker/WarehouseSelect/BatchPicker/SerialPicker) — only the table
 * shell, columns and toolbar are new, restyled to the premium look via consumption.css.
 */
export function ConsumptionLinesPanel({ spec, lines, onChange, warehouses, defaultWarehouseId, availability, checking, offendingKeys, disabled, scanOpen, onToggleScan, onOpenBom }: ConsumptionLinesPanelProps) {
  const toast = useToast()
  const [importOpen, setImportOpen] = useState(false)

  const totals = draftTotals(lines, spec)

  const update = (key: string, patch: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const remove = (key: string) => onChange(lines.filter((l) => l.key !== key))
  const add = () => onChange([...lines, newLine(spec, { warehouse_id: defaultWarehouseId })])
  const duplicate = (key: string) => {
    const idx = lines.findIndex((l) => l.key === key)
    if (idx === -1) return
    const clone: LineDraft = { ...lines[idx], key: nextLineKey(), serials: [] }
    onChange([...lines.slice(0, idx + 1), clone, ...lines.slice(idx + 1)])
  }
  const appendLines = (drafts: LineDraft[]) => {
    if (drafts.length === 0) return
    const nonBlank = lines.filter((l) => !isBlankLine(l))
    onChange([...nonBlank, ...drafts])
    toast.success(`${drafts.length} line${drafts.length === 1 ? '' : 's'} added.`)
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
      warehouse_id: line.warehouse_id ?? row.default_warehouse_id ?? defaultWarehouseId ?? null,
      batch_id: null,
      batch_no: null,
      serials: [],
    })
  }

  const clear = (line: LineDraft) => update(line.key, { item_id: null, item_name: '', item_sku: null, track_batch: false, track_serial: false, units: [], unit_id: null, batch_id: null, batch_no: null, serials: [] })

  const onBarcodeResolved = (row: ItemSearchRow) => {
    const wh = defaultWarehouseId
    const nonBatchOrSerial = Number(row.track_batch) !== 1 && Number(row.track_serial) !== 1
    if (nonBatchOrSerial) {
      const existing = lines.find((l) => l.item_id === row.item_id && (l.warehouse_id ?? defaultWarehouseId) === wh)
      if (existing) {
        const qty = (Number(existing.qty) || 0) + 1
        update(existing.key, { qty: String(qty) })
        toast.success(`${row.item_name}: quantity increased to ${formatQty(qty)}.`)
        return
      }
    }
    const units = unitOptionsFrom(row)
    const def = units.find((u) => u.is_default) ?? units[0]
    const draft = newLine(spec, {
      item_id: row.item_id,
      item_name: row.print_name || row.item_name,
      item_sku: row.item_sku,
      track_batch: Number(row.track_batch) === 1,
      track_serial: Number(row.track_serial) === 1,
      units,
      unit_id: def?.unit_id ?? row.unit_id ?? null,
      warehouse_id: row.default_warehouse_id ?? wh,
      qty: '1',
    })
    const nonBlank = lines.filter((l) => !isBlankLine(l))
    onChange([...nonBlank, draft])
    toast.success(`${row.item_name} added.`)
  }

  const onBarcodeNotFound = (code: string, message: string) => {
    toast.error(message || `No item found for "${code}".`)
  }

  return (
    <section className="aic rounded-2xl border border-gray-200 bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3.5 md:px-5">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Items to Consume</h2>
          <p className="mt-0.5 text-xs text-gray-500">Add items to be consumed. System will check live stock availability.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon={Upload} onClick={() => setImportOpen(true)} disabled={disabled}>
            Import Items
          </Button>
          <Button variant={scanOpen ? 'outline' : 'secondary'} size="sm" icon={ScanBarcode} onClick={onToggleScan} disabled={disabled}>
            Scan Barcode
          </Button>
          <Button variant="secondary" size="sm" icon={Boxes} onClick={onOpenBom} disabled={disabled}>
            Add from BOM
          </Button>
          <Button variant="primary" size="sm" icon={Plus} onClick={add} disabled={disabled}>
            Add Line
          </Button>
        </div>
      </div>

      {scanOpen ? (
        <div className="border-b border-gray-100 px-4 py-2.5 md:px-5">
          <BarcodeScanBar autoFocus warehouseId={defaultWarehouseId} disabled={disabled} onResolved={onBarcodeResolved} onNotFound={onBarcodeNotFound} />
        </div>
      ) : null}

      <div className="consumption-premium overflow-x-auto">
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-gray-500">
              <th className="w-10 px-3 py-2.5 text-left">#</th>
              <th className="min-w-[16rem] px-2 py-2.5 text-left">Item *</th>
              <th className="min-w-[9rem] px-2 py-2.5 text-left">Warehouse</th>
              <th className="min-w-[8rem] px-2 py-2.5 text-left">Batch</th>
              <th className="min-w-[6rem] px-2 py-2.5 text-left">Serial No.</th>
              <th className="w-24 px-2 py-2.5 text-right">Quantity *</th>
              <th className="min-w-[7rem] px-2 py-2.5 text-left">Available Stock</th>
              <th className="w-20 px-2 py-2.5 text-left">Unit</th>
              <th className="min-w-[9rem] px-2 py-2.5 text-left">Remarks</th>
              <th className="w-16 px-2 py-2.5 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => {
              const invalid = offendingKeys.has(line.key)
              return (
                <tr key={line.key} className={`border-b border-gray-50 align-top transition-colors hover:bg-gray-50/60 ${invalid ? 'bg-red-50/60' : ''}`}>
                  <td className="px-3 py-2 text-xs text-gray-400">{i + 1}</td>
                  <td className="px-2 py-2">
                    <LineItemPicker itemId={line.item_id} itemName={line.item_name} itemSku={line.item_sku} warehouseId={line.warehouse_id ?? defaultWarehouseId} onPick={(row) => pick(line, row)} onClear={() => clear(line)} disabled={disabled} invalid={invalid} />
                    {line.description ? <div className="mt-1 truncate text-[11px] text-gray-400">{line.description}</div> : null}
                  </td>
                  <td className="px-2 py-2">
                    <WarehouseSelect value={line.warehouse_id} onChange={(id) => update(line.key, { warehouse_id: id, batch_id: null, batch_no: null, serials: [] })} warehouses={warehouses} disabled={disabled} />
                  </td>
                  <td className="px-2 py-2">
                    {line.item_id && line.track_batch ? (
                      <BatchPicker itemId={line.item_id} warehouseId={line.warehouse_id ?? defaultWarehouseId} value={line.batch_id} onChange={(b) => update(line.key, { batch_id: b?.batch_id ?? null, batch_no: b?.batch_no ?? null })} allowCreate={false} disabled={disabled} />
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {line.item_id && line.track_serial ? (
                      <SerialPicker itemId={line.item_id} itemName={line.item_name} warehouseId={line.warehouse_id ?? defaultWarehouseId} batchId={line.batch_id} direction="out" value={line.serials} onChange={(serials) => update(line.key, { serials })} requiredCount={Number(line.qty) || 0} disabled={disabled} />
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <input
                      className="h-9 w-full rounded-lg border border-gray-200 px-2 text-right text-sm tabular-nums outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:bg-gray-50"
                      inputMode="decimal"
                      aria-label={`Quantity for line ${i + 1}`}
                      value={line.qty}
                      disabled={disabled}
                      onChange={(e) => update(line.key, { qty: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <AvailabilityCell hasItem={line.item_id !== null} checking={checking} result={availability[line.key]} />
                  </td>
                  <td className="px-2 py-2">
                    {line.units.length > 0 ? (
                      <select
                        className="h-9 w-full rounded-lg border border-gray-200 bg-white px-1.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
                        aria-label={`Unit for line ${i + 1}`}
                        value={line.unit_id ?? ''}
                        disabled={disabled}
                        onChange={(e) => update(line.key, { unit_id: e.target.value === '' ? null : Number(e.target.value) })}
                      >
                        {line.units.map((u) => (
                          <option key={u.unit_id} value={u.unit_id}>
                            {u.unit_symbol ?? u.unit_name ?? u.unit_id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <input
                      className="h-9 w-full rounded-lg border border-gray-200 px-2 text-xs outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:bg-gray-50"
                      placeholder="Remarks"
                      aria-label={`Remarks for line ${i + 1}`}
                      value={line.description}
                      disabled={disabled}
                      onChange={(e) => update(line.key, { description: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-center gap-1">
                      <button type="button" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40" aria-label={`Duplicate line ${i + 1}`} title="Duplicate line" onClick={() => duplicate(line.key)} disabled={disabled}>
                        <Copy className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button type="button" className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40" aria-label={`Delete line ${i + 1}`} title="Delete line" onClick={() => remove(line.key)} disabled={disabled}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {lines.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-5 py-10 text-center">
          <p className="text-sm font-semibold text-gray-900">Add an item to start recording consumption.</p>
          <p className="text-xs text-gray-500">Search items, scan a barcode, import items, or add from BOM.</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 md:px-5">
        <Button variant="secondary" size="sm" icon={Plus} onClick={add} disabled={disabled}>
          Add Line
        </Button>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>
            Total Items <strong className="text-gray-900">{totals.lines}</strong>
          </span>
          <span>
            Total Quantity <strong className="tabular-nums text-gray-900">{formatQty(totals.qtyOut)}</strong>
          </span>
        </div>
      </div>

      <ImportLinesModal open={importOpen} onClose={() => setImportOpen(false)} spec={spec} warehouses={warehouses} defaultWarehouseId={defaultWarehouseId} onInsert={appendLines} />
    </section>
  )
}

export default ConsumptionLinesPanel
