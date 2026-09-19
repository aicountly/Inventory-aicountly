import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  EllipsisVertical,
  ExternalLink,
  GitMerge,
  Layers,
  Minus,
} from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { MenuButton } from '../../../ui/MenuButton'
import type { MenuAction } from '../../../ui/MenuButton'
import { SmartTable } from '../../../ui/shell/SmartTable'
import type { SmartColumn, SmartTableError } from '../../../ui/shell/SmartTable'
import { cx } from '../../../ui/cx'
import type { SortOrder } from '../../../services/api'
import type { ValuationRevision } from '../../../services/valuationApi'
import { formatDate, formatDateTime, formatMoney, formatQty, humanize } from '../../../utils/format'
import { BOOKS_STATE_BADGE, DELTA_MEANING, booksState, deltaDirection } from './revisionsModel'

export interface RevisionTableProps {
  rows: readonly ValuationRevision[]
  loading: boolean
  error: SmartTableError
  sort: { key: string; order: SortOrder }
  onSort: (key: string) => void
  selected: ReadonlySet<number>
  onToggle: (id: number) => void
  onToggleAll: () => void
  canAcknowledge: boolean
  canViewDocuments: boolean
  canReconcile: boolean
  onOpen: (row: ValuationRevision) => void
  onAcknowledgeRow: (row: ValuationRevision) => void
  /** Router navigation — a menu item must not reload the SPA. */
  onNavigate: (to: string) => void
  documentTypeLabel: (code: string | null) => string
  empty: ReactNode
  title: ReactNode
  description: ReactNode
  headerAction: ReactNode
  footer: ReactNode
  /** Changes whenever the query does, so keyboard focus returns to the first row. */
  resetKey: string
}

/** A checkbox that can also say "some of them". */
function TriStateCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  indeterminate: boolean
  onChange: () => void
  label: string
  disabled?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked
  }, [indeterminate, checked])
  return (
    <input
      ref={ref}
      type="checkbox"
      className="h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))] disabled:cursor-not-allowed disabled:opacity-40"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
    />
  )
}

/**
 * The valuation delta, with its meaning attached.
 *
 * A positive delta means the stock cost MORE than the books had it at — a COGS increase to
 * re-post, which is why it is drawn as pressure rather than as a gain. The arrow and the
 * screen-reader phrase carry the same meaning as the colour, so nothing is lost in a
 * monochrome print or to a reader who cannot separate red from green.
 */
