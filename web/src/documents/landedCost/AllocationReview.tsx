import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Table2 } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { Input } from '../../ui/Input'
import { SearchBox } from '../../ui/SearchBox'
import { FormSectionCard } from '../../ui/shell'
import { AIC, cx } from '../../ui/cx'
import { Notice } from '../../components/Notice'
import { ExportCsvButton } from '../../components/ExportCsvButton'
import { csvFilename } from '../../utils/csv'
import type { CsvColumn } from '../../utils/csv'
import { formatMoney, formatQty } from '../../utils/format'
import { BASIS_LABELS, COST_TYPE_LABELS, chargeAmount } from '../landedCost'
import type { AllocationBasis, AllocationPreview, ChargeDraft } from '../landedCost'
import type { AllocationReviewRow } from './model'
import { seriesClassFor } from './chargePalette'

type SortKey = 'receipt' | 'item' | 'qty' | 'current' | 'allocated' | 'revised'

interface AllocationReviewProps {
  rows: AllocationReviewRow[]
  charges: ChargeDraft[]
  preview: AllocationPreview
  currency: string
  disabled: boolean
  /** Typing over one line's share switches that charge to "entered per line". */
  onOverride: (charge: ChargeDraft, lineId: number, value: string) => void
}

const BASIS_TONE: Record<string, 'info' | 'primary' | 'violet' | 'warning' | 'neutral'> = {
  value: 'info',
  qty: 'primary',
  equal: 'violet',
  manual: 'warning',
  direct: 'warning',
  mixed: 'neutral',
  none: 'neutral',
}

function basisLabel(basis: string): string {
  if (basis === 'mixed') return 'Mixed'
  if (basis === 'none') return '—'
  return BASIS_LABELS[basis as AllocationBasis] ?? basis
}

/**
 * Exactly where the money goes, before it goes there.
 *
 * This is the table the whole screen exists to show: one row per receipt line, what it is worth
 * now, what this bill puts on it, and what it will be worth per unit afterwards. An operator who
 * can see a ₹16.18 per-unit uplift before posting is an operator who will notice when it should
 * have been ₹1.62.
 *
 * Any share can be typed over. Doing so switches that charge to "entered per line" and SEEDS the
 * other lines with what the pro-rata split had worked out, so overriding one line does not silently
 * blank the rest — the same behaviour the server validates against, and the figure it refuses is
 * the one the footer flags here first.
 *
 * The per-charge columns are collapsed by default: twelve lines × four charges is forty-eight
 * inputs, and the overwhelmingly common case is that nobody overrides anything.
 */
