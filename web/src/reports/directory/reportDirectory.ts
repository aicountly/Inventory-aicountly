/**
 * The report directory — the metadata the landing screen at `/reports` renders.
 *
 * It is deliberately a *view* over the configs that already exist rather than a
 * second list of reports: the title, the long description, the icon, the
 * permission and the route all come from the `RegisterConfig` that actually
 * serves the report, so a report renamed or re-pathed in one place cannot end
 * up with a card pointing somewhere else. What lives here is only what a
 * directory needs and a report config has no business knowing — which shelf a
 * card sits on, which decorative preview it draws, and the words a reader is
 * likely to type when looking for it.
 *
 * The eight `/reports/*` configs and the two registers that Reports has always
 * linked to (the stock ledger and valuation) are listed together, because to a
 * reader they are ten reports; the URL each one opens is unchanged.
 */

import type { LucideIcon } from 'lucide-react'
import type { PermissionKey } from '../../access/AccessContext'
import type { AnyRegisterConfig } from '../../registers/RegisterConfig'
import { registerPermission, registerRoute } from '../../registers/RegisterConfig'
import { stockLedgerRegister } from '../../registers/configs/stockRegisters'
import { valuationRegister } from '../../registers/configs/opsRegisters'
import type { IconTone } from '../../ui/IconTile'
import {
  movementAnalysisConfig,
  nearExpiryConfig,
  replenishmentConfig,
  stockAgeingConfig,
} from '../configs/analysisReports'
import {
  batchStockConfig,
  serialStockConfig,
  stockSummaryConfig,
  warehouseStockConfig,
} from '../configs/stockReports'

/** The three shelves the directory groups reports onto. */
export type ReportCategory = 'stock-movement' | 'ageing-expiry' | 'valuation-ledger'

export const CATEGORY_ORDER: readonly ReportCategory[] = [
  'stock-movement',
  'ageing-expiry',
  'valuation-ledger',
]

export const CATEGORY_LABELS: Record<ReportCategory, string> = {
  'stock-movement': 'Stock & movement',
  'ageing-expiry': 'Ageing & expiry',
  'valuation-ledger': 'Valuation & ledger',
}

/**
 * Which decorative sketch a card draws in its footer.
 *
 * Every one of these is a fixed shape — no data is fetched to draw it and no
 * figure is printed inside it. A directory that rendered invented quantities
 * would be inviting a reader to act on numbers no endpoint ever returned.
 */
export type ReportPreviewKind =
  | 'bars'
  | 'columns'
  | 'histogram'
  | 'sparkline'
  | 'area'
  | 'status'
  | 'ledger'
  | 'progress'

export interface ReportDirectoryEntry {
  /** Stable id — persisted in the favourites list, so it must not track a path. */
  id: string
  title: string
  /** Card text: one or two lines. */
  blurb: string
  /** The config's own description, kept for the card's tooltip. */
  fullDescription: string
  /** The route this report already lives at. */
  route: string
  permission: PermissionKey
  icon: LucideIcon
  tone: IconTone
  preview: ReportPreviewKind
  category: ReportCategory
  /** Extra words search should match, beyond the title, blurb and category. */
  keywords: readonly string[]
  /** True when the report declares a `warehouse_id` filter of its own. */
  acceptsWarehouse: boolean
}

/** Where a `/reports/*` config is mounted — see the `reports/:path` route. */
export function reportRoute(config: AnyRegisterConfig): string {
  return `/reports/${config.path}`
}

function acceptsWarehouse(config: AnyRegisterConfig): boolean {
  return config.filters.some((f) => f.key === 'warehouse_id')
}

interface DirectoryExtras {
  id: string
  blurb: string
  tone: IconTone
  preview: ReportPreviewKind
  category: ReportCategory
  keywords: readonly string[]
  icon?: LucideIcon
  /**
   * What Reports calls this report, when that is not what the config calls it.
   *
   * Only the valuation register uses it. It answers to "Valuation register" on
   * the registers hub and has been "Stock valuation" on this page since before
   * registers existed; renaming the card to match the hub would move a door
   * readers already know, so the name they know is kept and the destination is
   * the same either way.
   */
  title?: string
}

