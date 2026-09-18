import { useMemo } from 'react'
import { AlertTriangle, Copy, PackageSearch, Trash2 } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Tooltip } from '../../ui/Tooltip'
import { cx } from '../../ui/cx'
import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { AvailabilityCheckResult, PendingRow } from '../../services/stockApi'
import { shortBy } from '../../services/stockApi'
import { formatDate, formatQty, toNumber } from '../../utils/format'
import { BatchPicker } from '../BatchPicker'
import { LineItemPicker } from '../LineItemPicker'
import { SerialPicker } from '../SerialPicker'
import { WarehouseSelect } from '../WarehouseSelect'
import { lineAmount, lineBaseQty } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { unitOptionsFrom } from '../LineEditor'
import { pendingForItem } from './jobWorkers'

export interface LineIssues {
  /** Draft line keys with a validation problem, by field. */
  item?: boolean
  qty?: boolean
  warehouse?: boolean
  serials?: boolean
  batch?: boolean
}

interface JobWorkLineTableProps {
  header: HeaderDraft
  lines: LineDraft[]
  onChange: (lines: LineDraft[]) => void
  warehouses: FormOptionWarehouse[]
  availability: Record<string, AvailabilityCheckResult>
  checking: boolean
  /** Open job-work pending rows, for "already out with this job worker". */
  pending: PendingRow[]
  partyRef: number | null
  offendingKeys: ReadonlySet<string>
  issues: Record<string, LineIssues>
  /** `block` refuses the post server-side; `warn` / `allow` let it through. */
  negativeStockPolicy: string
  currency: string
  /** Hide the challan rate / value columns when the reader may not see them. */
  showValue: boolean
  disabled?: boolean
}

/** Availability shown as a fact plus a judgement, never colour alone. */
function availabilityHint(
  result: AvailabilityCheckResult | undefined,
  checking: boolean,
  hasItem: boolean,
  baseQty: number,
  warehouseName: string,
  blocking: boolean,
): { text: string; tone: 'muted' | 'ok' | 'warn' | 'bad'; icon: boolean } {
  if (!hasItem) return { text: 'Pick an item to see what is on hand', tone: 'muted', icon: false }
  if (!result) return { text: checking ? 'Checking availability…' : 'Enter a quantity to check availability', tone: 'muted', icon: false }
  const available = Number(result.available) || 0
  if (!result.ok) {
    const short = shortBy(result)
    return {
      text: `Only ${formatQty(available)} available${warehouseName ? ` in ${warehouseName}` : ''} — short by ${formatQty(short)}${blocking ? '' : ' (posts with a warning)'}`,
      tone: 'bad',
      icon: true,
    }
  }
  // "Comfortably available" is not a number this app owns, so the amber band is the one case
  // that is not a judgement call: what is left after this line would not cover it again.
  if (baseQty > 0 && available - baseQty < baseQty) {
    return { text: `${formatQty(available)} available${warehouseName ? ` in ${warehouseName}` : ''} — little spare after this line`, tone: 'warn', icon: false }
  }
  return { text: `${formatQty(available)} available${warehouseName ? ` in ${warehouseName}` : ''}`, tone: 'ok', icon: false }
}

const HINT_TONE = {
  muted: 'text-gray-400',
  ok: 'text-emerald-700',
  warn: 'text-amber-700',
  bad: 'text-red-700',
} as const

const TH = 'px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500 whitespace-nowrap'
const TD = 'px-2 py-2 align-top border-b border-gray-100'

/**
 * The material going out.
 *
 * Every figure in a row is live: availability comes from `POST /v1/availability/check` through
 * useAvailability, batches and serials from their own endpoints, and the "already out" hint
 * from the open pending rows. Nothing here is computed from an assumption about stock.
 */
