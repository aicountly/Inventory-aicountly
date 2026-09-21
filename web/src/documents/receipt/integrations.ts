/**
 * The three things the Material Receipt screen wants from outside Inventory's
 * own database, each behind an adapter and a flag.
 *
 * ## The rule these obey
 *
 * Aicountly products keep one source of truth each and read each other's data
 * over live APIs (docs/DOMAIN_OWNERSHIP.md). Purchase orders belong to
 * Purchases, invoice text extraction is an AI service, and a stored file
 * belongs to the document vault. None of them is copied into inv_* tables, none
 * is synchronised by a cron, and nothing here writes to another product's
 * database.
 *
 * ## Why they are flagged off
 *
 * Inventory's API has no relay for any of the three yet. Rather than fake the
 * data — a mocked purchase order would be indistinguishable from a real one on
 * screen and would post real stock against an order nobody raised — each
 * adapter declares itself unavailable, the button that opens it stays VISIBLE
 * and DISABLED with the reason on it (the same choice the document entry hub
 * makes for a type your profile cannot raise), and the workflow behind it is
 * built and ready for the day the relay ships.
 *
 * ## Wiring one up
 *
 * 1. Add the relay to server-php (`app/Config/Routes.php` + a controller that
 *    calls the owning product with the service key, exactly as
 *    ManageProxyController does for Manage).
 * 2. Set the matching VITE_FEATURE_* to 1 for the environment.
 * The request shapes below are the contract; nothing else on the screen needs
 * to change.
 */

import { api } from '../../services/api'
import type { ItemResponse, ListResponse } from '../../services/api'
import { isOn } from '../../utils/format'

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export interface IntegrationStatus {
  available: boolean
  /** Shown on the disabled control. Null when it is available. */
  reason: string | null
}

function status(flag: string | undefined, reason: string): IntegrationStatus {
  return isOn(flag) ? { available: true, reason: null } : { available: false, reason }
}

export function purchaseOrdersStatus(): IntegrationStatus {
  return status(
    import.meta.env.VITE_FEATURE_RECEIPT_PURCHASE_ORDERS,
    'Purchase orders are not connected in this environment yet. Add the item lines by hand, or paste them in with Add multiple items.',
  )
}

export function aiAutofillStatus(): IntegrationStatus {
  return status(
    import.meta.env.VITE_FEATURE_RECEIPT_AI_AUTOFILL,
    'Invoice reading is not switched on in this environment yet.',
  )
}

export function attachmentsStatus(): IntegrationStatus {
  return status(
    import.meta.env.VITE_FEATURE_RECEIPT_ATTACHMENTS,
    'Attachments are not switched on in this environment yet. Record the supplier document in Reference no. instead.',
  )
}

/** Thrown when a workflow is opened without its endpoint — never shown raw. */
export class IntegrationUnavailableError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'IntegrationUnavailableError'
  }
}

function assertAvailable(s: IntegrationStatus): void {
  if (!s.available) throw new IntegrationUnavailableError(s.reason ?? 'This feature is not available yet.')
}

// ---------------------------------------------------------------------------
// Purchase orders (Purchases owns them; Inventory only reads)
// ---------------------------------------------------------------------------

export interface PurchaseOrderSummary {
  /** The id in Purchases. Inventory stores it as a reference, never as a row. */
  po_id: number | string
  po_no: string
  po_date: string | null
  supplier_ref: number | null
  supplier_name: string | null
  status: string | null
  currency_code?: string | null
  ordered_amount?: number | null
  /** Lines still awaiting receipt. */
  pending_lines?: number | null
}

export interface PurchaseOrderReceivableLine {
  po_line_id: number | string
  /** Resolved to an Inventory item by the relay; null when the item is unknown here. */
  item_id: number | null
  item_name: string | null
  item_sku: string | null
  unit_id: number | null
  unit_symbol: string | null
  warehouse_id?: number | null
  ordered_qty: number
  received_qty: number
  pending_qty: number
  rate: number | null
}

export interface PurchaseOrderReceivable {
  order: PurchaseOrderSummary
  lines: PurchaseOrderReceivableLine[]
}

/**
 * `GET /v1/purchases/purchase-orders` and
 * `GET /v1/purchases/purchase-orders/{id}/receivable` — an Inventory relay that
 * forwards to Purchases with the service key, the way `/v1/manage/...` already
 * relays to Manage. Read-only: Inventory never writes a purchase order.
 */
