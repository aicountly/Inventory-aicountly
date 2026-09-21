import { useEffect, useState } from 'react'
import { CopyPlus, FileText, RotateCcw } from 'lucide-react'
import { errorMessage, isAbortError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import type { DocumentListRow } from '../types'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { EmptyState } from '../../ui/EmptyState'
import { Spinner } from '../../ui/Spinner'
import { cx } from '../../ui/cx'
import { formatDate } from '../../utils/format'
import type { LineDraft } from '../formModel'
import { lineFromStored } from '../formModel'
import type { DocumentTypeSpec } from '../registry'

interface CopyFromChallanDrawerProps {
  open: boolean
  onClose: () => void
  spec: DocumentTypeSpec
  /** Restricts the list to one customer when the header already names one. */
  partyRef: number | null
  partyName: string
  defaultWarehouseId: number | null
  onCopy: (lines: LineDraft[], source: DocumentListRow) => void
}

/**
 * Repeat a dispatch: load the lines of an earlier challan into this one.
 *
 * Items, units, warehouses and quantities are copied. Batch and serial
 * selections are NOT — they name stock that has already left the building, and
 * re-picking them against live availability is the whole point of doing this on
 * a draft rather than duplicating a posted document.
 */
export function CopyFromChallanDrawer({ open, onClose, spec, partyRef, partyName, defaultWarehouseId, onCopy }: CopyFromChallanDrawerProps) {
  const [rows, setRows] = useState<DocumentListRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyingId, setCopyingId] = useState<number | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    documentsApi
      .list(
        {
          document_type: spec.code,
          party_ref: partyRef ?? undefined,
          all_fy: true,
          limit: 25,
          sort: 'document_date',
          order: 'desc',
        },
        controller.signal,
      )
      .then((res) => {
        if (controller.signal.aborted) return
        setRows(res.data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setError(errorMessage(err, 'Could not load earlier challans.'))
        setLoading(false)
      })
    return () => controller.abort()
  }, [open, spec.code, partyRef, tick])

  const copy = async (row: DocumentListRow) => {
    setCopyingId(row.document_id)
    setError(null)
    try {
      const doc = await documentsApi.get(row.document_id)
      const lines = doc.lines.map((l) => {
        const draft = lineFromStored(l, spec)
        return {
          ...draft,
          warehouse_id: draft.warehouse_id ?? defaultWarehouseId,
          batch_id: null,
          batch_no: null,
          serials: [],
          origin: 'manual' as const,
        }
      })
      if (lines.length === 0) {
        setError('That challan has no item lines to copy.')
        return
      }
      onCopy(lines, row)
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Could not read that challan.'))
    } finally {
      setCopyingId(null)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Copy lines from an earlier challan"
      description={partyRef ? `Challans raised for ${partyName || `ledger #${partyRef}`}` : 'The most recent delivery challans in this company'}
      width="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500">Batch and serial selections are re-picked against live stock.</span>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {error ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <span className="min-w-0">{error}</span>
            <Button variant="secondary" size="xs" icon={RotateCcw} onClick={() => setTick((t) => t + 1)}>
              Retry
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
            <Spinner /> Loading challans…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={FileText} size="sm" title="No earlier challan to copy" description={partyRef ? 'This customer has no delivery challan on record yet.' : 'No delivery challan has been raised in this company yet.'} />
        ) : (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
            {rows.map((row) => (
              <li key={row.document_id} className="flex flex-wrap items-center gap-2 px-3 py-2 hover:bg-gray-50">
                <span className="min-w-0 flex-1 basis-48">
                  <span className="block truncate text-xs font-medium text-gray-900">{row.document_no ?? `#${row.document_id}`}</span>
                  <span className="block truncate text-[11px] text-gray-500">
                    {formatDate(row.document_date)}
                    {row.party_name ? ` · ${row.party_name}` : ''}
                    {` · ${row.line_count} line${Number(row.line_count) === 1 ? '' : 's'}`}
                  </span>
                </span>
                <Badge tone={row.status === 'POSTED' || row.status === 'COMPLETED' ? 'success' : 'neutral'} size="xs">
                  {row.status.replace(/_/g, ' ').toLowerCase()}
                </Badge>
                <Button
                  variant="secondary"
                  size="xs"
                  icon={CopyPlus}
                  loading={copyingId === row.document_id}
                  disabled={copyingId !== null}
                  className={cx('shrink-0')}
                  onClick={() => void copy(row)}
                >
                  Copy lines
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  )
}
