import { useEffect, useState } from 'react'
import { isAbortError } from '../services/api'
import { lookupApi } from '../services/lookupApi'
import { ItemPicker } from './ItemPicker'
import type { PickedItem } from './ItemPicker'

interface ItemFilterProps {
  /** `item_id` as kept in the URL ('' = none). */
  value: string
  onChange: (itemId: string) => void
  placeholder?: string
  id?: string
}

/**
 * Item typeahead bound to a URL filter. When the page loads with an `item_id`
 * already in the URL the name is looked up so the chip does not read "Item #12".
 */
export function ItemFilter({ value, onChange, placeholder = 'Filter by item…', id }: ItemFilterProps) {
  const [picked, setPicked] = useState<PickedItem | null>(null)
  const wanted = value ? Number(value) : null

  useEffect(() => {
    if (wanted === null || !Number.isFinite(wanted) || picked?.item_id === wanted) return undefined
    const controller = new AbortController()
    lookupApi
      .itemsByIds([wanted], controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return
        const row = rows[0]
        setPicked(row ? { item_id: row.item_id, item_name: row.item_name, item_sku: row.item_sku, unit_id: row.unit_id, unit_symbol: row.unit_symbol } : { item_id: wanted, item_name: `Item #${wanted}` })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setPicked({ item_id: wanted, item_name: `Item #${wanted}` })
      })
    return () => controller.abort()
  }, [wanted, picked?.item_id])

  if (wanted === null) {
    return (
      <div className="grow" style={{ maxWidth: '22rem' }}>
        <ItemPicker
          id={id}
          value={null}
          placeholder={placeholder}
          onChange={(it) => {
            setPicked(it)
            onChange(it ? String(it.item_id) : '')
          }}
        />
      </div>
    )
  }

  return (
    <div className="typeahead-selected" style={{ maxWidth: '22rem' }}>
      <span>
        <strong>{picked?.item_id === wanted ? picked.item_name : `Item #${wanted}`}</strong>
        {picked?.item_id === wanted && picked.item_sku ? <span className="muted"> · {picked.item_sku}</span> : null}
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          setPicked(null)
          onChange('')
        }}
        aria-label="Clear item filter"
      >
        Clear
      </button>
    </div>
  )
}
