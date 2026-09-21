import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { Button } from '../../ui/Button'
import type { WarehouseGroup } from '../../services/masters'
import { childCount, warehouseCount } from './model'

/**
 * Delete, with the consequence stated before the button is pressed.
 *
 * The API refuses a group that still has warehouses or sub-groups (see the
 * delete guards on WarehouseGroupsController), and the row already carries both
 * counts — so the screen says exactly why, and does not offer a Delete button
 * that is going to come back 409. A warehouse is never orphaned and a
 * relationship is never quietly broken: reassigning comes first, always.
 *
 * The delete itself stays a SOFT delete on the server (deleted_at + is_active
 * 0). Nothing here changes that, and the wording says "removed from every list
 * and dropdown" rather than "permanently", because that is what happens.
 */

export interface WarehouseGroupDeleteDialogProps {
  open: boolean
  rows: readonly WarehouseGroup[]
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

export function WarehouseGroupDeleteDialog({
  open,
  rows,
  busy,
  error,
  onCancel,
  onConfirm,
}: WarehouseGroupDeleteDialogProps) {
  const blocked = rows.filter((r) => warehouseCount(r) > 0 || childCount(r) > 0)
  const deletable = rows.filter((r) => warehouseCount(r) === 0 && childCount(r) === 0)
  const many = rows.length > 1
  const only = rows.length === 1 ? rows[0] : null

  return (
    <Modal
      open={open}
      title={many ? `Delete ${rows.length} warehouse groups?` : 'Delete warehouse group?'}
      onClose={onCancel}
      busy={busy}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            loading={busy}
            disabled={deletable.length === 0}
            title={deletable.length === 0 ? 'Nothing here can be deleted yet' : undefined}
          >
            {many && deletable.length !== rows.length
              ? `Delete ${deletable.length} ${deletable.length === 1 ? 'group' : 'groups'}`
              : many
                ? 'Delete groups'
                : 'Delete group'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm leading-relaxed text-gray-700">
        {only ? (
          <p className="m-0">
            You are about to delete <strong>“{only.grp_name}”</strong>.
          </p>
        ) : (
          <p className="m-0">
            You are about to delete <strong>{rows.length} warehouse groups</strong>.
          </p>
        )}

        {blocked.length > 0 ? (
          <Notice kind="warning" title={blocked.length === rows.length ? 'This cannot be deleted yet.' : 'Some of these cannot be deleted yet.'}>
            <ul className="m-0 mt-1 list-disc space-y-0.5 pl-4 text-xs">
              {blocked.slice(0, 5).map((r) => {
                const w = warehouseCount(r)
                const c = childCount(r)
                const parts = [
                  w > 0 ? `${w} ${w === 1 ? 'warehouse' : 'warehouses'}` : null,
                  c > 0 ? `${c} ${c === 1 ? 'sub-group' : 'sub-groups'}` : null,
                ].filter(Boolean)
                return (
                  <li key={r.warehouse_group_id}>
                    <strong>{r.grp_name}</strong> contains {parts.join(' and ')}. Reassign or remove {parts.length > 1 ? 'them' : 'those'} first.
                  </li>
                )
              })}
              {blocked.length > 5 ? <li>…and {blocked.length - 5} more.</li> : null}
            </ul>
          </Notice>
        ) : null}

        {deletable.length > 0 ? (
          <p className="m-0 text-xs text-gray-500">
            {deletable.length === 1 ? 'It' : `${deletable.length} of them`} will be removed from every list and
            dropdown. Records that already reference {deletable.length === 1 ? 'it' : 'them'} keep working, and the
            audit log keeps the history.
          </p>
        ) : null}

        {error ? <Notice kind="error">{error}</Notice> : null}
      </div>
    </Modal>
  )
}

export default WarehouseGroupDeleteDialog
