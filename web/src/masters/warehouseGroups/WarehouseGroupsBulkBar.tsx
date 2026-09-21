import { Power, PowerOff, Trash2, X } from 'lucide-react'
import { Button } from '../../ui/Button'
import { AIC, cx } from '../../ui/cx'

/**
 * What the selection can do, shown only once there is one.
 *
 * It replaces nothing: the toolbar above stays where it was, so clearing the
 * selection does not make the page jump. Destructive actions go through the
 * same confirmation a single delete does — a bulk delete is the one place where
 * an accidental click costs the most, so it is the last place to skip the step.
 *
 * There is no Export button here on purpose. The header's Export already writes
 * the selection when there is one, and a second button would mean a second
 * export implementation to keep in step with the letterhead, the filters line
 * and the four formats. The bar says so instead.
 */

export interface WarehouseGroupsBulkBarProps {
  count: number
  canWrite: boolean
  canDelete: boolean
  busy: boolean
  onActivate: () => void
  onDeactivate: () => void
  onDelete: () => void
  onClear: () => void
  className?: string
}

export function WarehouseGroupsBulkBar({
  count,
  canWrite,
  canDelete,
  busy,
  onActivate,
  onDeactivate,
  onDelete,
  onClear,
  className,
}: WarehouseGroupsBulkBarProps) {
  if (count === 0) return null
  return (
    <div
      className={cx(
        AIC,
        'flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-light/50 px-3 py-2 print:hidden',
        className,
      )}
      role="region"
      aria-label="Bulk actions"
    >
      <span className="text-xs font-semibold text-gray-800" aria-live="polite">
        {count} {count === 1 ? 'group' : 'groups'} selected
      </span>
      <span className="hidden text-[11px] text-gray-500 sm:inline">Export now covers this selection.</span>
      <span className="ml-auto flex flex-wrap items-center gap-1.5">
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
        {canDelete ? (
          <Button variant="secondary" size="sm" icon={Trash2} onClick={onDelete} disabled={busy} className="text-red-600 hover:text-red-700">
            Delete
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" icon={X} onClick={onClear} disabled={busy} aria-label="Clear selection" />
      </span>
    </div>
  )
}

export default WarehouseGroupsBulkBar
