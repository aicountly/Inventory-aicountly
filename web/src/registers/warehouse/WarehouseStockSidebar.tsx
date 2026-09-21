import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Sparkles } from 'lucide-react'
import { Card } from '../../ui/Card'
import { cx, AIC } from '../../ui/cx'
import { formatMoney, formatQty } from '../../utils/format'
import { currencySymbol } from '../../utils/format'
import type { WarehouseStockSummary } from '../../services/reportsApi'
import { useFastMovingItems, FAST_MOVING_DAYS } from './useFastMovingItems'
import { warehouseStockAlerts } from './warehouseStockInsights'
import type { InsightTone } from './warehouseStockInsights'

/* --------------------------------------------------------------- rail shell */

function RailCard({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <Card padding="none" className="overflow-hidden print:hidden">
      <div className="flex items-baseline justify-between gap-2 border-b border-gray-100 px-3 py-2">
        <h3 className="text-xs font-semibold text-gray-900">{title}</h3>
        {aside ? <span className="text-[10px] text-gray-500">{aside}</span> : null}
      </div>
      <div className="px-3 py-2.5">{children}</div>
    </Card>
  )
}

function RailEmpty({ children }: { children: ReactNode }) {
  return <p className="py-1 text-[11px] leading-snug text-gray-500">{children}</p>
}

function RailSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-6 rounded" />
      ))}
    </div>
  )
}

/* ------------------------------------------------------- stock distribution */

/**
 * Where the stock sits, by share of value.
 *
 * NOT "warehouse utilisation". Utilisation needs a capacity to be a percentage OF, and
 * inv_warehouses holds no capacity column — there is nowhere in Inventory a warehouse's
 * size is recorded. A bar labelled "78%" with an invented denominator would be the
 * prettiest lie on the screen, so the bar here measures each warehouse against the
 * largest one, which is a real comparison, and the figure beside it is the share of
 * total value, which is a real share.
 *
 * Every figure comes from `summary.by_warehouse`, which the server computes over the
 * whole filtered set — not the page on screen.
 */
