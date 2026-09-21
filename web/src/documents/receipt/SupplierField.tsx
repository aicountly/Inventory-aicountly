import { Building2 } from 'lucide-react'
import { Input } from '../../ui/Input'
import { FormField } from '../../ui/shell/FormSectionCard'

export interface SupplierFieldProps {
  name: string
  /** Books account id (acc_id) as typed. */
  ledgerId: string
  onChange: (patch: { party_name?: string; party_ref?: string }) => void
  disabled?: boolean
  error?: string
}

/**
 * Who the goods came from.
 *
 * Two values, one field, because they are one fact: the supplier as written on
 * the challan, and — optionally — the Books ledger that supplier is accounted
 * under. Inventory does not own parties and has no party master to search:
 * `inv_documents.party_ref` holds the Books `acc_id` and `party_name` holds the
 * snapshot of the name, which is exactly what every other party-carrying
 * document in this app stores.
 *
 * Optional on a receipt, as it has always been on the server — material comes
 * into stores from a supplier, another branch or a site, and only the first of
 * those has a ledger.
 */
export function SupplierField({ name, ledgerId, onChange, disabled, error }: SupplierFieldProps) {
  return (
    <FormField
      label="Supplier"
      htmlFor="mr_party_name"
      error={error}
      hint={error ? undefined : 'As printed on the challan. The ledger id links it to Books.'}
    >
      <div className="flex items-stretch gap-1.5">
        <Input
          id="mr_party_name"
          className="flex-1 min-w-0"
          size="md"
          leadingIcon={Building2}
          value={name}
          disabled={disabled}
          maxLength={255}
          placeholder="Search or type supplier…"
          autoComplete="off"
          onChange={(e) => onChange({ party_name: e.target.value })}
        />
        {/* The width lives on the wrapper: `Input` already carries `w-full`,
            which Tailwind emits after `w-20` and would win on the element. */}
        <div className="w-20 shrink-0">
          <Input
            id="mr_party_ref"
            className="text-right"
            size="md"
            inputMode="numeric"
            value={ledgerId}
            disabled={disabled}
            invalid={Boolean(error)}
            placeholder="Ledger"
            aria-label="Books ledger id"
            title="Books account id (acc_id)"
            onChange={(e) => onChange({ party_ref: e.target.value.replace(/[^\d]/g, '') })}
          />
        </div>
      </div>
    </FormField>
  )
}

export default SupplierField
