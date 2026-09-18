import { Download, Power, PowerOff, Trash2, X } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { cx } from '../../../ui/cx'
import { formatInt } from '../../../utils/format'

/**
 * The bar that replaces the toolbar's right-hand side once rows are ticked.
 *
 * It is additive, not modal: the search and the filters above it keep working,
 * because a reader who selects four categories and then narrows the search has
 * not changed their mind about the four. The count is therefore the whole
 * selection, which may include rows that are no longer on screen, and the bar
 * says so rather than quietly acting on fewer.
 */

export interface StockCategoryBulkBarProps {
  count: number
  /** Selected rows that are not on the current page. */
  offPage: number
  canWrite: boolean
  canDelete: boolean
  busy: boolean
  onActivate: () => void
  onDeactivate: () => void
  onExport: () => void
  onDelete: () => void
  onClear: () => void
  className?: string
}

export function StockCategoryBulkBar({
  count,
  offPage,
  canWrite,
  canDelete,
  busy,
  onActivate,
  onDeactivate,
  onExport,
  onDelete,
  onClear,
  className,
}: StockCategoryBulkBarProps) {
  if (count === 0) return null
  return (
    <div
      className={cx(
        'flex flex-wrap items-center gap-2 border-b border-primary/20 bg-primary-light/50 px-3 py-2 print:hidden',
        className,
      )}
      role="region"
      aria-label="Bulk actions"
    >
      <span className="text-xs font-semibold text-gray-900">
        {formatInt(count)} selected
        {offPage > 0 ? (
          <span className="ml-1 font-normal text-gray-500">({formatInt(offPage)} on other pages)</span>
        ) : null}
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {canWrite ? (
          <>
            <Button variant="secondary" size="sm" icon={Power} onClick={onActivate} disabled={busy}>
              Activate
            </Button>
            <Button variant="secondary" size="sm" icon={PowerOff} onClick={onDeactivate} disabled={busy}>
              Deactivate
            </Button>
          </>
        ) : null}
        <Button variant="secondary" size="sm" icon={Download} onClick={onExport} disabled={busy}>
          Export selected
        </Button>
        {canDelete ? (
          <Button variant="danger" size="sm" icon={Trash2} onClick={onDelete} disabled={busy}>
            Delete
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" icon={X} onClick={onClear} aria-label="Clear selection" disabled={busy} />
      </div>
    </div>
  )
}

export default StockCategoryBulkBar
