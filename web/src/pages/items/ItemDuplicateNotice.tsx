import { AlertTriangle, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../../ui/Badge'
import { AIC, cx } from '../../ui/cx'
import type { DuplicateMatch, DuplicateReason } from './itemDuplicates'

const REASON_LABEL: Record<DuplicateReason, string> = {
  name: 'Same name',
  sku: 'Same SKU',
  barcode: 'Same barcode',
  similar: 'Similar name',
}

export interface ItemDuplicateNoticeProps {
  matches: DuplicateMatch[]
  onDismiss: () => void
}

/**
 * "You may already have this item."
 *
 * Deliberately not a blocker and deliberately not a toast. Not a blocker because only the API
 * knows for certain and it already refuses a repeated name or SKU with a message of its own; not a
 * toast because the answer is a comparison — the reader needs the other item's name and SKU in
 * front of them, and a link to open it, which a message that disappears cannot give.
 */
export function ItemDuplicateNotice({ matches, onDismiss }: ItemDuplicateNoticeProps) {
  if (matches.length === 0) return null

  return (
    <div className={cx(AIC, 'mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3')} role="status">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <strong className="text-[0.8125rem] font-semibold text-amber-800">
            {matches.length === 1 ? 'A possible duplicate' : `${matches.length} possible duplicates`}
          </strong>
          <p className="mt-0.5 text-[11px] leading-relaxed text-amber-700">
            Nothing is blocked here — the API refuses a repeated name or SKU when you save, and says which one.
          </p>

          <ul className={cx(AIC, 'mt-2 flex list-none flex-col gap-1.5 p-0')}>
            {matches.map((match) => (
              <li
                key={`${match.reason}-${match.item.item_id}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-white px-2.5 py-1.5"
              >
                <Badge tone={match.severity === 'conflict' ? 'danger' : 'warning'}>{REASON_LABEL[match.reason]}</Badge>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-900" title={match.message}>
                  {match.item.item_name}
                </span>
                {match.item.item_sku ? (
                  <span className="truncate text-[11px] text-gray-500">{match.item.item_sku}</span>
                ) : null}
                <Link
                  to={`/items/${match.item.item_id}`}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary no-underline hover:underline"
                >
                  Open
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={onDismiss}
            className="mt-2 rounded-md text-[11px] font-semibold text-amber-800 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  )
}

export default ItemDuplicateNotice
