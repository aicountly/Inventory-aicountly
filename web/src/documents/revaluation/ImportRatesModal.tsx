import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, FileUp, Loader2, TriangleAlert } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Button, Select } from '../../ui'
import { FormField } from '../../ui/shell'
import { errorMessage, isAbortError } from '../../services/api'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { FormOptionWarehouse } from '../../services/items'
import { resolveItemCodes } from './revaluationApi'
import { parseRateRows } from './revaluationImport'
import type { ParsedRateRow } from './revaluationImport'

export interface ImportedRate {
  item: ItemSearchRow
  warehouseId: number | null
  newUnitCost: number | null
  remarks: string
}

export interface ImportRatesModalProps {
  open: boolean
  onClose: () => void
  warehouses: readonly FormOptionWarehouse[]
  defaultWarehouseId: number | null
  /** Text handed in by a Ctrl+V on the page, so a paste opens the dialog already filled. */
  seedText?: string
  onImport: (rates: ImportedRate[]) => void
}

interface Resolved {
  row: ParsedRateRow
  item: ItemSearchRow | null
  reason: string | null
}

const SAMPLE = 'SKU,New cost,Remarks\nLAP001,46500,Market price revised\nCHR001,3950,Discounted bulk rate'

/**
 * Bring a column of codes and rates in from a spreadsheet.
 *
 * Codes are resolved through the same barcode / SKU endpoint the scanner uses, a few at a time, so
 * a 200-row paste does not open 200 connections. Rows that resolve to nothing are listed rather
 * than dropped: an import that silently skips three lines is worse than one that refuses.
 */
export function ImportRatesModal({ open, onClose, warehouses, defaultWarehouseId, seedText, onImport }: ImportRatesModalProps) {
  const [text, setText] = useState('')
  const [warehouseId, setWarehouseId] = useState<number | null>(defaultWarehouseId)
  const [resolved, setResolved] = useState<Resolved[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setText(seedText ?? '')
    setResolved(null)
    setError(null)
    setBusy(false)
    setWarehouseId(defaultWarehouseId)
  }, [open, seedText, defaultWarehouseId])

  const parsed = useMemo(() => parseRateRows(text), [text])
  const usable = parsed.rows.filter((r) => r.problem === null)

  const matched = resolved?.filter((r) => r.item !== null) ?? []
  const unmatched = resolved?.filter((r) => r.item === null) ?? []
  const badRows = parsed.rows.filter((r) => r.problem !== null)

  const check = async () => {
    setBusy(true)
    setError(null)
    try {
      const answers = await resolveItemCodes(usable.map((r) => r.code), warehouseId)
      setResolved(usable.map((row, index) => ({ row, item: answers[index]?.item ?? null, reason: answers[index]?.reason ?? null })))
    } catch (err) {
      if (!isAbortError(err)) setError(errorMessage(err, 'Those codes could not be looked up.'))
    } finally {
      setBusy(false)
    }
  }

  const readFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      setText(String(reader.result ?? ''))
      setResolved(null)
    }
    reader.onerror = () => setError('That file could not be read.')
    reader.readAsText(file)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import rates"
      description="Paste from a spreadsheet, or pick a CSV. One row per item: SKU or barcode, new cost, remarks."
      size="lg"
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {resolved === null ? (
            <Button variant="primary" loading={busy} disabled={usable.length === 0} onClick={() => void check()}>
              Check {usable.length} row{usable.length === 1 ? '' : 's'}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={matched.length === 0}
              onClick={() => {
                onImport(
                  matched.map((r) => ({
                    item: r.item as ItemSearchRow,
                    warehouseId,
                    newUnitCost: r.row.newUnitCost,
                    remarks: r.row.remarks,
                  })),
                )
                onClose()
              }}
            >
              Import {matched.length} item{matched.length === 1 ? '' : 's'}
            </Button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem]">
        <FormField
          label="Rows"
          htmlFor="import-rates-text"
          hint={parsed.rows.length > 0 ? `${parsed.rows.length} row${parsed.rows.length === 1 ? '' : 's'} read${parsed.headerSkipped ? ', header skipped' : ''}.` : 'Columns separated by a tab, comma, semicolon or pipe.'}
        >
          <textarea
            id="import-rates-text"
            rows={7}
            className="aic block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder={SAMPLE}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setResolved(null)
            }}
          />
        </FormField>
        <div className="space-y-3">
          <FormField label="Warehouse" htmlFor="import-rates-warehouse" hint="Applied to every imported line.">
            <Select id="import-rates-warehouse" size="md" value={warehouseId ?? ''} onChange={(e) => setWarehouseId(e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">Select warehouse…</option>
              {warehouses.map((w) => (
                <option key={w.warehouse_id} value={w.warehouse_id}>
                  {w.warehouse_name}
                </option>
              ))}
            </Select>
          </FormField>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) readFile(file)
                e.target.value = ''
              }}
            />
            <Button variant="secondary" size="sm" icon={FileUp} block onClick={() => fileRef.current?.click()}>
              Choose a CSV file
            </Button>
            <p className="mt-1.5 text-[10px] leading-relaxed text-gray-500">The file is read in your browser. Nothing is uploaded — the codes are resolved against your item master, one lookup each.</p>
          </div>
        </div>
      </div>

      {error ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
        </p>
      ) : null}

      {badRows.length > 0 ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-900">
            {badRows.length} row{badRows.length === 1 ? '' : 's'} cannot be read
          </p>
          <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto scrollbar-thin text-[11px] text-amber-800">
            {badRows.slice(0, 20).map((r) => (
              <li key={r.row}>
                Row {r.row}: {r.problem}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {busy ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Looking the codes up…
        </p>
      ) : null}

      {resolved !== null && !busy ? (
        <div className="mt-3 space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-900">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
            {matched.length} item{matched.length === 1 ? '' : 's'} matched
            {unmatched.length > 0 ? <span className="font-normal text-amber-700">· {unmatched.length} need attention</span> : null}
          </p>
          {matched.length > 0 ? (
            <div className="max-h-44 overflow-y-auto scrollbar-thin rounded-xl border border-gray-200">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-2.5 py-1.5 text-left font-semibold text-gray-500">
                      Code
                    </th>
                    <th scope="col" className="px-2.5 py-1.5 text-left font-semibold text-gray-500">
                      Item
                    </th>
                    <th scope="col" className="px-2.5 py-1.5 text-right font-semibold text-gray-500">
                      New cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matched.map((r) => (
                    <tr key={`${r.row.row}-${r.row.code}`} className="border-t border-gray-100">
                      <td className="px-2.5 py-1.5 font-mono text-[11px] text-gray-500">{r.row.code}</td>
                      <td className="max-w-[18rem] truncate px-2.5 py-1.5 text-gray-900">{r.item?.print_name || r.item?.item_name}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums text-gray-900">{r.row.newUnitCost ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {unmatched.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <ul className="max-h-24 space-y-0.5 overflow-y-auto scrollbar-thin text-[11px] text-amber-800">
                {unmatched.map((r) => (
                  <li key={`${r.row.row}-${r.row.code}`}>
                    Row {r.row.row} · <span className="font-mono">{r.row.code}</span>: {r.reason ?? 'No matching item.'}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}

export default ImportRatesModal
