import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Clock, Info, Paperclip, RotateCcw } from 'lucide-react'
import { errorMessage, isAbortError } from '../../services/api'
import { pendingApi } from '../../services/stockApi'
import type { PendingRow } from '../../services/stockApi'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Spinner } from '../../ui/Spinner'
import { Textarea } from '../../ui/Textarea'
import { cx } from '../../ui/cx'
import { FormField, FormGrid } from '../../ui/shell/FormSectionCard'
import { formatDate, formatQty } from '../../utils/format'
import type { DispatchDetails, TransportDetails } from './challanMeta'
import { TRANSPORT_MODES } from './challanMeta'

// ---------------------------------------------------------------------------
// Additional details
// ---------------------------------------------------------------------------

interface AdditionalDetailsPanelProps {
  dispatch: DispatchDetails
  onChange: (patch: Partial<DispatchDetails>) => void
  returnable: boolean
  expectedReturnDate: string
  onExpectedReturnDate: (value: string) => void
  disabled?: boolean
}

/**
 * The optional header detail. Everything here is either a real column
 * (`expected_return_date`) or a field of `metadata.dispatch`, which the API
 * stores and returns verbatim — no speculative column was added for any of it.
 */
export function AdditionalDetailsPanel({ dispatch, onChange, returnable, expectedReturnDate, onExpectedReturnDate, disabled }: AdditionalDetailsPanelProps) {
  return (
    <div className="space-y-3">
      <FormGrid cols={3}>
        <FormField label="Reference no." htmlFor="dc-reference-no" hint="Your own reference for this dispatch.">
          <Input id="dc-reference-no" value={dispatch.reference_no} maxLength={64} disabled={disabled} onChange={(e) => onChange({ reference_no: e.target.value })} />
        </FormField>
        <FormField label="Customer reference / PO" htmlFor="dc-customer-ref" hint="The order or PO number the customer quotes.">
          <Input id="dc-customer-ref" value={dispatch.customer_ref} maxLength={64} disabled={disabled} onChange={(e) => onChange({ customer_ref: e.target.value })} />
        </FormField>
        <FormField label="Dispatch reason" htmlFor="dc-dispatch-reason">
          <Input id="dc-dispatch-reason" value={dispatch.dispatch_reason} maxLength={64} disabled={disabled} placeholder="e.g. Sale on approval" onChange={(e) => onChange({ dispatch_reason: e.target.value })} />
        </FormField>
        <FormField label="Contact person" htmlFor="dc-contact-person">
          <Input id="dc-contact-person" value={dispatch.contact_person} maxLength={64} disabled={disabled} onChange={(e) => onChange({ contact_person: e.target.value })} />
        </FormField>
        <FormField label="Contact phone" htmlFor="dc-contact-phone">
          <Input id="dc-contact-phone" value={dispatch.contact_phone} maxLength={32} disabled={disabled} inputMode="tel" onChange={(e) => onChange({ contact_phone: e.target.value })} />
        </FormField>
        {returnable ? (
          <FormField label="Expected return" htmlFor="dc-expected-return" hint="Stored on the document; drives the returnable challan chase.">
            <Input id="dc-expected-return" type="date" value={expectedReturnDate} disabled={disabled} onChange={(e) => onExpectedReturnDate(e.target.value)} />
          </FormField>
        ) : null}
      </FormGrid>
      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500">
        <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        Commercial terms — price, discount, tax and invoice value — belong to the Books voucher this challan is later settled by, and are deliberately not collected here.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Transport & dispatch
// ---------------------------------------------------------------------------

interface TransportPanelProps {
  transport: TransportDetails
  onChange: (patch: Partial<TransportDetails>) => void
  disabled?: boolean
}

export function TransportPanel({ transport, onChange, disabled }: TransportPanelProps) {
  return (
    <div className="space-y-3">
      <FormGrid cols={4}>
        <FormField label="Transporter" htmlFor="dc-transporter">
          <Input id="dc-transporter" value={transport.transporter_name} maxLength={80} disabled={disabled} onChange={(e) => onChange({ transporter_name: e.target.value })} />
        </FormField>
        <FormField label="Transporter ID" htmlFor="dc-transporter-id" hint="GST transporter id, where one applies.">
          <Input id="dc-transporter-id" value={transport.transporter_id} maxLength={20} disabled={disabled} onChange={(e) => onChange({ transporter_id: e.target.value })} />
        </FormField>
        <FormField label="Vehicle no." htmlFor="dc-vehicle">
          <Input id="dc-vehicle" value={transport.vehicle_no} maxLength={20} disabled={disabled} placeholder="e.g. MH12AB1234" onChange={(e) => onChange({ vehicle_no: e.target.value.toUpperCase() })} />
        </FormField>
        <FormField label="LR / RR no." htmlFor="dc-lr">
          <Input id="dc-lr" value={transport.lr_no} maxLength={40} disabled={disabled} onChange={(e) => onChange({ lr_no: e.target.value })} />
        </FormField>
        <FormField label="Dispatch date" htmlFor="dc-dispatch-date">
          <Input id="dc-dispatch-date" type="date" value={transport.dispatch_date} disabled={disabled} onChange={(e) => onChange({ dispatch_date: e.target.value })} />
        </FormField>
        <FormField label="Mode of transport" htmlFor="dc-mode">
          <Select id="dc-mode" value={transport.transport_mode} disabled={disabled} onChange={(e) => onChange({ transport_mode: e.target.value })}>
            <option value="">Not stated</option>
            {TRANSPORT_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Place of supply / destination" htmlFor="dc-place">
          <Input id="dc-place" value={transport.place_of_supply} maxLength={80} disabled={disabled} onChange={(e) => onChange({ place_of_supply: e.target.value })} />
        </FormField>
        <FormField label="Driver" htmlFor="dc-driver">
          <Input id="dc-driver" value={transport.driver_name} maxLength={64} disabled={disabled} onChange={(e) => onChange({ driver_name: e.target.value })} />
        </FormField>
        <FormField label="Driver phone" htmlFor="dc-driver-phone">
          <Input id="dc-driver-phone" value={transport.driver_phone} maxLength={32} disabled={disabled} inputMode="tel" onChange={(e) => onChange({ driver_phone: e.target.value })} />
        </FormField>
      </FormGrid>
      <FormField label="Shipping address" htmlFor="dc-ship-to" hint="Where the goods are being delivered, if it differs from the customer's registered address.">
        <Textarea id="dc-ship-to" rows={3} value={transport.shipping_address} maxLength={400} disabled={disabled} onChange={(e) => onChange({ shipping_address: e.target.value })} />
      </FormField>
      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500">
        <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        These details ride on the document as <code className="font-mono">metadata.transport</code>, the same shape a migrated Books voucher carries. Generating the e-way bill itself is not
        Inventory's — nothing here contacts the NIC portal.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

interface ReferencesPanelProps {
  partyRef: number | null
  partyName: string
  documentId: number | null
}

/**
 * The live links this challan actually has.
 *
 * A delivery challan is linked to other documents by the pending quantity it
 * opens: the Books invoice that settles it names the challan, not the other way
 * round. So this panel shows what the pending-quantity API answers rather than
 * offering a free-text "related document" field that nothing downstream reads.
 */
export function ReferencesPanel({ partyRef, partyName, documentId }: ReferencesPanelProps) {
  const [rows, setRows] = useState<PendingRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (partyRef === null && documentId === null) {
      setRows([])
      return undefined
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    pendingApi
      .list({ kind: 'challan', direction: 'out', party_ref: partyRef ?? undefined, document_id: documentId ?? undefined, limit: 100 }, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return
        setRows(res.data.filter((r) => Number(r.qty_open) > 0))
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setError(errorMessage(err, 'Could not read pending quantities.'))
        setLoading(false)
      })
    return () => controller.abort()
  }, [partyRef, documentId, tick])

  if (partyRef === null && documentId === null) {
    return (
      <EmptyState
        icon={Clock}
        size="sm"
        title="Pick a customer to see their open challans"
        description="A delivery challan is linked to its invoice through the pending quantity it opens. Once the customer is known, everything still open for them is listed here."
      />
    )
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
          <Spinner /> Reading open challans…
        </div>
      ) : error ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="min-w-0">{error}</span>
          <Button variant="secondary" size="xs" icon={RotateCcw} onClick={() => setTick((t) => t + 1)}>
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Clock}
          size="sm"
          title="Nothing open"
          description={`${partyName || 'This customer'} has no unsettled challan quantity. A link appears here once this challan is posted and until its invoice settles it.`}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-gray-50">
              <tr className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                <th scope="col" className="px-2.5 py-1.5">
                  Document
                </th>
                <th scope="col" className="px-2.5 py-1.5">
                  Item
                </th>
                <th scope="col" className="w-28 px-2.5 py-1.5">
                  Warehouse
                </th>
                <th scope="col" className="w-24 px-2.5 py-1.5 text-right">
                  Open qty
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.pending_id} className="hover:bg-gray-50">
                  <td className="px-2.5 py-1.5">
                    <Link to={`/documents/${r.document_id}`} className="font-medium text-primary no-underline hover:underline">
                      {r.document_no ?? `#${r.document_id}`}
                    </Link>
                    <span className="block text-[10px] text-gray-500">{formatDate(r.document_date)}</span>
                  </td>
                  <td className="truncate px-2.5 py-1.5 text-gray-900">{r.item_name ?? `Item #${r.item_id}`}</td>
                  <td className="truncate px-2.5 py-1.5 text-gray-600">{r.warehouse_name ?? '—'}</td>
                  <td className="px-2.5 py-1.5 text-right font-semibold tabular-nums text-gray-900">
                    {formatQty(r.qty_open)}
                    {r.unit_symbol ? <span className="ml-1 text-[10px] font-normal text-gray-500">{r.unit_symbol}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {partyRef !== null ? (
        <Link to={`/registers/pending-quantities?party_ref=${partyRef}&kind=challan&direction=out`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary no-underline hover:underline">
          Open the pending quantity register
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Attachments are not part of the Inventory API.
 *
 * There is no upload endpoint on `/api/v1/...` and no attachment table behind
 * the documents module, so this tab says so rather than offering a drop zone
 * that would either lose the file on reload or smuggle it into the document's
 * metadata as base64. When an upload endpoint ships, this panel is the only
 * thing that changes.
 */
export function AttachmentsPanel() {
  return (
    <EmptyState
      icon={Paperclip}
      size="sm"
      title="Attachments are not stored by Inventory yet"
      description="The Inventory API has no document-attachment endpoint, so nothing uploaded here could be kept. Until one exists, reference the paperwork by its number in Additional details or in the narration."
    />
  )
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

interface NotesPanelProps {
  narration: string
  onChange: (value: string) => void
  /**
   * What prints comfortably on the challan sheet. `inv_documents.narration` is
   * a TEXT column with no server-side maximum, so this is guidance shown to the
   * writer — never a cap that silently truncates what they typed.
   */
  softLimit: number
  disabled?: boolean
}

export function NotesPanel({ narration, onChange, softLimit, disabled }: NotesPanelProps) {
  const over = narration.length > softLimit
  return (
    <div className="space-y-2">
      <FormField label="Narration" htmlFor="dc-notes-narration" hint="The same narration as the box below the lines — one document, one note.">
        <Textarea
          id="dc-notes-narration"
          rows={8}
          value={narration}
          disabled={disabled}
          placeholder="Anything the stores, the driver or the customer needs to know about this dispatch…"
          onChange={(e) => onChange(e.target.value)}
        />
      </FormField>
      <div className={cx('text-right text-[11px] tabular-nums', over ? 'text-amber-600' : 'text-gray-400')}>
        {narration.length}/{softLimit}
        <span className="ml-1 text-gray-400">· guidance only, nothing is truncated</span>
      </div>
    </div>
  )
}
