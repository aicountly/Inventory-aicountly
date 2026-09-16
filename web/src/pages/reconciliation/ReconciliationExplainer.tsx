import { useState } from 'react'
import { ChevronDown, ChevronRight, Info } from 'lucide-react'
import { cx } from '../../ui/cx'

/**
 * What these screens are for, on the screens themselves.
 *
 * Both apps now read and write the same live Inventory API, which makes the
 * obvious question "then what is left to reconcile?" — and a screen that cannot
 * answer it in its own words is a screen people stop trusting. The answer is
 * that a posting is not one transaction: Books opens its own, calls Inventory,
 * Inventory commits its own, and the result travels back. Anything that breaks
 * in between leaves one side holding a document the other does not have. There
 * is no scheduled job in this deployment, so deferred work waits for the next
 * person who opens the company, and a gap can stand for days without anything
 * being wrong with either app.
 *
 * Kept as UI text rather than a comment on purpose: the reader who needs it is
 * the one looking at a difference, not the one reading this file.
 *
 * Compact by design. The old full-height blue block pushed the figures below
 * the fold on a laptop, and a panel people scroll past every day is a panel
 * nobody reads. The one sentence that decides what a number MEANS stays
 * visible; the reasoning behind it is one click away.
 */

export type ReconciliationScreen = 'runs' | 'posting-status' | 'outbox'

const WHAT: Record<ReconciliationScreen, { title: string; gist: string; lead: string; means: string }> = {
  runs: {
    title: 'How reconciliation works',
    gist: 'Difference = Inventory − Books. Zero means the two sides agree at that date.',
    lead:
      "One run takes one date and compares two totals: the closing value of the stock Inventory holds, and the Stock-in-Hand balance in the Books ledger. It then explains the gap bucket by bucket — postings still pending, postings that failed, cancellations, and valuation revisions Books has not applied yet.",
    means:
      'The difference is Inventory minus Books, in rupees. Zero means the Books stock ledger agrees with the stock this app holds. A positive figure means Inventory is carrying value Books has not booked yet; a negative one means Books has booked value Inventory does not hold.',
  },
  'posting-status': {
    title: 'How pending adjustments work',
    gist: 'Every row that is not "In sync" is a rupee difference a run will report.',
    lead:
      'The same question, document by document: which Books vouchers with stock lines produced an Inventory document, which Inventory documents reached Books, and which are stuck on one side.',
    means:
      'Every row that is not "In sync" is a rupee difference a run will report. Clear the failed and the missing rows first — a run cannot balance while a voucher exists on one side only.',
  },
  outbox: {
    title: 'How the audit trail works',
    gist: 'Pending and failed events are still on their way to Books; a dead one has stopped trying.',
    lead:
      'The queue Inventory uses to tell Books what happened — postings, reversals, valuation revisions and master changes — with every delivery attempt it has made.',
    means:
      'Pending and failed events are still on their way. A dead event has used up its retries and will not move again until someone fixes the cause and replays it; until then Books is working from older figures than Inventory.',
  },
}

export function ReconciliationExplainer({
  screen,
  className,
}: {
  screen: ReconciliationScreen
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const copy = WHAT[screen]
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <section className={cx('aic rounded-xl border border-sky-100 bg-sky-50/60 print:bg-white', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Info className="h-4 w-4 shrink-0 text-sky-600" aria-hidden />
        <span className="text-[13px] font-semibold text-gray-800">{copy.title}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-gray-600">{copy.gist}</span>
        <Chevron className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
      </button>

      {open ? (
        <div className="space-y-2 border-t border-sky-100 px-3 py-2.5 text-xs leading-relaxed text-gray-600">
          <p className="m-0">{copy.lead}</p>
          <p className="m-0">{copy.means}</p>
          <p className="m-0">
            Both apps use the same live API, and they can still disagree, because posting is not one
            transaction. Books opens its own, calls Inventory, Inventory commits its own, and the answer
            travels back. A timeout, a rejected line or a voucher cancelled on one side can leave the
            other holding something it should not.
          </p>
          <p className="m-0">
            Nothing runs on a schedule here — this deployment has no background job — so anything that was
            deferred waits for the next person who works in this company. A difference is therefore normal
            until somebody clears it, and it is cleared by finishing the postings in these screens. Neither
            app ever copies the other's tables: Inventory owns the stock and its valuation, Books owns the
            ledger, and they only ever talk over the API.
          </p>
        </div>
      ) : null}
    </section>
  )
}

export default ReconciliationExplainer
