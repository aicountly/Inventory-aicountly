/**
 * Shared AICOUNTLY design tokens — the single source for filter / table / form
 * class strings. Typed port of books-react-app/web/src/styles/designTokens.js.
 *
 * Why class *strings* and not components: every register, report and list in
 * Books looks identical because they all paste the same handful of constants.
 * Import from here rather than retyping the utilities, and the two products
 * cannot drift.
 */

export const FILTER_CARD =
  'shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 print:hidden'

export const FILTER_LABEL =
  'text-label-sm font-semibold uppercase tracking-wide text-gray-500'

export const FILTER_LABEL_COMPACT =
  'text-label-xs font-semibold uppercase tracking-wide text-gray-400'

export const FILTER_INPUT =
  'block w-full bg-white rounded-lg border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/30 h-8 text-sm px-2.5 text-gray-900 transition-colors focus:outline-none'

export const FILTER_INPUT_MD =
  'block w-full bg-white rounded-lg border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/30 h-9 text-sm px-3 text-gray-900 transition-colors focus:outline-none'

export const FILTER_ROW = 'flex flex-wrap items-center gap-x-3 gap-y-1.5'

export const FILTER_DATE_INPUT =
  'w-[7.25rem] shrink-0 bg-white rounded-lg border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/30 h-8 text-sm px-2 text-gray-900 transition-colors focus:outline-none'

export const FILTER_ACTIONS_ROW =
  'mt-2 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2'

export const SUMMARY_CARD_GRID =
  'grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 shrink-0 print:hidden'

export const SUMMARY_CARD = 'rounded-xl border border-gray-200 bg-white px-3 py-2.5'

/**
 * Four wide metric cards over a table — the register panel layout.
 *
 * Deliberately not the six-up strip above: a register that shows four figures
 * wants each of them readable at a glance from across a desk, and six columns
 * on a 1280px screen leaves 190px a card for a label, a figure and a caption.
 */
export const METRIC_CARD_GRID =
  'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 shrink-0 print:hidden'

export const TABLE_HEADER =
  'text-label-sm font-semibold uppercase tracking-wide text-gray-500'

export const TABLE_ROW_HOVER = 'table-row-hover'

export const TABLE_ROW_SELECTED = 'table-row-selected'

export const TABLE_STICKY_HEAD =
  'sticky top-0 z-10 bg-gray-50 shadow-[0_1px_0_0_rgb(var(--color-border))]'

export const AMOUNT_DEBIT = 'tabular-nums text-gray-900'

export const AMOUNT_CREDIT = 'tabular-nums text-red-600'

export const AMOUNT_BALANCE = 'tabular-nums text-emerald-600'

/** Right-aligned amount column headers in register / report tables. */
export const AMOUNT_HEADER_CLASS = 'tabular-nums whitespace-nowrap'

/** Right-aligned amount cells in register / report tables. */
export const AMOUNT_CELL_CLASS = 'tabular-nums'

export const TOOLBAR_CARD =
  'shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 flex flex-wrap items-center gap-2 print:hidden'

/**
 * SmartTable prop bundles. `as const` so `density` narrows to its literal type
 * and the bundles can be spread into SmartTableProps without a cast.
 */

/** Viewport-bound report / register lists: sticky head, scrolling body. */
export const REPORT_TABLE_PROPS = {
  stickyHeader: true,
  scrollBody: true,
  fillAvailable: true,
  density: 'compact',
} as const

/** Compact dashboard widget tables — scroll capped, no fillAvailable. */
export const DASHBOARD_TABLE_PROPS = {
  stickyHeader: true,
  scrollBody: true,
  density: 'compact',
  className: 'max-h-72',
} as const

/**
 * Staging / preview tables inside a form: scroll inside the table body,
 * pagination pinned below. Do not use fillAvailable — it collapses the scroll
 * area when the table is not the page's only flex child.
 */
export const STAGING_TABLE_PROPS = {
  stickyHeader: true,
  scrollBody: true,
  fillAvailable: false,
  density: 'compact',
  className: 'max-h-[min(32rem,55vh)]',
} as const
