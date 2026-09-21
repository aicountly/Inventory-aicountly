import { useMemo, useRef, useState } from 'react'
import { Boxes, Copy, ListPlus, MoreHorizontal, Package, Plus, ScanLine, Trash2 } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { MenuButton } from '../../ui/MenuButton'
import { Select } from '../../ui/Select'
import { Tooltip } from '../../ui/Tooltip'
import { AIC, cx } from '../../ui/cx'
import { formatDate, formatMoney, formatQty, toNumber } from '../../utils/format'
import { lineAmount, lineBaseQty, newLine, nextLineKey } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import type { FormOptionWarehouse } from '../../services/items'
import type { BatchRow } from '../../services/lookupApi'
import { GrnCard, GrnCardHeader } from './GrnCard'
import { GrnBatchCell } from './GrnBatchCell'
import { GrnItemPicker } from './GrnItemPicker'
import { GrnWarehouseSelect } from './GrnWarehouseSelect'
import { GrnSerialDrawer } from './GrnSerialDrawer'
import { PO_MATCH_LABEL, poLink, poMatchStatus } from './grnModel'
import type { PoMatchStatus } from './grnModel'
import { itemPatch } from './grnLines'
import type { LineSerial } from '../types'

export interface GrnLinesCardProps {
  spec: DocumentTypeSpec
  header: HeaderDraft
  lines: LineDraft[]
  onChange: (lines: LineDraft[]) => void
  warehouses: FormOptionWarehouse[]
  /** Line keys an alert points at — highlighted so the reader can find them. */
  flaggedKeys: ReadonlySet<string>
  onScan: () => void
  onBulkAdd: () => void
  onImportPo: () => void
  /** The company's base-currency symbol, for the money column headings. */
  currencySymbol: string
  disabled?: boolean
}

const MATCH_TONE: Record<PoMatchStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  matched: 'success',
  partial: 'warning',
  excess: 'danger',
  unlinked: 'neutral',
}

const TH = 'px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-500'
const TD = 'px-2 py-1.5 align-middle'

/**
 * The receiving grid.
 *
 * Deliberately a dense editable table and not a stack of cards: a store team receives twenty
 * lines off one challan and compares them down a column, which is what a table is for. Every
 * cell is reachable with Tab in reading order, and the row a validation message names is tinted
 * so it can be found without counting.
 *
 * Batch, expiry and serials appear only where the item says they apply — an item that is not
 * batch-tracked shows a dash rather than a disabled control, because an empty box invites the
 * question "what should go here?" on every single row.
 */
