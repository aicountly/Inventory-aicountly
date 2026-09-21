import { AlertTriangle, CheckCircle2, EyeOff, Info, PackageSearch } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '../../ui/Card'
import { IconTile } from '../../ui/IconTile'
import { Skeleton } from '../../ui/Skeleton'
import { Tooltip } from '../../ui/Tooltip'
import { cx } from '../../ui/cx'
import { formatInt, formatQty } from '../../utils/format'
import { formatEstimate } from './transferModel'
import type { TransferIssue, TransferTotals } from './transferModel'

export interface TransferSummaryCardProps {
  totals: TransferTotals
  currencyCode: string | null
  /** False when the profile may not read stock valuation. */
  valuationPermitted: boolean
  valuationLoading: boolean
  issues: readonly TransferIssue[]
  fromWarehouseName: string
  toWarehouseName: string
  loading?: boolean
  className?: string
}

interface Panel {
  tone: 'success' | 'warning' | 'danger' | 'info'
  icon: LucideIcon
  title: string
  body: string
  detail?: readonly string[]
}

const PANEL_TONE: Record<Panel['tone'], { box: string; icon: string; title: string }> = {
  success: { box: 'bg-emerald-50 border-emerald-100', icon: 'bg-emerald-500 text-white', title: 'text-emerald-800' },
  warning: { box: 'bg-amber-50 border-amber-100', icon: 'bg-amber-500 text-white', title: 'text-amber-800' },
  danger: { box: 'bg-red-50 border-red-100', icon: 'bg-red-500 text-white', title: 'text-red-800' },
  info: { box: 'bg-sky-50 border-sky-100', icon: 'bg-sky-500 text-white', title: 'text-sky-800' },
}

const MAX_DETAIL = 3

/**
 * What this transfer will do, said plainly and kept true.
 *
 * The status panel deliberately does NOT promise a reservation. A stock
 * transfer in this system takes nothing out of the source warehouse when the
 * draft is saved: RESERVATION is its own document type, and the transfer's
 * quantities move only when DocumentPostingService posts it. Saying "stock will
 * be reserved on save" would read well and be false, and an operator who
 * believed it would leave a warehouse promising stock it had not held back.
 */
export function TransferSummaryCard({
  totals,
  currencyCode,
  valuationPermitted,
  valuationLoading,
  issues,
  fromWarehouseName,
  toWarehouseName,
  loading = false,
  className,
}: TransferSummaryCardProps) {
  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')
  const route = fromWarehouseName && toWarehouseName ? `${fromWarehouseName} → ${toWarehouseName}` : null

  const panel: Panel =
    errors.length > 0
      ? {
          tone: 'danger',
          icon: AlertTriangle,
          title: errors.length === 1 ? '1 issue to fix' : `${errors.length} issues to fix`,
          body: 'This transfer cannot be posted until these are resolved.',
          detail: errors.slice(0, MAX_DETAIL).map((e) => e.message),
        }
      : warnings.length > 0
        ? {
            tone: 'warning',
            icon: AlertTriangle,
            title: warnings.length === 1 ? '1 thing to look at' : `${warnings.length} things to look at`,
            body: 'None of these stop the post — the server decides on stock when it runs.',
            detail: warnings.slice(0, MAX_DETAIL).map((w) => w.message),
          }
        : totals.items === 0
          ? {
              tone: 'info',
              icon: PackageSearch,
              title: 'Nothing to move yet',
              body: 'Add the items being transferred and their quantities to see what this will do.',
            }
          : {
              tone: 'success',
              icon: CheckCircle2,
              title: 'Stock moves when this is posted',
              body: route
                ? `Quantities leave ${fromWarehouseName} and arrive at ${toWarehouseName} the moment this transfer posts. Saving a draft moves nothing and holds nothing back.`
                : 'Quantities move out of the source warehouse and into the destination the moment this transfer posts. Saving a draft moves nothing and holds nothing back.',
            }

  const tone = PANEL_TONE[panel.tone]
  const PanelIcon = panel.icon

  return (
    <Card padding="md" className={cx('overflow-hidden', className)}>
      <div className="mb-4 flex items-center gap-2.5">
        <IconTile icon={PackageSearch} tone="primary" size="sm" />
        <h2 className="text-sm font-semibold text-gray-900">Transfer Summary</h2>
      </div>

      <dl className="space-y-3.5">
        <Row label="Total Items" value={loading ? null : formatInt(totals.items)} />
        <Row label="Total Quantity" value={loading ? null : formatQty(totals.quantity, '0')} />
        <Row
          label="Total Value (Estimated)"
          hint={
            valuationPermitted
              ? 'Quantity × the current inventory unit cost. The valuation engine prices the movement layer by layer when it posts.'
              : undefined
          }
          value={
            loading || valuationLoading ? null : !valuationPermitted ? (
              <Tooltip label="Stock valuation is not part of your access profile.">
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-400">
                  <EyeOff className="h-3.5 w-3.5" aria-hidden />
                  Not available
                </span>
              </Tooltip>
            ) : totals.value === null ? (
              <span className="text-xs font-medium text-gray-400">—</span>
            ) : (
              formatEstimate(totals.value, currencyCode)
            )
          }
        />
      </dl>

      {valuationPermitted && totals.value !== null && totals.valuedLines < totals.items ? (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-gray-500">
          <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span>
            {totals.items - totals.valuedLines} of {totals.items} lines have no cost on record yet and are not in this
            estimate.
          </span>
        </p>
      ) : null}

      <div className={cx('mt-4 flex gap-2.5 rounded-xl border p-3', tone.box)}>
        <span className={cx('mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full', tone.icon)} aria-hidden>
          <PanelIcon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <strong className={cx('block text-xs font-semibold', tone.title)}>{panel.title}</strong>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-600">{panel.body}</p>
          {panel.detail?.length ? (
            <ul className="mt-1.5 space-y-1 text-[11px] leading-snug text-gray-600">
              {panel.detail.map((line) => (
                <li key={line} className="flex gap-1.5">
                  <span aria-hidden className="text-gray-400">
                    •
                  </span>
                  <span className="min-w-0">{line}</span>
                </li>
              ))}
              {(panel.tone === 'danger' ? errors.length : warnings.length) > MAX_DETAIL ? (
                <li className="text-gray-400">
                  and {(panel.tone === 'danger' ? errors.length : warnings.length) - MAX_DETAIL} more
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      </div>
    </Card>
  )
}

function Row({ label, value, hint }: { label: string; value: ReactNode | null; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-gray-500">
        {hint ? (
          <Tooltip label={hint}>
            <span className="cursor-help border-b border-dashed border-gray-300">{label}</span>
          </Tooltip>
        ) : (
          label
        )}
      </dt>
      <dd className="m-0 text-right text-sm font-bold tabular-nums text-gray-900">
        {value === null ? <Skeleton className="ml-auto h-4 w-16" rounded="md" /> : value}
      </dd>
    </div>
  )
}