export const purchaseOrdersApi = {
  status: purchaseOrdersStatus,

  async search(q: string, options: { supplierRef?: number | null; limit?: number; signal?: AbortSignal } = {}): Promise<PurchaseOrderSummary[]> {
    assertAvailable(purchaseOrdersStatus())
    const res = await api.list<PurchaseOrderSummary>(
      'v1/purchases/purchase-orders',
      { q, limit: options.limit ?? 20, status: 'open', supplier_ref: options.supplierRef ?? undefined },
      { signal: options.signal },
    )
    return res.data
  },

  async receivable(poId: number | string, signal?: AbortSignal): Promise<PurchaseOrderReceivable> {
    assertAvailable(purchaseOrdersStatus())
    const res = await api.get<ItemResponse<PurchaseOrderReceivable>>(
      `v1/purchases/purchase-orders/${encodeURIComponent(String(poId))}/receivable`,
      { signal },
    )
    return res.data
  },
}

// ---------------------------------------------------------------------------
// AI invoice reading
// ---------------------------------------------------------------------------

export interface ExtractedLine {
  item_id: number | null
  item_name: string | null
  item_sku: string | null
  batch_no?: string | null
  unit_id?: number | null
  unit_symbol?: string | null
  qty: number | null
  rate: number | null
  /** 0..1 — how sure the reader is about THIS line. */
  confidence?: number | null
}

export interface ExtractedReceipt {
  supplier_name?: string | null
  supplier_ref?: number | null
  reference_no?: string | null
  reference_date?: string | null
  document_date?: string | null
  transporter_name?: string | null
  vehicle_no?: string | null
  lines: ExtractedLine[]
  /** 0..1 over the whole document. */
  confidence?: number | null
  /** Anything the reader could not resolve — shown before the user accepts. */
  warnings?: string[]
}

/**
 * `POST /v1/ai/invoice-extract` (multipart: `file`) — reads a supplier invoice
 * or challan and PROPOSES field values.
 *
 * It never saves and never posts. The proposal is shown for confirmation and
 * the user applies it, which is the whole point: an inventory document that
 * moves real stock at a real cost is not something a reader gets to decide.
 */
export const aiInvoiceApi = {
  status: aiAutofillStatus,

  async extract(file: File, signal?: AbortSignal): Promise<ExtractedReceipt> {
    assertAvailable(aiAutofillStatus())
    const form = new FormData()
    form.append('file', file)
    form.append('document_type', 'MATERIAL_RECEIPT')
    const res = await api.upload<ItemResponse<ExtractedReceipt>>('v1/ai/invoice-extract', form, { signal, timeoutMs: 90_000 })
    return res.data
  },
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export interface ReceiptAttachment {
  attachment_id: number | string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  created_at?: string | null
  /** Short-lived, signed by the API. Absent while the upload is in flight. */
  url?: string | null
}

/**
 * `/v1/inventory-documents/{id}/attachments` — the supplier invoice, challan
 * and quality report kept with the document.
 *
 * The bytes belong to the Aicountly document vault, not to inv_*: the relay
 * stores them there and keeps the reference. Which is also why a draft has to
 * exist before a file can be attached — a file with no document to hang on is
 * an orphan the vault can never clean up.
 */
export const receiptAttachmentsApi = {
  status: attachmentsStatus,

  async list(documentId: number, signal?: AbortSignal): Promise<ReceiptAttachment[]> {
    assertAvailable(attachmentsStatus())
    const res = await api.get<ListResponse<ReceiptAttachment>>(`v1/inventory-documents/${documentId}/attachments`, { signal })
    return res.data
  },

  async upload(documentId: number, file: File, signal?: AbortSignal): Promise<ReceiptAttachment> {
    assertAvailable(attachmentsStatus())
    const form = new FormData()
    form.append('file', file)
    const res = await api.upload<ItemResponse<ReceiptAttachment>>(`v1/inventory-documents/${documentId}/attachments`, form, { signal, timeoutMs: 120_000 })
    return res.data
  },

  async remove(documentId: number, attachmentId: number | string): Promise<void> {
    assertAvailable(attachmentsStatus())
    await api.delete<void>(`v1/inventory-documents/${documentId}/attachments/${encodeURIComponent(String(attachmentId))}`)
  },
}