/**
 * One card, built from the config that serves the report.
 *
 * `route` is passed in rather than derived here because the ten entries are not
 * all mounted the same way — eight are `/reports/<path>`, two are registers —
 * and guessing would be exactly the invention this file exists to avoid.
 */
function entry(config: AnyRegisterConfig, route: string, extras: DirectoryExtras): ReportDirectoryEntry {
  const icon = extras.icon ?? config.icon
  if (!icon) throw new Error(`Report "${extras.id}" has no icon`)
  return {
    id: extras.id,
    title: extras.title ?? config.title,
    blurb: extras.blurb,
    fullDescription: config.description,
    route,
    permission: registerPermission(config),
    icon,
    tone: extras.tone,
    preview: extras.preview,
    category: extras.category,
    keywords: extras.keywords,
    acceptsWarehouse: acceptsWarehouse(config),
  }
}

/**
 * The ten reports, in the order the directory shows them.
 *
 * The blurbs are shorter than the configs' own descriptions because a card is
 * not a report header — the full text is still one hover away, and the report
 * itself repeats it. Where shortening would have cost precision it was not
 * shortened: "what is on hand and what is already promised" stays, because
 * "available" names a specific bucket in this domain and near expiry reports
 * both.
 */
export const REPORT_DIRECTORY: readonly ReportDirectoryEntry[] = [
  entry(stockSummaryConfig, reportRoute(stockSummaryConfig), {
    id: 'stock-summary',
    blurb: 'Opening, receipts, issues and closing per item, valued at the chosen method.',
    tone: 'primary',
    preview: 'bars',
    category: 'stock-movement',
    keywords: ['opening', 'receipts', 'issues', 'closing', 'valuation', 'fifo', 'lifo', 'weighted average', 'period'],
  }),
  entry(warehouseStockConfig, reportRoute(warehouseStockConfig), {
    id: 'warehouse-stock',
    blurb: 'Closing stock per item and warehouse as at a selected date.',
    tone: 'info',
    preview: 'columns',
    category: 'stock-movement',
    keywords: ['warehouse', 'store', 'godown', 'on hand', 'closing', 'balance', 'location'],
  }),
  entry(batchStockConfig, reportRoute(batchStockConfig), {
    id: 'batch-stock',
    blurb: 'On-hand and available quantity per batch, including expiry.',
    tone: 'violet',
    preview: 'histogram',
    category: 'stock-movement',
    keywords: ['batch', 'lot', 'expiry', 'shelf life', 'available', 'on hand'],
  }),
  entry(serialStockConfig, reportRoute(serialStockConfig), {
    id: 'serial-numbers',
    blurb: 'Every tracked serial with its status, location and linked documents.',
    tone: 'rose',
    preview: 'status',
    category: 'stock-movement',
    keywords: ['serial', 'imei', 'barcode', 'tracking', 'status', 'warranty'],
  }),
  entry(movementAnalysisConfig, reportRoute(movementAnalysisConfig), {
    id: 'movement-analysis',
    blurb: 'Fast, slow, non-moving and dead stock from the movement of the period.',
    tone: 'teal',
    preview: 'sparkline',
    category: 'stock-movement',
    keywords: ['fast', 'slow', 'non-moving', 'dead stock', 'abc', 'turnover', 'movement'],
  }),

  entry(stockAgeingConfig, reportRoute(stockAgeingConfig), {
    id: 'stock-ageing',
    blurb: 'Open cost layers bucketed by age as at a selected date.',
    tone: 'warning',
    preview: 'histogram',
    category: 'ageing-expiry',
    keywords: ['ageing', 'aging', 'buckets', 'days', 'old stock', 'cost layers', 'slow'],
  }),
  entry(nearExpiryConfig, reportRoute(nearExpiryConfig), {
    id: 'near-expiry',
    blurb: 'Batches expiring within the window, oldest first, with what is on hand and what is already promised.',
    tone: 'danger',
    preview: 'bars',
    category: 'ageing-expiry',
    keywords: ['expiry', 'expired', 'shelf life', 'batch', 'window', 'perishable'],
  }),
  entry(replenishmentConfig, reportRoute(replenishmentConfig), {
    id: 'replenishment',
    blurb: 'Items at or below their reorder point, with a suggested order quantity.',
    tone: 'success',
    preview: 'progress',
    category: 'ageing-expiry',
    keywords: ['reorder', 'reorder point', 'minimum', 'purchase', 'shortage', 'order quantity', 'stock out'],
  }),

  entry(stockLedgerRegister, registerRoute(stockLedgerRegister), {
    id: 'stock-ledger',
    blurb: 'Every movement of one item, with running quantity and value.',
    tone: 'violet',
    preview: 'ledger',
    category: 'valuation-ledger',
    keywords: ['ledger', 'running balance', 'movement', 'history', 'audit', 'trail'],
  }),
  entry(valuationRegister, registerRoute(valuationRegister), {
    id: 'stock-valuation',
    title: 'Stock valuation',
    blurb: 'Closing quantity, unit cost and value per item at the configured valuation method.',
    tone: 'info',
    preview: 'area',
    category: 'valuation-ledger',
    keywords: ['valuation', 'value', 'fifo', 'lifo', 'weighted average', 'wac', 'unit cost', 'worth'],
  }),
]

