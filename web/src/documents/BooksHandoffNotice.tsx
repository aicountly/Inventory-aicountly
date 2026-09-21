import { Notice } from '../components/Notice'
import type { BooksHandoffBlock } from './booksHandoff'
import { BOOKS_UNRESOLVED } from './booksHandoff'

/**
 * The banner shown when posting was refused because the books would not (or could not) take
 * the accounting entry.
 *
 * It says the availability cost out loud — "Inventory does not post stock while the books are
 * unavailable" — because a refusal with no reason is indistinguishable from a bug, and the
 * person in front of it will retry, re-enter the document, or work around it.
 */
export function BooksHandoffNotice({ block }: { block: BooksHandoffBlock }) {
  const unresolved = block.kind === BOOKS_UNRESOLVED
  return (
    <Notice kind={unresolved ? 'error' : 'warning'} title={block.title}>
      <p>{block.message}</p>
      {block.booksError ? (
        <p className="hint">
          Reported by the books: <span className="mono">{block.booksError}</span>
        </p>
      ) : null}
      <p className="hint">{block.advice}</p>
      {unresolved && block.handoffId ? <p className="hint">Repair reference: handoff #{block.handoffId}.</p> : null}
    </Notice>
  )
}
