import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, HelpCircle, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { Badge } from '../ui/Badge'
import type { BadgeTone } from '../ui/Badge'
import { Button } from '../ui/Button'
import { csvFilename, downloadCsv } from '../utils/csv'
import { formatQty } from '../utils/format'
import { parseLinesInput, resolveImportRows } from './lineImport'
import type { ImportRowStatus, ResolvedImportRow } from './lineImport'

const STATUS: Record<ImportRowStatus, { label: string; tone: BadgeTone; icon: LucideIcon }> = {
  ok: { label: 'Matched', tone: 'success', icon: CheckCircle2 },
  not_found: { label: 'No matching item', tone: 'danger', icon: AlertTriangle },
  ambiguous: { label: 'Multiple matches', tone: 'warning', icon: HelpCircle },
  invalid_qty: { label: 'Invalid quantity', tone: 'danger', icon: AlertTriangle },
}

export interface ImportLinesDialogProps {
  open: boolean
  onClose: () => void
  warehouseId: number | null
  onImport: (rows: ResolvedImportRow[]) => void
  disabled?: boolean
}

/**
 * CSV / pasted-text line import: parse → match each row against the live item API → preview with
 * row-level status → the user confirms before anything is appended. Nothing is written to the
 * table (let alone the server) before that confirm.
 */
export function ImportLinesDialog({ open, onClose, warehouseId, onImport, disabled }: ImportLinesDialogProps) {
  const [step, setStep] = useState<'input' | 'preview'>('input')
  const [text, setText] = useState('')
  const [rows, setRows] = useState<ResolvedImportRow[]>([])
  const [resolving, setResolving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setStep('input')
    setText('')
    setRows([])
  }

  const close = () => {
    reset()
    onClose()
  }

  const onFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  const preview = async () => {
    const parsed = parseLinesInput(text)
    if (parsed.length === 0) return
    setResolving(true)
    try {
      const resolved = await resolveImportRows(parsed, warehouseId)
      setRows(resolved)
      setStep('preview')
    } finally {
      setResolving(false)
    }
  }

  const okRows = rows.filter((r) => r.status === 'ok')

  const confirm = () => {
    onImport(okRows)
    close()
  }

  const template = () => {
    downloadCsv(csvFilename('line-import-template'), 'Item SKU or name,Qty,Rate\r\nSKU-0001,10,125.50\r\n')
  }

  return (
    <Modal
      open={open}
      title="Import lines"
      description="Paste rows or upload a CSV: item SKU / name, quantity, rate."
      onClose={close}
      size="lg"
      busy={resolving}
      footer={
        <>
          {step === 'preview' ? (
            <Button variant="ghost" onClick={() => setStep('input')}>
              Back
            </Button>
          ) : null}
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          {step === 'input' ? (
            <Button onClick={() => void preview()} loading={resolving} disabled={disabled || !text.trim()}>
              Preview
            </Button>
          ) : (
            <Button onClick={confirm} disabled={disabled || okRows.length === 0}>
              Add {okRows.length} line{okRows.length === 1 ? '' : 's'}
            </Button>
          )}
        </>
      }
    >
      {step === 'input' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>
              Upload CSV
            </Button>
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <Button size="sm" variant="ghost" icon={Download} onClick={template}>
              Download template
            </Button>
          </div>
          <textarea
            className="textarea font-mono text-xs"
            style={{ minHeight: '10rem' }}
            placeholder={'SKU-0001, 10, 125.50\nSKU-0002, 5'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="hint">One line per item: SKU or name, quantity, rate (rate optional). Comma, tab or plain spaces all work.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>{rows.length} row{rows.length === 1 ? '' : 's'} parsed</span>
            <span>·</span>
            <span className="text-emerald-700 font-medium">{okRows.length} ready to import</span>
            {rows.length - okRows.length > 0 ? <span className="text-amber-700 font-medium">{rows.length - okRows.length} need attention</span> : null}
          </div>
          <div className="border border-gray-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left px-2.5 py-1.5 font-semibold text-gray-500">Row</th>
                  <th className="text-left px-2.5 py-1.5 font-semibold text-gray-500">Matched item</th>
                  <th className="text-right px-2.5 py-1.5 font-semibold text-gray-500">Qty</th>
                  <th className="text-right px-2.5 py-1.5 font-semibold text-gray-500">Rate</th>
                  <th className="text-left px-2.5 py-1.5 font-semibold text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const s = STATUS[r.status]
                  return (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-2.5 py-1.5 text-gray-500 max-w-[10rem] truncate" title={r.raw}>
                        {r.identifier}
                      </td>
                      <td className="px-2.5 py-1.5">{r.item ? r.item.print_name || r.item.item_name : <span className="text-gray-400">—</span>}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{r.qty !== null ? formatQty(r.qty) : '—'}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{r.rate !== null ? formatQty(r.rate) : '—'}</td>
                      <td className="px-2.5 py-1.5">
                        <Badge tone={s.tone} size="xs">
                          {s.label}
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {rows.length - okRows.length > 0 ? <Notice kind="warning">Rows that could not be matched, or named an invalid quantity, are skipped — nothing will be added for them.</Notice> : null}
        </div>
      )}
    </Modal>
  )
}

export default ImportLinesDialog
