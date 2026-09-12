import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { DataTable } from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { StatusBadge } from '../../components/StatusBadge'
import type { PostingStatusEntry } from '../../services/reconciliationApi'
import { formatDate, formatMoney } from '../../utils/format'

const SYNC_TONE: Record<string, 'good' | 'warning' | 'critical' | 'neutral' | 'info'> = {
  IN_SYNC: 'good',
  PENDING_INVENTORY: 'info',
  PENDING_IN_BOOKS: 'info',
  FAILED_INVENTORY: 'critical',
  FAILED_IN_BOOKS: 'critical',
  MISSING_IN_BOOKS: 'critical',
  MISSING_IN_INVENTORY: 'critical',
  REVERSED_INVENTORY: 'warning',
  CANCELLED_IN_BOOKS: 'warning',
  CANCELLED_BOTH: 'neutral',
  BOOKS_UNAVAILABLE: 'warning',
}

export function syncTone(status: string) {
  return SYNC_TONE[status] ?? 'neutral'
}

export function PostingStatusTable({ entries, loading, error }: { entries: PostingStatusEntry[]; loading?: boolean; error?: Error | null }) {
  const columns = useMemo<Column<PostingStatusEntry>[]>(
    () => [
      { key: 'sync_status', header: 'Sync', render: (e) => <StatusBadge value={e.sync_status.replace(/_/g, ' ')} tone={syncTone(e.sync_status)} /> },
      { key: 'source', header: 'Books voucher', render: (e) => <span>{e.source.source_document_type ?? e.books?.source_document_type ?? '—'} · {e.books?.document_no ?? e.source.source_document_no ?? `#${e.source.source_document_id ?? ''}`}</span> },
      { key: 'books_date', header: 'Books date', render: (e) => formatDate(e.books?.document_date) },
      { key: 'books_status', header: 'Books status', render: (e) => e.books?.status ?? <span className="muted">—</span> },
      { key: 'books_amount', header: 'Books amount', align: 'right', render: (e) => formatMoney(e.books?.amount) },
      { key: 'inventory', header: 'Inventory document', render: (e) => (e.inventory ? <Link to={`/documents/${e.inventory.document_id}`}>{e.inventory.document_no ?? `#${e.inventory.document_id}`} · {e.inventory.document_type}</Link> : <span className="muted">none</span>) },
      { key: 'inventory_status', header: 'Inventory status', render: (e) => (e.inventory ? <StatusBadge value={e.inventory.status} /> : '—') },
      { key: 'stock_effect', header: 'Stock effect', align: 'right', render: (e) => formatMoney(e.inventory?.stock_effect) },
      { key: 'failure', header: 'Failure', render: (e) => e.inventory?.failure_reason ?? <span className="muted">—</span> },
    ],
    [],
  )
  return <DataTable columns={columns} rows={entries} rowKey={(e) => `${e.source.source_document_type}:${e.source.source_document_id}:${e.inventory?.document_id ?? 0}`} loading={loading} error={error ?? null} emptyMessage="No vouchers to compare." />
}
