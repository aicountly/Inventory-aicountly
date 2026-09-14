import { Navigate, useLocation } from 'react-router-dom'

/**
 * A screen that has moved into the register engine.
 *
 * The revamp replaced the plain stock, valuation and pending-quantity listings
 * rather than adding to them, so their old URLs have to keep resolving: they are
 * in bookmarks, in Books links, in printed sheets and in this app's own drill
 * targets. The query string travels with the reader — `/stock/ledger?item_id=9`
 * is a question, not just a screen — so the register opens on the same rows.
 *
 * Port of books-react-app/web/src/modules/registers/RegisterLegacyRedirect.jsx.
 */
export function LegacyRedirect({ to }: { to: string }) {
  const { search } = useLocation()
  return <Navigate to={`${to}${search}`} replace />
}

export default LegacyRedirect
