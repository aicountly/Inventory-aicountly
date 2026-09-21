import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileUp, ScanLine, Upload } from 'lucide-react'
import { ItemPicker } from '../components/ItemPicker'
import type { PickedItem } from '../components/ItemPicker'
import { Notice } from '../components/Notice'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Drawer } from '../ui/Drawer'
import { Input } from '../ui/Input'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { Textarea } from '../ui/Textarea'
import { FormGrid } from '../ui/shell/FormSectionCard'
import { Field } from './Field'
import { useToast } from '../ui/ToastContext'
import { errorMessage, isAbortError } from '../services/api'
import { batchesApi, locationsApi, serialsApi } from '../services/masters'
import type { Batch, Location, SerialBulkResult } from '../services/masters'
import type { FormOptionWarehouse } from '../services/items'
import { humanize } from '../utils/format'
import {
  SERIAL_BULK_MAX,
  SERIAL_IMPORT_STATE_LABEL,
  SERIAL_IMPORT_TEMPLATE,
  classifyImportRows,
  detectDelimiter,
  generateSerialRange,
  guessColumnMapping,
  importRowCounts,
  importableRows,
  parseDelimited,
  splitSerialInput,
} from './serialParse'
import type { SerialImportField, SerialImportRow } from './serialParse'

type Method = 'paste' | 'file' | 'range' | 'scan'

const METHODS: { value: Method; label: string }[] = [
  { value: 'paste', label: 'Paste' },
  { value: 'file', label: 'CSV file' },
  { value: 'range', label: 'Generate' },
  { value: 'scan', label: 'Scan' },
]

/**
 * Register many serials for one item.
 *
 * One item per import, because that is what a serial IS: `inv_serials` is
 * unique on (company, item, serial number), and a file mixing three items would
 * have to guess which of them each row belongs to. The item, warehouse, batch
 * and location are chosen once, above; the file supplies the numbers and — the
 * one thing that genuinely differs per unit — each one's warranty date.
 *
 * Nothing is dropped silently. Every row that cannot be sent stays on screen
 * with the reason, and the server's own answer ("already registered", and for
 * which status) comes back per serial when the import runs.
 */
export interface SerialImportDrawerProps {
  open: boolean
  onClose: () => void
  onImported: () => void
  warehouses: readonly FormOptionWarehouse[]
  /** Pre-selects the method — the scanner entry point opens on "Scan". */
  initialMethod?: Method
}