export function GrnLinesCard({
  spec,
  header,
  lines,
  onChange,
  warehouses,
  flaggedKeys,
  onScan,
  onBulkAdd,
  onImportPo,
  currencySymbol,
  disabled,
}: GrnLinesCardProps) {
  const [creatingBatch, setCreatingBatch] = useState<ReadonlySet<string>>(new Set())
  const [serialFor, setSerialFor] = useState<string | null>(null)
  const addRef = useRef<HTMLDivElement>(null)

  const update = (key: string, patch: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const remove = (key: string) => onChange(lines.filter((l) => l.key !== key))

  const setCreating = (key: string, on: boolean) =>
    setCreatingBatch((current) => {
      const next = new Set(current)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const duplicate = (line: LineDraft) => {
    const copy: LineDraft = { ...line, key: nextLineKey(), serials: [], batch_id: null, batch_no: null, expiry_date: null }
    const at = lines.findIndex((l) => l.key === line.key)
    onChange([...lines.slice(0, at + 1), copy, ...lines.slice(at + 1)])
  }

  const serialLine = lines.find((l) => l.key === serialFor) ?? null

  // Serial numbers already spoken for by the other lines, so the drawer can call out a clash
  // while it can still be fixed rather than at posting time.
  const serialsElsewhere = useMemo(() => {
    const used = new Set<string>()
    for (const line of lines) {
      if (line.key === serialFor) continue
      for (const serial of line.serials) used.add((serial.serial_no ?? `#${serial.serial_id}`).trim().toLowerCase())
    }
    return used
  }, [lines, serialFor])

  const appendFromPicker = (patch: Partial<LineDraft>) => {
    onChange([...lines, newLine(spec, { warehouse_id: header.default_warehouse_id, qty: '1', ...patch })])
  }

  return (
    <GrnCard>
      <GrnCardHeader
        icon={Boxes}
        tone="info"
        title="Items / Lines"
        description="Add items received in this challan"
        action={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              disabled={disabled}
              className="text-sky-700 border-sky-200 hover:border-sky-300"
              onClick={() => {
                onChange([...lines, newLine(spec, { warehouse_id: header.default_warehouse_id })])
                window.setTimeout(() => addRef.current?.querySelector('input')?.focus(), 0)
              }}
              kbd="Alt A"
            >
              Add item
            </Button>
            <Button variant="secondary" size="sm" icon={ScanLine} disabled={disabled} onClick={onScan}>
              Scan barcode
            </Button>
            <Button variant="secondary" size="sm" icon={ListPlus} disabled={disabled} onClick={onBulkAdd}>
              Bulk add
            </Button>
            <MenuButton
              label="More line actions"
              icon={MoreHorizontal}
              variant="secondary"
              size="sm"
              width={232}
              actions={[
                { key: 'po', label: 'Import from purchase order', icon: Copy, onSelect: onImportPo, disabled },
                {
                  key: 'warehouse',
                  label: 'Set every line to the default warehouse',
                  icon: Package,
                  disabled: disabled || header.default_warehouse_id === null,
                  onSelect: () => onChange(lines.map((l) => ({ ...l, warehouse_id: header.default_warehouse_id }))),
                },
                {
                  key: 'clear',
                  label: 'Remove all lines',
                  icon: Trash2,
                  danger: true,
                  separated: true,
                  disabled: disabled || lines.length === 0,
                  onSelect: () => onChange([newLine(spec, { warehouse_id: header.default_warehouse_id })]),
                },
              ]}
            />
          </>
        }
      />

      <div className="overflow-x-auto px-2 pb-2">
        <table className={cx(AIC, 'w-full min-w-[68rem] border-separate border-spacing-0 text-sm')}>
          <caption className="sr-only">Items received in this inward challan</caption>
          <thead>
            <tr className="bg-gray-50">
              <th scope="col" className={cx(TH, 'w-9 rounded-l-lg')}>
                #
              </th>
              <th scope="col" className={cx(TH, 'min-w-[16rem]')}>
                Item details
              </th>
              <th scope="col" className={cx(TH, 'min-w-[10rem]')}>
                Warehouse
              </th>
              <th scope="col" className={cx(TH, 'min-w-[9rem]')}>
                Batch / Lot
              </th>
              <th scope="col" className={cx(TH, 'w-32')}>
                Expiry
              </th>
              <th scope="col" className={cx(TH, 'w-24')}>
                Unit
              </th>
              <th scope="col" className={cx(TH, 'w-28 text-right')}>
                Qty received
              </th>
              <th scope="col" className={cx(TH, 'w-28 text-right')}>
                Rate ({currencySymbol})
              </th>
              <th scope="col" className={cx(TH, 'w-32 text-right')}>
                Amount ({currencySymbol})
              </th>
              <th scope="col" className={cx(TH, 'w-20 rounded-r-lg text-right')}>
                <span className="sr-only">Row actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const flagged = flaggedKeys.has(line.key)
              const match = poMatchStatus(line)
              const link = poLink(line)
              const amount = toNumber(line.amount) ?? lineAmount(line.qty, line.rate)
              const required = lineBaseQty(line)
              const serialShort = line.track_serial && required > 0 && line.serials.length !== required
              const isCreatingBatch = creatingBatch.has(line.key)
              return (
                <tr
                  key={line.key}
                  className={cx(
                    'border-b border-gray-100 transition-colors',
                    flagged ? 'bg-amber-50/70' : 'hover:bg-gray-50/60',
                    line.origin !== 'manual' && 'border-l-2 border-l-sky-400',
                  )}
                >
                  <td className={cx(TD, 'text-xs text-gray-400')}>{index + 1}</td>

                  <td className={TD}>
                    {line.item_id === null ? (
                      <GrnItemPicker
                        warehouseId={line.warehouse_id ?? header.default_warehouse_id}
                        disabled={disabled}
                        invalid={flagged}
                        bare
                        onPick={(row) => update(line.key, itemPatch(row, { warehouseId: header.default_warehouse_id }, line))}
                      />
                    ) : (
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500" aria-hidden>
                          <Package className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium leading-tight text-gray-900" title={line.item_name}>
                            {line.item_name}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] leading-tight text-gray-500">
                            <span className="truncate">{line.item_sku ?? 'No SKU'}</span>
                            {link.poNo ? (
                              <Badge tone={MATCH_TONE[match]} size="xs">
                                {PO_MATCH_LABEL[match]}
                              </Badge>
                            ) : null}
                            {line.track_serial ? (
                              <button
                                type="button"
                                className={cx(
                                  'rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide transition-colors',
                                  serialShort ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-violet-50 text-violet-700 hover:bg-violet-100',
                                )}
                                onClick={() => setSerialFor(line.key)}
                                disabled={disabled}
                              >
                                Serials {line.serials.length}
                                {required > 0 ? ` / ${formatQty(required)}` : ''}
                              </button>
                            ) : null}
                          </p>
                          {line.description ? <p className="mt-0.5 truncate text-[10px] text-gray-400">{line.description}</p> : null}
                        </div>
                      </div>
                    )}
                  </td>

                  <td className={TD}>
                    <GrnWarehouseSelect
                      value={line.warehouse_id}
                      warehouses={warehouses}
                      disabled={disabled}
                      aria-label={`Warehouse on line ${index + 1}`}
                      onChange={(id) => update(line.key, { warehouse_id: id, batch_id: null, batch_no: null, expiry_date: null, serials: [] })}
                    />
                  </td>

                  <td className={TD}>
                    {line.item_id !== null && line.track_batch ? (
                      <GrnBatchCell
                        itemId={line.item_id}
                        warehouseId={line.warehouse_id ?? header.default_warehouse_id}
                        value={line.batch_id}
                        batchNo={line.batch_no}
                        expiryDraft={line.expiry_date}
                        creating={isCreatingBatch}
                        onCreatingChange={(on) => setCreating(line.key, on)}
                        disabled={disabled}
                        invalid={flagged && line.batch_id === null}
                        onSelect={(batch: BatchRow | null) =>
                          update(line.key, {
                            batch_id: batch?.batch_id ?? null,
                            batch_no: batch?.batch_no ?? null,
                            expiry_date: batch?.expiry_date ?? null,
                            serials: [],
                          })
                        }
                      />
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>

                  <td className={TD}>
                    {line.item_id !== null && line.track_batch ? (
                      isCreatingBatch ? (
                        <Input
                          type="date"
                          size="sm"
                          aria-label="Expiry date for the new batch"
                          value={line.expiry_date ?? ''}
                          disabled={disabled}
                          onChange={(e) => update(line.key, { expiry_date: e.target.value || null })}
                        />
                      ) : (
                        <span
                          className={cx(
                            'text-xs tabular-nums',
                            line.expiry_date && line.expiry_date < header.document_date ? 'font-semibold text-amber-700' : 'text-gray-600',
                          )}
                        >
                          {line.expiry_date ? formatDate(line.expiry_date) : '—'}
                        </span>
                      )
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>

                  <td className={TD}>
                    {line.units.length > 0 ? (
                      <Select
                        aria-label="Unit"
                        value={line.unit_id ?? ''}
                        disabled={disabled}
                        onChange={(e) => update(line.key, { unit_id: e.target.value === '' ? null : Number(e.target.value) })}
                      >
                        {line.units.map((unit) => (
                          <option key={unit.unit_id} value={unit.unit_id}>
                            {unit.unit_symbol ?? unit.unit_name ?? unit.unit_id}
                            {unit.conversion_factor !== 1 ? ` ×${formatQty(unit.conversion_factor)}` : ''}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>

                  <td className={TD}>
                    <Input
                      className="text-right tabular-nums"
                      inputMode="decimal"
                      aria-label={`Quantity received on line ${index + 1}`}
                      value={line.qty}
                      disabled={disabled}
                      invalid={flagged}
                      onChange={(e) =>
                        update(line.key, {
                          qty: e.target.value,
                          amount: line.rate ? String(lineAmount(e.target.value, line.rate) ?? '') : line.amount,
                        })
                      }
                    />
                    {link.qtyOpen !== null ? (
                      <span className="mt-0.5 block text-right text-[10px] tabular-nums text-gray-400">open {formatQty(link.qtyOpen)}</span>
                    ) : null}
                  </td>

                  <td className={TD}>
                    <Input
                      className="text-right tabular-nums"
                      inputMode="decimal"
                      aria-label={`Rate on line ${index + 1}`}
                      value={line.rate}
                      disabled={disabled}
                      onChange={(e) => update(line.key, { rate: e.target.value, amount: String(lineAmount(line.qty, e.target.value) ?? '') })}
                    />
                  </td>

                  <td className={cx(TD, 'text-right text-[13px] font-semibold tabular-nums text-gray-900')}>
                    {amount === null ? <span className="font-normal text-gray-400">—</span> : formatMoney(amount)}
                  </td>

                  <td className={cx(TD, 'text-right whitespace-nowrap')}>
                    <MenuButton
                      label={`Actions for line ${index + 1}`}
                      icon={MoreHorizontal}
                      width={220}
                      actions={[
                        { key: 'duplicate', label: 'Duplicate line', icon: Copy, disabled, onSelect: () => duplicate(line) },
                        {
                          key: 'serials',
                          label: 'Serial numbers…',
                          icon: ScanLine,
                          disabled: disabled || line.item_id === null || !line.track_serial,
                          onSelect: () => setSerialFor(line.key),
                        },
                        {
                          key: 'change',
                          label: 'Change item',
                          icon: Package,
                          disabled: disabled || line.item_id === null,
                          onSelect: () =>
                            update(line.key, {
                              item_id: null,
                              item_name: '',
                              item_sku: null,
                              track_batch: false,
                              track_serial: false,
                              units: [],
                              unit_id: null,
                              batch_id: null,
                              batch_no: null,
                              expiry_date: null,
                              serials: [],
                            }),
                        },
                        {
                          key: 'remove',
                          label: 'Remove line',
                          icon: Trash2,
                          danger: true,
                          separated: true,
                          disabled,
                          onSelect: () => remove(line.key),
                        },
                      ]}
                    />
                    <Tooltip label="Remove line">
                      <Button
                        variant="ghost"
                        size="xs"
                        icon={Trash2}
                        className="text-red-500 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Remove line ${index + 1}`}
                        disabled={disabled}
                        onClick={() => remove(line.key)}
                      />
                    </Tooltip>
                  </td>
                </tr>
              )
            })}

            {lines.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-xs text-gray-500">
                  No items yet. Search below, scan a barcode, or import an open purchase order.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="px-3 pb-3" ref={addRef}>
        <div className="rounded-lg border border-dashed border-sky-200 bg-sky-50/40 px-2 py-1.5">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 shrink-0 text-sky-600" aria-hidden />
            <div className="min-w-0 flex-1">
              <GrnItemPicker
                warehouseId={header.default_warehouse_id}
                disabled={disabled}
                bare
                placeholder="Add item — search by name, SKU, barcode or scan…"
                onPick={(row) => appendFromPicker(itemPatch(row, { warehouseId: header.default_warehouse_id }))}
              />
            </div>
          </div>
        </div>
      </div>

      {serialLine && serialLine.item_id !== null ? (
        <GrnSerialDrawer
          open
          onClose={() => setSerialFor(null)}
          itemId={serialLine.item_id}
          itemName={serialLine.item_name}
          warehouseId={serialLine.warehouse_id ?? header.default_warehouse_id}
          batchId={serialLine.batch_id}
          requiredCount={lineBaseQty(serialLine)}
          value={serialLine.serials}
          usedElsewhere={serialsElsewhere}
          onChange={(serials: LineSerial[]) => update(serialLine.key, { serials })}
        />
      ) : null}
    </GrnCard>
  )
}

export default GrnLinesCard
