import { useEffect, useState } from 'react'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { Input } from '../../../ui/Input'
import { Select } from '../../../ui/Select'
import { isAbortError } from '../../../services/api'
import { lookupApi } from '../../../services/lookupApi'
import type { BatchRow } from '../../../services/lookupApi'
import { formatDate } from '../../../utils/format'
import { LAYER_STATUS_FILTERS } from './costLayersModel'

/** The keys this drawer owns, so the page can count and clear them as a set. */
export const MORE_FILTER_KEYS = ['layer_kind', 'status', 'batch_id', 'from', 'to', 'all_fy'] as const
export type MoreFilterKey = (typeof MORE_FILTER_KEYS)[number]

const LAYER_KINDS: readonly { value: string; label: string; hint: string }[] = [
  { value: '', label: 'Any kind', hint: '' },
  { value: 'opening', label: 'Opening', hint: 'Stock carried into the year.' },
  { value: 'receipt', label: 'Receipt', hint: 'A purchase, production or transfer in.' },
  { value: 'backorder', label: 'Backorder', hint: 'Issued below zero, awaiting a receipt.' },
  { value: 'revaluation', label: 'Revaluation', hint: 'A re-priced layer.' },
]

export interface CostLayersMoreFiltersProps {
  open: boolean
  onClose: () => void
  values: Record<string, string>
  onChange: (key: MoreFilterKey, value: string) => void
  onClear: () => void
  /** Batches can only be listed for a chosen item. */
  itemId: number | null
  warehouseId: number | null
  /** Set while a period is chosen, so the drawer explains who wins. */
  periodLabel?: string | null
}

/**
 * The filters that do not earn a column in the bar.
 *
 * Only filters the API can actually honour are here. A control that sifted the
 * page already downloaded — a cost band, a "high variance" switch — would be
 * lying by a factor of however many pages the item has, so those are quick
 * views over a server sort instead, or they are not offered.
 *
 * Changes apply as they are made, exactly as on every other list in the
 * product; this drawer is a place to put controls, not a gate in front of them.
 */
export function CostLayersMoreFilters({
  open,
  onClose,
  values,
  onChange,
  onClear,
  itemId,
  warehouseId,
  periodLabel,
}: CostLayersMoreFiltersProps) {
  const [batches, setBatches] = useState<BatchRow[]>([])
  const [batchState, setBatchState] = useState<'idle' | 'loading' | 'failed'>('idle')

  useEffect(() => {
    if (!open || itemId === null) {
      setBatches([])
      return undefined
    }
    const controller = new AbortController()
    setBatchState('loading')
    lookupApi
      .batches(itemId, { warehouseId, status: '', signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return
        setBatches(res.data)
        setBatchState('idle')
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setBatches([])
        // A batch list that will not load must not hide the other filters, and
        // must not look like "this item has no batches" either.
        setBatchState('failed')
      })
    return () => controller.abort()
  }, [open, itemId, warehouseId])

  const activeCount = MORE_FILTER_KEYS.filter((k) => (values[k] ?? '') !== '').length

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="More filters"
      description="Narrow the layers further. Every filter here is applied by the server, not to the page on screen."
      width="md"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={onClear} disabled={activeCount === 0}>
            Clear these filters
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-700">Layer kind</span>
            <Select value={values.layer_kind ?? ''} onChange={(e) => onChange('layer_kind', e.target.value)}>
              {LAYER_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
            <span className="text-[11px] leading-relaxed text-gray-500">
              How the layer came into existence — opening stock, a receipt, a backorder or a revaluation.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-700">Layer state</span>
            <Select value={values.status ?? ''} onChange={(e) => onChange('status', e.target.value)}>
              {LAYER_STATUS_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
            <span className="text-[11px] leading-relaxed text-gray-500">
              The same states the quick filters set; changing it moves the chip above.
            </span>
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-700">Batch / lot</span>
          <Select
            value={values.batch_id ?? ''}
            onChange={(e) => onChange('batch_id', e.target.value)}
            disabled={itemId === null || batchState === 'loading'}
          >
            <option value="">All batches</option>
            {batches.map((b) => (
              <option key={b.batch_id} value={String(b.batch_id)}>
                {b.batch_no}
                {b.lot_no ? ` · lot ${b.lot_no}` : ''}
                {b.expiry_date ? ` · expires ${formatDate(b.expiry_date)}` : ''}
              </option>
            ))}
          </Select>
          <span className="text-[11px] leading-relaxed text-gray-500">
            {itemId === null
              ? 'Choose an item first — batches are registered per item.'
              : batchState === 'failed'
                ? 'The batch list could not be loaded. The other filters still work.'
                : batchState === 'loading'
                  ? 'Loading batches…'
                  : batches.length === 0
                    ? 'This item has no batches registered.'
                    : 'Includes closed and quarantined batches, because their stock is still valued.'}
          </span>
        </label>

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-xs font-semibold text-gray-700">Received between</legend>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500">From</span>
            <Input type="date" value={values.from ?? ''} onChange={(e) => onChange('from', e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500">To</span>
            <Input type="date" value={values.to ?? ''} onChange={(e) => onChange('to', e.target.value)} />
          </label>
          <p className="text-[11px] leading-relaxed text-gray-500 sm:col-span-2">
            {periodLabel
              ? `Setting either end replaces the "${periodLabel}" period chosen above.`
              : 'Leave both empty to use the period chosen above.'}
          </p>
        </fieldset>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-200 p-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={(values.all_fy ?? '') === '1'}
            onChange={(e) => onChange('all_fy', e.target.checked ? '1' : '')}
          />
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-gray-700">All financial years</span>
            <span className="block text-[11px] leading-relaxed text-gray-500">
              Layers are carried forward year by year. Switch this on to follow an item's costing back through earlier
              years — it ignores the year selected in the header.
            </span>
          </span>
        </label>
      </div>
    </Drawer>
  )
}

export default CostLayersMoreFilters
