import { Download, PencilLine, Printer, X } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { MenuButton } from '../../../ui/MenuButton'
import type { MenuAction } from '../../../ui/MenuButton'
import { AIC, cx } from '../../../ui/cx'
import { BATCH_STATUSES } from '../../../services/masters'
import type { BatchStatus } from '../../../services/masters'
import { formatInt, humanize } from '../../../utils/format'

/**
 * What a selection can do, shown only once there is one.
 *
 * The bar sits between the filters and the table rather than floating over the
 * rows: an ERP table is read by scanning down a column, and a bar that covers
 * the last two rows is a bar that hides the thing being counted.
 *
 * A selection is about the rows in front of the reader, so it holds only for
 * the current page and the page says so. Every operation offered here is one
 * the API actually supports for the current profile — a status change goes to
 * `POST /v1/batches/bulk-update` in a single transaction, and it is absent
 * entirely without write permission rather than present and refused.
 */

export interface BatchBulkBarProps {
  count: number
  onChangeStatus: (status: BatchStatus) => void
  onPrintLabels: () => void
  onExport: () => void
  onClear: () => void
  canWrite: boolean
  canPrint: boolean
  busy?: boolean
}

export function BatchBulkBar({
  count,
  onChangeStatus,
  onPrintLabels,
  onExport,
  onClear,
  canWrite,
  canPrint,
  busy = false,
}: BatchBulkBarProps) {
  if (count === 0) return null

  const statusActions: MenuAction[] = BATCH_STATUSES.map((s) => ({
    key: s,
    label: `Mark as ${humanize(s).toLowerCase()}`,
    danger: s === 'recalled',
    onSelect: () => onChangeStatus(s),
  }))

  return (
    <div
      className={cx(
        AIC,
        'flex flex-wrap items-center gap-2 border-b border-primary/25 bg-primary-light px-3 py-2 text-xs text-gray-700 print:hidden',
      )}
      role="status"
    >
      <strong className="font-semibold text-primary">{formatInt(count)} selected</strong>
      <span className="text-gray-500">on this page</span>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {canWrite ? (
          <MenuButton
            label="Change the status of the selected batches"
            icon={PencilLine}
            variant="secondary"
            size="xs"
            actions={statusActions}
            width={196}
            buttonProps={{ disabled: busy }}
          >
            Change status
          </MenuButton>
        ) : null}
        {canPrint ? (
          <Button variant="secondary" size="xs" icon={Printer} onClick={onPrintLabels} disabled={busy}>
            Print labels
          </Button>
        ) : null}
        <Button variant="secondary" size="xs" icon={Download} onClick={onExport} disabled={busy}>
          Export selection
        </Button>
        <Button variant="ghost" size="xs" icon={X} onClick={onClear} disabled={busy}>
          Clear selection
        </Button>
      </div>
    </div>
  )
}

export default BatchBulkBar