function DeltaCell({ delta }: { delta: number | null }) {
  const direction = deltaDirection(delta)
  const meaning = DELTA_MEANING[direction]
  const Icon = direction === 'increase' ? ArrowUpRight : direction === 'decrease' ? ArrowDownRight : Minus
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold tabular-nums',
        direction === 'increase' && 'bg-red-50 text-red-700',
        direction === 'decrease' && 'bg-emerald-50 text-emerald-700',
        direction === 'flat' && 'text-gray-400',
      )}
      title={`${meaning.srLabel}: ${formatMoney(delta)}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {formatMoney(delta)}
      <span className="sr-only">{meaning.srLabel}</span>
    </span>
  )
}

export function RevisionTable({
  rows,
  loading,
  error,
  sort,
  onSort,
  selected,
  onToggle,
  onToggleAll,
  canAcknowledge,
  canViewDocuments,
  canReconcile,
  onOpen,
  onAcknowledgeRow,
  onNavigate,
  documentTypeLabel,
  empty,
  title,
  description,
  headerAction,
  footer,
  resetKey,
}: RevisionTableProps) {
  const selectable = useMemo(() => rows.filter((r) => !r.acknowledged), [rows])
  const selectedOnPage = selectable.filter((r) => selected.has(r.revision_id)).length
  const allSelected = selectable.length > 0 && selectedOnPage === selectable.length

  const columns = useMemo<SmartColumn<ValuationRevision>[]>(() => {
    const cols: SmartColumn<ValuationRevision>[] = []

    if (canAcknowledge) {
      cols.push({
        key: 'select',
        width: 36,
        header: (
          <TriStateCheckbox
            checked={allSelected}
            indeterminate={selectedOnPage > 0}
            onChange={onToggleAll}
            disabled={selectable.length === 0}
            label="Select every revision on this page that Books has not applied"
          />
        ),
        render: (r) =>
          r.acknowledged ? (
            <span className="sr-only">Already applied in Books</span>
          ) : (
            <TriStateCheckbox
              checked={selected.has(r.revision_id)}
              indeterminate={false}
              onChange={() => onToggle(r.revision_id)}
              label={`Select revision ${r.revision_id}`}
            />
          ),
      })
    }

    cols.push(
      {
        key: 'created_at',
        header: 'Created',
        sortKey: 'created_at',
        minWidth: 130,
        render: (r) => <span className="whitespace-nowrap tabular-nums">{formatDateTime(r.created_at)}</span>,
      },
      {
        key: 'books',
        header: 'Books',
        minWidth: 96,
        render: (r) => {
          const badge = BOOKS_STATE_BADGE[booksState(r)]
          return (
            <span title={badge.title}>
              <Badge tone={badge.tone} size="xs" dot>
                {badge.label}
              </Badge>
            </span>
          )
        },
      },
      {
        key: 'document',
        header: 'Document',
        minWidth: 110,
        render: (r) =>
          r.document_id && canViewDocuments ? (
            <Link to={`/documents/${r.document_id}`} className="font-medium text-primary hover:underline">
              {r.document_no ?? `#${r.document_id}`}
            </Link>
          ) : (
            (r.document_no ?? (r.document_id ? `#${r.document_id}` : null))
          ),
      },
      {
        key: 'document_date',
        header: 'Date',
        minWidth: 100,
        render: (r) => <span className="whitespace-nowrap">{formatDate(r.document_date)}</span>,
      },
      {
        key: 'source',
        header: 'Source',
        minWidth: 130,
        render: (r) => (
          <span className="block min-w-0">
            <span className="block truncate">{documentTypeLabel(r.document_type)}</span>
            {r.source_app ? (
              <span className="block truncate text-[10px] text-gray-400" title={`Originated in ${r.source_app}`}>
                {humanize(r.source_app)}
                {r.source_document_no ? ` · ${r.source_document_no}` : ''}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        key: 'item',
        header: 'Item',
        minWidth: 180,
        render: (r) =>
          r.item_id ? (
            <span className="block min-w-0">
              <Link
                to={`/valuation/cost-layers?item_id=${r.item_id}`}
                className="block truncate font-medium text-primary hover:underline"
                title={r.item_name ?? undefined}
              >
                {r.item_name ?? `Item #${r.item_id}`}
              </Link>
              {r.item_sku ? <span className="block truncate text-[10px] text-gray-400">{r.item_sku}</span> : null}
            </span>
          ) : null,
      },
      {
        key: 'base_qty',
        header: 'Qty',
        align: 'right',
        minWidth: 80,
        render: (r) => (
          <span className="whitespace-nowrap">
            {formatQty(r.base_qty)}
            {r.unit_symbol ? <span className="ml-1 text-[10px] text-gray-400">{r.unit_symbol}</span> : null}
          </span>
        ),
      },
      /*
       * Every money column below is a VALUATION figure — what the stock cost, which is what
       * drives COGS and closing stock. None of it is the commercial rate agreed with a party:
       * that number belongs to Books and is not on this screen. The headers say so in full,
       * because a column headed "Old rate" is one somebody will read as a price.
       */
      {
        key: 'old_valuation_rate',
        header: 'Old valuation rate',
        align: 'right',
        minWidth: 110,
        render: (r) => formatMoney(r.old_valuation_rate),
      },
      {
        key: 'new_valuation_rate',
        header: 'New valuation rate',
        align: 'right',
        minWidth: 110,
        render: (r) => formatMoney(r.new_valuation_rate),
      },
      {
        key: 'old_valuation_amount',
        header: 'Old valuation amount',
        align: 'right',
        minWidth: 120,
        render: (r) => formatMoney(r.old_valuation_amount),
      },
      {
        key: 'new_valuation_amount',
        header: 'New valuation amount',
        align: 'right',
        minWidth: 120,
        render: (r) => formatMoney(r.new_valuation_amount),
      },
      {
        key: 'delta_amount',
        header: 'Valuation delta',
        align: 'right',
        sortKey: 'delta_amount',
        minWidth: 120,
        render: (r) => <DeltaCell delta={r.delta_amount} />,
      },
      {
        key: 'job_id',
        header: 'Job',
        minWidth: 80,
        render: (r) =>
          r.job_id ? (
            <Link to={`/valuation/revisions?job_id=${r.job_id}`} className="font-medium text-primary hover:underline">
              #{r.job_id}
            </Link>
          ) : null,
      },
      {
        key: 'acknowledged',
        header: 'Acknowledged',
        minWidth: 120,
        sortKey: 'acknowledged_at',
        render: (r) =>
          r.acknowledged ? (
            <span
              title={`${formatDateTime(r.acknowledged_at)}${r.acknowledged_by_app ? ` · ${r.acknowledged_by_app}` : ''}`}
            >
              <Badge tone="success" size="xs" dot>
                Yes
              </Badge>
            </span>
          ) : (
            <Badge tone="danger" size="xs" dot>
              No
            </Badge>
          ),
      },
      {
        key: 'actions',
        header: <span className="sr-only">Actions</span>,
        align: 'right',
        width: 44,
        render: (r) => {
          const actions: MenuAction[] = [
            { key: 'view', label: 'View revision', icon: ExternalLink, onSelect: () => onOpen(r) },
          ]
          if (r.item_id) {
            actions.push({
              key: 'layers',
              label: 'View cost layers',
              icon: Layers,
              onSelect: () => onNavigate(`/valuation/cost-layers?item_id=${r.item_id}`),
            })
          }
          if (canAcknowledge && !r.acknowledged) {
            actions.push({
              key: 'ack',
              label: 'Acknowledge this revision',
              icon: CheckCircle2,
              separated: true,
              onSelect: () => onAcknowledgeRow(r),
            })
          }
          if (canReconcile) {
            actions.push({
              key: 'reconcile',
              label: 'Open reconciliation',
              icon: GitMerge,
              separated: !canAcknowledge || r.acknowledged,
              onSelect: () => onNavigate('/reconciliation/posting-status'),
            })
          }
          return (
            <MenuButton
              actions={actions}
              label={`Actions for revision ${r.revision_id}`}
              icon={EllipsisVertical}
              width={232}
            />
          )
        },
      },
    )

    return cols
  }, [
    allSelected,
    canAcknowledge,
    canReconcile,
    canViewDocuments,
    documentTypeLabel,
    onAcknowledgeRow,
    onNavigate,
    onOpen,
    onToggle,
    onToggleAll,
    selectable.length,
    selected,
    selectedOnPage,
  ])

  return (
    <SmartTable<ValuationRevision>
      columns={columns}
      rows={rows}
      rowKey={(r) => r.revision_id}
      loading={loading}
      error={error}
      empty={empty}
      title={title}
      description={description}
      headerAction={headerAction}
      footer={footer}
      caption="Valuation revisions, newest first. Every rate and amount is a valuation figure."
      sort={sort}
      onSort={onSort}
      stickyHeader
      scrollBody
      density="compact"
      size="xs"
      minWidth={1420}
      keyboardResetKey={resetKey}
      onRowActivate={onOpen}
      rowClassName={(r) => (selected.has(r.revision_id) ? 'bg-primary-light/50' : undefined)}
      className="max-h-[min(38rem,62vh)] print:max-h-none"
    />
  )
}

export default RevisionTable
