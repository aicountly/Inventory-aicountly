import { useNavigate, useSearchParams } from 'react-router-dom'
import { ExternalLink, Layers, MoreVertical, ScrollText, Warehouse } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { P } from '../../services/access'
import { MenuButton } from '../../ui/MenuButton'
import type { MenuAction } from '../../ui/MenuButton'
import type { ValuationSnapshotRow } from '../../services/valuationApi'

/**
 * The per-row menu on the valuation register: the four places a figure can be
 * taken apart.
 *
 * Every entry is a screen the app already has, narrowed by a filter that
 * screen actually reads — the warehouse breakup is the warehouse-stock register
 * for this item at this date, not a view invented for the menu. Each is gated
 * on the permission its destination is gated on, so nothing here 403s on the
 * click.
 *
 * The as-at date travels with the link where the destination takes one, so a
 * valuation queried at a back date does not open its workings at today's.
 *
 * Same shape as StockBalanceRowActions and documents/DocumentRowActions, on the
 * same `ui/MenuButton`.
 */
export function ValuationRowActions({ row }: { row: ValuationSnapshotRow }) {
  const { can } = useAccess()
  const navigate = useNavigate()
  const asOf = useSearchParams()[0].get('as_of') ?? ''
  const dated = (key: string) => (asOf ? `&${key}=${asOf}` : '')
  const name = row.item_name ?? `Item #${row.item_id}`

  const actions: MenuAction[] = [
    ...(can(P.report('valuation'))
      ? [
          {
            key: 'layers',
            label: 'View cost layers',
            icon: Layers,
            onSelect: () => navigate(`/valuation/cost-layers?item_id=${row.item_id}`),
          },
        ]
      : []),
    ...(can(P.report('stock_ledger'))
      ? [
          {
            key: 'ledger',
            label: 'Movement history',
            icon: ScrollText,
            onSelect: () =>
              navigate(`/registers/stock-ledger?item_id=${row.item_id}${dated('to')}`),
          },
        ]
      : []),
    ...(can(P.report('warehouse_stock'))
      ? [
          {
            key: 'warehouses',
            label: 'Warehouse breakup',
            icon: Warehouse,
            onSelect: () =>
              navigate(`/registers/warehouse-stock?item_id=${row.item_id}${dated('to')}`),
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
        label={`Actions for ${name}`}
        icon={MoreVertical}
        variant="ghost"
        size="xs"
      />
    </span>
  )
}

export default ValuationRowActions
