import { useNavigate } from 'react-router-dom'
import { PackageOpen } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { P } from '../../services/access'
import { EmptyState } from '../../ui/EmptyState'

/**
 * What the register shows when nothing is filtered and there is still nothing to show.
 *
 * Distinct from the filtered empty state on purpose: "widen a filter and try again"
 * sends a company that has simply never recorded stock hunting for a filter that is not
 * there. The way out of THAT is an item and an opening balance, so that is what is
 * offered — and only to a reader who may create one. An action that 403s on the click is
 * worse than no action.
 */
export function WarehouseStockEmptyState() {
  const { can } = useAccess()
  const navigate = useNavigate()
  const mayAdd = can(P.masters('items', 'write'))

  return (
    <EmptyState
      icon={PackageOpen}
      title="No stock recorded yet"
      description={
        mayAdd
          ? 'Once items carry an opening balance or a document moves them, their position appears here for every warehouse.'
          : 'Nothing has been received into a warehouse in this financial year yet.'
      }
      action={mayAdd ? 'Add an item' : undefined}
      onAction={mayAdd ? () => navigate('/items/new') : undefined}
    />
  )
}

export default WarehouseStockEmptyState