function StockDistributionCard({
  summary,
  currency,
  linkFor,
}: {
  summary: WarehouseStockSummary
  currency: string
  linkFor: (warehouseId: number | null) => string | null
}) {
  const rows = [...(summary.by_warehouse ?? [])].sort((a, b) => b.closing_value - a.closing_value)
  const total = summary.closing_value
  const largest = rows.reduce((max, r) => Math.max(max, Math.abs(r.closing_value)), 0)

  return (
    <RailCard
      title="Stock distribution"
      aside={`${rows.length} of ${summary.active_warehouses} in use`}
    >
      {rows.length === 0 ? (
        <RailEmpty>No warehouse holds stock on this date.</RailEmpty>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const pct = total > 0 ? Math.round((row.closing_value / total) * 100) : 0
            const width = largest > 0 ? Math.max(2, (Math.abs(row.closing_value) / largest) * 100) : 0
            const to = linkFor(row.warehouse_id)
            const name = row.warehouse_name ?? 'No warehouse'
            return (
              <li key={row.warehouse_id ?? 'none'}>
                <div className="flex items-baseline justify-between gap-2 text-[11px]">
                  {to ? (
                    <Link
                      to={to}
                      className="truncate font-medium text-gray-800 hover:text-primary"
                      title={`Show only ${name}`}
                    >
                      {name}
                    </Link>
                  ) : (
                    <span className="truncate font-medium text-gray-800">{name}</span>
                  )}
                  <span className="shrink-0 font-semibold tabular-nums text-gray-900">{pct}%</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={cx(
                      'h-full rounded-full',
                      row.closing_value < 0 ? 'bg-red-500' : 'bg-primary',
                    )}
                    style={{ width: `${width}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] tabular-nums text-gray-500">
                  {formatQty(row.closing_qty)} units · {currencySymbol(currency)}{' '}
                  {formatMoney(row.closing_value)}
                </p>
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-2.5 border-t border-gray-100 pt-2 text-[10px] leading-snug text-gray-400">
        Share of closing value. Bars compare warehouses to the largest — Inventory records
        no warehouse capacity, so there is no utilisation to show.
      </p>
    </RailCard>
  )
}

/* ---------------------------------------------------------- fast moving items */

function FastMovingItemsCard({
  to,
  warehouseId,
  itemGroupId,
  stockCategoryId,
  unitLabel,
}: {
  to: string
  warehouseId?: string
  itemGroupId?: string
  stockCategoryId?: string
  unitLabel: string
}) {
  const { allowed, rows, loading, error } = useFastMovingItems({
    to,
    warehouseId,
    itemGroupId,
    stockCategoryId,
  })
  if (!allowed) return null

  return (
    <RailCard title="Fast moving items" aside={`Last ${FAST_MOVING_DAYS} days`}>
      {loading && rows.length === 0 ? (
        <RailSkeleton rows={4} />
      ) : error ? (
        <RailEmpty>Movement figures could not be loaded.</RailEmpty>
      ) : rows.length === 0 ? (
        <RailEmpty>Nothing has moved out in the last {FAST_MOVING_DAYS} days.</RailEmpty>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((row, index) => (
            <li key={row.item_id} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-600">
                {index + 1}
              </span>
              <Link
                to={`/registers/stock-ledger?item_id=${row.item_id}`}
                className="truncate text-[11px] text-gray-700 hover:text-primary"
                title={row.item_name ?? undefined}
              >
                {row.item_name ?? `Item #${row.item_id}`}
              </Link>
              <span className="whitespace-nowrap text-[10.5px] font-semibold tabular-nums text-gray-900">
                {formatQty(row.period_out_qty)} {row.unit_symbol ?? unitLabel}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2.5 border-t border-gray-100 pt-2 text-[10px] leading-snug text-gray-400">
        Outward quantity from movement analysis, under this register's filters.
      </p>
    </RailCard>
  )
}

/* ----------------------------------------------------------------- alerts */

const ALERT_DOT: Record<InsightTone, string> = {
  danger: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-sky-500',
  success: 'bg-emerald-500',
}

/**
 * What the stock says about itself right now.
 *
 * States, not events. Inventory keeps no "this went negative at 14:05" record, so there
 * is no honest way to write "2 hours ago" under one of these — and a timestamp is the
 * one part of an alert a reader acts on. Each row links to the rows behind it instead,
 * which is the thing the timestamp was standing in for.
 */
function StockAlertsCard({
  summary,
  linkFor,
}: {
  summary: WarehouseStockSummary
  linkFor: (health: string) => string
}) {
  const alerts = warehouseStockAlerts(summary)
  return (
    <RailCard title="Stock alerts" aside="As at this date">
      {alerts.length === 0 ? (
        <RailEmpty>
          Nothing needs attention — every line is within the levels set on its item.
        </RailEmpty>
      ) : (
        <ul className="space-y-0.5">
          {alerts.map((alert) => (
            <li key={alert.key}>
              <Link
                to={alert.health ? linkFor(alert.health) : '#'}
                className="-mx-1.5 flex items-start gap-2 rounded-lg px-1.5 py-1.5 hover:bg-gray-50"
              >
                <span
                  className={cx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', ALERT_DOT[alert.tone])}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold leading-snug text-gray-800">
                    {alert.label}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-gray-500">{alert.hint}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  )
}

/* -------------------------------------------------------------------- CTA */

/**
 * The intelligence call to action.
 *
 * It points at the registers hub, which is where Inventory's analysis actually lives —
 * replenishment advice, movement classes, ageing. There is no inventory-AI screen to
 * link to yet, and a chevron that goes nowhere (or to a route invented to receive it)
 * would be worse than no card. The copy therefore promises the hub, not a model.
 */
function InventoryAiCta() {
  return (
    <Link
      to="/registers"
      className={cx(
        AIC,
        'grid grid-cols-[1.75rem_minmax(0,1fr)_0.75rem] items-center gap-2.5 rounded-xl border border-primary/20 bg-primary-light/50 p-3',
        'no-underline transition-colors hover:border-primary/40 hover:bg-primary-light/70 print:hidden',
      )}
    >
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-white" aria-hidden>
        <Sparkles className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold leading-snug text-gray-900">
          Go deeper on this stock
        </span>
        <span className="mt-0.5 block text-[10px] leading-snug text-gray-600">
          Replenishment advice, movement classes and ageing, in your registers.
        </span>
      </span>
      <ChevronRight className="h-4 w-4 text-primary/70" aria-hidden />
    </Link>
  )
}

/* ------------------------------------------------------------------- rail */

export interface WarehouseStockSidebarProps {
  summary: WarehouseStockSummary
  /** Effective filter values, so the rail asks the same question the table did. */
  values: Record<string, string>
  /** `?health=` link that keeps every other filter. */
  healthLink: (health: string) => string
  /** `?warehouse_id=` link that keeps every other filter, or null for the no-warehouse row. */
  warehouseLink: (warehouseId: number | null) => string | null
}

export function WarehouseStockSidebar({
  summary,
  values,
  healthLink,
  warehouseLink,
}: WarehouseStockSidebarProps) {
  return (
    <>
      <StockDistributionCard
        summary={summary}
        currency={summary.currency}
        linkFor={warehouseLink}
      />
      <FastMovingItemsCard
        to={summary.to ?? values.to ?? ''}
        warehouseId={values.warehouse_id}
        itemGroupId={values.item_grp_id}
        stockCategoryId={values.stock_cat_id}
        unitLabel="units"
      />
      <StockAlertsCard summary={summary} linkFor={healthLink} />
      <InventoryAiCta />
    </>
  )
}

export default WarehouseStockSidebar
