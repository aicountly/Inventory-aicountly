import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, ExternalLink, FileClock } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { StatusBadge } from '../../ui/StatusBadge'
import { useQuery } from '../../hooks/useQuery'
import { errorMessage } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { LoadingState } from '../../ui/LoadingState'
import { formatDate, formatQty } from '../../utils/format'
import type { DocumentListRow } from '../types'

export interface RecentDialogProps {
  open: boolean
  onClose: () => void
  /** `copy` offers to pull a document's lines into the draft; `browse` only links to them. */
  mode: 'copy' | 'browse'
  onCopy: (documentId: number) => Promise<void>
}

/**
 * Recent disassemblies, read live from `GET /v1/inventory-documents?document_type=DISASSEMBLY`.
 *
 * Copying one loads the document itself (not the list row) so the components, batches, units and
 * costs come from the stored document rather than from a summary — and it copies the LINES only:
 * the number, the date and the status belong to that document, never to a new one.
 */
export function RecentDialog({ open, onClose, mode, onCopy }: RecentDialogProps) {
  const [copying, setCopying] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const query = useQuery(
    (signal) => documentsApi.list({ document_type: 'DISASSEMBLY', limit: 15, sort: 'document_date', order: 'desc', all_fy: false }, signal),
    [open],
    { enabled: open },
  )

  const copy = async (row: DocumentListRow) => {
    setCopying(row.document_id)
    setError(null)
    try {
      await onCopy(row.document_id)
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Could not copy that document.'))
    } finally {
      setCopying(null)
    }
  }

  const rows = query.data?.data ?? []

  return (
    <Modal
      open={open}
      title={mode === 'copy' ? 'Copy an existing disassembly' : 'Recent disassemblies'}
      description={mode === 'copy' ? 'Its lines are copied into this draft; the number, date and status are not.' : 'The last fifteen in this financial year.'}
      onClose={onClose}
      size="lg"
      busy={copying !== null}
      footer={
        <Button variant="secondary" onClick={onClose} disabled={copying !== null}>
          Close
        </Button>
      }
    >
      {error ? <Notice kind="error">{error}</Notice> : null}
      {query.error ? <Notice kind="error">{errorMessage(query.error)}</Notice> : null}
      {query.loading && rows.length === 0 ? <LoadingState label="Loading recent disassemblies…" /> : null}
      {!query.loading && rows.length === 0 && !query.error ? (
        <EmptyState icon={FileClock} title="No disassembly yet" description="Once you post one it will be listed here to copy from." />
      ) : null}
      {rows.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {rows.map((row) => (
            <li key={row.document_id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-semibold text-gray-900">{row.document_no ?? `#${row.document_id}`}</span>
                  <StatusBadge value={row.status} size="xs" />
                </div>
                <p className="mt-0.5 truncate text-[11px] text-gray-500">
                  {formatDate(row.document_date)} · {formatQty(row.line_count, '0')} lines
                  {row.narration ? ` · ${row.narration}` : ''}
                </p>
              </div>
              <Link
                to={`/documents/${row.document_id}`}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                Open
              </Link>
              {mode === 'copy' ? (
                <Button size="xs" variant="secondary" icon={Copy} loading={copying === row.document_id} onClick={() => void copy(row)}>
                  Copy lines
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  )
}