/**
 * Every word a search term is matched against, lowercased once per entry.
 *
 * The shelf name is deliberately NOT in here. It has its own control, and
 * folding it in makes a search quietly return a whole shelf: "expiry" would
 * match Replenishment, which has nothing to do with expiry, purely because
 * they are filed together. Anything a reader might reasonably type instead
 * belongs in the entry's own `keywords`.
 */
const HAYSTACK = new WeakMap<ReportDirectoryEntry, string>()

function haystack(entry: ReportDirectoryEntry): string {
  const cached = HAYSTACK.get(entry)
  if (cached !== undefined) return cached
  const built = [entry.title, entry.blurb, entry.fullDescription, ...entry.keywords]
    .join(' ')
    .toLowerCase()
  HAYSTACK.set(entry, built)
  return built
}

export interface ReportDirectoryFilter {
  search?: string
  category?: ReportCategory | 'all'
  favouritesOnly?: boolean
  favourites?: ReadonlySet<string>
}

/**
 * The cards a reader should see.
 *
 * Every term in the search has to match something, so "batch expiry" narrows to
 * the reports about both rather than widening to the union of them.
 */
export function filterReports(
  reports: readonly ReportDirectoryEntry[],
  { search = '', category = 'all', favouritesOnly = false, favourites }: ReportDirectoryFilter,
): ReportDirectoryEntry[] {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return reports.filter((entry) => {
    if (category !== 'all' && entry.category !== category) return false
    if (favouritesOnly && !favourites?.has(entry.id)) return false
    if (!terms.length) return true
    const text = haystack(entry)
    return terms.every((term) => text.includes(term))
  })
}

/** The entries of one category, in directory order. */
export function reportsInCategory(
  reports: readonly ReportDirectoryEntry[],
  category: ReportCategory,
): ReportDirectoryEntry[] {
  return reports.filter((entry) => entry.category === category)
}

/** Narrow an arbitrary string (a URL parameter) to a category we know. */
export function toCategory(value: string | null | undefined): ReportCategory | 'all' {
  return CATEGORY_ORDER.includes(value as ReportCategory) ? (value as ReportCategory) : 'all'
}

/**
 * The link a card opens.
 *
 * The chosen warehouse is a launch default, not a filter on the directory: it
 * is handed to the reports that declare `warehouse_id` themselves, using the
 * same query key their filter bar reads, and left off the ones that do not have
 * the filter at all rather than being added to a URL nothing would honour.
 */
export function reportLink(entry: ReportDirectoryEntry, warehouseId?: string | null): string {
  const id = String(warehouseId ?? '').trim()
  if (!id || !entry.acceptsWarehouse) return entry.route
  const sep = entry.route.includes('?') ? '&' : '?'
  return `${entry.route}${sep}warehouse_id=${encodeURIComponent(id)}`
}
