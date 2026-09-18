import { memo, useCallback } from 'react'
import type { ReactNode } from 'react'
import { ArrowUpFromLine, Merge, Plus, Trash2, Wand2 } from 'lucide-react'
import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Select } from '../../ui/Select'
import { Tooltip } from '../../ui/Tooltip'
import { cx } from '../../ui/cx'
import { formatCurrency, formatQty } from '../../utils/format'
import { BatchPicker } from '../BatchPicker'
import { LineItemPicker } from '../LineItemPicker'
import { SerialPicker } from '../SerialPicker'
import { WarehouseSelect } from '../WarehouseSelect'
import { lineBaseQty } from '../formModel'
import type { LineDraft } from '../formModel'
import { CellMessage, NumberCell, PickedItemCell } from './LineCells'
import { COST_BASES, COST_BASIS_HELP, COST_BASIS_LABELS, lineValue } from './model'
import type { CostBasis } from './model'
import type { DisassemblyIssue } from './validation'

export interface ComponentsSectionProps {
  lines: LineDraft[]
  warehouses: FormOptionWarehouse[]
  defaultWarehouseId: number | null
  fieldErrors: Map<string, DisassemblyIssue>
  duplicateKeys: ReadonlySet<string>
  currencyCode: string | null
  costBasis: CostBasis
  costsLoading: boolean
  onCostBasisChange: (basis: CostBasis) => void
  onMergeDuplicates: () => void
  onUpdate: (key: string, patch: Partial<LineDraft>) => void
  onCostEdited: (key: string) => void
  onPick: (key: string, row: ItemSearchRow) => void
  onClear: (key: string) => void
  onAdd: () => void
  onRemove: (key: string) => void
  onAutoFill: () => void
  autoFillDisabled?: boolean
  autoFillLabel?: string
  /** Banner above the rows — today, the offer to rescale after the parent quantity changed. */
  notice?: ReactNode
  disabled?: boolean
}

/* See FinishedProductSection for why the minimums and the scroll floor are stated together. */
const GRID =
  'grid items-start gap-2 grid-cols-[1.75rem_minmax(10rem,2.2fr)_minmax(7rem,1.1fr)_minmax(7rem,1fr)_minmax(5rem,0.8fr)_minmax(4rem,0.6fr)_minmax(5.5rem,0.9fr)_minmax(5.5rem,0.9fr)_2rem]'
const SCROLL_MIN = 'min-w-[52rem]'

function errorOf(errors: Map<string, DisassemblyIssue>, key: string, field: string): DisassemblyIssue | undefined {
  return errors.get(`${key}:${field}`)
}

interface RowProps {
  line: LineDraft
  index: number
  warehouses: FormOptionWarehouse[]
  defaultWarehouseId: number | null
  fieldErrors: Map<string, DisassemblyIssue>
  duplicate: boolean
  currencyCode: string | null
  costBasis: CostBasis
  onUpdate: (key: string, patch: Partial<LineDraft>) => void
  onCostEdited: (key: string) => void
  onPick: (key: string, row: ItemSearchRow) => void
  onClear: (key: string) => void
  onRemove: (key: string) => void
  removable: boolean
  disabled?: boolean
}

