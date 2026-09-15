import { FileDown, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Notice } from '../../components/Notice'
import { Select } from '../../ui/Select'
import { cx } from '../../ui/cx'
import { formatDate } from '../../utils/format'
import type { WarehouseRow } from '../../services/lookupApi'
import { relativeTimeFromNow } from '../formatters'

/**
 * The heading every dashboard shares: what you are looking at, for whom, as at
 * when — then the controls that change those three things.
 *
 * The scope line is load-bearing rather than decorative. Every figure below it
 * is scoped to this company, financial year, branch and warehouse and computed
 * as at this date; a reader comparing a card against a register needs to see
 * which, and an exported PDF needs the same line on it for the same reason.
 */
export interface DashboardPageHeaderProps {
  title: string
  description: string
  companyName: string
  fyLabel: string
  branchLabel: string
  asOf: string
  onAsOf: (iso: string) => void
  /** The latest date the picker will accept — no dashboard reports the future. */
  maxDate: string
  warehouses: readonly WarehouseRow[]
  warehouseId: number | null
  onWarehouseId: (id: number | null) => void
  warehouseDropped?: boolean
  refreshing: boolean
  onRefresh: () => void
  lastSyncedAt: number | null
  onExport?: () => void
  exporting?: boolean
  /** The dashboard's own primary action. */
  actions?: ReactNode
  className?: string
}

export function DashboardPageHeader({
  title,
  description,
  companyName,
  fyLabel,
  branchLabel,
  asOf,
  onAsOf,
  maxDate,
  warehouses,
  warehouseId,
  onWarehouseId,
  warehouseDropped = false,
  refreshing,
  onRefresh,
  lastSyncedAt,
  onExport,
  exporting = false,
  actions,
  className,
}: DashboardPageHeaderProps) {
  const warehouseLabel =
    warehouseId === null
      ? 'All warehouses'
      : (warehouses.find((w) => w.warehouse_id === warehouseId)?.warehouse_name ?? `Warehouse ${warehouseId}`)

  return (
    <div className={cx('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold text-gray-900 md:text-2xl">{title}</h1>
          <p className="mt-0.5 text-xs text-gray-500">{description}</p>
          <p className="mt-1 truncate text-[11px] text-gray-500">
            <span className="font-semibold text-gray-600">{companyName || 'Company'}</span>
            {' · '}
            {fyLabel}
            {' · '}
            {branchLabel}
            {' · '}
            {warehouseLabel}
            {' · as at '}
            {formatDate(asOf)}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 print:hidden">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="whitespace-nowrap">As at</span>
            <input
              type="date"
              value={asOf}
              max={maxDate}
              onChange={(e) => onAsOf(e.target.value)}
              className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-900 focus:border-primary focus:outline-none"
              aria-label="Figures as at date"
            />
          </label>

          <Select
            aria-label="Warehouse"
            value={warehouseId === null ? '' : String(warehouseId)}
            onChange={(e) => onWarehouseId(e.target.value === '' ? null : Number(e.target.value))}
            className="h-8 max-w-[12rem] text-xs"
          >
            <option value="">All warehouses</option>
            {warehouses.map((w) => (
              <option key={w.warehouse_id} value={w.warehouse_id}>
                {w.warehouse_name}
              </option>
            ))}
          </Select>

          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            title="Reload every card on this dashboard"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-600 transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-60"
          >
            <RefreshCw className={cx('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden />
            <span className="hidden sm:inline">
              {refreshing ? 'Refreshing…' : `Synced ${relativeTimeFromNow(lastSyncedAt)}`}
            </span>
          </button>

          {onExport ? (
            <button
              type="button"
              onClick={onExport}
              disabled={exporting}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-semibold text-primary transition-colors hover:border-primary/40 disabled:opacity-60"
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden />
              {exporting ? 'Preparing…' : 'Export PDF'}
            </button>
          ) : null}

          {actions}
        </div>
      </div>

      {warehouseDropped ? (
        <Notice kind="warning">
          The warehouse filter was cleared: that warehouse does not belong to the branch now
          selected. Every figure below is for all warehouses in this branch.
        </Notice>
      ) : null}
    </div>
  )
}

export default DashboardPageHeader
