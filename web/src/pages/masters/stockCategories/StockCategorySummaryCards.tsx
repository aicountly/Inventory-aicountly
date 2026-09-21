import { Link } from 'react-router-dom'
import { ChevronRight, CircleCheck, CircleX, Layers, Tag, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '../../../ui/Card'
import { ICON_TILE_SIZE, IconTile } from '../../../ui/IconTile'
import type { IconTone } from '../../../ui/IconTile'
import { cx } from '../../../ui/cx'
import { formatInt } from '../../../utils/format'
import type { StockCategorySummary } from '../../../services/stockCategories'

/**
 * The four figures over the list.
 *
 * Every one of them comes from `GET /v1/stock-categories/summary`, which
 * counts the company. None is derived from the page on screen: "10 categories"
 * computed from ten visible rows would read the same on page 1 of 9 and be
 * wrong, and the footer three inches below would say so.
 *
 * When the summary call fails the cards say `—` and the strip explains itself
 * once. They never fall back to counting the rows that happen to be loaded,
 * because a figure that is sometimes the company and sometimes the page is
 * worse than no figure.
 */

interface KpiCardProps {
  icon: LucideIcon
  tone: IconTone
  label: string
  value: ReactNode
  meta: ReactNode
  /** Right of the figure — the mini chart, the progress line, the chevron. */
  accessory?: ReactNode
  to?: string
  ariaLabel?: string
}

const SHELL = 'flex items-start gap-3 min-h-[92px]'

function KpiCard({ icon, tone, label, value, meta, accessory, to, ariaLabel }: KpiCardProps) {
  return (
    <Card
      as={to ? Link : 'article'}
      to={to}
      aria-label={to ? ariaLabel : undefined}
      padding="sm"
      interactive={Boolean(to)}
      className={cx(SHELL, 'transition-colors hover:border-gray-300 motion-reduce:transition-none')}
    >
      <IconTile icon={icon} tone={tone} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
        <p className="mt-1 truncate text-2xl font-semibold leading-none tabular-nums text-gray-900">{value}</p>
        <div className="mt-1.5 min-h-[16px] text-[11px] text-gray-500">{meta}</div>
      </div>
      {accessory ? <div className="flex shrink-0 items-center self-center">{accessory}</div> : null}
    </Card>
  )
}

function KpiSkeleton() {
  return (
    <Card aria-hidden padding="sm" className={SHELL}>
      <span className={cx('skeleton', ICON_TILE_SIZE.lg)} />
      <div className="min-w-0 flex-1 space-y-2">
        <span className="skeleton block h-3 w-20 rounded" />
        <span className="skeleton block h-6 w-16 rounded" />
        <span className="skeleton block h-3 w-24 rounded" />
      </div>
    </Card>
  )
}

/**
 * A five-bar sparkline of the active / inactive split.
 *
 * Decoration with a job: the bars are the share of categories that are active,
 * so a company whose masters are half switched off does not get the same
 * confident rising chart as one whose masters are all live. `aria-hidden`,
 * because the same fact is printed beside it in words.
 */
function ActiveShareBars({ activePercent }: { activePercent: number }) {
  const bars = [0.3, 0.5, 0.65, 0.85, 1]
  return (
    <span className="flex h-10 items-end gap-1 opacity-70" aria-hidden>
      {bars.map((scale, i) => (
        <span
          key={i}
          className="block w-1.5 rounded-full bg-primary/60"
          style={{ height: `${Math.max(14, Math.round(scale * Math.max(18, activePercent)))}%` }}
        />
      ))}
    </span>
  )
}

function Meter({ percent, tone }: { percent: number; tone: 'primary' | 'danger' }) {
  return (
    <span className="mt-1 block h-1 w-16 overflow-hidden rounded-full bg-gray-200" aria-hidden>
      <span
        className={cx('block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none', tone === 'primary' ? 'bg-primary' : 'bg-red-500')}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </span>
  )
}

/** Never divides by zero — an empty company is 0%, not NaN%. */
export function percentOf(part: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  return Math.round((part / total) * 100)
}

export interface StockCategorySummaryCardsProps {
  summary: StockCategorySummary | null
  loading: boolean
  /** The summary call failed — the cards show em dashes and say why once. */
  failed: boolean
  /** Route to the Items list filtered to a category, when the user may read it. */
  itemsLinkFor?: (stockCatId: number) => string | undefined
}

export function StockCategorySummaryCards({ summary, loading, failed, itemsLinkFor }: StockCategorySummaryCardsProps) {
  if (loading && !summary) {
    return (
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Stock category summary" aria-busy>
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
      </section>
    )
  }

  const dash = <span className="text-gray-400">—</span>
  const total = summary?.total ?? null
  const active = summary?.active ?? null
  const inactive = summary?.inactive ?? null
  const activePercent = summary ? percentOf(summary.active, summary.total) : 0
  const inactivePercent = summary ? percentOf(summary.inactive, summary.total) : 0
  const mostUsed = summary?.most_used ?? null
  const mostUsedTo = mostUsed ? itemsLinkFor?.(mostUsed.stock_cat_id) : undefined

  const added = summary?.created_this_month ?? null

  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Stock category summary">
      <KpiCard
        icon={Layers}
        tone="info"
        label="Total categories"
        value={total === null ? dash : formatInt(total)}
        meta={
          added === null ? (
            'Count unavailable'
          ) : (
            <span className={cx('inline-flex items-center gap-1', added > 0 && 'font-semibold text-primary')}>
              <TrendingUp className="h-3 w-3" aria-hidden />
              {added === 0 ? 'None added this month' : `${formatInt(added)} added this month`}
            </span>
          )
        }
        accessory={summary ? <ActiveShareBars activePercent={activePercent} /> : undefined}
      />

      <KpiCard
        icon={CircleCheck}
        tone="success"
        label="Active"
        value={active === null ? dash : formatInt(active)}
        meta={
          summary ? (
            <>
              {activePercent}% of total
              <Meter percent={activePercent} tone="primary" />
            </>
          ) : (
            'Count unavailable'
          )
        }
      />

      <KpiCard
        icon={CircleX}
        tone="rose"
        label="Inactive"
        value={inactive === null ? dash : formatInt(inactive)}
        meta={
          summary ? (
            <>
              {inactivePercent}% of total
              <Meter percent={inactivePercent} tone="danger" />
            </>
          ) : (
            'Count unavailable'
          )
        }
      />

      <KpiCard
        icon={Tag}
        tone="violet"
        label="Most used category"
        value={
          !summary ? (
            dash
          ) : mostUsed ? (
            <span className="block truncate text-lg font-semibold">{mostUsed.cat_name}</span>
          ) : (
            <span className="block truncate text-base font-semibold text-gray-500">No items categorised yet</span>
          )
        }
        meta={
          !summary
            ? 'Usage data unavailable'
            : mostUsed
              ? `${formatInt(mostUsed.item_count)} ${mostUsed.item_count === 1 ? 'item' : 'items'}`
              : 'Assign a category on an item to see this'
        }
        accessory={mostUsedTo ? <ChevronRight className="h-5 w-5 text-gray-400" aria-hidden /> : undefined}
        to={mostUsedTo}
        ariaLabel={mostUsed ? `Open items in ${mostUsed.cat_name}` : undefined}
      />

      {failed ? (
        <p className="sm:col-span-2 xl:col-span-4 text-xs text-amber-700">
          The summary figures could not be read, so they show as —. The list below is unaffected.
        </p>
      ) : null}
    </section>
  )
}

export default StockCategorySummaryCards
