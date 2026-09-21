import { useMemo } from 'react'
import { useCompany } from '../company/CompanyContext'
import { useQuery } from '../hooks/useQuery'
import { settingsApi } from '../services/settingsApi'
import type { FilterOption } from '../reports/types'

/**
 * The parties a register can filter on, for the `party` filter kind.
 *
 * Inventory does not own parties. `party_ref` is an opaque Books ledger id, and
 * `party_name` is the name captured on the document when it was raised — this
 * reads those two columns back off Inventory's own documents so a register can
 * offer a list instead of asking a reader to know a ledger id. Nothing is copied,
 * synced or cached into a master here; the contract in docs/DOMAIN_OWNERSHIP.md
 * stays exactly as it was.
 *
 * The fallback when the request fails or is still in flight is an EMPTY list, not
 * an invented one — and the control falls back to accepting a typed id, so a
 * reader who knows the ledger is never blocked by a picker that has not loaded.
 */
export function usePartyOptions(): { options: FilterOption[]; loading: boolean } {
  const { scope } = useCompany()
  const { data, loading } = useQuery(
    (signal) => settingsApi.documentParties(signal),
    [scope?.cmp_id, scope?.bo_id],
    { enabled: scope !== null },
  )

  const options = useMemo<FilterOption[]>(
    () =>
      (data ?? []).map((p) => ({
        value: String(p.party_ref),
        // A document raised without a name still has a ledger behind it, and a
        // blank row in a picker is unselectable in practice.
        label: p.party_name?.trim() || `Ledger #${p.party_ref}`,
      })),
    [data],
  )

  return { options, loading }
}

export default usePartyOptions
