import { useEffect, useMemo, useState } from 'react'
import { FormField } from '../../components/FormField'
import { ItemPicker } from '../../components/ItemPicker'
import type { PickedItem } from '../../components/ItemPicker'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { errorMessage, isAbortError } from '../../services/api'
import { batchesApi, locationsApi, serialsApi } from '../../services/masters'
import type { Batch, Location, SerialBulkResult } from '../../services/masters'
import type { FormOptionWarehouse } from '../../services/items'
import { useToast } from '../../ui/ToastContext'
import { humanize } from '../../utils/format'
import { generateSerialRange, parseSerialInput, SERIAL_BULK_MAX } from './serials'

interface SerialBulkAddDialogProps {
  open: boolean
  onClose: () => void
  onDone: () => void
  warehouses: FormOptionWarehouse[]
}

/** Register many `expected` serial numbers for one item in a single call. */
export function SerialBulkAddDialog({ open, onClose, onDone, warehouses }: SerialBulkAddDialogProps) {
  const toast = useToast()
  const [item, setItem] = useState<PickedItem | null>(null)
  const [warehouseId, setWarehouseId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [text, setText] = useState('')
  const [range, setRange] = useState({ prefix: '', suffix: '', start: '1', end: '100', pad: '4' })
  const [batches, setBatches] = useState<Batch[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SerialBulkResult | null>(null)

  const parsed = useMemo(() => parseSerialInput(text), [text])

  useEffect(() => {
    if (!open) {
      setItem(null)
      setWarehouseId('')
      setBatchId('')
      setLocationId('')
      setText('')
      setError(null)
      setResult(null)
    }
  }, [open])

  useEffect(() => {
    if (!item) {
      setBatches([])
      setBatchId('')
      return undefined
    }
    const controller = new AbortController()
    batchesApi
      .list({ item_id: item.item_id, limit: 500, sort: 'batch_no' }, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) setBatches(res.data)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) setBatches([])
      })
    return () => controller.abort()
  }, [item])

  useEffect(() => {
    const wh = Number(warehouseId)
    if (!wh) {
      setLocations([])
      setLocationId('')
      return undefined
    }
    const controller = new AbortController()
    locationsApi
      .list({ warehouse_id: wh, limit: 1000, sort: 'location_code', status: 'active' }, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) setLocations(res.data)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) setLocations([])
      })
    return () => controller.abort()
  }, [warehouseId])

  const appendRange = () => {
    const generated = generateSerialRange({ prefix: range.prefix, suffix: range.suffix, start: Number(range.start), end: Number(range.end), pad: Number(range.pad) || 0 })
    if (generated.length === 0) {
      setError(`Enter a valid range of at most ${SERIAL_BULK_MAX} numbers.`)
      return
    }
    setError(null)
    setText((t) => (t.trim() ? `${t.trimEnd()}\n` : '') + generated.join('\n'))
  }

  const submit = async () => {
    if (!item) {
      setError('Pick an item first.')
      return
    }
    if (parsed.serials.length === 0) {
      setError('Enter at least one serial number.')
      return
    }
    if (parsed.serials.length > SERIAL_BULK_MAX) {
      setError(`At most ${SERIAL_BULK_MAX} serial numbers per request.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await serialsApi.bulkCreate({
        item_id: item.item_id,
        serial_nos: parsed.serials,
        warehouse_id: Number(warehouseId) || null,
        batch_id: Number(batchId) || null,
        location_id: Number(locationId) || null,
      })
      setResult(res)
      toast.success(`${res.created_count} serial number${res.created_count === 1 ? '' : 's'} registered`)
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Bulk add serial numbers"
      onClose={onClose}
      busy={busy}
      size="lg"
      footer={
        result ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !item || parsed.serials.length === 0}>
              {busy ? 'Registering…' : `Register ${parsed.serials.length || ''} serial${parsed.serials.length === 1 ? '' : 's'}`}
            </button>
          </>
        )
      }
    >
      {result ? (
        <>
          <Notice kind="success" title={`${result.created_count} registered`}>
            for {result.item_name}. {result.skipped_count > 0 ? `${result.skipped_count} skipped.` : ''}
          </Notice>
          {result.skipped.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Skipped serial</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.skipped.slice(0, 200).map((s, i) => (
                    <tr key={`${s.serial_no}-${i}`}>
                      <td className="mono">{s.serial_no || '(empty)'}</td>
                      <td>
                        {humanize(s.reason)}
                        {s.status ? ` (${humanize(s.status)})` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
            Serials registered here are <strong>expected</strong> until a receipt document brings them into stock. Numbers already registered for the item are skipped, never duplicated.
          </p>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <div className="form-grid">
            <FormField label="Item" required className="span-all">
              <ItemPicker value={item} onChange={setItem} filter={(row) => Number(row.track_serial) === 1} placeholder="Search serial-tracked items…" />
            </FormField>
            <FormField label="Warehouse" help="Where the serials are expected to arrive.">
              <select className="select" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">— Not yet known —</option>
                {warehouses.map((w) => (
                  <option key={w.warehouse_id} value={w.warehouse_id}>
                    {w.warehouse_name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Batch">
              <select className="select" value={batchId} onChange={(e) => setBatchId(e.target.value)} disabled={!item || batches.length === 0}>
                <option value="">{!item ? 'Pick an item first' : batches.length === 0 ? 'No batches for this item' : '— None —'}</option>
                {batches.map((b) => (
                  <option key={b.batch_id} value={b.batch_id}>
                    {b.batch_no}
                    {b.expiry_date ? ` (exp ${b.expiry_date})` : ''}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Location">
              <select className="select" value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={!warehouseId || locations.length === 0}>
                <option value="">{!warehouseId ? 'Pick a warehouse first' : locations.length === 0 ? 'No locations' : '— None —'}</option>
                {locations.map((l) => (
                  <option key={l.location_id} value={l.location_id}>
                    {l.location_code}
                    {l.location_name ? ` – ${l.location_name}` : ''}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="form-section">
            <h3 className="form-section-title">Generate a range</h3>
            <div className="form-grid">
              <FormField label="Prefix">
                <input className="input" value={range.prefix} onChange={(e) => setRange({ ...range, prefix: e.target.value })} placeholder="SN-" />
              </FormField>
              <FormField label="From">
                <input className="input" type="number" min={0} step={1} value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
              </FormField>
              <FormField label="To">
                <input className="input" type="number" min={0} step={1} value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} />
              </FormField>
              <FormField label="Digits" help="Zero-padded width; 0 for none.">
                <input className="input" type="number" min={0} max={20} step={1} value={range.pad} onChange={(e) => setRange({ ...range, pad: e.target.value })} />
              </FormField>
              <FormField label="Suffix">
                <input className="input" value={range.suffix} onChange={(e) => setRange({ ...range, suffix: e.target.value })} />
              </FormField>
              <div className="field" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn" onClick={appendRange}>
                  Add range to list
                </button>
              </div>
            </div>
          </div>

          <FormField
            label="Serial numbers"
            required
            help={`One per line, or separated by commas. ${parsed.serials.length} ready${parsed.duplicates.length ? `, ${parsed.duplicates.length} repeated in the list` : ''}${parsed.tooLong.length ? `, ${parsed.tooLong.length} too long` : ''}.`}
          >
            <textarea className="textarea" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'SN-0001\nSN-0002\nSN-0003'} spellCheck={false} />
          </FormField>
        </>
      )}
    </Modal>
  )
}
