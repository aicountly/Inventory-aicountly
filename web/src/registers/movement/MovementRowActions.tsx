import { useNavigate } from 'react-router-dom'
import {
  Boxes,
  Copy,
  ExternalLink,
  FileText,
  MoreVertical,
  Printer,
  ScrollText,
  Warehouse,
} from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { P } from '../../services/access'
import { MenuButton } from '../../ui/MenuButton'
import type { MenuAction } from '../../ui/MenuButton'
import { notify } from '../../ui/notify'
import type { StockMovementRow } from '../../services/stockViewsApi'

/**
 * The per-row menu on the movement register.
 *
 * Every entry is a screen this app already has and this member is already allowed to
 * open, so nothing here is a new capability and nothing 403s on the click. Nothing
 * writes, either: a movement is an append-only fact and the register is a reading of it,
 * so there is no edit or delete to offer and none is invented for symmetry.
 *
 * Same shape as StockBalanceRowActions, on the same `ui/MenuButton`.
 */
export function MovementRowActions({ row }: { row: StockMovementRow }) {
  const { can } = useAccess()
  const navigate = useNavigate()

  const canReadDocuments = can(P.documentsRead)
  const canReadLedger = can(P.report('stock_ledger'))

  const ledgerHref = `/registers/stock-ledger?item_id=${row.item_id}${
    row.warehouse_id ? `&warehouse_id=${row.warehouse_id}` : ''
  }`

  const reference = row.document_no ?? (row.document_id ? `#${row.document_id}` : null)

  const actions: MenuAction[] = [
    ...(row.document_id && canReadDocuments
      ? [
          {
            key: 'document',
            label: 'Open document',
            icon: FileText,
            onSelect: () => navigate(`/documents/${row.document_id}`),
          },
        ]
      : []),
    ...(canReadLedger
      ? [
          {
            key: 'ledger',
            label: 'View item ledger',
            icon: ScrollText,
            onSelect: () => navigate(ledgerHref),
          },
        ]
      : []),
    ...(can(P.masters('items', 'read'))
      ? [
          {
            key: 'item',
            label: 'Open item',
            icon: ExternalLink,
            onSelect: () => navigate(`/items/${row.item_id}`),
          },
        ]
      : []),
    // The register's own screen, filtered to this row's batch — the movements of one
    // batch is a question people ask of a batch number they have just read off a line.
    ...(row.batch_id && canReadLedger
      ? [
          {
            key: 'batch',
            label: 'Movements of this batch',
            icon: Boxes,
            onSelect: () =>
              navigate(`/registers/movement-register?item_id=${row.item_id}&batch_id=${row.batch_id}`),
          },
        ]
      : []),
    ...(row.warehouse_id && canReadLedger
      ? [
          {
            key: 'warehouse',
            label: 'Movements in this warehouse',
            icon: Warehouse,
            onSelect: () => navigate(`/registers/movement-register?warehouse_id=${row.warehouse_id}`),
          },
        ]
      : []),
    ...(reference
      ? [
          {
            key: 'copy',
            label: 'Copy reference',
            icon: Copy,
            separated: true,
            onSelect: () => {
              // `navigator.clipboard` is absent over plain HTTP and can be refused by
              // permission policy. Either way the reader is told, rather than left
              // pasting whatever was on the clipboard before.
              navigator.clipboard
                ?.writeText(reference)
                .then(() => notify.success(`Copied ${reference}`))
                .catch(() => notify.error('Could not copy to the clipboard'))
            },
          },
        ]
      : []),
    ...(row.document_id && canReadDocuments
      ? [
          {
            key: 'print',
            label: 'Print document',
            icon: Printer,
            onSelect: () => navigate(`/documents/${row.document_id}/print`),
          },
        ]
      : []),
  ]

  if (actions.length === 0) return null

  return (
    // The row drills through on click, and the kebab must not take the reader with it.
    // Stopped on a wrapper rather than through `buttonProps`: MenuButton spreads that bag
    // AFTER its own onClick, so an onClick passed there would replace the toggle.
    <span
      className="inline-flex"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <MenuButton
        actions={actions}
        label="Movement actions"
        icon={MoreVertical}
        variant="ghost"
        size="xs"
      />
    </span>
  )
}

export default MovementRowActions
