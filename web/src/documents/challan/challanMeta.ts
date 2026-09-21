/**
 * The optional header detail a delivery challan carries beyond its own columns.
 *
 * `inv_documents.metadata_json` is a free-form JSON column that DocumentService
 * stores verbatim (`metadata_json => json_encode($p['metadata'])`) and hands
 * back decoded, and `metadata.transport` is already the shape the Books
 * migration writes a voucher's `transport_json` into
 * (Services\Migration\Migrator). Nothing here invents a database column: these
 * are two namespaced objects inside metadata that the document round-trips.
 *
 * Everything is pure so the round-trip is unit-tested, and blank fields are
 * dropped rather than stored as empty strings — a challan with no transporter
 * should carry no transport object at all.
 */

import type { DocumentMetadata } from '../types'

export interface TransportDetails {
  transporter_name: string
  transporter_id: string
  vehicle_no: string
  lr_no: string
  dispatch_date: string
  transport_mode: string
  place_of_supply: string
  driver_name: string
  driver_phone: string
  shipping_address: string
}

export interface DispatchDetails {
  reference_no: string
  customer_ref: string
  dispatch_reason: string
  contact_person: string
  contact_phone: string
}

export const TRANSPORT_FIELDS: readonly (keyof TransportDetails)[] = [
  'transporter_name',
  'transporter_id',
  'vehicle_no',
  'lr_no',
  'dispatch_date',
  'transport_mode',
  'place_of_supply',
  'driver_name',
  'driver_phone',
  'shipping_address',
]

export const DISPATCH_FIELDS: readonly (keyof DispatchDetails)[] = [
  'reference_no',
  'customer_ref',
  'dispatch_reason',
  'contact_person',
  'contact_phone',
]

/**
 * Modes of transport as the e-way bill declares them. The list is fixed by that
 * form, not by anything Inventory decides, and it is stored as the plain word —
 * no code Inventory would then have to be the registry for.
 */
export const TRANSPORT_MODES = ['Road', 'Rail', 'Air', 'Ship', 'Courier', 'Hand delivery'] as const

export const EMPTY_TRANSPORT: TransportDetails = {
  transporter_name: '',
  transporter_id: '',
  vehicle_no: '',
  lr_no: '',
  dispatch_date: '',
  transport_mode: '',
  place_of_supply: '',
  driver_name: '',
  driver_phone: '',
  shipping_address: '',
}

export const EMPTY_DISPATCH: DispatchDetails = {
  reference_no: '',
  customer_ref: '',
  dispatch_reason: '',
  contact_person: '',
  contact_phone: '',
}

function readString(source: unknown, key: string): string {
  if (!source || typeof source !== 'object') return ''
  const value = (source as Record<string, unknown>)[key]
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function pick<T extends object>(source: unknown, fields: readonly (keyof T & string)[], empty: T): T {
  const out: T = { ...empty }
  for (const field of fields) {
    out[field] = readString(source, field) as T[typeof field]
  }
  return out
}

/** Transport block of a stored document, with every field present as a string. */
export function transportFrom(metadata: DocumentMetadata | null | undefined): TransportDetails {
  return pick(metadata?.transport, TRANSPORT_FIELDS, EMPTY_TRANSPORT)
}

/** Dispatch / reference block of a stored document. */
export function dispatchFrom(metadata: DocumentMetadata | null | undefined): DispatchDetails {
  return pick(metadata?.dispatch, DISPATCH_FIELDS, EMPTY_DISPATCH)
}

function compact(values: object): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (trimmed !== '') out[key] = trimmed
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Put both blocks back into metadata. An all-blank block is removed rather than
 * stored empty, so `toPayload`'s own `cleanMetadata` has nothing left to strip
 * and a challan without transport details carries no `transport` key at all.
 */
export function withHeaderDetails(
  metadata: DocumentMetadata,
  details: { transport?: TransportDetails; dispatch?: DispatchDetails },
): DocumentMetadata {
  const next: DocumentMetadata = { ...metadata }
  if (details.transport) {
    const transport = compact(details.transport)
    if (transport) next.transport = transport
    else delete next.transport
  }
  if (details.dispatch) {
    const dispatch = compact(details.dispatch)
    if (dispatch) next.dispatch = dispatch
    else delete next.dispatch
  }
  return next
}

/** How many of a block's fields are filled — drives the tab's "3" chip. */
export function filledCount(values: object): number {
  return Object.values(values).filter((v) => typeof v === 'string' && v.trim() !== '').length
}

/** True when nothing at all identifies how the goods travel. */
export function transportIsEmpty(transport: TransportDetails): boolean {
  return filledCount(transport) === 0
}
