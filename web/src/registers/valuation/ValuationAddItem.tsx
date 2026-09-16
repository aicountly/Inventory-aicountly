import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { P } from '../../services/access'
import { Button } from '../../ui/Button'

/**
 * "Add item", in the valuation table's header.
 *
 * It opens the item master, not a valuation: there is nothing on this register
 * to write. An item is where a valuation method and an opening stock are set,
 * so it is the only creation this screen can honestly offer — and it is gated
 * on the permission that governs it, so a member who may read a valuation but
 * not maintain items is not shown a door that answers 403.
 *
 * A plain link: ItemFormPage returns to the item list on save and reads no
 * return target, so this does not promise to come back with the reader's date
 * and filters intact.
 */
export function ValuationAddItem() {
  const { can } = useAccess()
  if (!can(P.masters('items', 'write'))) return null
  return (
    <Link to="/items/new">
      <Button size="xs" variant="secondary" icon={Plus}>
        Add item
      </Button>
    </Link>
  )
}

export default ValuationAddItem
