import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Boxes, PackageSearch } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Card } from '../../../ui/Card'
import { EmptyState } from '../../../ui/EmptyState'
import { IconTile } from '../../../ui/IconTile'
import { Select } from '../../../ui/Select'
import { Skeleton } from '../../../ui/Skeleton'
import { Tooltip } from '../../../ui/Tooltip'
import { cx } from '../../../ui/cx'
import { formatDate, formatMoney, formatQty } from '../../../utils/format'
import type { CostLayerRow, CostLayersResponse, ValuationSnapshotResponse } from '../../../services/valuationApi'
import { METHOD_LABELS } from '../../../services/valuationApi'
import { layerDistribution } from '../costLayerModel'
import type { CostStats, DistributionMeasure } from '../costLayerModel'
import { STATUS_BAR_FILL } from './CostLayerStatusBadge'

export interface ItemSnapshotPanelProps {
  item: CostLayersResponse['item'] | null
  summary: CostLayersResponse['summary'] | null
  snapshot: ValuationSnapshotResponse | null
  stats: CostStats
  layers: CostLayerRow[]
  loading: boolean
  /** The rail read a bounded window rather than every layer. */
  capped: boolean
  analysisTotal: number
  /** The cost basis the snapshot figures were read at. */
  methodLabel: string
}

/**
 * The item beside the grid.
 *
 * Three figures, and each is somebody's answer rather than this panel's: the
 * quantity and value are the valuation snapshot's own totals for this item at
 * today's date, and the method is what the item master prescribes. The average
 * cost is the only division done here — value over quantity — and it is
 * labelled as the average of what is on hand, not as a rate anything was
 * bought or sold at.
 */
export function ItemSnapshotPanel({
  item,
  summary,
  snapshot,
  stats,
  layers,
  loading,
  capped,
  analysisTotal,
  methodLabel,
}: ItemSnapshotPanelProps) {
  const [measure, setMeasure] = useState<DistributionMeasure>('value')
  const row = snapshot?.data?.[0] ?? null
  const totals = snapshot?.summary ?? null
  const avgCost = totals && totals.total_qty !== 0 ? totals.total_value / totals.total_qty : null
  const method = row?.valuation_method_applied ?? item?.valuation_method ?? null

  if (!item && !loading) {
    return (
      <Card padding="none" className="overflow-hidden">
        <EmptyState
          size="sm"
          icon={PackageSearch}
          title="No item selected"
          description="Pick an item above and its on-hand quantity, average cost and layer mix appear here."
        />
      </Card>
    )
  }

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <h2 className="text-sm font-semibold text-gray-900">Item snapshot</h2>
        {item ? (
          <Link
            to={`/items/${item.item_id}`}
            className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary no-underline hover:underline"
          >
            View item
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        ) : null}
      </div>

      <div className="flex items-center gap-2.5 px-3 pb-3">
        <IconTile icon={Boxes} tone="primary" size="md" />
        <div className="min-w-0">
          {loading && !item ? (
            <Skeleton height="h-4" className="w-32" />
          ) : (
            <>
              <p className="truncate text-[13px] font-semibold text-gray-900">{item?.item_name}</p>
              <p className="truncate text-[11px] text-gray-500">
                {item?.item_sku ? `SKU ${item.item_sku}` : 'No SKU'}
                {item?.item_alias ? ` · ${item.item_alias}` : ''}
              </p>
            </>
          )}
        </div>
      </div>

      <dl className="mx-3 grid grid-cols-3 overflow-hidden rounded-lg border border-gray-200">
        <Metric
          label="On hand"
          value={totals ? formatQty(totals.total_qty) : '—'}
          caption={row?.unit_symbol ?? 'units'}
          loading={loading && !totals}
        />
        <Metric
          label="Avg cost"
          value={avgCost === null ? '—' : formatMoney(avgCost)}
          caption="per unit"
          loading={loading && !totals}
        />
        <Metric
          label="Method"
          value={
            method ? (
              <Badge tone="primary" size="xs" className="normal-case">
                {METHOD_LABELS[method as keyof typeof METHOD_LABELS] ?? method}
              </Badge>
            ) : (
              <span className="text-xs text-gray-400">Default</span>
            )
          }
          caption="item master"
          loading={loading && !item}
        />
      </dl>

      {/*
       * The basis belongs in a sentence, not in a 100px caption under a figure
       * — "at As per item m…" told a reader nothing and looked like a bug.
       */}
      {totals ? (
        <p className="mt-2 px-3 text-[10px] leading-relaxed text-gray-400">
          On hand and average cost as at {formatDate(totals.as_of)}, read at {methodLabel}.
        </p>
      ) : null}

      {summary ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 text-[11px] text-gray-500">
          <span>
            Open qty <strong className="tabular-nums text-gray-800">{formatQty(summary.open_qty)}</strong>
          </span>
          <span>
            Open value <strong className="tabular-nums text-gray-800">{formatMoney(summary.open_value)}</strong>
          </span>
          {summary.backorder_qty !== 0 ? (
            <Tooltip label="Issued below zero — costed at the last known rate until a receipt arrives">
              <span className="text-red-600">
                Backorder <strong className="tabular-nums">{formatQty(summary.backorder_qty)}</strong>
              </span>
            </Tooltip>
          ) : null}
        </div>
      ) : null}

      <LayerDistribution
        layers={layers}
        measure={measure}
        onMeasure={setMeasure}
        loading={loading && layers.length === 0}
        capped={capped}
        analysisTotal={analysisTotal}
        openLayers={stats.openLayers}
      />
    </Card>
  )
}

