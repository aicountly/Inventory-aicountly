import { ActiveBadge } from '../../components/StatusBadge'
import { MasterPage } from '../../masters/MasterPage'
import type { MasterConfig } from '../../masters/types'
import { bomApi } from '../../services/masters'
import type { Bom } from '../../services/masters'
import { formatDateTime, formatInt, formatQty } from '../../utils/format'

const bomConfig: MasterConfig<Bom> = {
  slug: 'bill-of-materials',
  permissionSlug: 'bill_of_materials',
  title: 'Bills of materials',
  singular: 'Bill of materials',
  idKey: 'bom_id',
  nameOf: (r) => r.bom_name,
  api: bomApi,
  defaultSort: 'bom_name',
  needsFormOptions: false,
  searchPlaceholder: 'Search by name or finished item…',
  createRoute: '/masters/bill-of-materials/new',
  editRoute: (r) => `/masters/bill-of-materials/${r.bom_id}`,
  deleteHint: 'A bill used by a production document cannot be deleted.',
  columns: [
    { key: 'bom_name', header: 'Bill', sortKey: 'bom_name', render: (r) => <strong>{r.bom_name}</strong> },
    {
      key: 'finished_item_name',
      header: 'Finished item',
      sortKey: 'finished_item_name',
      render: (r) => (
        <>
          {r.finished_item_name ?? `#${r.finished_item_id}`}
          {r.finished_item_sku ? <span className="muted"> · {r.finished_item_sku}</span> : null}
        </>
      ),
    },
    { key: 'yield_qty', header: 'Yield', align: 'right', sortKey: 'yield_qty', render: (r) => `${formatQty(r.yield_qty)}${r.yield_unit_symbol ? ` ${r.yield_unit_symbol}` : ''}` },
    { key: 'line_count', header: 'Lines', align: 'right', render: (r) => formatInt(r.line_count) },
    { key: 'is_active', header: 'Status', render: (r) => <ActiveBadge active={r.is_active} /> },
    { key: 'updated_at', header: 'Updated', sortKey: 'updated_at', render: (r) => <span className="nowrap muted">{formatDateTime(r.updated_at)}</span> },
  ],
  fields: [],
}

export function BomListPage() {
  return <MasterPage config={bomConfig} breadcrumbs={[{ label: 'Masters', to: '/masters' }]} />
}
