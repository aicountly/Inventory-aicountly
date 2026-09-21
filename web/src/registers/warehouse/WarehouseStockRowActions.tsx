import { useNavigate } from 'react-router-dom'
import { ExternalLink, Layers, MoreVertical, ScrollText, Warehouse } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { P } from '../../services/access'
import { MenuButton } from '../../ui/MenuButton'
import type { MenuAction } from '../../ui/MenuButton'
import type { WarehouseStockRow } from '../../services/reportsApi'
import { ledgerLink } from './cells'

/**
 * The per-row menu on the warehouse-stock register.
 *
 * Every entry is a screen the app already has and this reader is already allowed to
 * open, so nothing here is a new capability and nothing 403s on the click. The ledger is
 * also where the row itself goes; it is listed because nothing on screen tells a reader
 * with a mouse that a row leads anywhere at all.
 *
 * Same shape as StockBalanceRowActions and DocumentRowActions, on the same MenuButton.
 */
export function WarehouseStockRowActions({ row }: { row: WarehouseStockRow }) {
  const { can } = useAccess()
  const navigate = useNavigate()

  const actions: MenuAction[] = [
    ...(can(P.report('stock_ledger'))
      ? [
          {
            key: 'ledger',
            label: 'View stock ledger',
            icon: ScrollText,
            onSelect: () => navigate(ledgerLink(row.item_id, row.warehouse_id)),
          },
        ]
      : []),
    ...(can(P.report('warehouse_stock'))
      ? [
          {
            key: 'balances',
            label: 'Balances by batch',
            icon: Layers,
            onSelect: () =>
              navigate(
                `/registers/stock-balances?item_id=${row.item_id}${
                  row.warehouse_id ? `&warehouse_id=${row.warehouse_id}` : ''
                }`,
              ),
          },
        ]
      : []),
    ...(row.warehouse_id
      ? [
          {
            key: 'warehouse',
            label: `Only ${row.warehouse_name ?? 'this warehouse'}`,
            icon: Warehouse,
            onSelect: () => {
              // Narrows the register in place: the date, the valuation method and every
              // other filter stay exactly as the reader set them.
              const next = new URLSearchParams(window.location.search)
              next.set('warehouse_id', String(row.warehouse_id))
              next.delete('page')
              navigate({ search: `?${next.toString()}` })
            },
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
    // The row reacts to clicks, and the kebab must not take the reader with it. Stopped
    // on a wrapper rather than through `buttonProps`: MenuButton spreads that bag AFTER
    // its own onClick, so a handler passed there replaces the toggle and nothing opens.
    <span
      className="inline-flex"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <MenuButton actions={actions} label="Row actions" icon={MoreVertical} variant="ghost" size="xs" />
    </span>
  )
}

export default WarehouseStockRowActions