export function AllocationReview({ rows, charges, preview, currency, disabled, onOverride }: AllocationReviewProps) {
  const [term, setTerm] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'receipt', dir: 'asc' })
  const [showPerCharge, setShowPerCharge] = useState(false)

  const priced = useMemo(() => charges.filter((c) => chargeAmount(c) > 0), [charges])

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase()
    const filtered = needle
      ? rows.filter((r) => r.label.toLowerCase().includes(needle) || (r.sku ?? '').toLowerCase().includes(needle) || r.receipt_no.toLowerCase().includes(needle))
      : rows
    const dir = sort.dir === 'asc' ? 1 : -1
    const value = (r: AllocationReviewRow): string | number => {
      switch (sort.key) {
        case 'receipt':
          return `${r.receipt_no}#${String(r.line_id).padStart(10, '0')}`
        case 'item':
          return r.label.toLowerCase()
        case 'qty':
          return r.base_qty
        case 'current':
          return r.valuation_amount
        case 'allocated':
          return r.allocatedCost
        case 'revised':
          return r.revisedValue
      }
    }
    return [...filtered].sort((a, b) => {
      const av = value(a)
      const bv = value(b)
      if (av === bv) return 0
      return (av > bv ? 1 : -1) * dir
    })
  }, [rows, term, sort])

  const totals = useMemo(
    () =>
      visible.reduce(
        (acc, r) => ({
          qty: acc.qty + r.base_qty,
          current: acc.current + r.valuation_amount,
          allocated: acc.allocated + r.allocatedCost,
          revised: acc.revised + r.revisedValue,
        }),
        { qty: 0, current: 0, allocated: 0, revised: 0 },
      ),
    [visible],
  )

  const csvColumns: CsvColumn<AllocationReviewRow>[] = [
    { header: 'Receipt', value: (r) => r.receipt_no },
    { header: 'Item', value: (r) => r.label },
    { header: 'SKU', value: (r) => r.sku ?? '' },
    { header: 'Warehouse', value: (r) => r.warehouse_name ?? '' },
    { header: 'Base qty', value: (r) => r.base_qty },
    { header: 'Current value', value: (r) => r.valuation_amount },
    { header: 'Current unit cost', value: (r) => r.current_unit_cost },
    { header: 'Allocated landed cost', value: (r) => r.allocatedCost },
    { header: 'Landed cost per unit', value: (r) => r.allocatedPerUnit },
    { header: 'New unit cost', value: (r) => r.revisedUnitCost },
    { header: 'New inventory value', value: (r) => r.revisedValue },
    { header: 'Basis', value: (r) => basisLabel(r.basis) },
  ]

  const sortButton = (key: SortKey, label: string, align: 'left' | 'right' = 'left') => (
    <button
      type="button"
      onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))}
      aria-label={`Sort by ${label}`}
      className={cx('inline-flex items-center gap-1 rounded hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', align === 'right' && 'flex-row-reverse')}
    >
      {label}
      {sort.key === key ? (
        sort.dir === 'asc' ? (
          <ArrowUp className="h-3 w-3" aria-hidden />
        ) : (
          <ArrowDown className="h-3 w-3" aria-hidden />
        )
      ) : null}
    </button>
  )

  const head = 'px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap'
  const cell = 'px-2.5 py-2 whitespace-nowrap'
  const num = `${cell} text-right tabular-nums`

  return (
    <FormSectionCard
      title="Allocation review"
      description="Exactly what each receipt line will be worth once these charges are allocated. Figures assume all of the charge lands."
      icon={Table2}
      action={
        rows.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="xs"
              icon={showPerCharge ? ChevronDown : ChevronRight}
              onClick={() => setShowPerCharge((v) => !v)}
              aria-expanded={showPerCharge}
            >
              {showPerCharge ? 'Hide per-charge' : 'Per-charge columns'}
            </Button>
            <ExportCsvButton
              filename={csvFilename('landed-cost-allocation-preview')}
              columns={csvColumns}
              rows={visible}
              label="Export preview"
            />
          </div>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={Table2}
          title="Nothing to review yet"
          description="Select a receipt and enter a charge. Every line the charge reaches appears here with its new unit cost, before anything is posted."
        />
      ) : (
        <>
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <SearchBox value={term} onChange={setTerm} placeholder="Find an item, SKU or receipt…" className="w-full sm:w-72" aria-label="Filter allocation rows" />
            <span className="text-[11px] text-gray-500">
              {visible.length === rows.length ? `${rows.length} line${rows.length === 1 ? '' : 's'}` : `${visible.length} of ${rows.length} lines`}
            </span>
          </div>

          <div className="max-h-[28rem] overflow-auto rounded-lg border border-gray-200">
            <table className={cx(AIC, 'w-full border-collapse text-xs')}>
              <caption className="sr-only">Per-line effect of this landed cost allocation on inventory valuation</caption>
              <thead className="lca-sticky-head">
                <tr className="text-left">
                  <th scope="col" className={cx(head, 'lca-sticky-col')}>
                    {sortButton('item', 'Item')}
                  </th>
                  <th scope="col" className={head}>
                    {sortButton('receipt', 'Receipt')}
                  </th>
                  <th scope="col" className={head}>
                    SKU
                  </th>
                  <th scope="col" className={head}>
                    Warehouse
                  </th>
                  <th scope="col" className={cx(head, 'text-right')}>
                    {sortButton('qty', 'Qty', 'right')}
                  </th>
                  <th scope="col" className={cx(head, 'text-right')}>
                    {sortButton('current', 'Base cost', 'right')}
                  </th>
                  <th scope="col" className={cx(head, 'text-right')}>
                    Current unit cost
                  </th>
                  {showPerCharge
                    ? priced.map((c, i) => (
                        <th key={c.key} scope="col" className={cx(head, 'text-right')}>
                          <span className="inline-flex items-center gap-1">
                            <span className={cx('h-1.5 w-1.5 rounded-full bg-current', seriesClassFor(c.cost_type))} aria-hidden />
                            {COST_TYPE_LABELS[c.cost_type]}
                            {priced.filter((x) => x.cost_type === c.cost_type).length > 1 ? ` ${i + 1}` : ''}
                          </span>
                        </th>
                      ))
                    : null}
                  <th scope="col" className={cx(head, 'text-right')}>
                    {sortButton('allocated', 'Allocated', 'right')}
                  </th>
                  <th scope="col" className={cx(head, 'text-right')}>
                    Cost / unit
                  </th>
                  <th scope="col" className={cx(head, 'text-right')}>
                    New unit cost
                  </th>
                  <th scope="col" className={cx(head, 'text-right')}>
                    {sortButton('revised', 'New value', 'right')}
                  </th>
                  <th scope="col" className={head}>
                    Basis
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.line_id} className="lca-review-row border-t border-gray-100 hover:bg-gray-50">
                    <th scope="row" className={cx(cell, 'lca-sticky-col max-w-[14rem] text-left font-medium text-gray-900')}>
                      <span className="block truncate" title={row.label}>
                        {row.label}
                      </span>
                    </th>
                    <td className={cx(cell, 'text-gray-600')}>{row.receipt_no}</td>
                    <td className={cx(cell, 'text-gray-500')}>{row.sku ?? '—'}</td>
                    <td className={cx(cell, 'max-w-[10rem] truncate text-gray-600')}>{row.warehouse_name ?? '—'}</td>
                    <td className={cx(num, 'text-gray-900')}>
                      {formatQty(row.base_qty)} {row.unit_symbol ?? ''}
                    </td>
                    <td className={cx(num, 'text-gray-900')}>{formatMoney(row.valuation_amount)}</td>
                    <td className={cx(num, 'text-gray-600')}>{formatMoney(row.current_unit_cost)}</td>
                    {showPerCharge
                      ? priced.map((c) => {
                          const share = preview.byCharge[c.key]?.[row.line_id]
                          return (
                            <td key={c.key} className="px-1.5 py-1.5">
                              <Input
                                inputMode="decimal"
                                className="w-24 text-right tabular-nums"
                                disabled={disabled}
                                aria-label={`${COST_TYPE_LABELS[c.cost_type]} on ${row.label}`}
                                value={c.lines[row.line_id] ?? (share !== undefined ? String(share) : '')}
                                onChange={(e) => onOverride(c, row.line_id, e.target.value)}
                              />
                            </td>
                          )
                        })
                      : null}
                    <td className={cx(num, 'font-semibold text-gray-900')}>{row.allocatedCost > 0 ? formatMoney(row.allocatedCost) : <span className="text-gray-400">—</span>}</td>
                    <td className={cx(num, 'text-gray-600')}>{row.allocatedPerUnit > 0 ? formatMoney(row.allocatedPerUnit) : '—'}</td>
                    <td className={cx(num, 'font-semibold text-emerald-700')}>{formatMoney(row.revisedUnitCost)}</td>
                    <td className={cx(num, 'text-gray-900')}>{formatMoney(row.revisedValue)}</td>
                    <td className={cell}>
                      <Badge tone={BASIS_TONE[row.basis] ?? 'neutral'} size="xs">
                        {basisLabel(row.basis)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50/80 font-semibold">
                  <th scope="row" className={cx(cell, 'lca-sticky-col text-left text-gray-600')}>
                    Total
                  </th>
                  <td colSpan={3} />
                  <td className={cx(num, 'text-gray-900')}>{formatQty(totals.qty, '0')}</td>
                  <td className={cx(num, 'text-gray-900')}>{formatMoney(totals.current)}</td>
                  <td />
                  {showPerCharge
                    ? priced.map((c) => (
                        <td key={c.key} className={cx(num, 'text-gray-900')}>
                          {formatMoney(Object.values(preview.byCharge[c.key] ?? {}).reduce((a, b) => a + b, 0))}
                        </td>
                      ))
                    : null}
                  <td className={cx(num, 'text-gray-900')}>{formatMoney(totals.allocated)}</td>
                  <td />
                  <td />
                  <td className={cx(num, 'text-emerald-700')}>{currency} {formatMoney(totals.revised)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
            Every share is rounded to four places and the last fraction is placed on the largest line, so the shares add up to the charge
            exactly — the same arithmetic the server performs when this posts. Type over any share to set that charge by hand.
          </p>

          {visible.length !== rows.length ? (
            <Notice kind="info" className="mt-2">
              The totals above cover the {visible.length} line{visible.length === 1 ? '' : 's'} matching your search, not the whole allocation.
            </Notice>
          ) : null}
        </>
      )}
    </FormSectionCard>
  )
}
