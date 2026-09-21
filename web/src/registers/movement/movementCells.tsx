import { ArrowRight } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { cx } from '../../ui/cx'
import type { BadgeTone } from '../../ui/Badge'
import { formatQty, humanize } from '../../utils/format'
import type { StockMovementRow } from '../../services/stockViewsApi'

/** The muted em dash every register uses for an absent value. */
const DASH = <span className="text-gray-300">—</span>

/**
 * The colour a document type is read by.
 *
 * Keyed on what the type DOES to stock rather than on its name, so a type added to
 * `DocumentTypeRegistry` later lands in the right family without a second list to
 * maintain: things arriving are green, things leaving are red, a transfer is amber
 * because it is both and neither, and corrections are violet. Anything unrecognised
 * renders neutral with its own label — a grey badge is a colour nobody has to decode,
 * which is the right failure for a type this file has not met.
 *
 * The badge never carries the status alone: the label beside the colour is the type, so
 * nothing here is communicated by colour only.
 */
const TYPE_TONES: Record<string, BadgeTone> = {
  // In
  OPENING_STOCK: 'success',
  MATERIAL_RECEIPT: 'success',
  PURCHASE_RECEIPT: 'success',
  INWARD_CHALLAN: 'success',
  SALES_RETURN: 'success',
  WRITE_IN: 'violet',
  JOB_WORK_IN: 'success',
  // Out
  MATERIAL_ISSUE: 'danger',
  SALES_ISSUE: 'danger',
  CONSUMPTION: 'warning',
  PURCHASE_RETURN: 'danger',
  DELIVERY_CHALLAN: 'info',
  WRITE_OFF: 'danger',
  JOB_WORK_OUT: 'warning',
  // Both ends
  STOCK_TRANSFER: 'warning',
  PRODUCTION: 'info',
  ASSEMBLY: 'info',
  DISASSEMBLY: 'info',
  PACKING: 'neutral',
  // Corrections and control
  STOCK_JOURNAL: 'violet',
  PHYSICAL_ADJUSTMENT: 'violet',
  BATCH_ADJUSTMENT: 'violet',
  SERIAL_ADJUSTMENT: 'violet',
  JOURNAL_ADJUSTMENT: 'violet',
  REVALUATION: 'indigo',
  LANDED_COST: 'indigo',
  RESERVATION: 'neutral',
  RESERVATION_RELEASE: 'neutral',
}

export function documentTypeTone(code: string | null | undefined): BadgeTone {
  return TYPE_TONES[String(code ?? '').toUpperCase()] ?? 'neutral'
}

/** The document type, as a badge. The label is the API's, never one invented here. */
export function MovementTypeBadge({ row }: { row: StockMovementRow }) {
  const label = row.document_type_label ?? humanize(row.document_type)
  if (!label) return DASH
  return (
    <Badge tone={documentTypeTone(row.document_type)} size="xs">
      {label}
    </Badge>
  )
}

/**
 * Which product raised the movement, and under what reference.
 *
 * `source_app` is the other Aicountly product that posted it — Books, POS — and is absent
 * on a document raised in Inventory itself, which is a fact worth showing rather than a
 * gap: "Inventory" is where the reader should look for it.
 */
export function MovementSourceBadge({ row }: { row: StockMovementRow }) {
  const app = row.source_app?.trim()
  const reference = row.source_document_no?.trim()
  if (!app) {
    return (
      <Badge tone="neutral" size="xs">
        Inventory
      </Badge>
    )
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Badge tone="info" size="xs">
        {humanize(app)}
      </Badge>
      {reference ? <span className="truncate text-gray-500">{reference}</span> : null}
    </span>
  )
}

/**
 * Where the movement happened, and — on a transfer — where the goods were going.
 *
 * A movement row stands in exactly one warehouse, because one warehouse is what it
 * changed; a transfer is two rows, one out of the source and one into the destination.
 * Showing only the row's own warehouse on a transfer leaves the reader unable to tell the
 * two halves apart, so the document's other end is named beside it, with the row's own
 * side carrying the weight. The arrow always points source → destination, whichever half
 * of the pair the row is.
 */
export function MovementWarehouseCell({ row }: { row: StockMovementRow }) {
  const own = row.warehouse_name
  const from = row.from_warehouse_name
  const to = row.to_warehouse_name
  const isTransfer = Boolean(from && to && row.from_warehouse_id !== row.to_warehouse_id)

  if (!isTransfer) return own ? <span className="truncate">{own}</span> : DASH

  const ownIsSource = row.warehouse_id === row.from_warehouse_id
  const ownIsTarget = row.warehouse_id === row.to_warehouse_id
  return (
    // Both ends truncate rather than forcing the column wide: on a grid of eleven columns
    // one long pair of warehouse names would push Source off the screen for every row.
    // The full pair is in the title, which is where a reader checks an abbreviated name.
    <span className="flex min-w-0 items-center gap-1" title={`${from} → ${to}`}>
      <span className={cx('truncate', ownIsSource ? 'font-medium text-gray-900' : 'text-gray-400')}>
        {from}
      </span>
      <ArrowRight className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />
      <span className={cx('truncate', ownIsTarget ? 'font-medium text-gray-900' : 'text-gray-400')}>
        {to}
      </span>
    </span>
  )
}

/** Plain text of the same cell, for the CSV and the printed sheet. */
export function warehouseCsv(row: StockMovementRow): string {
  const from = row.from_warehouse_name
  const to = row.to_warehouse_name
  if (from && to && row.from_warehouse_id !== row.to_warehouse_id) return `${from} -> ${to}`
  return row.warehouse_name ?? ''
}

/**
 * Inward and outward as two columns, from the one signed quantity the row carries.
 *
 * Derived, not fetched: `qty` is signed in the database and the sign IS the direction, so
 * splitting it here is a rendering of the stored figure rather than a second version of
 * it. The empty side shows a dash — a zero in both columns of every row would be a grid
 * of noughts with the answer hidden among them.
 */
export function MovementQtyCell({ row, side }: { row: StockMovementRow; side: 'in' | 'out' }) {
  const qty = Number(row.qty) || 0
  const mine = side === 'in' ? qty >= 0 : qty < 0
  if (!mine || qty === 0) return DASH
  return (
    <strong className={side === 'in' ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
      {formatQty(Math.abs(qty))}
      {row.unit_symbol ? <span className="ml-1 font-normal text-gray-400">{row.unit_symbol}</span> : null}
    </strong>
  )
}

/** The numeric half of the same cell, for the CSV. */
export function movementQtyCsv(row: StockMovementRow, side: 'in' | 'out'): number | '' {
  const qty = Number(row.qty) || 0
  if (qty === 0) return ''
  if (side === 'in') return qty > 0 ? qty : ''
  return qty < 0 ? -qty : ''
}
