import { CircleCheck, CircleMinus, Download, Trash2, X } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { AIC, cx } from '../../../ui/cx'
import { formatInt } from '../../../utils/format'

/**
 * What replaces the toolbar's right-hand side once rows are ticked.
 *
 * It states the count first and offers "Clear" last, because the two things a
 * reader needs from a selection bar are "how many did I catch" and "let me out
 * of this". Destructive actions are separated from the reversible ones and
 * never fire directly — delete opens a confirmation that names what will go.
 *
 * The bar only ever acts on the rows that are ticked ON THIS PAGE. There is no
 * "select all 431 matching" here: a bulk deactivate across a filter nobody can
 * see the whole of is exactly the action people undo for the rest of the day.
 */

export interface BrandsBulkBarProps {
  count: number
  canWrite: boolean
  canDelete: boolean
  busy: boolean
  onActivate: () => void
  onDeactivate: () => void
  onExport: () => void
  onDelete: () => void
  onClear: () => void
}

export function BrandsBulkBar({
  count,
  canWrite,
  canDelete,
  busy,
  onActivate,
  onDeactivate,
  onExport,
  onDelete,
  onClear,
}: BrandsBulkBarProps) {
  if (count === 0) return null

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className={cx(
        AIC,
        'flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-light/60 px-3 py-2',
      )}
    >
      <span className="text-sm font-semibold text-gray-900" aria-live="polite">
        {formatInt(count)} selected
      </span>
      <span className="h-4 w-px bg-primary/20" aria-hidden />

      {canWrite ? (
        <>
          <Button variant="secondary" size="xs" icon={CircleCheck} onClick={onActivate} disabled={busy}>
            Activate
          </Button>
          <Button variant="secondary" size="xs" icon={CircleMinus} onClick={onDeactivate} disabled={busy}>
            Deactivate
          </Button>
        </>
      ) : null}

      <Button variant="secondary" size="xs" icon={Download} onClick={onExport} disabled={busy}>
        Export selected
      </Button>

      {canDelete ? (
        <Button
          variant="secondary"
          size="xs"
          icon={Trash2}
          onClick={onDelete}
          disabled={busy}
          className="text-red-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
        >
          Delete
        </Button>
      ) : null}

      <Button variant="ghost" size="xs" icon={X} onClick={onClear} disabled={busy} className="ml-auto">
        Clear selection
      </Button>
    </div>
  )
}

export default BrandsBulkBar
