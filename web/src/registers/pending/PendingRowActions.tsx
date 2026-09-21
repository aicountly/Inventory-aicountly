import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, ExternalLink, MoreVertical, PanelRightOpen, ScrollText, Users, Warehouse } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { P } from '../../services/access'
import { MenuButton } from '../../ui/MenuButton'
import type { MenuAction } from '../../ui/MenuButton'
import { notify } from '../../ui/notify'
import type { PendingRow } from '../../services/stockApi'
import { PendingDetailDrawer } from './PendingDetailDrawer'

/**
 * The per-row menu on the pending register.
 *
 * Every entry is either a screen the app already has, narrowed by a filter that
 * screen actually reads, or the inspector for this line. Nothing here writes:
 * a pending quantity is settled by raising the document that settles it, and a
 * menu that offered to close one from a register would be a second, untracked
 * way of moving stock.
 *
 * Each action is gated on the permission its destination is gated on, so nothing
 * here 403s on the click. The whole menu disappears when none survive.
 *
 * The drawer is owned per row rather than by the register: only one is ever open,
 * it is mounted only once asked for, and the alternative — hoisting the open id
 * into the engine — would put a register-specific piece of state in the file that
 * renders twenty other registers.
 */
export function PendingRowActions({ row }: { row: PendingRow }) {
  const { can } = useAccess()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const label = row.document_no ?? `Pending line #${row.pending_id}`

  const actions: MenuAction[] = [
    {
      key: 'details',
      label: 'View details',
      icon: PanelRightOpen,
      onSelect: () => setDrawerOpen(true),
    },
    ...(row.document_id
      ? [
          {
            key: 'document',
            label: 'Open source document',
            icon: ExternalLink,
            onSelect: () => navigate(`/documents/${row.document_id}`),
          },
        ]
      : []),
    ...(can(P.report('stock_ledger'))
      ? [
          {
            key: 'ledger',
            label: 'Item movement history',
            icon: ScrollText,
            onSelect: () => navigate(`/registers/stock-ledger?item_id=${row.item_id}`),
          },
        ]
      : []),
    ...(row.warehouse_id && can(P.report('warehouse_stock'))
      ? [
          {
            key: 'warehouse',
            label: 'Stock in this warehouse',
            icon: Warehouse,
            onSelect: () => navigate(`/registers/warehouse-stock?warehouse_id=${row.warehouse_id}`),
          },
        ]
      : []),
    ...(row.party_ref
      ? [
          {
            key: 'party',
            label: 'Everything pending for this party',
            icon: Users,
            separated: true,
            onSelect: () => navigate(`/registers/pending-quantities?party_ref=${row.party_ref}`),
          },
        ]
      : []),
    ...(row.document_no
      ? [
          {
            key: 'copy',
            label: 'Copy document number',
            icon: Copy,
            onSelect: () => {
              // Clipboard access is permission-gated in the browser and absent
              // over plain HTTP; a silent failure would look like a working copy.
              navigator.clipboard
                ?.writeText(row.document_no ?? '')
                .then(() => notify.success(`Copied ${row.document_no}`))
                .catch(() => notify.error('Could not copy to the clipboard'))
            },
          },
        ]
      : []),
  ]

  return (
    // The row drills through on activation, and the kebab must not take the
    // reader with it. Stopped on a wrapper rather than through `buttonProps`:
    // MenuButton spreads that bag AFTER its own onClick, so an onClick passed
    // there would replace the toggle and the menu would never open.
    <span
      className="inline-flex"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <MenuButton
        actions={actions}
        label={`Actions for ${label}`}
        icon={MoreVertical}
        variant="ghost"
        size="xs"
      />
      {drawerOpen ? (
        <PendingDetailDrawer row={row} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      ) : null}
    </span>
  )
}

export default PendingRowActions
