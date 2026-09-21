import { useEffect, useState } from 'react'
import { documentsApi } from '../../services/documentsApi'
import type { PrintSnapshot } from '../types'
import { errorMessage } from '../../services/api'
import { useToast } from '../../ui/ToastContext'
import { Button } from '../../ui/Button'
import { formatDate } from '../../utils/format'
import '../documents.css'
import './consumption.css'

interface ConsumptionPrintViewProps {
  /** Document to print, or null when nothing should render. */
  documentId: number | null
  onDone: () => void
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

/**
 * "Save & Post + Print": renders the server's own print snapshot (`GET
 * /inventory-documents/{id}/print-snapshot`, the same one the document detail screen can print)
 * and calls the browser print dialog. No new backend endpoint — this only reads a snapshot every
 * posted document already has.
 */
export function ConsumptionPrintView({ documentId, onDone }: ConsumptionPrintViewProps) {
  const toast = useToast()
  const [snapshot, setSnapshot] = useState<PrintSnapshot | null>(null)

  useEffect(() => {
    if (documentId === null) {
      setSnapshot(null)
      return undefined
    }
    let active = true
    documentsApi
      .printSnapshot(documentId)
      .then((snap) => {
        if (active) setSnapshot(snap)
      })
      .catch((err: unknown) => {
        if (!active) return
        toast.error(errorMessage(err, 'Could not load the print view.'))
        onDone()
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone/toast are stable for the run's lifetime
  }, [documentId])

  useEffect(() => {
    if (!snapshot) return undefined
    const id = window.setTimeout(() => window.print(), 150)
    const after = () => onDone()
    window.addEventListener('afterprint', after)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('afterprint', after)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone is stable for the run's lifetime
  }, [snapshot])

  if (documentId === null || !snapshot) return null

  const header = (snapshot.header_snapshot ?? {}) as Record<string, unknown>
  const lines = snapshot.item_lines_snapshot ?? []
  const footer = (snapshot.footer_snapshot ?? {}) as Record<string, unknown>

  return (
    <div className="consumption-print-overlay">
      <div className="print-sheet">
        <h1>{str(header.document_type_label) || 'Consumption'} {snapshot.document_no ?? `#${snapshot.document_id}`}</h1>
        <div className="print-meta">
          <div>
            <span>Date</span>
            <br />
            {formatDate(snapshot.document_date)}
          </div>
          <div>
            <span>Warehouse</span>
            <br />
            {str(header.warehouse_name) || '—'}
          </div>
          <div>
            <span>Reason</span>
            <br />
            {str(header.reason_code) || '—'}
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>Batch</th>
              <th className="align-right">Qty</th>
              <th>Unit</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{str(l.item_name) || `Item #${str(l.item_id)}`}</td>
                <td>{str(l.batch_no) || '—'}</td>
                <td className="align-right">{str(l.qty)}</td>
                <td>{str(l.unit_symbol)}</td>
                <td>{str(l.description)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {footer.narration ? <p>{str(footer.narration)}</p> : null}
      </div>
      <div className="no-print" style={{ textAlign: 'center', padding: '1rem' }}>
        <Button variant="secondary" onClick={onDone}>
          Close
        </Button>
      </div>
    </div>
  )
}

export default ConsumptionPrintView
