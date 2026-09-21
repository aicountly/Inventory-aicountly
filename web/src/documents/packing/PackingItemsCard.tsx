import { useEffect, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { ListPlus, Package, Plus, Search } from 'lucide-react'
import { useDebounce } from '../../hooks/useDebounce'
import { isAbortError } from '../../services/api'
import type { FormOptionWarehouse } from '../../services/items'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { IconTile } from '../../ui/IconTile'
import { Input } from '../../ui/Input'
import { notify } from '../../ui/notify'
import { toNumber } from '../../utils/format'
import { LineEditor, unitOptionsFrom } from '../LineEditor'
import { newLine } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import { AddMultipleItemsDrawer } from './AddMultipleItemsDrawer'

export interface PackingItemsCardProps {
  spec: DocumentTypeSpec
  header: HeaderDraft
  lines: LineDraft[]
  onChange: (lines: LineDraft[]) => void
  warehouses: FormOptionWarehouse[]
  availability: Record<string, AvailabilityCheckResult>
  checking: boolean
  offendingKeys: ReadonlySet<string>
  disabled?: boolean
  /** So the page header's "Scan & Add" action can jump focus in here. */
  scanFieldRef: RefObject<HTMLInputElement | null>
  /** Owned by the page (PackingFormView) so Alt+A does exactly what the button does. */
  onAddBlankLine: () => void
  /** Owned by the page so Alt+M opens the same drawer the button does. */
  addMultipleOpen: boolean
  onOpenAddMultiple: () => void
  onCloseAddMultiple: () => void
}

function lineFromSearchRow(spec: DocumentTypeSpec, row: ItemSearchRow, warehouseId: number | null, qty: string): LineDraft {
  const units = unitOptionsFrom(row)
  const def = units.find((u) => u.is_default) ?? units[0]
  return newLine(spec, {
    item_id: row.item_id,
    item_name: row.print_name || row.item_name,
    item_sku: row.item_sku,
    track_batch: Number(row.track_batch) === 1,
    track_serial: Number(row.track_serial) === 1,
    units,
    unit_id: def?.unit_id ?? row.unit_id ?? null,
    warehouse_id: warehouseId ?? row.default_warehouse_id ?? null,
    qty,
  })
}

/**
 * The core workflow card: a search-or-scan box that adds/bumps lines on a match, "Add multiple"
 * for a bulk pick, and the existing `LineEditor` underneath for everything a line itself needs
 * (warehouse override, batch, serials, qty). LineEditor is shared with every other document type
 * and is left untouched — this card only adds the premium chrome and the fast-entry toolbar.
 */
export function PackingItemsCard({
  spec,
  header,
  lines,
  onChange,
  warehouses,
  availability,
  checking,
  offendingKeys,
  disabled,
  scanFieldRef,
  onAddBlankLine,
  addMultipleOpen,
  onOpenAddMultiple,
  onCloseAddMultiple,
}: PackingItemsCardProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [open, setOpen] = useState(false)
  const debounced = useDebounce(query, 200)

  useEffect(() => {
    const q = debounced.trim()
    if (!q) {
      setRows([])
      return undefined
    }
    const controller = new AbortController()
    lookupApi
      .searchItems(q, { warehouseId: header.default_warehouse_id, limit: 8, signal: controller.signal })
      .then((found) => {
        if (!controller.signal.aborted) setRows(found)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) setRows([])
      })
    return () => controller.abort()
  }, [debounced, header.default_warehouse_id])

  const addOrBump = (row: ItemSearchRow) => {
    const wh = header.default_warehouse_id
    const existing = lines.find((l) => l.item_id === row.item_id && (l.warehouse_id ?? wh) === wh && !l.track_serial && !l.track_batch)
    if (existing) {
      onChange(lines.map((l) => (l.key === existing.key ? { ...l, qty: String((toNumber(l.qty) ?? 0) + 1) } : l)))
      notify.success(`${row.item_name}: quantity increased.`)
    } else {
      onChange([...lines, lineFromSearchRow(spec, row, wh, '1')])
      notify.success(`${row.item_name} added.`)
    }
    setQuery('')
    setRows([])
    setOpen(false)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (rows.length >= 1) addOrBump(rows[0])
      else if (query.trim()) notify.error(`No item matches "${query.trim()}".`)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const addMultiple = (picked: { row: ItemSearchRow; qty: number }[]) => {
    const wh = header.default_warehouse_id
    onChange([...lines, ...picked.map((p) => lineFromSearchRow(spec, p.row, wh, String(p.qty)))])
    notify.success(`${picked.length} item${picked.length === 1 ? '' : 's'} added.`)
  }

  return (
    <Card padding="md">
      <div className="mb-3 flex flex-col gap-3 border-b border-gray-100 pb-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <IconTile icon={Package} tone="primary" />
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Items to pack</h3>
            <p className="mt-0.5 text-xs text-gray-500">Add items, quantities and serial/batch details.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Input
              ref={scanFieldRef}
              leadingIcon={Search}
              placeholder="Search or scan by name, SKU or barcode…"
              value={query}
              disabled={disabled}
              className="w-72"
              onChange={(e) => {
                setQuery(e.target.value)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={onKeyDown}
            />
            {open && query.trim() && rows.length > 0 ? (
              <ul className="absolute right-0 z-20 mt-1 max-h-72 w-80 overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-overlay">
                {rows.map((row) => (
                  <li key={row.item_id}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        addOrBump(row)
                      }}
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-primary-light/50"
                    >
                      <span className="text-sm font-medium text-gray-900">{row.item_name}</span>
                      <span className="text-xs text-gray-500">
                        {[row.item_sku, row.unit_symbol].filter(Boolean).join(' · ') || '—'}
                        {row.stock ? ` · avail ${row.stock.available}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <Button variant="secondary" icon={ListPlus} onClick={onOpenAddMultiple} disabled={disabled} kbd="Alt M">
            Add multiple
          </Button>
          <Button icon={Plus} onClick={onAddBlankLine} disabled={disabled} kbd="Alt A">
            Add item
          </Button>
        </div>
      </div>

      <LineEditor spec={spec} header={header} lines={lines} onChange={onChange} warehouses={warehouses} availability={availability} checking={checking} offendingKeys={offendingKeys} disabled={disabled} />

      <AddMultipleItemsDrawer open={addMultipleOpen} onClose={onCloseAddMultiple} warehouseId={header.default_warehouse_id} onAdd={addMultiple} />
    </Card>
  )
}

export default PackingItemsCard