export function SerialImportDrawer({ open, onClose, onImported, warehouses, initialMethod = 'paste' }: SerialImportDrawerProps) {
  const toast = useToast()
  const [method, setMethod] = useState<Method>(initialMethod)
  const [item, setItem] = useState<PickedItem | null>(null)
  const [warehouseId, setWarehouseId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [warrantyUntil, setWarrantyUntil] = useState('')
  const [batches, setBatches] = useState<Batch[]>([])
  const [locations, setLocations] = useState<Location[]>([])

  const [text, setText] = useState('')
  const [range, setRange] = useState({ prefix: '', suffix: '', start: '1', end: '100', pad: '4' })
  const [fileRows, setFileRows] = useState<string[][] | null>(null)
  const [fileName, setFileName] = useState('')
  const [mapping, setMapping] = useState<SerialImportField[]>([])
  const [hasHeader, setHasHeader] = useState(true)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SerialBulkResult | null>(null)
  const scanRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setMethod(initialMethod)
      return
    }
    setItem(null)
    setWarehouseId('')
    setBatchId('')
    setLocationId('')
    setWarrantyUntil('')
    setText('')
    setFileRows(null)
    setFileName('')
    setMapping([])
    setError(null)
    setResult(null)
  }, [open, initialMethod])

  useEffect(() => {
    if (open && method === 'scan') scanRef.current?.focus()
  }, [open, method])

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

  /**
   * The rows this import would send, whichever way they were supplied.
   *
   * Pasted, scanned and generated numbers all become one-cell rows and go
   * through the SAME classifier as a CSV, so "repeated in this file" means the
   * same thing and is counted the same way however the list was built.
   */
  const rows: SerialImportRow[] = useMemo(() => {
    if (method === 'file' && fileRows) return classifyImportRows(fileRows, mapping, { hasHeader })
    return classifyImportRows(
      splitSerialInput(text).map((serial) => [serial]),
      ['serial_no'],
    )
  }, [method, fileRows, mapping, hasHeader, text])

  const ready = useMemo(() => importableRows(rows), [rows])
  const counts = useMemo(() => importRowCounts(rows), [rows])

  const appendRange = () => {
    const generated = generateSerialRange({
      prefix: range.prefix,
      suffix: range.suffix,
      start: Number(range.start),
      end: Number(range.end),
      pad: Number(range.pad) || 0,
    })
    if (generated.length === 0) {
      setError(`Enter a valid range of at most ${SERIAL_BULK_MAX} numbers.`)
      return
    }
    setError(null)
    setMethod('paste')
    setText((t) => (t.trim() ? `${t.trimEnd()}\n` : '') + generated.join('\n'))
  }

  const readFile = async (file: File) => {
    const content = await file.text()
    const parsed = parseDelimited(content, detectDelimiter(content))
    if (parsed.length === 0) {
      setError('That file has no rows in it.')
      return
    }
    setFileName(file.name)
    setFileRows(parsed)
    const guessed = guessColumnMapping(parsed[0])
    // A file with no recognisable header is treated as data, with the first
    // column taken as the serial — the mapping row above the preview says so
    // and can be changed.
    const looksLikeHeader = guessed.some((m) => m !== 'ignore')
    setHasHeader(looksLikeHeader)
    setMapping(looksLikeHeader ? guessed : parsed[0].map((_, i) => (i === 0 ? 'serial_no' : 'ignore')))
    setError(null)
  }

  const downloadTemplate = () => {
    const blob = new Blob([SERIAL_IMPORT_TEMPLATE], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'serial-numbers-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const submit = async () => {
    if (!item) {
      setError('Pick an item first.')
      return
    }
    if (ready.length === 0) {
      setError('There is nothing ready to import.')
      return
    }
    if (ready.length > SERIAL_BULK_MAX) {
      setError(`At most ${SERIAL_BULK_MAX} serial numbers per import.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await serialsApi.bulkCreate({
        item_id: item.item_id,
        serial_nos: ready.map((r) => ({ serial_no: r.serialNo, warranty_until: r.warrantyUntil })),
        warehouse_id: Number(warehouseId) || null,
        batch_id: Number(batchId) || null,
        location_id: Number(locationId) || null,
        warranty_until: warrantyUntil || null,
      })
      setResult(res)
      toast.success(`${res.created_count} serial number${res.created_count === 1 ? '' : 's'} registered`)
      onImported()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const preview = rows.slice(0, 200)

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="xl"
      title="Bulk add serial numbers"
      description="One item per import. Serials are registered as expected until a receipt document brings them into stock."
      footer={
        result ? (
          <div className="flex justify-end">
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-gray-500">
              {counts.ready} ready
              {counts.duplicate_in_file ? ` · ${counts.duplicate_in_file} repeated` : ''}
              {counts.too_long ? ` · ${counts.too_long} too long` : ''}
              {counts.bad_warranty ? ` · ${counts.bad_warranty} bad date` : ''}
              {counts.empty ? ` · ${counts.empty} empty` : ''}
            </span>
            <span className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" icon={Upload} onClick={submit} loading={busy} disabled={!item || ready.length === 0}>
                Import {ready.length || ''}
              </Button>
            </span>
          </div>
        )
      }
    >
      {result ? (
        <>
          <Notice kind={result.skipped_count > 0 ? 'warning' : 'success'} title={`${result.created_count} registered for ${result.item_name}`}>
            {result.skipped_count > 0
              ? `${result.skipped_count} were skipped. Every one of them is listed below with its reason — nothing was dropped quietly.`
              : 'Every serial number in the list was registered.'}
          </Notice>
          {result.skipped.length > 0 ? (
            <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Serial</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.skipped.map((s, i) => (
                    <tr key={`${s.serial_no}-${i}`} className="border-t border-gray-100">
                      <td className="px-2 py-1 font-mono">{s.serial_no || '(empty)'}</td>
                      <td className="px-2 py-1 text-gray-600">
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
          {error ? (
            <div className="mb-3">
              <Notice kind="error">{error}</Notice>
            </div>
          ) : null}

          <FormGrid className="mb-4">
            <Field label="Item" required className="sm:col-span-2" hint="Only serial-tracked items can hold serial numbers.">
              <ItemPicker
                value={item}
                onChange={setItem}
                filter={(row) => Number(row.track_serial) === 1}
                placeholder="Search serial-tracked items…"
              />
            </Field>
            <Field label="Warehouse" hint="Where the serials are expected to arrive.">
              <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">Not yet known</option>
                {warehouses.map((w) => (
                  <option key={w.warehouse_id} value={w.warehouse_id}>
                    {w.warehouse_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Location">
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={!warehouseId || locations.length === 0}>
                <option value="">{!warehouseId ? 'Pick a warehouse first' : locations.length === 0 ? 'No locations' : 'None'}</option>
                {locations.map((l) => (
                  <option key={l.location_id} value={l.location_id}>
                    {l.location_code}
                    {l.location_name ? ` – ${l.location_name}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Batch">
              <Select value={batchId} onChange={(e) => setBatchId(e.target.value)} disabled={!item || batches.length === 0}>
                <option value="">{!item ? 'Pick an item first' : batches.length === 0 ? 'No batches for this item' : 'None'}</option>
                {batches.map((b) => (
                  <option key={b.batch_id} value={b.batch_id}>
                    {b.batch_no}
                    {b.expiry_date ? ` (exp ${b.expiry_date})` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Warranty until" hint="Used for rows that carry no date of their own.">
              <Input type="date" value={warrantyUntil} onChange={(e) => setWarrantyUntil(e.target.value)} />
            </Field>
          </FormGrid>

          <SegmentedControl<Method> value={method} options={METHODS} onChange={setMethod} className="mb-3" />

          {method === 'paste' ? (
            <Field label="Serial numbers" hint="One per line, or separated by commas, semicolons or tabs.">
              <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'SN-0001\nSN-0002\nSN-0003'} spellCheck={false} />
            </Field>
          ) : null}

          {method === 'scan' ? (
            <Field
              label="Scan into the list"
              hint="A hardware scanner types the code and presses Enter. Each scan is added to the list below; scan the same one twice and it is flagged, not duplicated."
            >
              <Input
                ref={scanRef}
                placeholder="Scan a barcode…"
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  const input = e.currentTarget
                  const scanned = input.value.trim()
                  if (!scanned) return
                  setText((t) => (t.trim() ? `${t.trimEnd()}\n` : '') + scanned)
                  input.value = ''
                }}
              />
            </Field>
          ) : null}

          {method === 'range' ? (
            <FormGrid cols={3}>
              <Field label="Prefix">
                <Input value={range.prefix} onChange={(e) => setRange({ ...range, prefix: e.target.value })} placeholder="SN-" />
              </Field>
              <Field label="From">
                <Input type="number" min={0} step={1} value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
              </Field>
              <Field label="To">
                <Input type="number" min={0} step={1} value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} />
              </Field>
              <Field label="Digits" hint="Zero-padded width; 0 for none.">
                <Input type="number" min={0} max={20} step={1} value={range.pad} onChange={(e) => setRange({ ...range, pad: e.target.value })} />
              </Field>
              <Field label="Suffix">
                <Input value={range.suffix} onChange={(e) => setRange({ ...range, suffix: e.target.value })} />
              </Field>
              {/* Not wrapped in a Field: a <label> bound to a button replaces
                  the button's own words as its accessible name. */}
              <div className="flex items-end">
                <Button variant="secondary" size="sm" onClick={appendRange}>
                  Add the range to the list
                </Button>
              </div>
            </FormGrid>
          ) : null}

          {method === 'file' ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-primary/40 hover:text-primary">
                  <FileUp className="h-3.5 w-3.5" aria-hidden />
                  Choose a CSV file
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt,text/csv,text/plain"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void readFile(file)
                    }}
                  />
                </label>
                <Button variant="ghost" size="xs" icon={Download} onClick={downloadTemplate}>
                  Download a template
                </Button>
                {fileName ? <span className="text-xs text-gray-500">{fileName}</span> : null}
              </div>

              {fileRows ? (
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Which column is which</p>
                  <div className="flex flex-wrap gap-2">
                    {fileRows[0].map((cell, index) => (
                      <label key={index} className="flex min-w-[9rem] flex-col gap-1">
                        <span className="truncate text-[11px] text-gray-500">{hasHeader ? cell || `Column ${index + 1}` : `Column ${index + 1}`}</span>
                        <Select
                          value={mapping[index] ?? 'ignore'}
                          onChange={(e) => {
                            const next = [...mapping]
                            next[index] = e.target.value as SerialImportField
                            setMapping(next)
                          }}
                          aria-label={`Column ${index + 1}`}
                        >
                          <option value="serial_no">Serial number</option>
                          <option value="warranty_until">Warranty until</option>
                          <option value="ignore">Do not import</option>
                        </Select>
                      </label>
                    ))}
                  </div>
                  <label className="mt-2 inline-flex items-center gap-1.5 text-xs text-gray-600">
                    <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} className="accent-[rgb(var(--color-primary))]" />
                    The first row is a header
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}

          {rows.length > 0 ? (
            <div className="mt-4">
              <p className="m-0 mb-1.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Preview
                <Badge tone="success" size="xs">
                  {counts.ready} ready
                </Badge>
                {counts.duplicate_in_file ? <Badge tone="warning" size="xs">{counts.duplicate_in_file} repeated</Badge> : null}
                {counts.too_long ? <Badge tone="danger" size="xs">{counts.too_long} too long</Badge> : null}
                {counts.bad_warranty ? <Badge tone="danger" size="xs">{counts.bad_warranty} bad date</Badge> : null}
                {counts.empty ? <Badge tone="neutral" size="xs">{counts.empty} empty</Badge> : null}
              </p>
              <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Line</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Serial</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Warranty</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-gray-500">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr key={`${row.line}-${row.serialNo}`} className="border-t border-gray-100">
                        <td className="px-2 py-1 text-gray-400">{row.line}</td>
                        <td className="px-2 py-1 font-mono">{row.serialNo || <span className="text-gray-300">(empty)</span>}</td>
                        <td className="px-2 py-1 text-gray-600">{row.warrantyUntil ?? <span className="text-gray-300">—</span>}</td>
                        <td className="px-2 py-1">
                          <Badge tone={row.state === 'ready' ? 'success' : row.state === 'duplicate_in_file' ? 'warning' : 'danger'} size="xs">
                            {SERIAL_IMPORT_STATE_LABEL[row.state]}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > preview.length ? (
                <p className="mt-1 text-[11px] text-gray-400">Showing the first {preview.length} of {rows.length} rows. All of them will be imported.</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 flex items-center gap-1.5 text-xs text-gray-400">
              <ScanLine className="h-3.5 w-3.5" aria-hidden />
              Nothing to import yet.
            </p>
          )}
        </>
      )}
    </Drawer>
  )
}

export default SerialImportDrawer
