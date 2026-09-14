import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  Boxes,
  ClipboardList,
  FileText,
  History,
  Layers,
  Scale,
  Send,
  ShoppingCart,
  Warehouse,
} from 'lucide-react'
import { Card, CardHeader } from '../../ui/Card'
import { useAccess } from '../../access/AccessContext'
import { P } from '../../services/access'
import { drill } from '../kpiNavigation'

/**
 * The nine places a stock manager goes next.
 *
 * Every tile is permission-filtered with the same `can()` the sidebar uses, and
 * filtered *after* permissions are known — a tile that appears and then vanishes
 * is worse than one that arrives a beat late.
 */
interface QuickAction {
  key: string
  label: string
  hint: string
  to: string
  icon: LucideIcon
  permissions: readonly string[]
}

export interface QuickActionsProps {
  asOf: string
  period: { from: string; to: string }
}

function actionsFor(asOf: string, period: { from: string; to: string }): QuickAction[] {
  return [
    {
      key: 'documents',
      label: 'Documents',
      hint: 'Receipts, issues, transfers',
      to: drill.documents(),
      icon: FileText,
      permissions: [P.documentsRead],
    },
    {
      key: 'items',
      label: 'Items',
      hint: 'The item master',
      to: drill.items(),
      icon: Boxes,
      permissions: [P.masters('items', 'read')],
    },
    {
      key: 'balances',
      label: 'Stock balances',
      hint: 'On hand by warehouse',
      to: drill.stockBalances(),
      icon: Warehouse,
      permissions: [P.report('stock_summary'), P.report('warehouse_stock'), P.documentsRead],
    },
    {
      key: 'ledger',
      label: 'Stock ledger',
      hint: 'One item, every movement',
      to: '/registers/stock-ledger',
      icon: History,
      permissions: [P.report('stock_ledger')],
    },
    {
      key: 'reorder',
      label: 'Replenishment',
      hint: 'What to buy next',
      to: drill.replenishment({ onlyTriggered: true }),
      icon: ShoppingCart,
      permissions: [P.report('replenishment')],
    },
    {
      key: 'ageing',
      label: 'Stock ageing',
      hint: 'Money sitting still',
      to: drill.stockAgeing({ asOf }),
      icon: Layers,
      permissions: [P.report('stock_ageing')],
    },
    {
      key: 'movement',
      label: 'Movement analysis',
      hint: 'Fast, slow and dead',
      to: drill.movementAnalysis(period),
      icon: ClipboardList,
      permissions: [P.report('movement_analysis')],
    },
    {
      key: 'reconciliation',
      label: 'Reconciliation',
      hint: 'Agree with Books',
      to: drill.reconciliationRuns(),
      icon: Scale,
      permissions: [P.reconciliationRead],
    },
    {
      key: 'outbox',
      label: 'Books outbox',
      hint: 'Delivery health',
      to: drill.outbox(),
      icon: Send,
      permissions: [P.integrationRead],
    },
  ]
}

export function QuickActions({ asOf, period }: QuickActionsProps) {
  const { can, loading } = useAccess()
  if (loading) return null

  const actions = actionsFor(asOf, period).filter((a) => a.permissions.some((p) => can(p)))
  if (actions.length === 0) return null

  return (
    <Card padding="md" className="print:hidden">
      <CardHeader title="Jump to" description="The screens behind these numbers" />
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
        {actions.map((a) => (
          <Link
            key={a.key}
            to={a.to}
            className="group flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-gray-100 hover:border-primary/40 hover:bg-primary-light/40 transition-colors min-w-0"
          >
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gray-50 text-gray-500 group-hover:bg-white group-hover:text-primary transition-colors shrink-0">
              <a.icon className="w-4 h-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-gray-800 truncate">{a.label}</span>
              <span className="block text-label-xs text-gray-400 truncate">{a.hint}</span>
            </span>
          </Link>
        ))}
      </div>
    </Card>
  )
}

export default QuickActions
