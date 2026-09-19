import { useNavigate } from 'react-router-dom'
import { Coins, ExternalLink, MoreVertical, ScrollText, Warehouse } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { P } from '../../services/access'
import { MenuButton } from '../../ui/MenuButton'
import type { MenuAction } from '../../ui/MenuButton'
import type { StockAgeingRow } from '../../services/reportsApi'

/**
 * The per-row menu on the stock ageing register.
 *
 * Every entry is a screen the app already has and this member is already allowed to open,
 * so nothing here is a new capability and nothing 403s on the click. The ageing register
 * is where a reader decides an item needs looking at; these are the four places they would
 * then go, with the item, the warehouse and the as-at date carried across rather than
 * retyped.
 *
 * Nothing writes. Acting on old stock — a write-down, a discount, a disposal — is a
 * decision with an accounting consequence, and it belongs on the screen that owns it.
 */
export function StockAgeingRowActions({ row, asOf }: { row: StockAgeingRow; asOf?: string }) {
  const { can } = useAccess()
  const navigate = useNavigate()

  const scope = row.warehouse_id ? `&warehouse_id=${row.warehouse_id}` : ''
  const actions: MenuAction[] = [
    ...(can(P.report('stock_ledger'))
      ? [
          {
            key: 'ledger',
            label: 'View stock ledger',
            icon: ScrollText,
            onSelect: () => navigate(`/registers/stock-ledger?item_id=${row.item_id}${scope}`),
          },
        ]
      : []),
    ...(can(P.report('stock_ledger'))
      ? [
          {
            key: 'movements',
            label: 'View movement history',
            icon: Warehouse,
            onSelect: () => navigate(`/registers/movement-register?item_id=${row.item_id}${scope}`),
          },
        ]
      : []),
    ...(can(P.report('valuation'))
      ? [
          {
            key: 'valuation',
            label: 'View item valuation',
            icon: Coins,
            onSelect: () =>
              navigate(
                `/registers/valuation?item_id=${row.item_id}${scope}${asOf ? `&as_of=${asOf}` : ''}`,
              ),
          },
        ]
      : []),
    ...(can(P.masters('items', 'read'))
      ? [
          {
            key: 'item',
            label: 'Open item',
            icon: ExternalLink,
            separated: true,
            onSelect: () => navigate(`/items/${row.item_id}`),
          },
        ]
      : []),
  ]

  if (actions.length === 0) return null

  return (
    // The row drills through on click, and the kebab must not take the reader with it.
    // Stopped on a wrapper rather than through `buttonProps`: MenuButton spreads that bag
    // AFTER its own onClick, so an onClick passed there replaces the toggle.
    <span
      className="inline-flex"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <MenuButton actions={actions} label="Row actions" icon={MoreVertical} variant="ghost" size="xs" />
    </span>
  )
}

export default StockAgeingRowActions
