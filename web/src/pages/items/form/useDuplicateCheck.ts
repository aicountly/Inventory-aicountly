import { useEffect, useMemo, useState } from 'react'
import { useDebounce } from '../../../hooks/useDebounce'
import { isAbortError } from '../../../services/api'
import { itemsApi } from '../../../services/items'
import type { ItemSearchRow } from '../../../services/items'
import type { ItemFormState } from '../itemForm'
import { classifyDuplicates } from './itemIntelligence'
import type { DuplicateMatch } from './itemIntelligence'

/**
 * Items already in this company that look like the one being typed.
 *
 * `GET /v1/items/search` is the existing typeahead — name, alias, SKU and
 * barcode, small payload. Nothing new was added to the API for this.
 *
 * Three things keep it off the critical path of typing: the terms are debounced
 * (400ms, inside the 300–500ms the design asks for), the previous request is
 * aborted the moment a newer one starts, and a failure is swallowed — a
 * duplicate check that cannot reach the server must never stop somebody
 * creating an item, so it just reports nothing.
 */
export interface DuplicateCheckState {
  matches: DuplicateMatch[]
  /** Whatever the search returned, for the suggestion builder to borrow an HSN from. */
  similar: ItemSearchRow[]
  loading: boolean
}

interface Options {
  form: ItemFormState
  excludeItemId?: number | null
  enabled?: boolean
}

export function useDuplicateCheck({ form, excludeItemId = null, enabled = true }: Options): DuplicateCheckState {
  const name = form.item_name.trim()
  const sku = form.item_sku.trim()
  const barcode = form.item_upc.trim()

  // One JSON string so the debounce restarts when any identifier changes and
  // the effect below has a single primitive dependency rather than three. JSON
  // rather than a joined separator because an item name may contain any
  // character a separator could pick.
  const terms = useDebounce(enabled && name.length >= 2 ? JSON.stringify([name, sku, barcode]) : '', 400)
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (terms === '') {
      setRows([])
      setLoading(false)
      return undefined
    }
    const [searchName, searchSku, searchBarcode] = JSON.parse(terms) as [string, string, string]
    const queries = [searchName, searchSku, searchBarcode].filter((q, i, all) => q !== '' && all.indexOf(q) === i)
    const controller = new AbortController()
    setLoading(true)
    Promise.all(queries.map((q) => itemsApi.search(q, 8, controller.signal)))
      .then((results) => {
        if (controller.signal.aborted) return
        const merged = new Map<number, ItemSearchRow>()
        for (const list of results) {
          for (const row of list) merged.set(row.item_id, row)
        }
        setRows([...merged.values()])
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || controller.signal.aborted) return
        // A lookup that failed is not a duplicate, and not the user's problem.
        setRows([])
        setLoading(false)
      })
    return () => controller.abort()
  }, [terms])

  const matches = useMemo(() => classifyDuplicates(form, rows, excludeItemId), [form, rows, excludeItemId])

  return { matches, similar: rows, loading }
}

export default useDuplicateCheck
