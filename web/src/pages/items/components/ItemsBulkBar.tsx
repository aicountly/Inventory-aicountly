import { Link } from 'react-router-dom'
import { CheckCircle2, CircleSlash, Download, PencilLine, Trash2, X } from 'lucide-react'
import { Button } from '../../../ui/Button'

export interface ItemsBulkBarProps {
  count: number
  onClear: () => void
  onActivate: () => void
  onDeactivate: () => void
  onExport: () => void
  onDelete: () => void
  busy: boolean
  canWrite: boolean
  canDelete: boolean
  canExport: boolean
}

/**
 * The toolbar that appears when rows are ticked.
 *
 * It floats over the list rather than pushing it down, so the rows the reader
 * just chose stay exactly where they were — a bar that reflows the page makes
 * the next tick land on a different item.
 *
 * Activate / deactivate are here because their worst case is a label being
 * wrong for a minute. Everything that changes what stock IS — quantities,
 * units, the valuation method — is deliberately absent: those go through the
 * item form or a stock adjustment, one at a time, where the consequence is
 * spelled out. "Change category / group / brand" opens Bulk edit, which already
 * shows the old and new value per item before anything is written.
 */
export function ItemsBulkBar({
  count,
  onClear,
  onActivate,
  onDeactivate,
  onExport,
  onDelete,
  busy,
  canWrite,
  canDelete,
  canExport,
}: ItemsBulkBarProps) {
  if (count === 0) return null

  return (
    <div className="pointer-events-none sticky bottom-3 z-30 flex justify-center print:hidden">
      <div
        role="region"
        aria-label={`${count} items selected`}
        className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-overlay"
      >
        <span className="inline-flex items-center gap-2 pr-1 text-xs font-semibold text-gray-900">
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-white">
            {count}
          </span>
          selected
        </span>
        <span className="h-5 w-px bg-gray-200" aria-hidden />

        {canWrite ? (
          <>
            <Button variant="ghost" size="xs" icon={CheckCircle2} onClick={onActivate} disabled={busy}>
              Activate
            </Button>
            <Button variant="ghost" size="xs" icon={CircleSlash} onClick={onDeactivate} disabled={busy}>
              Deactivate
            </Button>
            <Link
              to="/items/bulk-edit"
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <PencilLine className="h-3.5 w-3.5" aria-hidden />
              Bulk edit
            </Link>
          </>
        ) : null}

        {canExport ? (
          <Button variant="ghost" size="xs" icon={Download} onClick={onExport} disabled={busy}>
            Export
          </Button>
        ) : null}

        {canDelete ? (
          <Button variant="ghost" size="xs" icon={Trash2} onClick={onDelete} disabled={busy} className="text-red-600 hover:bg-red-50 hover:text-red-700">
            Delete
          </Button>
        ) : null}

        <span className="h-5 w-px bg-gray-200" aria-hidden />
        <Button variant="ghost" size="xs" icon={X} onClick={onClear} disabled={busy} aria-label="Clear selection">
          Clear
        </Button>
      </div>
    </div>
  )
}
