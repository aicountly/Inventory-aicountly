import { useEffect, useMemo, useState } from 'react'
import { FormField } from '../../components/FormField'
import { Notice } from '../../components/Notice'
import { useQuery } from '../../hooks/useQuery'
import { errorMessage, isApiError } from '../../services/api'
import type { FormOptionWarehouse } from '../../services/items'
import { lookupApi } from '../../services/lookupApi'
import { formatQty, toNumber } from '../../utils/format'
import { WarehouseSelect } from '../WarehouseSelect'
import { scaleBomLines } from '../bom'
import type { BomHeader } from '../bom'
import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import type { CreateDocumentLine, DocumentMetadata } from '../types'

export interface ProductionMeta {
  bom_id: number
  production_qty: number
  finished_rate: number
  warehouse_id: number | null
}

interface ProductionPanelProps {
  spec: DocumentTypeSpec
  warehouses: FormOptionWarehouse[]
  defaultWarehouseId: number | null
  initial: DocumentMetadata | null
  onExplode: (lines: LineDraft[], meta: ProductionMeta) => void
  disabled?: boolean
}

function toDrafts(lines: CreateDocumentLine[], bom: BomHeader, spec: DocumentTypeSpec): LineDraft[] {
  return lines.map((l, i) => {
    const bomLine = bom.lines.find((b) => b.item_id === l.item_id)
    const finished = l.item_id === bom.finished_item_id
    const name = finished ? (bom.finished_item_name ?? `Item #${l.item_id}`) : (bomLine?.item_name ?? `Item #${l.item_id}`)
    const symbol = finished ? (bom.yield_unit_symbol ?? null) : (bomLine?.unit_symbol ?? null)
    return newLine(spec, {
      key: `bom-${bom.bom_id}-${i}`,
      item_id: l.item_id,
      item_name: name,
      item_sku: finished ? (bom.finished_item_sku ?? null) : (bomLine?.item_sku ?? null),
      units: l.unit_id ? [{ unit_id: l.unit_id, unit_symbol: symbol, conversion_factor: 1, is_default: true }] : [],
      unit_id: l.unit_id ?? null,
      warehouse_id: l.warehouse_id ?? null,
      direction: l.direction ?? 'out',
      qty: String(l.qty),
      rate: l.rate ? String(l.rate) : '',
      amount: l.amount ? String(l.amount) : '',
      valuation_rate: l.valuation_rate ? String(l.valuation_rate) : '',
      origin: 'bom',
      metadata: l.metadata ?? null,
    })
  })
}

/**
 * Pick a bill of materials, set the run quantity, finished-goods rate and warehouse, and explode
 * it into editable lines. Uses `POST /v1/bill-of-materials/{id}/explode` (BomService::productionPayload);
 * an API without that route falls back to the client mirror of the same arithmetic.
 */
