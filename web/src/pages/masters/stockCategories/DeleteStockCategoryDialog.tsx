import { Link } from 'react-router-dom'
import { Button } from '../../../ui/Button'
import { Modal } from '../../../components/Modal'
import { Notice } from '../../../components/Notice'
import type { StockCategory } from '../../../services/masters'
import { formatInt } from '../../../utils/format'

/**
 * Deleting one category, or a selection of them.
 *
 * The screen does not decide whether a delete is allowed — the API does, and
 * refuses with `409 delete_blocked` while any item still points at the row.
 * What this dialog does is say so *before* the request, using the same
 * `item_count` the list already shows, so a reader is not sent to find out the
 * hard way. When a count is in use the confirm button is not offered at all;
 * the way out (reassign those items first) is offered instead.
 *
 * Counts can be a few seconds old. If one is, the server still refuses and its
 * reason is printed here verbatim — the guard is the API's, this is only the
 * warning in front of it.
 */

export interface DeleteStockCategoryDialogProps {
  open: boolean
  /** One row, or the selection. */
  rows: readonly StockCategory[]
  busy: boolean
  error: string | null
  itemsLinkFor?: (stockCatId: number) => string | undefined
  onConfirm: (deletable: readonly StockCategory[]) => void
  onCancel: () => void
}

function usageOf(row: StockCategory): number {
  return typeof row.item_count === 'number' ? row.item_count : 0
}

export function DeleteStockCategoryDialog({
  open,
  rows,
  busy,
  error,
  itemsLinkFor,
  onConfirm,
  onCancel,
}: DeleteStockCategoryDialogProps) {
  const blocked = rows.filter((r) => usageOf(r) > 0)
  const deletable = rows.filter((r) => usageOf(r) === 0)
  const single = rows.length === 1
  const only = rows[0]

  const title = single ? 'Delete stock category?' : `Delete ${formatInt(rows.length)} stock categories?`

  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      busy={busy}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {deletable.length === 0 ? 'Close' : 'Cancel'}
          </Button>
          {deletable.length > 0 ? (
            <Button variant="danger" loading={busy} onClick={() => onConfirm(deletable)}>
              {single ? 'Delete' : `Delete ${formatInt(deletable.length)}`}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-3 text-sm leading-relaxed text-gray-700">
        {single && only ? (
          <p>
            <strong className="font-semibold text-gray-900">{only.cat_name}</strong> will be removed from every list
            and dropdown. This action cannot be undone.
          </p>
        ) : (
          <p>
            {formatInt(rows.length)} categories will be removed from every list and dropdown. This action cannot be
            undone.
          </p>
        )}

        {blocked.length > 0 ? (
          <Notice kind="warning">
            {single && only ? (
              <>
                This category is currently assigned to {formatInt(usageOf(only))}{' '}
                {usageOf(only) === 1 ? 'item' : 'items'} and cannot be deleted until those items are reassigned.{' '}
                {itemsLinkFor?.(Number(only.stock_cat_id)) ? (
                  <Link to={itemsLinkFor(Number(only.stock_cat_id)) as string} className="font-semibold text-primary">
                    View the items
                  </Link>
                ) : null}
              </>
            ) : (
              <>
                <p className="m-0">
                  {formatInt(blocked.length)} of the selected categories are in use and will be left alone:
                </p>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                  {blocked.slice(0, 6).map((r) => (
                    <li key={r.stock_cat_id}>
                      {r.cat_name} — {formatInt(usageOf(r))} {usageOf(r) === 1 ? 'item' : 'items'}
                    </li>
                  ))}
                  {blocked.length > 6 ? <li>and {formatInt(blocked.length - 6)} more</li> : null}
                </ul>
                <p className="mt-1.5 mb-0">Reassign those items first, or deactivate the categories instead.</p>
              </>
            )}
          </Notice>
        ) : null}

        {!single && deletable.length > 0 ? (
          <p className="text-xs text-gray-500">
            {formatInt(deletable.length)} {deletable.length === 1 ? 'category has' : 'categories have'} no items and
            will be deleted.
          </p>
        ) : null}

        {error ? <Notice kind="error">{error}</Notice> : null}
      </div>
    </Modal>
  )
}

export default DeleteStockCategoryDialog
