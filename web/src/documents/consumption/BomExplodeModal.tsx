import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { Button } from '../../ui/Button'
import { FormField, FormGrid } from '../../ui/shell/FormSectionCard'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { useQuery } from '../../hooks/useQuery'
import { errorMessage, isApiError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { FormOptionWarehouse } from '../../services/items'
import { formatQty, toNumber } from '../../utils/format'
import { scaleBomLines } from '../bom'
import type { BomHeader } from '../bom'
import { unitOptionsFrom } from '../LineEditor'
import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import { WarehouseSelect } from '../WarehouseSelect'
import type { DocumentTypeSpec } from '../registry'
import type { CreateDocumentLine } from '../types'

interface BomExplodeModalProps {
  open: boolean
  onClose: () => void
  spec: DocumentTypeSpec
  warehouses: FormOptionWarehouse[]
  defaultWarehouseId: number | null
  onInsert: (lines: LineDraft[]) => void
}

function toDrafts(lines: CreateDocumentLine[], bom: BomHeader, spec: DocumentTypeSpec, warehouseId: number | null): LineDraft[] {
  return lines.map((l, i) => {
    const bomLine = bom.lines.find((b) => b.item_id === l.item_id)
    return newLine(spec, {
      key: `bom-${bom.bom_id}-${i}-${l.item_id}`,
      item_id: l.item_id,
      item_name: bomLine?.item_name ?? `Item #${l.item_id}`,
      item_sku: bomLine?.item_sku ?? null,
      units: l.unit_id ? [{ unit_id: l.unit_id, unit_symbol: bomLine?.unit_symbol ?? null, conversion_factor: 1, is_default: true }] : [],
      unit_id: l.unit_id ?? null,
      warehouse_id: l.warehouse_id ?? warehouseId,
      qty: String(l.qty),
      description: `From BOM: ${bom.bom_name}`,
    })
  })
}

/**
 * "Add from BOM" for Consumption: explode a bill of materials at a reference quantity and keep
 * only the OUT (component) lines — the finished-good and by-product lines a Production document
 * would receive have no place on a document that only ever consumes stock. Reuses the same
 * `POST /v1/bill-of-materials/{id}/explode` (falling back to the client mirror on a 404) that
 * ProductionPanel uses, so the arithmetic is identical; nothing here duplicates the BOM master.
 */
export function BomExplodeModal({ open, onClose, spec, warehouses, defaultWarehouseId, onInsert }: BomExplodeModalProps) {
  const [query, setQuery] = useState('')
  const [bomId, setBomId] = useState<number | null>(null)
  const [qty, setQty] = useState('')
  const [warehouseId, setWarehouseId] = useState<number | null>(defaultWarehouseId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    if (open) {
      setWarehouseId(defaultWarehouseId)
      setError(null)
      setFallback(false)
    }
  }, [open, defaultWarehouseId])

  const boms = useQuery((signal) => lookupApi.boms(query, signal), [query], { enabled: open })
  const bom = useQuery((signal) => (bomId ? lookupApi.bom(bomId, signal) : Promise.resolve(null)), [bomId], { enabled: open && bomId !== null })

  useEffect(() => {
    if (bom.data && !qty) setQty(String(bom.data.yield_qty || 1))
  }, [bom.data, qty])

  const components = useMemo(() => (bom.data?.lines ?? []).filter((l) => (l.line_kind ?? 'component') === 'component'), [bom.data])

  const explode = async () => {
    const referenceQty = toNumber(qty)
    if (!bomId || !bom.data) {
      setError('Pick a bill of materials first.')
      return
    }
    if (referenceQty === null || referenceQty <= 0) {
      setError('Reference quantity must be greater than zero.')
      return
    }
    setBusy(true)
    setError(null)
    setFallback(false)
    try {
      let lines: CreateDocumentLine[]
      try {
        const payload = await lookupApi.explodeBom(bomId, { production_qty: referenceQty, warehouse_id: warehouseId })
        lines = payload.lines
      } catch (err) {
        if (isApiError(err) && err.status === 404) {
          lines = scaleBomLines(bom.data, referenceQty, warehouseId, 0)
          setFallback(true)
        } else {
          throw err
        }
      }
      const consumed = lines.filter((l) => l.direction === 'out')
      if (consumed.length === 0) {
        setError('This bill of materials has no components to consume at that quantity.')
        setBusy(false)
        return
      }
      let drafts = toDrafts(consumed, bom.data, spec, warehouseId)
      // Re-check the live item master so batch/serial tracking and unit options reflect today's
      // setup rather than whatever the BOM line last recorded.
      try {
        const items = await lookupApi.itemsByIds(drafts.map((d) => d.item_id).filter((id): id is number => id !== null))
        const byId = new Map(items.map((it) => [it.item_id, it]))
        drafts = drafts.map((d) => {
          const it = d.item_id !== null ? byId.get(d.item_id) : undefined
          if (!it) return d
          const units = unitOptionsFrom(it)
          return { ...d, track_batch: Number(it.track_batch) === 1, track_serial: Number(it.track_serial) === 1, units: units.length > 0 ? units : d.units }
        })
      } catch {
        /* the BOM-derived unit still works; pickers just stay minimal */
      }
      onInsert(drafts)
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Could not explode the bill of materials.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add from Bill of Materials"
      description="Pick a BOM and a reference quantity; its components are added as editable consumption lines."
      size="lg"
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void explode()} loading={busy} disabled={!bomId}>
            Add components
          </Button>
        </>
      }
    >
      {error ? (
        <Notice kind="error" className="mb-3">
          {error}
        </Notice>
      ) : null}
      {fallback ? (
        <Notice kind="info" className="mb-3">
          Components were scaled in the browser (the explode endpoint is unavailable); the server still revalidates on posting.
        </Notice>
      ) : null}
      <FormGrid cols={2}>
        <FormField label="Find BOM" htmlFor="bom_explode_query">
          <Input id="bom_explode_query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by BOM or finished item…" />
        </FormField>
        <FormField label="Bill of materials" htmlFor="bom_explode_id" required>
          <Select
            id="bom_explode_id"
            value={bomId ?? ''}
            onChange={(e) => setBomId(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">{boms.loading ? 'Loading…' : 'Select…'}</option>
            {(boms.data?.data ?? []).map((b) => (
              <option key={b.bom_id} value={b.bom_id}>
                {b.bom_name} → {b.finished_item_name ?? `#${b.finished_item_id}`} (yield {formatQty(b.yield_qty)} {b.yield_unit_symbol ?? ''})
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Reference quantity" htmlFor="bom_explode_qty" required hint={bom.data ? `BOM yield ${formatQty(bom.data.yield_qty)} ${bom.data.yield_unit_symbol ?? ''}` : undefined}>
          <Input id="bom_explode_qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        </FormField>
        <FormField label="Warehouse" htmlFor="bom_explode_wh" hint="Components are issued from this warehouse.">
          <WarehouseSelect id="bom_explode_wh" value={warehouseId} onChange={setWarehouseId} warehouses={warehouses} />
        </FormField>
      </FormGrid>

      {bom.data ? (
        <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                <th className="px-3 py-1.5 text-left">Component</th>
                <th className="px-3 py-1.5 text-right">Qty per yield</th>
                <th className="px-3 py-1.5 text-right">Scrap %</th>
              </tr>
            </thead>
            <tbody>
              {components.map((l) => (
                <tr key={l.bom_line_id ?? l.item_id} className="border-t border-gray-100">
                  <td className="px-3 py-1.5">{l.item_name ?? `Item #${l.item_id}`}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatQty(l.qty)} {l.unit_symbol ?? ''}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatQty(l.scrap_percent ?? 0)}</td>
                </tr>
              ))}
              {components.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-3 text-center text-gray-500">
                    No consumable components on this BOM.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
      {bom.error ? (
        <Notice kind="error" className="mt-3">
          {errorMessage(bom.error)}
        </Notice>
      ) : null}
    </Modal>
  )
}

export default BomExplodeModal
