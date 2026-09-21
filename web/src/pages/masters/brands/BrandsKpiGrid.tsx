import { CircleCheck, CircleMinus, RefreshCw, Star, Tag, TrendingUp } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { ProgressBar } from '../../../ui/ProgressBar'
import { StatCard, StatCardSkeleton } from '../../../ui/StatCard'
import { Notice } from '../../../components/Notice'
import { REGISTER_KPI_GRID } from '../../../styles/designTokens'
import { formatCompactMoney, formatInt } from '../../../utils/format'
import type { BrandMetrics } from '../../../services/masters'
import type { BrandSales } from '../../../services/brandAnalyticsApi'
import { brandSalesMessage } from '../../../services/brandAnalyticsApi'

/**
 * The five figures over the Brands list.
 *
 * Each one is a link, and each link is a view of the same rows underneath —
 * that is the whole contract of a KPI card here: it states a number and takes
 * you to the records behind it. None of them is computed in the browser from
 * the page on screen; they come from `GET /v1/brands/metrics`, counted over the
 * whole company, so they do not move when the reader searches or pages.
 *
 * The fourth card is the one worth reading the code for. The design calls it
 * "Top selling brand", and it is exactly that WHEN Books is connected and has
 * answered. When it is not, the card does not go blank and it does not print a
 * sales figure Inventory does not have: it shows the leader by item count and
 * relabels itself to say so. A card that says "Top selling brand: Apple" from
 * an item count would be a lie told in a place people make decisions.
 */

export interface BrandsKpiGridProps {
  metrics: BrandMetrics | null
  sales: BrandSales | null
  loading: boolean
  error: string | null
  onRetry?: () => void
  /** Name lookup for the sales leader, from the rows already on screen. */
  brandNameOf?: (id: number) => string | null
}

function pctOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

export function BrandsKpiGrid({ metrics, sales, loading, error, onRetry, brandNameOf }: BrandsKpiGridProps) {
  if (error) {
    return (
      <Notice
        kind="warning"
        actions={
          onRetry ? (
            <Button variant="secondary" size="xs" icon={RefreshCw} onClick={onRetry}>
              Retry
            </Button>
          ) : null
        }
      >
        Brand analytics are temporarily unavailable, so the figures above the list are hidden. The
        brand list below is unaffected.
      </Notice>
    )
  }

  if (loading && !metrics) {
    return (
      <div className={REGISTER_KPI_GRID} aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <StatCardSkeleton key={i} layout="metric" />
        ))}
      </div>
    )
  }

  if (!metrics) return null

  const activePct = pctOf(metrics.active, metrics.total)
  const inactivePct = pctOf(metrics.inactive, metrics.total)

  // The revenue leader, but only if Books actually answered with figures.
  const salesLeader =
    sales?.available && sales.rows.length > 0
      ? sales.rows.reduce((best, row) => (row.sales > best.sales ? row : best), sales.rows[0])
      : null
  const salesLeaderName = salesLeader ? (brandNameOf?.(salesLeader.brand_id) ?? null) : null
  const itemsLeader = metrics.top_by_items

  const leaderCard = salesLeader && salesLeaderName
    ? {
        label: 'Top selling brand',
        value: salesLeaderName,
        hint: `${formatCompactMoney(salesLeader.sales, sales?.currency ?? 'INR')} this financial year`,
        to: `/items?brand_id=${salesLeader.brand_id}`,
      }
    : itemsLeader
      ? {
          label: 'Largest brand',
          value: itemsLeader.brand_name,
          hint: `${formatInt(itemsLeader.item_count)} ${itemsLeader.item_count === 1 ? 'item' : 'items'}${
            sales && !sales.available ? ' · revenue not connected' : ''
          }`,
          to: `/items?brand_id=${itemsLeader.brand_id}`,
        }
      : {
          label: 'Largest brand',
          value: '—',
          hint: 'No items are filed under any brand yet',
          to: undefined,
        }

  return (
    <>
      <section className={REGISTER_KPI_GRID} aria-label="Brand summary">
        <StatCard
          layout="metric"
          icon={Tag}
          tone="info"
          label="Total brands"
          value={formatInt(metrics.total)}
          hint="in this company"
          to="/masters/brands"
        />

        <StatCard
          layout="metric"
          icon={CircleCheck}
          tone="success"
          label="Active brands"
          value={formatInt(metrics.active)}
          hint={metrics.total > 0 ? `${activePct}% of all brands` : 'No brands yet'}
          to="/masters/brands?status=active"
          footer={
            <ProgressBar
              size="sm"
              value={metrics.active}
              max={Math.max(1, metrics.total)}
              aria-label={`${metrics.active} of ${metrics.total} brands are active`}
            />
          }
        />

        <StatCard
          layout="metric"
          icon={CircleMinus}
          tone="danger"
          label="Inactive brands"
          value={formatInt(metrics.inactive)}
          hint={metrics.total > 0 ? `${inactivePct}% of all brands` : 'No brands yet'}
          to="/masters/brands?status=inactive"
          footer={
            <ProgressBar
              size="sm"
              value={metrics.inactive}
              max={Math.max(1, metrics.total)}
              barClassName="bg-red-500"
              aria-label={`${metrics.inactive} of ${metrics.total} brands are inactive`}
            />
          }
        />

        <StatCard
          layout="metric"
          icon={Star}
          tone="warning"
          label={leaderCard.label}
          value={leaderCard.value}
          hint={leaderCard.hint}
          to={leaderCard.to}
        />

        <StatCard
          layout="metric"
          icon={TrendingUp}
          tone="primary"
          label="New this month"
          value={formatInt(metrics.new_this_month)}
          // A real comparative or none at all: StatCard draws no chip when the
          // previous period is zero, which is exactly right — nothing divides
          // by a month in which nothing was added.
          current={metrics.new_this_month}
          previous={metrics.new_prev_month}
          hint="vs last month"
          to="/masters/brands?created=month"
        />
      </section>

      {sales && !sales.available && sales.reason !== 'not_configured' ? (
        <p className="text-xs text-gray-500">{brandSalesMessage(sales.reason)}</p>
      ) : null}
    </>
  )
}

export default BrandsKpiGrid
