import { Outlet } from 'react-router-dom'
import { SubNav } from '../../components/SubNav'
import { P } from '../../services/access'

const ITEMS = [
  { to: '/stock', label: 'Balances', end: true, permission: P.report('warehouse_stock') },
  { to: '/stock/ledger', label: 'Stock ledger', permission: P.report('stock_ledger') },
  { to: '/stock/movements', label: 'Movements', permission: P.report('stock_ledger') },
] as const

export function StockLayout() {
  return (
    <div className="page">
      <SubNav items={ITEMS} label="Stock views" />
      <Outlet />
    </div>
  )
}