const ComponentRow = memo(function ComponentRow({
  line,
  index,
  warehouses,
  defaultWarehouseId,
  fieldErrors,
  duplicate,
  currencyCode,
  costBasis,
  onUpdate,
  onCostEdited,
  onPick,
  onClear,
  onRemove,
  removable,
  disabled,
}: RowProps) {
  const update = useCallback((patch: Partial<LineDraft>) => onUpdate(line.key, patch), [onUpdate, line.key])
  const itemError = errorOf(fieldErrors, line.key, 'item')
  const qtyError = errorOf(fieldErrors, line.key, 'qty')
  const whError = errorOf(fieldErrors, line.key, 'warehouse')
  const costError = errorOf(fieldErrors, line.key, 'cost')
  const serialError = errorOf(fieldErrors, line.key, 'serials')
  const warehouseId = line.warehouse_id ?? defaultWarehouseId
  const need = lineBaseQty(line)
  const value = lineValue(line)

  return (
    <div className={cx(GRID, 'border-t border-gray-100 px-3 py-2.5 first:border-t-0', duplicate && 'bg-amber-50/50')}>
      <div className="pt-2 text-xs font-medium tabular-nums text-gray-400">{index + 1}</div>

      <div className="min-w-0">
        {line.item_id === null ? (
          <LineItemPicker
            itemId={null}
            itemName=""
            itemSku={null}
            warehouseId={warehouseId}
            onPick={(row) => onPick(line.key, row)}
            onClear={() => onClear(line.key)}
            disabled={disabled}
            invalid={Boolean(itemError)}
          />
        ) : (
          <PickedItemCell line={line} tone="sky" onChangeItem={() => onClear(line.key)} disabled={disabled} />
        )}
        {itemError ? <CellMessage message={itemError.message} severity={itemError.severity} /> : null}
      </div>

      <div className="min-w-0">
        {line.item_id && line.track_batch ? (
          <BatchPicker
            itemId={line.item_id}
            warehouseId={warehouseId}
            value={line.batch_id}
            onChange={(b) => update({ batch_id: b?.batch_id ?? null, batch_no: b?.batch_no ?? null })}
            allowCreate
            disabled={disabled}
            variant="field"
            autoLabel="AUTO — new batch on posting"
          />
        ) : (
          <span className="inline-flex h-8 items-center text-xs text-gray-400">AUTO</span>
        )}
        {line.item_id && line.track_serial ? (
          <div className="mt-1.5">
            <SerialPicker
              itemId={line.item_id}
              itemName={line.item_name}
              warehouseId={warehouseId}
              batchId={line.batch_id}
              direction="in"
              value={line.serials}
              onChange={(serials) => update({ serials })}
              requiredCount={need}
              disabled={disabled}
              variant="field"
            />
          </div>
        ) : null}
        {serialError ? <CellMessage message={serialError.message} severity={serialError.severity} /> : null}
      </div>

      <div className="min-w-0">
        <WarehouseSelect
          value={line.warehouse_id}
          onChange={(id) => update({ warehouse_id: id, batch_id: null, batch_no: null, serials: [] })}
          warehouses={warehouses}
          disabled={disabled}
          invalid={Boolean(whError)}
          variant="field"
        />
        {whError ? <CellMessage message={whError.message} severity={whError.severity} /> : null}
      </div>

      <div className="min-w-0">
        <NumberCell
          value={line.qty}
          onChange={(v) => update({ qty: v })}
          ariaLabel={`Quantity produced, row ${index + 1}`}
          invalid={qtyError?.severity === 'error'}
          disabled={disabled}
          placeholder="0.00"
        />
        {qtyError ? <CellMessage message={qtyError.message} severity={qtyError.severity} /> : null}
      </div>

      <div className="min-w-0">
        {line.units.length > 0 ? (
          <Select
            value={line.unit_id ?? ''}
            disabled={disabled}
            aria-label={`Unit, row ${index + 1}`}
            onChange={(e) => update({ unit_id: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">—</option>
            {line.units.map((u) => (
              <option key={u.unit_id} value={u.unit_id}>
                {u.unit_symbol ?? u.unit_name ?? u.unit_id}
                {u.conversion_factor !== 1 ? ` ×${formatQty(u.conversion_factor)}` : ''}
              </option>
            ))}
          </Select>
        ) : (
          <span className="inline-flex h-8 items-center text-xs text-gray-400">—</span>
        )}
      </div>

      <div className="min-w-0">
        <NumberCell
          value={line.valuation_rate}
          onChange={(v) => {
            onCostEdited(line.key)
            update({ valuation_rate: v })
          }}
          ariaLabel={`Estimated unit cost, row ${index + 1}`}
          invalid={costError?.severity === 'error'}
          disabled={disabled || (costBasis !== 'manual' && costBasis !== 'component_cost')}
          placeholder="0.00"
        />
        {costError?.severity === 'error' ? <CellMessage message={costError.message} severity="error" /> : null}
      </div>

      <div className="min-w-0 pt-1.5 text-right text-sm font-semibold tabular-nums text-gray-900">
        {value > 0 ? formatCurrency(value, currencyCode ?? undefined) : <span className="text-gray-400">—</span>}
      </div>

      <div className="pt-1">
        <button
          type="button"
          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-300/50 disabled:opacity-40"
          onClick={() => onRemove(line.key)}
          disabled={disabled || !removable}
          aria-label={`Remove component row ${index + 1}`}
          title="Remove row"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
})

/** What is recovered. Blue and upward everywhere, against the green and downward of the parent. */
export function ComponentsSection({
  lines,
  warehouses,
  defaultWarehouseId,
  fieldErrors,
  duplicateKeys,
  currencyCode,
  costBasis,
  costsLoading,
  onCostBasisChange,
  onMergeDuplicates,
  onUpdate,
  onCostEdited,
  onPick,
  onClear,
  onAdd,
  onRemove,
  onAutoFill,
  autoFillDisabled,
  autoFillLabel,
  notice,
  disabled,
}: ComponentsSectionProps) {
  const removable = lines.length > 1
  const hasItem = lines.some((l) => l.item_id !== null)

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200" aria-labelledby="components-heading">
      <header className="flex flex-wrap items-center gap-2 border-b border-sky-100 bg-sky-50/70 px-3 py-2">
        <ArrowUpFromLine className="h-4 w-4 shrink-0 text-sky-700" aria-hidden />
        <h3 id="components-heading" className="text-[13px] font-bold text-sky-900">
          Components
        </h3>
        <span className="text-[12px] text-sky-700">will be produced in stock</span>
        <Badge tone="info" size="xs" className="ml-auto">
          Stock in
        </Badge>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-white px-3 py-2">
        <label htmlFor="cost-basis" className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Cost basis
        </label>
        <div className="w-full max-w-xs sm:w-64">
          <Select id="cost-basis" value={costBasis} disabled={disabled} onChange={(e) => onCostBasisChange(e.target.value as CostBasis)}>
            {COST_BASES.map((basis) => (
              <option key={basis} value={basis}>
                {COST_BASIS_LABELS[basis]}
              </option>
            ))}
          </Select>
        </div>
        <Tooltip label={COST_BASIS_HELP[costBasis]}>
          <span className="text-[11px] text-gray-500">{costsLoading ? 'Reading current cost…' : 'What each recovered component is valued at.'}</span>
        </Tooltip>
        {duplicateKeys.size > 0 ? (
          <Button variant="secondary" size="xs" icon={Merge} onClick={onMergeDuplicates} disabled={disabled} className="ml-auto">
            Merge {duplicateKeys.size} duplicate rows
          </Button>
        ) : null}
      </div>

      {notice}

      <div className="overflow-x-auto scrollbar-thin">
        <div className={SCROLL_MIN}>
          <div className={cx(GRID, 'bg-gray-50/80 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500')}>
            <span>#</span>
            <span>Item (component)</span>
            <span>Batch / serial</span>
            <span>Warehouse</span>
            <span>Qty produced</span>
            <span>Unit</span>
            <span>Est. unit cost</span>
            <span className="text-right">Total value</span>
            <span className="sr-only">Actions</span>
          </div>
          <div className="bg-white">
            {lines.map((line, i) => (
              <ComponentRow
                key={line.key}
                line={line}
                index={i}
                warehouses={warehouses}
                defaultWarehouseId={defaultWarehouseId}
                fieldErrors={fieldErrors}
                duplicate={duplicateKeys.has(line.key)}
                currencyCode={currencyCode}
                costBasis={costBasis}
                onUpdate={onUpdate}
                onCostEdited={onCostEdited}
                onPick={onPick}
                onClear={onClear}
                onRemove={onRemove}
                removable={removable}
                disabled={disabled}
              />
            ))}
          </div>
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-gray-50/60 px-3 py-2">
        <Button variant="secondary" size="xs" icon={Plus} onClick={onAdd} disabled={disabled} title="Add component (Alt+N)">
          Add component
        </Button>
        <Button variant="outline" size="xs" icon={Wand2} onClick={onAutoFill} disabled={disabled || autoFillDisabled} title={autoFillLabel}>
          Auto-fill components
        </Button>
        {!hasItem ? <span className="text-[12px] text-gray-500">Load a bill of materials, scan a barcode, or search for each component.</span> : null}
      </footer>
    </section>
  )
}
