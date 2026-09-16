import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { P } from '../../services/access'
import { Button } from '../../ui/Button'
import { METHOD_LABELS } from '../../services/valuationApi'
import type { ReportMethod, ValuationSnapshotSummary } from '../../services/valuationApi'
import { formatInt } from '../../utils/format'

/**
 * The heading above the table, and the one thing a reader might want to create
 * from here.
 *
 * "Add item" opens the item master, not a valuation: there is nothing on this
 * register to write. An item is where a valuation method and an opening stock
 * are set, so it is the only creation this screen can honestly offer, and it is
 * gated on the permission that governs it — a member who may read a valuation
 * but not maintain items is not shown a door that answers 403.
 *
 * It is a plain link to the item form, which returns to the item list on save
 * (ItemFormPage navigates to LIST and reads no return target) — so this opens
 * in a new tab-worthy way rather than pretending the register will come back
 * with the reader's date and filters intact.
 */
export function ValuationTableToolbar({ summary }: { summary: ValuationSnapshotSummary }) {
  const { can } = useAccess()
  const method = METHOD_LABELS[summary.method as ReportMethod] ?? summary.method

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-0.5 pt-1">
      <h2 className="text-sm font-semibold text-gray-900">Item-wise valuation</h2>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-gray-500">
          {formatInt(summary.item_count)} {summary.item_count === 1 ? 'item' : 'items'} · valued at{' '}
          {method} as at {summary.as_of}
        </p>
        {can(P.masters('items', 'write')) ? (
          <Link to="/items/new">
            <Button size="xs" variant="secondary" icon={Plus}>
              Add item
            </Button>
          </Link>
        ) : null}
      </div>
    </div>
  )
}

export default ValuationTableToolbar
