import { useState } from 'react'
import { PieChart } from 'lucide-react'
import { EmptyState } from '../../ui/EmptyState'
import { AIC, cx } from '../../ui/cx'
import { formatMoney } from '../../utils/format'
import { seriesClassFor } from './chargePalette'
import type { ChargeSlice } from './model'

interface AllocationPreviewChartProps {
  slices: ChargeSlice[]
  total: number
  currency: string
}

const RADIUS = 48
const STROKE = 14
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
/** Surface gap between adjacent arcs, in viewBox units, so two similar hues never touch. */
const GAP = 2.5

/**
 * What the bill is made of.
 *
 * A donut is the right form here and only just: part-to-whole, read at a glance, six segments at
 * the absolute most (there are exactly six cost types). It is never the place the numbers are read
 * FROM — the legend beside it carries every label, percentage and amount, which is also what
 * discharges the light-mode contrast warning on the palette: identity is never colour alone.
 *
 * Sorted largest-first for readability; coloured by cost type, so the hues do not move when the
 * order does. See chargePalette.ts.
 */
export function AllocationPreviewChart({ slices, total, currency }: AllocationPreviewChartProps) {
  const [hovered, setHovered] = useState<string | null>(null)

  if (slices.length === 0) {
    return (
      <EmptyState
        compact
        icon={PieChart}
        title="Nothing to spread yet"
        description="Add a charge and the mix appears here, with each cost type's share of the bill."
      />
    )
  }

  const active = slices.find((s) => s.costType === hovered) ?? null
  // One slice needs no gap: a 360° arc minus a gap is a ring with a nick in it for no reason.
  const gap = slices.length > 1 ? GAP : 0
  let cursor = 0

  return (
    <div className={cx(AIC, 'flex flex-col items-center gap-3 sm:flex-row sm:items-center')}>
      <div className="relative shrink-0" style={{ width: 128, height: 128 }}>
        <svg viewBox="0 0 120 120" width={128} height={128} role="img" aria-label={`Charge mix: ${slices.map((s) => `${s.label} ${s.percent.toFixed(1)}%`).join(', ')}`}>
          <circle cx="60" cy="60" r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-gray-100" />
          {slices.map((slice) => {
            const length = Math.max((slice.percent / 100) * CIRCUMFERENCE - gap, 0.5)
            const offset = -(cursor / 100) * CIRCUMFERENCE
            cursor += slice.percent
            const dim = hovered !== null && hovered !== slice.costType
            return (
              <circle
                key={slice.costType}
                cx="60"
                cy="60"
                r={RADIUS}
                fill="none"
                strokeWidth={STROKE}
                strokeDasharray={`${length} ${Math.max(CIRCUMFERENCE - length, 0)}`}
                strokeDashoffset={offset}
                transform="rotate(-90 60 60)"
                className={cx('lca-donut-slice', seriesClassFor(slice.costType), dim && 'opacity-30')}
                stroke="currentColor"
                onMouseEnter={() => setHovered(slice.costType)}
                onMouseLeave={() => setHovered(null)}
              >
                <title>{`${slice.label}: ${currency} ${formatMoney(slice.amount)} (${slice.percent.toFixed(1)}%)`}</title>
              </circle>
            )
          })}
        </svg>
        {/* The hero figure. On hover it becomes the slice under the pointer, which is the whole
            interaction: the ring is a picture, the middle is the reading. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="max-w-[5.5rem] truncate text-sm font-bold tabular-nums text-gray-900">
            {formatMoney(active ? active.amount : total)}
          </span>
          <span className="max-w-[5.5rem] truncate text-[9px] uppercase tracking-wide text-gray-500">
            {active ? active.label : 'Total charges'}
          </span>
        </div>
      </div>

      <ul className="grid w-full min-w-0 gap-1.5">
        {slices.map((slice) => (
          <li
            key={slice.costType}
            className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-2 text-[11px]"
            onMouseEnter={() => setHovered(slice.costType)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className={cx('h-2 w-2 shrink-0 rounded-full bg-current', seriesClassFor(slice.costType))} aria-hidden />
            <span className="truncate text-gray-600">{slice.label}</span>
            <span className="tabular-nums text-gray-400">{slice.percent.toFixed(1)}%</span>
            <span className="tabular-nums font-semibold text-gray-900">{formatMoney(slice.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
