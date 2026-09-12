import { FormField } from '../components/FormField'
import type { PartyRole } from './registry'

const LABELS: Record<PartyRole, string> = {
  party: 'Party',
  job_worker: 'Job worker',
  consignee: 'Consignee',
  supplier: 'Supplier',
  customer: 'Customer',
}

interface PartyFieldsProps {
  role: PartyRole
  partyRef: string
  partyName: string
  onChange: (patch: { party_ref?: string; party_name?: string }) => void
  disabled?: boolean
}

/**
 * Parties are Books ledgers; Inventory stores the ledger id (`party_ref`) and a name snapshot.
 * The id is what pending quantities and job-work settlements are matched on.
 */
export function PartyFields({ role, partyRef, partyName, onChange, disabled }: PartyFieldsProps) {
  const label = LABELS[role]
  return (
    <>
      <FormField label={`${label} name`} htmlFor="party_name">
        <input id="party_name" className="input" value={partyName} disabled={disabled} onChange={(e) => onChange({ party_name: e.target.value })} placeholder={`${label} as printed`} />
      </FormField>
      <FormField label={`${label} ledger id`} htmlFor="party_ref" help="Books account id (acc_id). Pending quantities are matched on it.">
        <input id="party_ref" className="input" inputMode="numeric" value={partyRef} disabled={disabled} onChange={(e) => onChange({ party_ref: e.target.value.replace(/[^\d]/g, '') })} placeholder="e.g. 1042" />
      </FormField>
    </>
  )
}
