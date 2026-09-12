import { useState } from 'react'
import { FormField } from '../../components/FormField'
import { Notice } from '../../components/Notice'
import { errorMessage } from '../../services/api'
import type { FormOptionWarehouse } from '../../services/items'
import { availabilityApi } from '../../services/stockApi'
import type { StockBalanceRow } from '../../services/stockApi'
import { WarehouseSelect } from '../WarehouseSelect'
import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'

interface PhysicalCountPanelProps {
  spec: DocumentTypeSpec
  warehouses: FormOptionWarehouse[]
  defaultWarehouseId: number | null
  onLoad: (lines: LineDraft[]) => void
  disabled?: boolean
}

const PAGE = 500
const MAX_ROWS = 5000

function toLine(spec: DocumentTypeSpec, row: StockBalanceRow): LineDraft {
  return newLine(spec, {
    key: `count-${row.balance_id}`,
    item_id: row.item_id,
    item_name: row.item_name ?? `Item #${row.item_id}`,
    item_sku: row.item_sku,
    track_batch: row.batch_id !== null,
    warehouse_id: row.warehouse_id,
    batch_id: row.batch_id,
    batch_no: row.batch_no,
    book_qty: String(Number(row.on_hand_qty) || 0),
    physical_qty: '',
    origin: 'count',
  })
}

/** Loads book quantities from `GET /v1/stock-balances` so the count sheet starts from the system figure. */
export function PhysicalCountPanel({ spec, warehouses, defaultWarehouseId, onLoad, disabled }: PhysicalCountPanelProps) {
  const [warehouseId, setWarehouseId] = useState<number | null>(defaultWarehouseId)
  const [includeZero, setIncludeZero] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const rows: StockBalanceRow[] = []
      let offset = 0
      for (;;) {
        const res = await availabilityApi.balances({ warehouse_id: warehouseId ?? undefined, nonzero: includeZero ? undefined : true, limit: PAGE, offset })
        rows.push(...res.data)
        offset += PAGE
        if (res.data.length < PAGE || offset >= res.meta.total || rows.length >= MAX_ROWS) break
      }
      const lines = rows.filter((r) => r.item_id).map((r) => toLine(spec, r))
      setLoaded(lines.length)
      onLoad(lines)
    } catch (err) {
      setError(errorMessage(err, 'Could not load stock balances.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="form-section">
      <h2 className="form-section-title">Count sheet</h2>
      <p className="form-section-subtitle">Load the book quantity per item, warehouse and batch, then enter what was counted. Lines with no difference are ignored on posting.</p>
      <div className="inline-fields">
        <FormField label="Warehouse" htmlFor="count_wh" help="Leave empty to count every warehouse.">
          <WarehouseSelect id="count_wh" value={warehouseId} onChange={setWarehouseId} warehouses={warehouses} emptyLabel="All warehouses" disabled={disabled} />
        </FormField>
        <label className="checkbox" style={{ paddingBottom: '0.5rem' }}>
          <input type="checkbox" checked={includeZero} disabled={disabled} onChange={(e) => setIncludeZero(e.target.checked)} />
          Include items with zero book quantity
        </label>
        <div>
          <button type="button" className="btn btn-primary" onClick={() => void load()} disabled={disabled || loading}>
            {loading ? 'Loading…' : 'Load book quantities'}
          </button>
        </div>
      </div>
      {loaded !== null && !loading ? <span className="hint">{loaded} line{loaded === 1 ? '' : 's'} loaded. Existing lines were replaced.</span> : null}
      {error ? <Notice kind="error">{error}</Notice> : null}
    </section>
  )
}
