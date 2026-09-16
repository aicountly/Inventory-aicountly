import { useNavigate } from 'react-router-dom'
import { ExternalLink, MoreVertical, ScrollText } from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { P } from '../services/access'
import { MenuButton } from '../ui/MenuButton'
import type { MenuAction } from '../ui/MenuButton'
import type { StockBalanceGridRow } from '../services/stockViewsApi'

/**
 * The per-row action menu on the stock balance register.
 *
 * Both entries are screens the app already has and this user is already allowed
 * to open, so nothing here is a new capability and nothing 403s on the click.
 * Opening the ledger is what a click on the row does anyway; it is listed
 * because nothing on screen told a reader with a mouse that the row led
 * anywhere at all.
 *
 * Same shape as documents/DocumentRowActions, on the same `ui/MenuButton`.
 */
export function StockBalanceRowActions({ row }: { row: StockBalanceGridRow }) {
  const { can } = useAccess()
  const navigate = useNavigate()

  const ledgerHref = `/registers/stock-ledger?item_id=${row.item_id}${
    row.warehouse_id ? `&warehouse_id=${row.warehouse_id}` : ''
  }`

  const actions: MenuAction[] = [
    ...(can(P.report('stock_ledger'))
      ? [
          {
            key: 'ledger',
            label: 'View stock ledger',
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
  ]

  if (actions.length === 0) return null

  return (
    // The row reacts to clicks, and the kebab must not take the reader with it.
    // Stopped on a wrapper rather than through `buttonProps`: MenuButton spreads
    // that bag AFTER its own onClick, so an onClick passed there replaces the
    // toggle and the menu never opens.
    <span
      className="inline-flex"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <MenuButton actions={actions} label="Row actions" icon={MoreVertical} variant="ghost" size="xs" />
    </span>
  )
}

export default StockBalanceRowActions
