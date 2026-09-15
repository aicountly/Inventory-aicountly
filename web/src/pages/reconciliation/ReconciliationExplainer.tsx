import { Notice } from '../../components/Notice'

/**
 * What these three screens are for, on the screens themselves.
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
 */

export type ReconciliationScreen = 'runs' | 'posting-status' | 'outbox'

const WHAT: Record<ReconciliationScreen, { title: string; lead: string; means: string }> = {
  runs: {
    title: 'What a run compares',
    lead:
      'One run takes one date and compares two totals: the closing value of the stock Inventory holds, and the Stock-in-Hand balance in the Books ledger. It then explains the gap bucket by bucket — postings still pending, postings that failed, cancellations, and valuation revisions Books has not applied yet.',
    means:
      'The difference is Inventory minus Books, in rupees. Zero means the Books stock ledger agrees with the stock this app holds. A positive figure means Inventory is carrying value Books has not booked yet; a negative one means Books has booked value Inventory does not hold.',
  },
  'posting-status': {
    title: 'What posting status shows',
    lead:
      'The same question, document by document: which Books vouchers with stock lines produced an Inventory document, which Inventory documents reached Books, and which are stuck on one side.',
    means:
      'Every row that is not "In sync" is a rupee difference a run will report. Clear the failed and the missing rows first — a run cannot balance while a voucher exists on one side only.',
  },
  outbox: {
    title: 'What the outbox holds',
    lead:
      'The queue Inventory uses to tell Books what happened — postings, reversals, valuation revisions and master changes — with every delivery attempt it has made.',
    means:
      'Pending and failed events are still on their way. A dead event has used up its retries and will not move again until someone fixes the cause and replays it; until then Books is working from older figures than Inventory.',
  },
}

export function ReconciliationExplainer({ screen }: { screen: ReconciliationScreen }) {
  const copy = WHAT[screen]
  return (
    <Notice kind="info" title={copy.title}>
      <p style={{ margin: 0 }}>{copy.lead}</p>
      <p style={{ margin: '0.5rem 0 0' }}>{copy.means}</p>
      <details style={{ marginTop: '0.5rem' }}>
        <summary>Both apps use the same live API — so why can they disagree?</summary>
        <p style={{ margin: '0.5rem 0 0' }}>
          Because posting is not one transaction. Books opens its own, calls Inventory, Inventory
          commits its own, and the answer travels back. A timeout, a rejected line or a voucher
          cancelled on one side can leave the other holding something it should not.
        </p>
        <p style={{ margin: '0.5rem 0 0' }}>
          Nothing runs on a schedule here — this deployment has no background job — so anything that
          was deferred waits for the next person who works in this company. A difference is
          therefore normal until somebody clears it. These screens tell you which kind you have:
          runs compare the totals, posting status names the documents, and the outbox shows what is
          still queued or was rejected.
        </p>
      </details>
    </Notice>
  )
}

export default ReconciliationExplainer
