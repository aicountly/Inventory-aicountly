import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PackageSearch } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Drawer } from '../../../ui/Drawer'
import { EmptyState } from '../../../ui/EmptyState'
import { ErrorState } from '../../../ui/ErrorState'
import { LoadingState } from '../../../ui/LoadingState'
import { ServerTablePagination } from '../../../ui/shell/TablePagination'
import { AIC, cx } from '../../../ui/cx'
import { useQuery } from '../../../hooks/useQuery'
import { uomExtras } from '../../../services/uomApi'
import type { UomUsageRole } from '../../../services/uomApi'
import type { Uom } from '../../../services/masters'
import { formatInt } from '../../../utils/format'

/**
 * The items behind a usage count.
 *
 * Read from `GET /v1/uom/{id}/usage`, which joins the item tables live. No item
 * data is copied onto the unit master to make this quicker — the count in the
 * list and the names in this panel are the same query, so they cannot disagree,
 * and neither can go stale.
 *
 * The endpoint authorises on the ITEM read permission because item rows are
 * what it returns. The list only offers the link when the profile holds it.
 */

const ROLE_LABEL: Record<UomUsageRole, string> = {
  base: 'Base unit',
  purchase: 'Purchase unit',
  sales: 'Sales unit',
  alternate: 'Alternate unit',
}

export interface UomUsageDrawerProps {
  unit: Uom | null
  onClose: () => void
}

export function UomUsageDrawer({ unit, onClose }: UomUsageDrawerProps) {
  const [page, setPage] = useState(1)
  const unitId = unit?.unit_id ?? null

  const query = useQuery(
    (signal) => uomExtras.usage(unitId as number, { page, limit: 25 }, signal),
    [unitId, page],
    { enabled: unitId !== null, resetKey: unitId },
  )

  const rows = useMemo(() => query.data?.data ?? [], [query.data])
  const total = query.data?.meta.total ?? unit?.usage_count ?? 0

  return (
    <Drawer
      open={unit !== null}
      title={unit ? `Items using “${unit.unit_name}”` : 'Items'}
      description={
        unit
          ? 'Every item that names this unit as its base, purchase, sales or an alternate unit.'
          : undefined
      }
      badge={
        query.data ? (
          <Badge tone="violet" size="xs">
            {formatInt(total)} {total === 1 ? 'item' : 'items'}
          </Badge>
        ) : null
      }
      onClose={() => {
        setPage(1)
        onClose()
      }}
      width="lg"
      footer={
        query.data && query.data.meta.total > query.data.meta.limit ? (
          <ServerTablePagination meta={query.data.meta} limit={25} onPage={setPage} />
        ) : null
      }
    >
      <div className={cx(AIC, 'space-y-3')}>
        {query.loading && rows.length === 0 ? (
          <LoadingState variant="skeleton" rows={6} />
        ) : query.error ? (
          <ErrorState
            title="We couldn’t load the items for this unit."
            description={query.error.message}
            onRetry={query.reload}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title="No items use this unit."
            description="Nothing references it, so it can be deactivated or deleted safely."
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((item) => (
              <li
                key={item.item_id}
                className="rounded-xl border border-gray-200 bg-white p-3 transition-colors hover:border-primary/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      to={`/items/${item.item_id}`}
                      className="truncate text-sm font-semibold text-gray-900 no-underline hover:text-primary"
                    >
                      {item.item_name}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      {item.item_sku ? <span className="font-mono">{item.item_sku}</span> : 'No SKU'}
                      {item.grp_name ? <span> · {item.grp_name}</span> : null}
                      {item.cat_name ? <span> · {item.cat_name}</span> : null}
                    </p>
                  </div>
                  <Badge tone={Number(item.is_active) === 1 ? 'success' : 'neutral'} size="xs" dot>
                    {Number(item.is_active) === 1 ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                {item.roles.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.roles.map((role) => (
                      <Badge key={role} tone={role === 'base' ? 'primary' : 'neutral'} size="xs">
                        {ROLE_LABEL[role]}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  )
}

export default UomUsageDrawer
