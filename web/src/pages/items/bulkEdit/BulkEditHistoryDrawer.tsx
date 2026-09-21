import { Drawer } from '../../../ui/Drawer'
import { Badge } from '../../../ui/Badge'
import { formatInt } from '../../../utils/format'
import { actorIdentity } from '../../audit/auditPresentation'
import type { ItemFormOptions } from '../../../services/items'
import type { BulkEditBatch } from './bulkEditHistory'
import { describeBatch, fieldLabel, formatWhen } from './bulkEditHistory'
import { BULK_EDIT_FIELDS, formatFieldValue } from './bulkEditFields'

/**
 * One past bulk edit, opened from the rail.
 *
 * Everything shown is read from the audit rows themselves — who, when, which
 * field, and per item the value before and after. The before / after snapshots
 * are the trail's own, so this is the record an auditor would be shown, not a
 * reconstruction from the items as they stand today.
 */

export interface BulkEditHistoryDrawerProps {
  batch: BulkEditBatch | null
  options: ItemFormOptions | null
  onClose: () => void
}

function valueOf(snapshot: Record<string, unknown> | null, field: string | null, options: ItemFormOptions | null): string {
  if (!field || !snapshot || typeof snapshot !== 'object' || !(field in snapshot)) return '—'
  const raw = snapshot[field]
  if (raw === null || raw === undefined || raw === '') return '—'
  const spec = BULK_EDIT_FIELDS.find((f) => f.key === field)
  return spec ? formatFieldValue(spec, String(raw), options) : String(raw)
}

export function BulkEditHistoryDrawer({ batch, options, onClose }: BulkEditHistoryDrawerProps) {
  if (!batch) return null
  const actor = actorIdentity({ actor_uuid: batch.actorUuid })

  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title={describeBatch(batch, options)}
      badge={
        <Badge tone="info" size="xs">
          {formatInt(batch.itemCount)} item{batch.itemCount === 1 ? '' : 's'}
        </Badge>
      }
      description={`${formatWhen(batch.at)} · by ${actor.label}`}
    >
      <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Field</dt>
          <dd className="mt-0.5 font-medium text-gray-900">{fieldLabel(batch.field)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Items</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-gray-900">{formatInt(batch.itemCount)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">When</dt>
          <dd className="mt-0.5 font-medium text-gray-900">{formatWhen(batch.at)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">By</dt>
          <dd className="mt-0.5 truncate font-medium text-gray-900" title={actor.title}>
            {actor.label}
          </dd>
        </div>
      </dl>

      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[26rem] border-collapse text-left">
          <caption className="sr-only">Every item this bulk edit changed, with its value before and after</caption>
          <thead>
            <tr className="bg-gray-50">
              <th scope="col" className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Item
              </th>
              <th scope="col" className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Before
              </th>
              <th scope="col" className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                After
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {batch.rows.map((row) => (
              <tr key={row.audit_id}>
                <td className="px-3 py-2 text-xs text-gray-700">
                  {typeof row.before?.item_name === 'string' ? row.before.item_name : `Item #${row.entity_id}`}
                </td>
                <td className="px-3 py-2 text-xs tabular-nums text-gray-500">
                  {valueOf(row.before, batch.field, options)}
                </td>
                <td className="px-3 py-2 text-xs font-medium tabular-nums text-gray-900">
                  {valueOf(row.after, batch.field, options)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Drawer>
  )
}