function Metric({
  label,
  value,
  caption,
  loading,
}: {
  label: string
  value: ReactNode
  caption: string
  loading: boolean
}) {
  return (
    <div className="min-w-0 border-r border-gray-200 px-2.5 py-2 last:border-r-0">
      <dt className="truncate text-[10px] font-medium uppercase tracking-wide text-gray-400">
        {label}
      </dt>
      <dd className="mt-1">
        {loading ? (
          <Skeleton height="h-4" className="w-12" />
        ) : (
          <span className="block truncate text-[13px] font-semibold tabular-nums text-gray-900">
            {value}
          </span>
        )}
        <span className="mt-0.5 block truncate text-[10px] text-gray-400">{caption}</span>
      </dd>
    </div>
  )
}

/**
 * Where the item's cost has got to, as one band.
 *
 * Measured at RECEIPT value rather than at what remains, and the caption says
 * so. Drawn on remaining value the band could only ever show open and
 * part-consumed layers — "22% closed", the figure that says how much of this
 * item's cost has already reached COGS, would be undrawable, and a band with a
 * missing third is not a distribution.
 */
export function LayerDistribution({
  layers,
  measure,
  onMeasure,
  loading,
  capped,
  analysisTotal,
  openLayers,
}: {
  layers: CostLayerRow[]
  measure: DistributionMeasure
  onMeasure: (next: DistributionMeasure) => void
  loading: boolean
  capped: boolean
  analysisTotal: number
  openLayers: number
}) {
  const { segments, total } = layerDistribution(layers, measure)
  const format = measure === 'value' ? formatMoney : formatQty

  return (
    <section className="mt-3 border-t border-gray-100 px-3 pb-3 pt-3" aria-label="Cost layer distribution">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-gray-900">Cost layer distribution</h3>
        <Select
          value={measure}
          onChange={(e) => onMeasure(e.target.value as DistributionMeasure)}
          aria-label="Distribution measure"
          className="h-7 w-[6.5rem] text-[11px]"
        >
          <option value="value">By value</option>
          <option value="qty">By quantity</option>
        </Select>
      </div>

      {loading ? (
        <Skeleton height="h-3.5" className="w-full" />
      ) : total === 0 ? (
        <p className="text-[11px] text-gray-500">No layers to distribute for this item yet.</p>
      ) : (
        <>
          <div
            className="flex h-3.5 overflow-hidden rounded bg-gray-100"
            role="img"
            aria-label={segments
              .map((s) => `${s.label} ${s.share.toFixed(0)} percent`)
              .join(', ')}
          >
            {segments.map((s) => (
              <span
                key={s.status}
                className={cx('h-full', STATUS_BAR_FILL[s.status])}
                style={{ width: `${s.share}%` }}
              />
            ))}
          </div>
          <ul className="mt-2 space-y-1">
            {segments.map((s) => (
              <li
                key={s.status}
                className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-1.5 text-[11px] text-gray-600"
              >
                <span
                  className={cx('inline-block h-[7px] w-[7px] rounded-sm', STATUS_BAR_FILL[s.status])}
                  aria-hidden
                />
                <span className="truncate">
                  {s.label} ({s.share.toFixed(0)}%)
                  <span className="text-gray-400"> · {s.layers}</span>
                </span>
                <strong className="tabular-nums text-gray-900">{format(s.amount)}</strong>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
            Share of the {measure === 'value' ? 'value' : 'quantity'} received into each layer, by
            what has since become of it. {openLayers} of {layers.length} layers still hold stock.
            {capped ? ` Read from the most recent ${layers.length} of ${analysisTotal} layers.` : ''}
          </p>
        </>
      )}
    </section>
  )
}

export default ItemSnapshotPanel
