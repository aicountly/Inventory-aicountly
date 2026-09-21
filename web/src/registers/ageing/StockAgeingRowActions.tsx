import { useNavigate, useSearchParams } from 'react-router-dom'
import { ExternalLink, Layers, MoreVertical, ScrollText, TrendingDown, Warehouse } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { P } from '../../services/access'
import { MenuButton } from '../../ui/MenuButton'
import type { MenuAction } from '../../ui/MenuButton'
import type { StockAgeingRow } from '../../services/reportsApi'

/**
 * The per-row menu on the Stock Ageing register: the five places an ageing figure can
 * be taken apart.
 *
 * Every entry is a screen the app already has, narrowed by filters that screen
 * actually reads, and gated on the permission its destination is gated on — so
 * nothing here is a new capability and nothing 403s after the click. A reader allowed
 * into none of them sees no menu rather than a list of dead ends.
 *
 * The as-at date travels with the link wherever the destination takes one: ageing read
 * at a back date must not open its workings at today's. Company, financial year and
 * branch are the shell's and ride along untouched, because every target is an in-app
 * route rather than a rebuilt URL.
 *
 * Same shape as valuation/ValuationRowActions and StockBalanceRowActions, on the same
 * `ui/MenuButton`.
 */
export function StockAgeingRowActions({ row }: { row: StockAgeingRow }) {
  const { can } = useAccess()
  const navigate = useNavigate()
  const asOf = useSearchParams()[0].get('as_of') ?? ''
  const name = row.item_name ?? `Item #${row.item_id}`

  /** item (and warehouse, when the rows are split by one) plus an optional date key. */
  const target = (path: string, dateKey?: string) => {
    const qs = new URLSearchParams({ item_id: String(row.item_id) })
    if (row.warehouse_id) qs.set('warehouse_id', String(row.warehouse_id))
    if (dateKey && asOf) qs.set(dateKey, asOf)
    return `${path}?${qs.toString()}`
  }

  const actions: MenuAction[] = [
    ...(can(P.report('stock_ledger'))
      ? [
          {
            key: 'ledger',
            label: 'View stock ledger',
            icon: ScrollText,
            onSelect: () => navigate(target('/registers/stock-ledger', 'to')),
          },
        ]
      : []),
    ...(can(P.report('movement_analysis'))
      ? [
          {
            key: 'movement',
            label: 'Movement analysis',
            icon: TrendingDown,
            onSelect: () => navigate(target('/registers/movement-analysis', 'to')),
          },
        ]
      : []),
    ...(can(P.report('warehouse_stock'))
      ? [
          {
            key: 'warehouses',
            label: 'Warehouse breakup',
            icon: Warehouse,
            onSelect: () => navigate(target('/registers/warehouse-stock', 'to')),
          },
        ]
      : []),
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
    // The row drills through on activation, and the kebab must not take the reader
    // with it. Stopped on a wrapper rather than through `buttonProps`: MenuButton
    // spreads that bag AFTER its own onClick, so an onClick passed there would
    // replace the toggle and the menu would never open.
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

export default StockAgeingRowActions
