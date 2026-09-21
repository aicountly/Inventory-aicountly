import { NewDocumentMenu } from '../../documents/NewDocumentMenu'
import { SavedViewsMenu } from './SavedViewsMenu'

/**
 * The movement register's own header controls, left of the engine's Columns / Export /
 * Print / Refresh row.
 *
 * `NewDocumentMenu` is the documents register's control, reused rather than reimplemented:
 * it already lists exactly the inventory document types this member may raise, links each
 * one at the form that creates it, and says so plainly when a profile may raise none. A
 * second "New document" written for this screen would be the same list drifting out of
 * step with the first, and would be the one that offers a type the API then refuses.
 */
export function MovementHeaderActions({ registerKey }: { registerKey: string }) {
  return (
    <>
      <SavedViewsMenu registerKey={registerKey} />
      <NewDocumentMenu />
    </>
  )
}

export default MovementHeaderActions
