/**
 * Per-brand commercial figures — read LIVE from Books, through the Inventory
 * API's relay (`GET /v1/brands/sales` → `App\Services\BrandSalesService`).
 *
 * The ownership line this module exists to hold:
 *
 *   Inventory owns the brand, the item that carries it and how many there are.
 *   Books owns the invoice, the credit note and therefore the turnover.
 *   Manage owns the company, the branch and the financial year the sum is for.
 *
 * The Brands screen shows all three at once, so somewhere they have to meet.
 * They meet HERE — in one request, at the moment the screen draws, over the
 * other product's own API. They are never made to meet by copying Books'
 * numbers into an Inventory table: a `inv_brand_sales` fed on a schedule would
 * be wrong within a minute of a back-dated credit note, would be a second place
 * for the same truth to live, and is precisely the thing the platform does not
 * do. Nothing in this file writes, caches across a reload, or persists.
 *
 * Books does not serve the path yet. Until it does, and whenever it cannot be
 * reached, this resolves to `available: false` with a reason and the screen
 * renders the brand master without a revenue column. It never substitutes a
 * zero, an estimate or a figure derived from anything else — an invented
 * turnover on an accounting screen is worse than a missing one.
 */

import { api } from './api'
import type { ItemResponse } from './api'

/** Why no figures came back. Each one is worded differently on screen. */
export type BrandSalesReason =
  /** The Inventory→Books brand-sales relay is switched off in this environment. */
  | 'not_configured'
  /** Books answered, but does not serve the endpoint yet. */
  | 'not_implemented'
  /** Books is configured and shipped, but unreachable or unwell right now. */
  | 'unavailable'

export interface BrandSalesRow {
  brand_id: number
  sales: number
  /**
   * A plain series for a sparkline, or null.
   *
   * Null is a real answer: a brand whose trend Books did not send draws no
   * sparkline. A flat line is not a stand-in, and neither is a made-up one.
   */
  trend: number[] | null
}

export interface BrandSales {
  available: boolean
  reason: BrandSalesReason | null
  /** The currency Books summed in — never assumed to be the rupee. */
  currency: string | null
  rows: BrandSalesRow[]
}

/** The empty answer, used before the first response and on any failure. */
export const BRAND_SALES_UNAVAILABLE: BrandSales = {
  available: false,
  reason: 'unavailable',
  currency: null,
  rows: [],
}

function normaliseRow(raw: unknown): BrandSalesRow | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const brandId = Number(row.brand_id)
  const sales = Number(row.sales)
  if (!Number.isFinite(brandId) || brandId <= 0 || !Number.isFinite(sales)) return null
  const trendRaw = Array.isArray(row.trend) ? row.trend.map(Number).filter((n) => Number.isFinite(n)) : []
  return { brand_id: brandId, sales, trend: trendRaw.length >= 2 ? trendRaw : null }
}

/**
 * Ask Books what each brand sold in the selected FY.
 *
 * The scope (company, FY, branch) rides along automatically — `api` injects it
 * — which is what makes the answer change when the header's FY selector does,
 * and what makes it impossible to show one company's revenue under another's
 * name.
 *
 * Never throws for a business reason. The relay answers 200 whether or not
 * Books could be reached, because a brand master that will not draw because an
 * accounting service is down is a worse screen than a brand master with no
 * revenue column. A genuine transport failure (the Inventory API itself
 * unreachable) resolves to `unavailable` for the same reason.
 */
export async function fetchBrandSales(signal?: AbortSignal): Promise<BrandSales> {
  try {
    const res = await api.get<ItemResponse<Partial<BrandSales>>>('v1/brands/sales', { signal })
    const data = res.data ?? {}
    const rows = Array.isArray(data.rows)
      ? data.rows.map(normaliseRow).filter((r): r is BrandSalesRow => r !== null)
      : []
    return {
      available: data.available === true,
      reason: data.available === true ? null : ((data.reason as BrandSalesReason | null) ?? 'unavailable'),
      currency: typeof data.currency === 'string' && data.currency ? data.currency : null,
      rows,
    }
  } catch (err) {
    // An aborted request is the caller changing its mind, not an outage: let it
    // propagate so useQuery can ignore its own abort instead of painting the
    // screen with a failure that did not happen.
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) throw err
    return BRAND_SALES_UNAVAILABLE
  }
}

/** Sales keyed by brand id, for a table that renders one row at a time. */
export function indexBrandSales(sales: BrandSales): Map<number, BrandSalesRow> {
  const index = new Map<number, BrandSalesRow>()
  for (const row of sales.rows) index.set(row.brand_id, row)
  return index
}

/** What to tell the reader, in their words rather than the relay's. */
export function brandSalesMessage(reason: BrandSalesReason | null): string {
  switch (reason) {
    case 'not_configured':
    case 'not_implemented':
      return 'Revenue figures appear here once the Sales service is connected to this company.'
    case 'unavailable':
      return 'Revenue figures are temporarily unavailable. The brand master below is unaffected.'
    default:
      return ''
  }
}

/**
 * Whether the screen should draw a revenue column at all.
 *
 * A column of dashes for a feature that does not exist in this deployment is
 * dead furniture; a column of dashes for one that is merely down right now
 * tells the reader something true. So the column appears when the integration
 * is live OR when it is live-but-failing, and stays away when nothing has been
 * connected.
 */
export function showsSalesColumn(sales: BrandSales | null): boolean {
  if (!sales) return false
  return sales.available || sales.reason === 'unavailable'
}
