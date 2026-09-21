import { useEffect, useState } from 'react'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { useDebounce } from '../hooks/useDebounce'
import { isAbortError } from '../services/api'
import { lookupApi } from '../services/lookupApi'
import type { ItemSearchRow } from '../services/lookupApi'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { formatQty } from '../utils/format'
import { lineFromItemRow } from './openingStock/openingStockHelpers'
import type { LineDraft } from './formModel'
import type { DocumentTypeSpec } from './registry'

interface AddMultipleItemsModalProps {
  open: boolean
  onClose: () => void
  spec: DocumentTypeSpec
  defaultWarehouseId: number | null
  /** Items already on the draft — flagged, never disabled: a second line for the same item is valid. */
  existingItemIds: ReadonlySet<number>
  onConfirm: (lines: LineDraft[]) => void
}

/** Search-as-you-type, multi-select, one modal for every "add several lines at once" entry point. */
export function AddMultipleItemsModal({ open, onClose, spec, defaultWarehouseId, existingItemIds, onConfirm }: AddMultipleItemsModalProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Map<number, ItemSearchRow>>(new Map())
  const debounced = useDebounce(query, 250)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setRows([])
    setPicked(new Map())
    setError(null)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    lookupApi
      .searchItems(debounced.trim(), { limit: 30, signal: controller.signal })
      .then((found) => {
        if (controller.signal.aborted) return
        setRows(found)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setError('Item search is temporarily unavailable.')
        setLoading(false)
      })
    return () => controller.abort()
  }, [open, debounced])

  const toggle = (row: ItemSearchRow) =>
    setPicked((m) => {
      const next = new Map(m)
      if (next.has(row.item_id)) next.delete(row.item_id)
      else next.set(row.item_id, row)
      return next
    })

  const confirm = () => {
    onConfirm([...picked.values()].map((row) => lineFromItemRow(spec, defaultWarehouseId, row)))
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add multiple items"
      description="Search and select as many items as you need, then add them all at once."
      size="lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={confirm} disabled={picked.size === 0}>
            Add {picked.size} item{picked.size === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <input
        type="text"
        className="input"
        autoFocus
        placeholder="Search item by name, SKU or barcode…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search items"
      />

      {picked.size > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[...picked.values()].map((row) => (
            <span key={row.item_id} className="chip">
              {row.print_name || row.item_name}
              <button type="button" aria-label={`Remove ${row.item_name}`} onClick={() => toggle(row)}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {error ? (
        <Notice kind="error" className="mt-3">
          {error}
        </Notice>
      ) : null}

      <div className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-gray-200">
        {loading ? <div className="p-4 text-center text-sm text-gray-400">Searching…</div> : null}
        {!loading && rows.length === 0 ? <EmptyState size="sm" title="No matching items" description={query.trim() ? undefined : 'Start typing to search the item master.'} /> : null}
        {!loading &&
          rows.map((row) => {
            const checked = picked.has(row.item_id)
            const already = existingItemIds.has(row.item_id)
            return (
              <label key={row.item_id} className="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-3 py-2 last:border-b-0 hover:bg-gray-50">
                <input type="checkbox" checked={checked} onChange={() => toggle(row)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">{row.print_name || row.item_name}</span>
                    {already ? (
                      <Badge tone="info" size="xs">
                        Already added
                      </Badge>
                    ) : null}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {[row.item_sku, row.unit_symbol].filter(Boolean).join(' · ') || '—'}
                    {row.stock ? ` · on hand ${formatQty(row.stock.on_hand)}` : ''}
                    {row.track_batch ? ' · batch' : ''}
                    {row.track_serial ? ' · serial' : ''}
                  </span>
                </span>
              </label>
            )
          })}
      </div>
    </Modal>
  )
}

export default AddMultipleItemsModal
