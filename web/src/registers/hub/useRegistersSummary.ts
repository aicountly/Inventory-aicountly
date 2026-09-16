import { useMemo } from 'react'
import {
  ArrowLeftRight,
  CalendarDays,
  Layers3,
  MapPin,
  Package,
  Warehouse,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCompany } from '../../company/CompanyContext'
import { useQuery } from '../../hooks/useQuery'
import { fetchRegistersSummary } from '../../services/registersApi'
import type { RegistersSummary } from '../../services/registersApi'
import { formatCompactMoney, formatDate, formatInt, todayIso } from '../../utils/format'

/**
 * The strip above the registers.
 *
 * One request for the whole strip, and the registers do not wait for it: the
 * hub renders its sections first and the numbers fill in, so a slow or failing
 * counter never stands between a reader and the register they came for.
 *
 * `value: null` means the figure has not arrived yet and the cell shimmers.
 * `value: '—'` means it is not coming — the caller may not read that master, or
 * nothing has been recorded — and the cell says so plainly rather than
 * borrowing a number from somewhere it does not belong.
 */
export interface RegisterKpi {
  key: string
  label: string
  value: string | null
  available: boolean
  /** The caveat behind a figure, shown as the cell's tooltip. */
  hint?: string
  icon: LucideIcon
  /** The date cell is a fact about the page, not a figure, so it reads quieter. */
  neutral?: boolean
}

export interface RegistersSummaryState {
  /**
   * Always six, in a fixed order, whatever the request did — so the strip has
   * one geometry and never reflows under the pointer. A card still in flight
   * carries `value: null` and shimmers in place; there is no separate loading
   * flag, because two ways of saying the same thing are two ways to disagree.
   */
  cards: RegisterKpi[]
  /** The strip could not be read at all — the hub drops it rather than printing six dashes. */
  failed: boolean
}

/** `2026-09-01` → `Sep 2026`. */
function monthLabel(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})/)
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

const NOT_AVAILABLE = '—'

function cardsFor(summary: RegistersSummary | null): RegisterKpi[] {
  const value = (n: number | null | undefined) =>
    summary === null ? null : n === null || n === undefined ? NOT_AVAILABLE : formatInt(n)

  const movements = summary?.movements ?? null
  const isMtd = summary !== null && summary.as_on === todayIso()
  const movementLabel =
    movements === null || isMtd ? 'Movements (MTD)' : `Movements · ${monthLabel(movements.from)}`

  const stock = summary?.stock_value ?? null

  return [
    {
      key: 'items',
      label: 'Total items tracked',
      value: value(summary?.items?.total ?? null),
      available: Boolean(summary?.items),
      icon: Package,
    },
    {
      key: 'movements',
      label: movementLabel,
      value: value(movements?.count ?? null),
      available: Boolean(movements),
      icon: ArrowLeftRight,
    },
    {
      key: 'warehouses',
      label: 'Warehouses',
      value: value(summary?.warehouses?.total ?? null),
      available: Boolean(summary?.warehouses),
      icon: Warehouse,
    },
    {
      key: 'locations',
      label: 'Bins / locations',
      value: value(summary?.locations?.total ?? null),
      available: Boolean(summary?.locations),
      icon: MapPin,
    },
    {
      key: 'stock_value',
      // The figure is the last reconciliation's, not this morning's, so the
      // date it belongs to travels with it. A bare "Current stock value" over
      // a number computed on Tuesday is the one caption here that could
      // actually mislead someone — and the tooltip says in words what the
      // date says in shorthand.
      label: stock ? `Stock value · ${formatDate(stock.as_of)}` : 'Stock value',
      hint: stock
        ? `Closing value recorded by the last reconciliation, as at ${formatDate(stock.as_of)}. Open the valuation register for the value at any other date.`
        : undefined,
      value:
        summary === null
          ? null
          : stock
            ? formatCompactMoney(stock.amount, summary.currency)
            : NOT_AVAILABLE,
      available: Boolean(stock),
      icon: Layers3,
    },
    {
      key: 'as_on',
      label: 'As on date',
      value: summary === null ? null : formatDate(summary.as_on),
      available: summary !== null,
      icon: CalendarDays,
      neutral: true,
    },
  ]
}

export function useRegistersSummary(): RegistersSummaryState {
  const { scope } = useCompany()
  // The scope is what makes these figures true: hold the previous company's
  // counters under the new company's name for even one frame and the strip is
  // showing another tenant's data. `resetKey` drops them during render.
  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null
  const { data, error } = useQuery(
    (signal) => fetchRegistersSummary(signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    { enabled: scope !== null, resetKey: scopeKey },
  )

  const cards = useMemo(() => cardsFor(data), [data])

  return { cards, failed: error !== null && data === null }
}

export default useRegistersSummary
