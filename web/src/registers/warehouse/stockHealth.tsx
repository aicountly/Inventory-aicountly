import { Badge } from '../../ui/Badge'
import type { BadgeTone } from '../../ui/Badge'
import { Tooltip } from '../../ui/Tooltip'
import { formatQty } from '../../utils/format'
import { STOCK_HEALTH } from '../../services/reportsApi'
import type { StockHealth, WarehouseStockRow } from '../../services/reportsApi'

/**
 * How the warehouse-stock register writes the server's health verdict.
 *
 * The verdict itself is the server's (InventoryReportService::stockHealth) and is never
 * re-derived here — the filter, the counts and the badge would otherwise be three
 * opinions about the same row. This file only decides what each one is CALLED, what
 * colour it wears and what the tooltip says it was measured against.
 */

export interface StockHealthPresentation {
  label: string
  tone: BadgeTone
  /** What the state means, in the dropdown and in the alerts card. */
  description: string
}

export const STOCK_HEALTH_UI: Record<StockHealth, StockHealthPresentation> = {
  negative: {
    label: 'Negative',
    tone: 'danger',
    description: 'Below zero in this warehouse — a posting to correct, not stock to sell.',
  },
  out: {
    label: 'Out of stock',
    tone: 'neutral',
    description: 'Nothing on hand in this warehouse as at the selected date.',
  },
  reorder: {
    label: 'Reorder',
    tone: 'danger',
    description: 'The item has reached its reorder point across the warehouses in view.',
  },
  low: {
    label: 'Low stock',
    tone: 'warning',
    description: 'The item is under its safety stock or minimum across the warehouses in view.',
  },
  overstocked: {
    label: 'Overstocked',
    tone: 'violet',
    description: 'The item is above its maximum across the warehouses in view.',
  },
  healthy: {
    label: 'Healthy',
    tone: 'success',
    description: 'Within the levels set on the item, or no levels are set.',
  },
}

/** Options for the Stock health filter, worst first, plus the set that matters most. */
export const STOCK_HEALTH_OPTIONS: { value: string; label: string }[] = [
  { value: 'attention', label: 'Needs attention' },
  ...STOCK_HEALTH.map((key) => ({ value: key, label: STOCK_HEALTH_UI[key].label })),
]

/** The states "Needs attention" gathers. Mirrors STOCK_HEALTH_GROUPS on the server. */
export const ATTENTION_STATES: readonly StockHealth[] = ['negative', 'out', 'reorder', 'low']

/** How many rows are in a state worth acting on, from the server's own counts. */
export function attentionCount(health: Record<StockHealth, number> | undefined): number {
  if (!health) return 0
  return ATTENTION_STATES.reduce((total, key) => total + (health[key] ?? 0), 0)
}

/**
 * The threshold a row was judged against, written out.
 *
 * A badge that says "Low stock" and nothing else leaves a buyer to go and look up the
 * item master to find out what "low" was. The figure is already on the row, so the
 * tooltip can simply say it.
 */
function measuredAgainst(row: WarehouseStockRow): string | null {
  switch (row.stock_health) {
    case 'reorder':
      return row.reorder_point_qty !== null
        ? `Reorder point ${formatQty(row.reorder_point_qty)}`
        : null
    case 'low': {
      const safety = row.safety_stock_qty
      const min = row.min_stock_qty
      if (safety !== null && safety > 0) return `Safety stock ${formatQty(safety)}`
      if (min !== null && min > 0) return `Minimum ${formatQty(min)}`
      return null
    }
    case 'overstocked':
      return row.max_stock_qty !== null ? `Maximum ${formatQty(row.max_stock_qty)}` : null
    default:
      return null
  }
}

/**
 * The status cell.
 *
 * The dot is not decoration: the eye finds the odd row in a column of identical shapes
 * by colour before it reads a word, and the word is still there for anyone who cannot
 * use the colour — which is the whole reason status is never colour alone here.
 */
export function StockHealthCell({ row }: { row: WarehouseStockRow }) {
  const ui = STOCK_HEALTH_UI[row.stock_health] ?? STOCK_HEALTH_UI.healthy
  const against = measuredAgainst(row)
  return (
    <Tooltip label={against ? `${ui.description} ${against}.` : ui.description}>
      <Badge tone={ui.tone} size="xs" dot className="normal-case">
        {ui.label}
      </Badge>
    </Tooltip>
  )
}
