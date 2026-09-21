/**
 * Document attachments — the adapter, ahead of the endpoint.
 *
 * Aicountly Inventory has no attachment storage today: there is no
 * `inv_document_attachments` table, no upload route in `Config\Routes` and
 * nothing in DocumentService that would keep a file. So this module declares
 * the shape the screen needs and reports the capability as unavailable, and the
 * panel renders a disabled control that says so.
 *
 * It deliberately does NOT fake one. A file accepted into browser memory and
 * dropped on the next navigation is worse than a button that admits it cannot
 * take the file yet: the user believes the approval is attached to the issue.
 *
 * TODO(inventory-api): when the API gains attachments, this needs
 *   - POST   v1/inventory-documents/{id}/attachments   (multipart, returns the row)
 *   - GET    v1/inventory-documents/{id}/attachments   (list)
 *   - DELETE v1/inventory-documents/{id}/attachments/{attachmentId}
 * and a `documents.*.attach` permission. Implement them here and flip
 * ATTACHMENTS_AVAILABLE; the panel needs no other change.
 */

export interface DocumentAttachment {
  attachment_id: number
  document_id: number
  file_name: string
  /** Bytes. */
  file_size: number
  mime_type: string
  uploaded_by: string | null
  uploaded_at: string
  download_url: string
}

/** Flip to true with the implementation below. The panel reads this, not a build flag. */
export const ATTACHMENTS_AVAILABLE = false

/** What the panel tells the user while the capability is missing. */
export const ATTACHMENTS_UNAVAILABLE_REASON =
  'Attachment storage is not part of the Inventory API yet, so files cannot be kept against this document. Reference the approval by its number below in the meantime.'

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

export const ATTACHMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.xlsx,.docx'

export interface AttachmentRejection {
  file: string
  reason: string
}

/**
 * Type and size check, pure, ready for the day a file can actually be sent.
 *
 * Exported and tested now because it is the half of the feature that does not
 * depend on the endpoint, and because the rules (10 MB, the accepted types) are
 * the ones the panel already promises on screen.
 */
export function rejectUnsupported(files: readonly File[]): AttachmentRejection[] {
  const allowed = new Set(ATTACHMENT_ACCEPT.split(',').map((e) => e.trim().toLowerCase()))
  const out: AttachmentRejection[] = []
  for (const file of files) {
    const dot = file.name.lastIndexOf('.')
    const ext = dot === -1 ? '' : file.name.slice(dot).toLowerCase()
    if (!allowed.has(ext)) {
      out.push({ file: file.name, reason: `${ext || 'That file type'} is not accepted.` })
      continue
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      out.push({ file: file.name, reason: `${(file.size / 1024 / 1024).toFixed(1)} MB is over the 10 MB limit.` })
    }
  }
  return out
}
