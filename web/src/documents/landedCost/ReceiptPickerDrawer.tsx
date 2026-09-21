import { useEffect, useMemo, useState } from 'react'
import { PackageSearch, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorState } from '../../ui/ErrorState'
import { SearchBox } from '../../ui/SearchBox'
import { Skeleton } from '../../ui/Skeleton'
import { AIC, cx } from '../../ui/cx'
import { useDebounce } from '../../hooks/useDebounce'
import { errorMessage } from '../../services/api'
import { formatDate, formatInt, formatMoney } from '../../utils/format'
import { useEligibleReceipts } from './useReceipts'

interface ReceiptPickerDrawerProps {
  open: boolean
  onClose: () => void
  selectedIds: number[]
  onToggle: (id: number) => void
  /** The landed cost document being edited, so it cannot pick itself. */
  ownDocumentId: number | null
  currency: string
}

/**
 * The receipt picker.
 *
 * A drawer rather than a page of its own: choosing a second GRN is a step inside entering a bill,
 * and losing the half-typed charges to a navigation would be a poor trade for a bigger table.
 *
 * The list is the SERVER's idea of an eligible receipt — inward types, posted, in this company and
 * financial year — because that is the set the allocator will accept. Whether a particular one can
 * actually carry a cost also depends on its lines and on the period lock, which is decided once it
 * is selected and its detail is read; the row in the card says so then.
 */
export function ReceiptPickerDrawer({ open, onClose, selectedIds, onToggle, ownDocumentId, currency }: ReceiptPickerDrawerProps) {
  const [term, setTerm] = useState('')
  const search = useDebounce(term, 300)
  const query = useEligibleReceipts({ q: search, limit: 25 }, open)

  // A drawer reopened should not still be filtered by what was typed last time.
  useEffect(() => {
    if (!open) setTerm('')
  }, [open])

  const rows = useMemo(() => (query.data?.data ?? []).filter((r) => r.document_id !== ownDocumentId), [query.data, ownDocumentId])

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add receipts"
      description="Posted, valued receipts this bill can be loaded onto. Tick every receipt the consignment arrived on."
      width="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500">
            {selectedIds.length} selected
          </span>
          <Button onClick={onClose}>Done</Button>
        </div>
      }
    >
      <div className={cx(AIC, 'space-y-3')}>
        <div className="flex items-center gap-2">
          <SearchBox value={term} onChange={setTerm} placeholder="Search by receipt no. or supplier…" className="flex-1" />
          <Button variant="secondary" icon={RefreshCw} onClick={query.reload} aria-label="Refresh the receipt list" />
        </div>

        {query.error ? (
          <ErrorState title="Unable to load eligible receipts" description={errorMessage(query.error)} onRetry={query.reload} retryLabel="Try again" />
        ) : query.loading && rows.length === 0 ? (
          <div className="space-y-2" aria-busy>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height="h-14" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title={search ? 'No receipt matches that search' : 'No eligible receipts found'}
            description={
              search
                ? 'Try the receipt number, or clear the search to see the most recent receipts.'
                : 'Posted and valued material receipts appear here when available. A receipt must be posted before a cost can be loaded onto it.'
            }
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="secondary" onClick={query.reload} icon={RefreshCw}>
                  Refresh
                </Button>
                <Link className="aic inline-flex h-8 items-center rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700 no-underline hover:bg-gray-50" to="/documents?document_type=MATERIAL_RECEIPT">
                  View material receipts
                </Link>
              </div>
            }
          />
        ) : (
          <ul className="m-0 space-y-1.5">
            {rows.map((row) => {
              const checked = selectedIds.includes(row.document_id)
              const inputId = `receipt-pick-${row.document_id}`
              return (
                <li key={row.document_id}>
                  <label
                    htmlFor={inputId}
                    className={cx(
                      'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                      checked ? 'border-primary/40 bg-primary-light/40' : 'border-gray-200 hover:bg-gray-50',
                    )}
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(row.document_id)}
                      className="h-4 w-4 shrink-0 accent-[rgb(var(--color-primary))]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-gray-900">{row.document_no ?? `#${row.document_id}`}</span>
                      <span className="block truncate text-[11px] text-gray-500">
                        {formatDate(row.document_date)}
                        {row.party_name ? ` · ${row.party_name}` : ''}
                        {` · ${formatInt(row.line_count)} line${Number(row.line_count) === 1 ? '' : 's'}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[10px] uppercase tracking-wide text-gray-400">Stock value</span>
                      <span className="block tabular-nums text-xs font-semibold text-gray-900">
                        {currency} {formatMoney(row.valuation_total)}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Drawer>
  )
}
