import { Link } from 'react-router-dom'
import { ArrowRight, Boxes, PackageSearch } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Skeleton } from '../../../ui/Skeleton'
import { cx } from '../../../ui/cx'
import type { CostLayerItem, ValuationSnapshotRow } from '../../../services/valuationApi'
import type { Item } from '../../../services/items'
import { formatMoney, formatQty } from '../../../utils/format'

export interface ItemSnapshotPanelProps {
  item: CostLayerItem | null
  /** Item master row — only fetched when the profile may read items. */
  master: Item | null
  /** The valuation engine's own closing figures for this item. */
  valuation: ValuationSnapshotRow | null
  loading?: boolean
  /** Warehouse the figures are scoped to, for the caveat line. */
  scopeLabel?: string
  children?: React.ReactNode
}

function Metric({
  label,
  children,
  hint,
}: {
  label: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div className="min-w-0 border-r border-gray-200 px-2.5 py-2 last:border-r-0">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <div className="mt-1 min-w-0">{children}</div>
      {hint ? <p className="mt-0.5 truncate text-[10px] text-gray-400">{hint}</p> : null}
    </div>
  )
}

/**
 * The item the layers below belong to, at a glance.
 *
 * Every figure is the valuation engine's own — the closing quantity and unit
 * cost come from `/v1/valuation` for this item under the same warehouse and
 * date the table is filtered by, not from adding up the rows on screen, which
 * would only ever total the current page.
 *
 * The identifying detail (category, unit, tracking) comes from the item master
 * and is simply absent for a profile that may not read items: the valuation is
 * still fully readable without it, so nothing is blocked over it.
 */
export function ItemSnapshotPanel({
  item,
  master,
  valuation,
  loading = false,
  scopeLabel,
  children,
}: ItemSnapshotPanelProps) {
  const method = valuation?.valuation_method_applied ?? item?.valuation_method ?? null
  const unit = master?.unit_symbol ?? valuation?.unit_symbol ?? null

  if (!item) {
    return (
      <section aria-label="Item snapshot" className="px-3 py-4">
        <div className="flex items-start gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-light text-primary">
            <PackageSearch className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-gray-900">Item snapshot</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
              Pick an item above and its closing quantity, current unit cost and valuation method appear here beside
              its layers.
            </p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Item snapshot" className="min-w-0">
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <h3 className="text-[13px] font-semibold text-gray-900">Item snapshot</h3>
        <Link
          to={`/items/${item.item_id}`}
          className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary no-underline hover:underline"
        >
          View item
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      <div className="flex items-start gap-2.5 px-3 pb-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-light text-primary">
          <Boxes className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold text-gray-900" title={item.item_name}>
            {item.item_name}
          </p>
          <p className="truncate text-[10.5px] text-gray-500">
            {item.item_sku ? `SKU ${item.item_sku}` : 'No SKU'}
            {master?.cat_name ? ` · ${master.cat_name}` : master?.grp_name ? ` · ${master.grp_name}` : ''}
            {unit ? ` · ${unit}` : ''}
          </p>
          {master && (master.track_batch === 1 || master.track_serial === 1 || master.track_expiry === 1) ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {master.track_batch === 1 ? (
                <Badge tone="info" size="xs">
                  Batch tracked
                </Badge>
              ) : null}
              {master.track_serial === 1 ? (
                <Badge tone="indigo" size="xs">
                  Serial tracked
                </Badge>
              ) : null}
              {master.track_expiry === 1 ? (
                <Badge tone="warning" size="xs">
                  Expiry tracked
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mx-3 grid grid-cols-3 overflow-hidden rounded-lg border border-gray-200">
        <Metric label="On hand" hint={unit ?? undefined}>
          {loading ? (
            <Skeleton className="h-4 w-14" rounded="md" />
          ) : valuation ? (
            <p
              className={cx(
                'truncate text-[15px] font-semibold tabular-nums',
                valuation.closing_qty < 0 ? 'text-red-600' : 'text-gray-900',
              )}
            >
              {formatQty(valuation.closing_qty)}
            </p>
          ) : (
            <p className="text-[12px] text-gray-400">—</p>
          )}
        </Metric>

        <Metric label="Unit cost" hint="valuation">
          {loading ? (
            <Skeleton className="h-4 w-14" rounded="md" />
          ) : valuation ? (
            <p className="truncate text-[15px] font-semibold tabular-nums text-gray-900">
              {formatMoney(valuation.unit_cost)}
            </p>
          ) : (
            <p className="text-[12px] text-gray-400">—</p>
          )}
        </Metric>

        <Metric label="Method">
          {method ? (
            <Badge tone="primary" size="xs">
              {method}
            </Badge>
          ) : (
            <span className="text-[11px] text-gray-400">Company default</span>
          )}
        </Metric>
      </div>

      {scopeLabel ? (
        <p className="px-3 pt-1.5 text-[10px] leading-relaxed text-gray-400">
          Closing figures for {scopeLabel}, from the valuation engine.
        </p>
      ) : null}

      {children}
    </section>
  )
}

export default ItemSnapshotPanel