export function ProductionPanel({ spec, warehouses, defaultWarehouseId, initial, onExplode, disabled }: ProductionPanelProps) {
  const [query, setQuery] = useState('')
  const [bomId, setBomId] = useState<number | null>(initial?.bom_id ? Number(initial.bom_id) : null)
  const [qty, setQty] = useState(initial?.production_qty ? String(initial.production_qty) : '')
  const [rate, setRate] = useState(initial?.finished_rate ? String(initial.finished_rate) : '')
  const [warehouseId, setWarehouseId] = useState<number | null>(initial?.warehouse_id ? Number(initial.warehouse_id) : defaultWarehouseId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fallback, setFallback] = useState(false)

  const boms = useQuery((signal) => lookupApi.boms(query, signal), [query])
  const bom = useQuery((signal) => (bomId ? lookupApi.bom(bomId, signal) : Promise.resolve(null)), [bomId], { enabled: bomId !== null })

  useEffect(() => {
    if (warehouseId === null && defaultWarehouseId !== null) setWarehouseId(defaultWarehouseId)
  }, [defaultWarehouseId, warehouseId])

  useEffect(() => {
    if (bom.data && !qty) setQty(String(bom.data.yield_qty || 1))
  }, [bom.data, qty])

  const components = useMemo(() => (bom.data?.lines ?? []).filter((l) => (l.line_kind ?? 'component') !== 'scrap'), [bom.data])

  const explode = async () => {
    const productionQty = toNumber(qty)
    const finishedRate = toNumber(rate) ?? 0
    if (!bomId || !bom.data) {
      setError('Pick a bill of materials first.')
      return
    }
    if (productionQty === null || productionQty <= 0) {
      setError('Production quantity must be greater than zero.')
      return
    }
    setBusy(true)
    setError(null)
    setFallback(false)
    try {
      let lines: CreateDocumentLine[]
      try {
        const payload = await lookupApi.explodeBom(bomId, { production_qty: productionQty, warehouse_id: warehouseId, finished_rate: finishedRate })
        lines = payload.lines
      } catch (err) {
        if (isApiError(err) && err.status === 404) {
          lines = scaleBomLines(bom.data, productionQty, warehouseId, finishedRate)
          setFallback(true)
        } else {
          throw err
        }
      }
      onExplode(toDrafts(lines, bom.data, spec), { bom_id: bomId, production_qty: productionQty, finished_rate: finishedRate, warehouse_id: warehouseId })
    } catch (err) {
      setError(errorMessage(err, 'Could not explode the bill of materials.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="form-section">
      <h2 className="form-section-title">Bill of materials</h2>
      <p className="form-section-subtitle">Components are consumed at the scaled BOM quantity (plus scrap %); the finished item is received at the rate you enter. Quantities stay editable below.</p>
      <div className="form-grid">
        <FormField label="Find BOM" htmlFor="bom_query">
          <input id="bom_query" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by BOM or finished item…" disabled={disabled} />
        </FormField>
        <FormField label="Bill of materials" htmlFor="bom_id" required>
          <select id="bom_id" className="select" value={bomId ?? ''} disabled={disabled} onChange={(e) => setBomId(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">{boms.loading ? 'Loading…' : 'Select…'}</option>
            {bomId !== null && !(boms.data?.data ?? []).some((b) => b.bom_id === bomId) ? <option value={bomId}>BOM #{bomId}</option> : null}
            {(boms.data?.data ?? []).map((b) => (
              <option key={b.bom_id} value={b.bom_id}>
                {b.bom_name} → {b.finished_item_name ?? `#${b.finished_item_id}`} (yield {formatQty(b.yield_qty)} {b.yield_unit_symbol ?? ''})
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Production quantity" htmlFor="production_qty" required help={bom.data ? `BOM yield ${formatQty(bom.data.yield_qty)} ${bom.data.yield_unit_symbol ?? ''}` : undefined}>
          <input id="production_qty" className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} disabled={disabled} />
        </FormField>
        <FormField label="Finished rate (per unit)" htmlFor="finished_rate" help="Cost of one finished unit. Zero falls back to the item's last cost when posting.">
          <input id="finished_rate" className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} disabled={disabled} />
        </FormField>
        <FormField label="Warehouse" htmlFor="production_wh" help="Components are issued from and finished goods received into this warehouse.">
          <WarehouseSelect id="production_wh" value={warehouseId} onChange={setWarehouseId} warehouses={warehouses} disabled={disabled} />
        </FormField>
      </div>
      {bom.data ? (
        <table className="panel-table">
          <thead>
            <tr>
              <th>Component</th>
              <th>Kind</th>
              <th className="align-right">Qty per yield</th>
              <th className="align-right">Scrap %</th>
            </tr>
          </thead>
          <tbody>
            {components.map((l) => (
              <tr key={l.bom_line_id ?? `${l.item_id}-${l.line_kind}`}>
                <td>{l.item_name ?? `Item #${l.item_id}`}</td>
                <td className="muted">{l.line_kind ?? 'component'}</td>
                <td className="align-right">
                  {formatQty(l.qty)} {l.unit_symbol ?? ''}
                </td>
                <td className="align-right">{formatQty(l.scrap_percent ?? 0)}</td>
              </tr>
            ))}
            <tr>
              <td>
                <strong>{bom.data.finished_item_name ?? `Item #${bom.data.finished_item_id}`}</strong>
              </td>
              <td className="muted">finished</td>
              <td className="align-right">
                {formatQty(bom.data.yield_qty)} {bom.data.yield_unit_symbol ?? ''}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      ) : null}
      {bom.error ? <Notice kind="error">{errorMessage(bom.error)}</Notice> : null}
      {error ? <Notice kind="error">{error}</Notice> : null}
      {fallback ? <Notice kind="info">Lines were scaled in the browser (the API has no explode endpoint); unit conversion of the finished rate is verified on posting.</Notice> : null}
      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={() => void explode()} disabled={disabled || busy || !bomId}>
          {busy ? 'Exploding…' : 'Explode into lines'}
        </button>
      </div>
    </section>
  )
}