export function JobWorkLineTable({
  header,
  lines,
  onChange,
  warehouses,
  availability,
  checking,
  pending,
  partyRef,
  offendingKeys,
  issues,
  negativeStockPolicy,
  currency,
  showValue,
  disabled = false,
}: JobWorkLineTableProps) {
  const blocking = negativeStockPolicy === 'block'
  const warehouseName = useMemo(() => {
    const byId = new Map(warehouses.map((w) => [w.warehouse_id, w.warehouse_name]))
    return (id: number | null) => (id === null ? '' : (byId.get(id) ?? ''))
  }, [warehouses])

  const update = (key: string, patch: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const remove = (key: string) => onChange(lines.filter((l) => l.key !== key))
  const duplicate = (key: string) => {
    const source = lines.find((l) => l.key === key)
    if (!source) return
    const index = lines.findIndex((l) => l.key === key)
    // A fresh key and fresh serials: serial numbers are unique, so copying them would put the
    // same physical unit on two lines and the server would refuse the document.
    const copy: LineDraft = { ...source, key: `${source.key}-c${Date.now().toString(36)}`, serials: [] }
    onChange([...lines.slice(0, index + 1), copy, ...lines.slice(index + 1)])
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
      warehouse_id: line.warehouse_id ?? row.default_warehouse_id ?? header.default_warehouse_id ?? null,
      batch_id: null,
      batch_no: null,
      serials: [],
    })
  }

  const clear = (line: LineDraft) =>
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
      serials: [],
    })

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-xs">
        <thead>
          <tr className="bg-gray-50">
            <th scope="col" className={cx(TH, 'w-8')}>#</th>
            <th scope="col" className={cx(TH, 'min-w-[15rem]')}>Item details</th>
            <th scope="col" className={cx(TH, 'min-w-[9rem]')}>Warehouse</th>
            <th scope="col" className={cx(TH, 'min-w-[9rem]')}>Batch / lot</th>
            <th scope="col" className={cx(TH, 'min-w-[7rem]')}>Serials</th>
            <th scope="col" className={cx(TH, 'min-w-[6rem]')}>Unit</th>
            <th scope="col" className={cx(TH, 'text-right min-w-[6rem]')}>Qty</th>
            {showValue ? (
              <>
                <th scope="col" className={cx(TH, 'text-right min-w-[7rem]')}>
                  <Tooltip label="What the delivery challan declares the goods are worth. It is not a cost and posts no accounting entry — Table 4 of FORM GST ITC-04 is filed from it.">
                    <span className="cursor-help border-b border-dotted border-gray-400">Challan rate</span>
                  </Tooltip>{' '}({currency})
                </th>
                <th scope="col" className={cx(TH, 'text-right min-w-[7rem]')}>Challan value</th>
              </>
            ) : null}
            <th scope="col" className={cx(TH, 'min-w-[8rem]')}>
              <Tooltip label="Recorded on the line for reference. The document's expected return date is the one the job-work register tracks.">
                <span className="cursor-help border-b border-dotted border-gray-400">Expected return</span>
              </Tooltip>
            </th>
            <th scope="col" className={cx(TH, 'w-20 text-right')}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            const issue = issues[line.key] ?? {}
            const offending = offendingKeys.has(line.key)
            const warehouseId = line.warehouse_id ?? header.default_warehouse_id
            const baseQty = lineBaseQty(line)
            const hint = availabilityHint(
              availability[line.key],
              checking,
              line.item_id !== null,
              baseQty,
              warehouseName(warehouseId),
              blocking,
            )
            const alreadyOut = pendingForItem(pending, partyRef, line.item_id)
            const rowReturn = typeof line.metadata?.expected_return_date === 'string' ? line.metadata.expected_return_date : ''
            const qtyNum = toNumber(line.qty)
            const serialMismatch = line.track_serial && line.serials.length > 0 && qtyNum !== null && line.serials.length !== baseQty

            return (
              <tr
                key={line.key}
                className={cx(
                  'transition-colors',
                  offending ? 'bg-red-50/60' : 'hover:bg-gray-50/60',
                )}
              >
                <td className={cx(TD, 'text-gray-400 tabular-nums')}>{i + 1}</td>

                <td className={TD}>
                  <LineItemPicker
                    itemId={line.item_id}
                    itemName={line.item_name}
                    itemSku={line.item_sku}
                    warehouseId={warehouseId}
                    onPick={(row) => pick(line, row)}
                    onClear={() => clear(line)}
                    disabled={disabled}
                    invalid={offending || issue.item}
                  />
                  <p className={cx('mt-1 flex items-start gap-1 text-[10px] leading-snug', HINT_TONE[hint.tone])}>
                    {hint.icon ? <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden /> : null}
                    <span>{hint.text}</span>
                  </p>
                  {alreadyOut ? (
                    <p className="mt-0.5 text-[10px] leading-snug text-violet-700">
                      {formatQty(alreadyOut.qty_open)} already out with this job worker
                      {alreadyOut.since ? ` since ${formatDate(alreadyOut.since)}` : ''}
                    </p>
                  ) : null}
                </td>

                <td className={TD}>
                  <WarehouseSelect
                    value={line.warehouse_id}
                    onChange={(id) =>
                      // Changing the source invalidates the batch and the serials picked from
                      // the old one; availability re-checks itself off the new warehouse.
                      update(line.key, { warehouse_id: id, batch_id: null, batch_no: null, serials: [] })
                    }
                    warehouses={warehouses}
                    disabled={disabled}
                    invalid={issue.warehouse}
                  />
                </td>

                <td className={TD}>
                  {line.item_id && line.track_batch ? (
                    <BatchPicker
                      itemId={line.item_id}
                      warehouseId={warehouseId}
                      value={line.batch_id}
                      onChange={(b) => update(line.key, { batch_id: b?.batch_id ?? null, batch_no: b?.batch_no ?? null })}
                      allowCreate={false}
                      disabled={disabled}
                    />
                  ) : (
                    <span className="text-gray-400">{line.batch_no ?? '—'}</span>
                  )}
                </td>

                <td className={TD}>
                  {line.item_id && line.track_serial ? (
                    <>
                      <SerialPicker
                        itemId={line.item_id}
                        itemName={line.item_name}
                        warehouseId={warehouseId}
                        batchId={line.batch_id}
                        direction="out"
                        value={line.serials}
                        onChange={(serials) => update(line.key, { serials })}
                        requiredCount={baseQty}
                        disabled={disabled}
                      />
                      {serialMismatch ? (
                        <p className="mt-1 text-[10px] leading-snug text-red-700">
                          {line.serials.length} picked for {formatQty(baseQty)}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>

                <td className={TD}>
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
                    <span className="text-gray-400">—</span>
                  )}
                </td>

                <td className={TD}>
                  <Input
                    size="sm"
                    inputMode="decimal"
                    className="text-right tabular-nums"
                    value={line.qty}
                    disabled={disabled}
                    invalid={offending || issue.qty}
                    aria-label={`Quantity for line ${i + 1}`}
                    onChange={(e) =>
                      update(line.key, {
                        qty: e.target.value,
                        amount: line.rate ? String(lineAmount(e.target.value, line.rate) ?? '') : line.amount,
                      })
                    }
                  />
                </td>

                {showValue ? (
                  <>
                    <td className={TD}>
                      <Input
                        size="sm"
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        value={line.rate}
                        disabled={disabled}
                        aria-label={`Challan rate for line ${i + 1}`}
                        onChange={(e) => update(line.key, { rate: e.target.value, amount: String(lineAmount(line.qty, e.target.value) ?? '') })}
                      />
                    </td>
                    <td className={TD}>
                      <Input
                        size="sm"
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        value={line.amount}
                        disabled={disabled}
                        aria-label={`Challan value for line ${i + 1}`}
                        onChange={(e) => update(line.key, { amount: e.target.value })}
                      />
                    </td>
                  </>
                ) : null}

                <td className={TD}>
                  <Input
                    size="sm"
                    type="date"
                    value={rowReturn || header.expected_return_date}
                    disabled={disabled}
                    aria-label={`Expected return for line ${i + 1}`}
                    onChange={(e) => {
                      const next = e.target.value
                      const meta = { ...(line.metadata ?? {}) }
                      // Only an override is stored. Writing the header's own date onto every
                      // line would put a copy on record that nothing keeps in step with it.
                      if (!next || next === header.expected_return_date) delete meta.expected_return_date
                      else meta.expected_return_date = next
                      update(line.key, { metadata: Object.keys(meta).length ? meta : null })
                    }}
                  />
                </td>

                <td className={cx(TD, 'text-right')}>
                  <div className="flex items-center justify-end gap-1">
                    <Tooltip label="Duplicate line">
                      <Button
                        variant="ghost"
                        size="xs"
                        icon={Copy}
                        disabled={disabled}
                        onClick={() => duplicate(line.key)}
                        aria-label={`Duplicate line ${i + 1}`}
                      />
                    </Tooltip>
                    <Tooltip label={lines.length === 1 ? 'Clear line' : 'Remove line'}>
                      <Button
                        variant="ghost"
                        size="xs"
                        icon={Trash2}
                        disabled={disabled}
                        className="hover:text-red-600"
                        onClick={() => (lines.length === 1 ? clear(line) : remove(line.key))}
                        aria-label={`Remove line ${i + 1}`}
                      />
                    </Tooltip>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {lines.length === 0 ? (
        <p className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-gray-500">
          <PackageSearch className="h-4 w-4 text-gray-400" aria-hidden />
          Add the materials you are sending to the job worker.
        </p>
      ) : null}
    </div>
  )
}

export default JobWorkLineTable
