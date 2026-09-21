import { memo } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, CircleSlash, Copy, Eraser, ExternalLink, Minus, MoreVertical, Repeat2, Trash2 } from 'lucide-react'
import type { FormOptionWarehouse } from '../../services/items'
import type { BatchRow, ItemSearchRow } from '../../services/lookupApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { MenuButton } from '../../ui/MenuButton'
import { Select } from '../../ui/Select'
import { Tooltip } from '../../ui/Tooltip'
import { cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import { LineItemPicker } from '../LineItemPicker'
import { lineBaseQty } from '../formModel'
import type { LineDraft } from '../formModel'
import { BatchField, WarehouseField } from './BatchControls'
import { LINE_STATUS_LABEL, applyBatchMapping, applyDirection, batchMapping, clearBatchMapping, lineStatus, ownSide, worstSeverity } from './batchAdjustmentModel'
import type { BatchIssue, IssueField, LineStatus } from './batchAdjustmentModel'

const STATUS_TONE = {
  empty: 'neutral',
  matched: 'success',
  changed: 'info',
  serial_required: 'warning',
  warning: 'warning',
  error: 'danger',
} as const satisfies Record<LineStatus, 'neutral' | 'success' | 'info' | 'warning' | 'danger'>

/** Digits with at most one decimal point — a minus sign never reaches the draft. */
const QTY_PATTERN = /^\d*\.?\d*$/

export const BATCH_ROW_ID_PREFIX = 'ba-line-'

export interface BatchAdjustmentRowProps {
  line: LineDraft
  index: number
  defaultWarehouseId: number | null
  warehouses: readonly FormOptionWarehouse[]
  /** Batches for this line's item at its warehouse — both ends of the mapping pick from it. */
  batches: readonly BatchRow[] | undefined
  batchesLoading: boolean
  issues: readonly BatchIssue[]
  disabled: boolean
  readOnly: boolean
  onPatch: (key: string, patch: Partial<LineDraft>) => void
  onPickItem: (key: string, row: ItemSearchRow) => void
  onClearItem: (key: string) => void
  onRemove: (key: string) => void
  onDuplicate: (key: string) => void
  onClearMapping: (key: string) => void
  onOpenItem: (itemId: number) => void
  onOpenSerials: (key: string) => void
  onCreateBatch: (key: string, body: { batch_no: string; expiry_date: string | null }) => Promise<BatchRow>
}

function fieldIssue(issues: readonly BatchIssue[], field: IssueField): BatchIssue | undefined {
  return issues.find((i) => i.field === field && i.severity === 'error') ?? issues.find((i) => i.field === field)
}

function serialLabel(line: LineDraft): string {
  const required = lineBaseQty(line)
  if (line.serials.length === 0) return required > 0 ? `Map ${required}` : 'Map serials'
  const shown = line.serials.slice(0, 2).map((s) => s.serial_no ?? `#${s.serial_id}`).join(', ')
  const extra = line.serials.length - 2
  return extra > 0 ? `${shown} +${extra}` : shown
}

const CELL = 'px-2 py-1.5 align-middle'

/**
 * One reallocation.
 *
 * The line carries a single `batch_id` on the wire — the batch the quantity leaves on an out line,
 * the batch it lands on on an in line — so whichever of the two batch columns matches the
 * direction is the real one and the other records where the quantity goes (or came from).
 */
export const BatchAdjustmentRow = memo(function BatchAdjustmentRow({
  line,
  index,
  defaultWarehouseId,
  warehouses,
  batches,
  batchesLoading,
  issues,
  disabled,
  readOnly,
  onPatch,
  onPickItem,
  onClearItem,
  onRemove,
  onDuplicate,
  onClearMapping,
  onOpenItem,
  onOpenSerials,
  onCreateBatch,
}: BatchAdjustmentRowProps) {
  const locked = disabled || readOnly
  const mapping = batchMapping(line)
  const status = lineStatus(line, issues)
  const severity = worstSeverity(issues)
  const own = ownSide(line.direction)
  const warehouseId = line.warehouse_id ?? defaultWarehouseId
  const required = lineBaseQty(line)

  const patch = (next: Partial<LineDraft>) => onPatch(line.key, next)

  return (
    <tr
      id={`${BATCH_ROW_ID_PREFIX}${line.key}`}
      className={cx(
        'border-b border-gray-100 last:border-0 transition-colors',
        severity === 'error' ? 'bg-red-50/40' : severity === 'warning' ? 'bg-amber-50/60' : 'hover:bg-gray-50/60',
      )}
    >
      <td className={cx(CELL, 'text-center text-[11px] tabular-nums text-gray-400')}>{index}</td>

      <td className={CELL}>
        {line.item_id === null ? (
          <LineItemPicker
            itemId={null}
            itemName=""
            itemSku={null}
            warehouseId={warehouseId}
            onPick={(row) => onPickItem(line.key, row)}
            onClear={() => onClearItem(line.key)}
            disabled={locked}
            invalid={Boolean(fieldIssue(issues, 'item'))}
          />
        ) : (
          <div className="flex items-start justify-between gap-1.5">
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold text-gray-800">{line.item_sku ?? line.item_name}</div>
              <div className="truncate text-[10px] text-gray-500">{line.item_sku ? line.item_name : `Item #${line.item_id}`}</div>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {line.track_batch ? (
                  <Badge tone="neutral" size="xs">
                    Batch
                  </Badge>
                ) : null}
                {line.track_serial ? (
                  <Badge tone="violet" size="xs">
                    Serial
                  </Badge>
                ) : null}
              </div>
            </div>
            {!locked ? (
              <Tooltip label="Change the item">
                <Button variant="ghost" size="xs" icon={Repeat2} className="shrink-0" onClick={() => onClearItem(line.key)} aria-label={`Change the item on line ${index}`} />
              </Tooltip>
            ) : null}
          </div>
        )}
      </td>

      <td className={CELL}>
        <WarehouseField
          value={line.warehouse_id}
          onChange={(id) => patch({ warehouse_id: id, ...clearBatchMapping(line) })}
          warehouses={warehouses}
          emptyLabel={defaultWarehouseId ? 'Document default' : 'Select warehouse…'}
          disabled={locked}
          invalid={Boolean(fieldIssue(issues, 'warehouse'))}
          aria-label={`Warehouse on line ${index}`}
        />
      </td>

      <td className={CELL}>
        {line.item_id === null ? (
          <span className="text-[11px] text-gray-400">—</span>
        ) : line.track_batch ? (
          <BatchField
            aria-label={`Current batch on line ${index}`}
            value={mapping.from_batch_id}
            valueLabel={mapping.from_batch_no}
            rows={batches}
            loading={batchesLoading}
            disabled={locked}
            invalid={Boolean(fieldIssue(issues, 'from_batch'))}
            onChange={(batch) => patch(applyBatchMapping(line, 'from', batch))}
          />
        ) : (
          <span className="text-[11px] text-gray-400">Not batch tracked</span>
        )}
      </td>

      <td className={CELL}>
        {line.item_id === null ? (
          <span className="text-[11px] text-gray-400">—</span>
        ) : line.track_batch ? (
          <BatchField
            aria-label={`Revised batch on line ${index}`}
            value={mapping.to_batch_id}
            valueLabel={mapping.to_batch_no}
            rows={batches}
            loading={batchesLoading}
            disabled={locked}
            invalid={Boolean(fieldIssue(issues, 'to_batch'))}
            onChange={(batch) => patch(applyBatchMapping(line, 'to', batch))}
            // A batch can only be brought into existence where the quantity lands.
            onCreate={own === 'to' && !locked ? (body) => onCreateBatch(line.key, body) : undefined}
          />
        ) : (
          <span className="text-[11px] text-gray-400">Not batch tracked</span>
        )}
      </td>

      <td className={CELL}>
        {line.units.length > 0 ? (
          <Select
            value={line.unit_id ?? ''}
            disabled={locked}
            aria-label={`Unit on line ${index}`}
            onChange={(e) => patch({ unit_id: e.target.value === '' ? null : Number(e.target.value) })}
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

      <td className={CELL}>
        <div className="flex items-center gap-1">
          {line.direction === 'out' ? (
            <ArrowDownToLine className="h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden />
          ) : line.direction === 'in' ? (
            <ArrowUpFromLine className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
          ) : (
            <Minus className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
          )}
          <Select
            value={line.direction ?? ''}
            disabled={locked}
            invalid={Boolean(fieldIssue(issues, 'direction'))}
            aria-label={`Direction on line ${index}`}
            className={cx('!px-1.5', line.direction === 'out' ? 'text-red-700' : line.direction === 'in' ? 'text-emerald-700' : undefined)}
            onChange={(e) => patch(applyDirection(line, e.target.value === 'in' ? 'in' : e.target.value === 'out' ? 'out' : null))}
          >
            <option value="">—</option>
            <option value="out">Out</option>
            <option value="in">In</option>
          </Select>
        </div>
      </td>

      <td className={CELL}>
        <Input
          value={line.qty}
          inputMode="decimal"
          disabled={locked}
          invalid={Boolean(fieldIssue(issues, 'qty'))}
          aria-label={`Quantity on line ${index}`}
          className="text-right tabular-nums"
          onChange={(e) => {
            if (QTY_PATTERN.test(e.target.value)) patch({ qty: e.target.value })
          }}
        />
      </td>

      <td className={CELL}>
        {line.item_id !== null && line.track_serial ? (
          <Tooltip label={required > 0 ? `${line.serials.length} of ${required} mapped` : 'Serial mapping'}>
            <Button
              variant={fieldIssue(issues, 'serials') ? 'outline' : 'secondary'}
              size="xs"
              disabled={locked}
              className="w-full justify-start"
              onClick={() => onOpenSerials(line.key)}
            >
              {serialLabel(line)}
            </Button>
          </Tooltip>
        ) : (
          <span className="text-[11px] text-gray-400">—</span>
        )}
      </td>

      <td className={CELL}>
        <Input
          value={line.description}
          disabled={locked}
          placeholder="Add a note…"
          aria-label={`Note on line ${index}`}
          onChange={(e) => patch({ description: e.target.value })}
        />
      </td>

      <td className={CELL}>
        {/* A row nobody has typed in yet has no status to report. */}
        {status === 'empty' ? null : (
          <Badge tone={STATUS_TONE[status]} size="xs" dot>
            {LINE_STATUS_LABEL[status]}
          </Badge>
        )}
      </td>

      <td className={cx(CELL, 'text-right')}>
        {readOnly ? null : (
          <MenuButton
            label={`Actions for line ${index}`}
            icon={MoreVertical}
            width={224}
            actions={[
              { key: 'duplicate', label: 'Duplicate line', icon: Copy, onSelect: () => onDuplicate(line.key), disabled },
              { key: 'clear', label: 'Clear batch mapping', icon: Eraser, onSelect: () => onClearMapping(line.key), disabled: disabled || !line.track_batch },
              { key: 'item', label: 'Open item details', icon: ExternalLink, onSelect: () => line.item_id !== null && onOpenItem(line.item_id), disabled: line.item_id === null },
              { key: 'remove', label: 'Remove line', icon: Trash2, onSelect: () => onRemove(line.key), danger: true, separated: true, disabled },
            ]}
          />
        )}
      </td>
    </tr>
  )
})

/** The row the reader sees when a filtered tab has nothing in it. */
export function BatchEmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-6 text-center text-xs text-gray-500">
        <CircleSlash className="mx-auto mb-1.5 h-4 w-4 text-gray-300" aria-hidden />
        {message}
      </td>
    </tr>
  )
}

export default BatchAdjustmentRow
