/**
 * Aicountly AI — reading a supplier's challan or invoice into a draft GRN.
 *
 * The contract, deliberately narrow: a file goes up, a *suggestion* comes back. Nothing here
 * posts stock, nothing here saves a document, and the caller must put every extracted value in
 * front of the user for approval before it reaches the form (see `AiExtractionReview`). An
 * extraction is evidence, not an instruction.
 *
 * TODO(ai-extraction): implement `POST /v1/ai/document-extraction` in server-php. The body below
 * is the whole contract — base64 rather than multipart because the shared API client
 * (`services/api.ts`) speaks JSON, carries the bearer session and injects the company scope, and
 * a second transport for one endpoint would have to re-implement all three. Until the route
 * exists this resolves to `{ available: false }` and the panel says so instead of pretending.
 */

import { api } from './api'
import type { ItemResponse } from './api'
import { relayCall } from './crossProduct'
import type { RelayResult } from './crossProduct'
import { toNumber } from '../utils/format'

/** What the uploader accepts. Enforced here as well as on the input's `accept`. */
export const ACCEPTED_UPLOAD_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const
export const ACCEPTED_UPLOAD_LABEL = 'PDF, JPG, PNG'
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export interface ExtractedSupplier {
  party_ref: number | null
  party_name: string | null
  gstin: string | null
}

export interface ExtractedLine {
  /** Set when the extractor matched the description to an Inventory item. */
  item_id: number | null
  item_name: string
  item_sku: string | null
  barcode: string | null
  batch_no: string | null
  expiry_date: string | null
  unit_symbol: string | null
  qty: number | null
  rate: number | null
  serials: string[]
  /** 0–1. Null when the extractor does not score lines. */
  confidence: number | null
}

export interface GrnExtraction {
  supplier: ExtractedSupplier | null
  /** Supplier challan / invoice number → the document's Reference. */
  reference: string | null
  document_date: string | null
  purchase_order_no: string | null
  warehouse_id: number | null
  lines: ExtractedLine[]
  /** Anything the extractor wants the user to look at. */
  notes: string[]
  confidence: number | null
}

export class UploadRejected extends Error {}

/** Reject an unusable file before it is read, with a message the panel can print as-is. */
export function validateUpload(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${file.name} is larger than ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`
  }
  if (file.size === 0) return `${file.name} is empty.`
  const type = (file.type || '').toLowerCase()
  if (type && !ACCEPTED_UPLOAD_TYPES.includes(type as (typeof ACCEPTED_UPLOAD_TYPES)[number])) {
    return `${file.name} is a ${type} file. Upload a ${ACCEPTED_UPLOAD_LABEL} file.`
  }
  if (!type && !/\.(pdf|jpe?g|png)$/i.test(file.name)) {
    return `${file.name} is not a ${ACCEPTED_UPLOAD_LABEL} file.`
  }
  return null
}

/** The payload bytes, base64 without the `data:` prefix. */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new UploadRejected(`Could not read ${file.name}.`))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

function isoDate(value: unknown): string | null {
  const s = str(value)
  if (!s) return null
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

/** Normalise the extractor's answer. Everything is optional; nothing here may throw on a gap. */
export function normaliseExtraction(raw: unknown): GrnExtraction {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const supplierRaw = (body.supplier && typeof body.supplier === 'object' ? body.supplier : null) as Record<string, unknown> | null
  const linesRaw = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]) : []
  return {
    supplier: supplierRaw
      ? {
          party_ref: toNumber(supplierRaw.party_ref ?? supplierRaw.acc_id),
          party_name: str(supplierRaw.party_name ?? supplierRaw.acc_name ?? supplierRaw.name),
          gstin: str(supplierRaw.gstin ?? supplierRaw.gst_no),
        }
      : null,
    reference: str(body.reference ?? body.supplier_challan_no ?? body.invoice_no),
    document_date: isoDate(body.document_date ?? body.date),
    purchase_order_no: str(body.purchase_order_no ?? body.po_no),
    warehouse_id: toNumber(body.warehouse_id),
    lines: linesRaw.map<ExtractedLine>((l) => ({
      item_id: toNumber(l.item_id),
      item_name: str(l.item_name ?? l.description) ?? 'Unnamed line',
      item_sku: str(l.item_sku ?? l.sku),
      barcode: str(l.barcode ?? l.item_upc),
      batch_no: str(l.batch_no ?? l.batch),
      expiry_date: isoDate(l.expiry_date),
      unit_symbol: str(l.unit_symbol ?? l.unit),
      qty: toNumber(l.qty ?? l.quantity),
      rate: toNumber(l.rate ?? l.price),
      serials: Array.isArray(l.serials) ? l.serials.map((s) => String(s).trim()).filter(Boolean) : [],
      confidence: toNumber(l.confidence),
    })),
    notes: Array.isArray(body.notes) ? body.notes.map((n) => String(n)).filter(Boolean) : [],
    confidence: toNumber(body.confidence),
  }
}

export const aiDocumentApi = {
  /**
   * Read a supplier challan / invoice into a GRN suggestion.
   *
   * Resolves to `{ available: false }` when the extraction service is not wired up for this
   * deployment; throws only on a genuine failure of a service that IS there.
   */
  async extractGrn(file: File, signal?: AbortSignal): Promise<RelayResult<GrnExtraction>> {
    const rejection = validateUpload(file)
    if (rejection) throw new UploadRejected(rejection)
    const content = await readFileAsBase64(file)
    const result = await relayCall(
      () =>
        api.post<ItemResponse<unknown>>(
          'v1/ai/document-extraction',
          {
            document_kind: 'inward_challan',
            file_name: file.name,
            mime_type: file.type || 'application/octet-stream',
            size_bytes: file.size,
            content_base64: content,
          },
          { signal, timeoutMs: 120_000 },
        ),
      'Aicountly AI document extraction',
    )
    if (!result.available) return result
    return { available: true, data: normaliseExtraction(result.data?.data) }
  },
}
