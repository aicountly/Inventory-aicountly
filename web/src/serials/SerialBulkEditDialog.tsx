import { useEffect, useState } from 'react'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { ProgressBar } from '../ui/ProgressBar'
import { Select } from '../ui/Select'
import { Field } from './Field'
import { useToast } from '../ui/ToastContext'
import { errorMessage, isAbortError } from '../services/api'
import { locationsApi, serialsApi } from '../services/masters'
import type { Location, SerialBulkUpdateResult } from '../services/masters'
import type { FormOptionWarehouse } from '../services/items'
import { formatInt } from '../utils/format'

export type BulkEditMode = 'place' | 'warranty'

/**
 * A correction across a selection: where these serials are, or how long they
 * are covered.
 *
 * Status is not here and will not be. `in_stock` is an assertion that a receipt
 * was posted, and a bulk editor that could make that assertion would be a way
 * around the posting engine and the stock ledger it writes. Moving stock is a
 * document; this moves a *record* of where something already is.
 *
 * Failures are reported per serial. The server answers with what went through
 * and what did not, and both counts are shown — a bulk action that said
 * "done" over four silent failures is the reason this dialog exists at all.
 */
export interface SerialBulkEditDialogProps {
  open: boolean
  mode: BulkEditMode
  serialIds: readonly number[]
  onClose: () => void
  onDone: () => void
  warehouses: readonly FormOptionWarehouse[]
}

export function SerialBulkEditDialog({ open, mode, serialIds, onClose, onDone, warehouses }: SerialBulkEditDialogProps) {
  const toast = useToast()
  const [warehouseId, setWarehouseId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [warrantyUntil, setWarrantyUntil] = useState('')
  const [clearWarranty, setClearWarranty] = useState(false)
  const [locations, setLocations] = useState<Location[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SerialBulkUpdateResult | null>(null)

  useEffect(() => {
    if (open) return
    setWarehouseId('')
    setLocationId('')
    setWarrantyUntil('')
    setClearWarranty(false)
    setError(null)
    setResult(null)
    setBusy(false)
  }, [open])

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

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const body =
        mode === 'place'
          ? {
              serial_ids: [...serialIds],
              warehouse_id: warehouseId ? Number(warehouseId) : null,
              location_id: locationId ? Number(locationId) : null,
            }
          : { serial_ids: [...serialIds], warranty_until: clearWarranty ? null : warrantyUntil }
      const res = await serialsApi.bulkUpdate(body)
      setResult(res)
      if (res.failed_count === 0) {
        toast.success(`${res.updated_count} serial number${res.updated_count === 1 ? '' : 's'} updated`)
      } else {
        toast.error(`${res.updated_count} updated, ${res.failed_count} could not be`)
      }
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const count = serialIds.length
  const canSubmit =
    mode === 'place' ? warehouseId !== '' || locationId !== '' : clearWarranty || warrantyUntil !== ''

  return (
    <Modal
      open={open}
      busy={busy}
      size="md"
      title={mode === 'place' ? 'Change location' : 'Update warranty'}
      description={`${formatInt(count)} serial number${count === 1 ? '' : 's'} selected. This records where they are — it does not post a stock movement.`}
      onClose={onClose}
      footer={
        result ? (
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} loading={busy} disabled={!canSubmit}>
              Update {formatInt(count)}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <>
          <ProgressBar value={result.updated_count} max={result.updated_count + result.failed_count} className="mb-3" />
          <Notice kind={result.failed_count === 0 ? 'success' : 'warning'} title={`${result.updated_count} updated`}>
            {result.failed_count === 0
              ? 'Every selected serial number was updated.'
              : `${result.failed_count} could not be updated. Each one is listed below with the reason the API gave.`}
          </Notice>
          {result.failed.length > 0 ? (
            <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Serial</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.failed.map((f) => (
                    <tr key={f.serial_id} className="border-t border-gray-100">
                      <td className="px-2 py-1 font-mono">{f.serial_no ?? `#${f.serial_id}`}</td>
                      <td className="px-2 py-1 text-gray-600">{f.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {error ? (
            <div className="mb-3">
              <Notice kind="error">{error}</Notice>
            </div>
          ) : null}
          {mode === 'place' ? (
            <>
              <Field label="Warehouse" hint="Leave empty to clear the warehouse on every selected serial.">
                <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">Clear the warehouse</option>
                  {warehouses.map((w) => (
                    <option key={w.warehouse_id} value={w.warehouse_id}>
                      {w.warehouse_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Location" className="mt-3">
                <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={!warehouseId || locations.length === 0}>
                  <option value="">{!warehouseId ? 'Pick a warehouse first' : locations.length === 0 ? 'No locations' : 'Clear the location'}</option>
                  {locations.map((l) => (
                    <option key={l.location_id} value={l.location_id}>
                      {l.location_code}
                      {l.location_name ? ` – ${l.location_name}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : (
            <>
              <Field label="Warranty until">
                <Input
                  type="date"
                  value={warrantyUntil}
                  disabled={clearWarranty}
                  onChange={(e) => setWarrantyUntil(e.target.value)}
                />
              </Field>
              <label className="mt-2 inline-flex items-center gap-1.5 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={clearWarranty}
                  onChange={(e) => setClearWarranty(e.target.checked)}
                  className="accent-[rgb(var(--color-primary))]"
                />
                Remove the warranty date instead
              </label>
            </>
          )}
        </>
      )}
    </Modal>
  )
}

export default SerialBulkEditDialog
