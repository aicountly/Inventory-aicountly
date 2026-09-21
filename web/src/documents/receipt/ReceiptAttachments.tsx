import { useEffect, useRef, useState } from 'react'
import { FileText, Loader2, Paperclip, Trash2, UploadCloud } from 'lucide-react'
import { errorMessage, isAbortError } from '../../services/api'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { FormSectionCard } from '../../ui/shell/FormSectionCard'
import { notify } from '../../ui/notify'
import { receiptAttachmentsApi } from './integrations'
import type { ReceiptAttachment } from './integrations'

export interface ReceiptAttachmentsProps {
  /** Null until the draft is saved: a file needs a document to hang on. */
  documentId: number | null
  disabled?: boolean
  /** Null when the endpoint is live. */
  unavailableReason: string | null
}

const ACCEPT = ['application/pdf', 'image/jpeg', 'image/png']
const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png'
const MAX_BYTES = 10 * 1024 * 1024

function prettySize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The supplier's paperwork kept with the receipt.
 *
 * Two rules the goods-inward desk depends on and one architectural one:
 *
 *  - a file is only accepted once the draft exists, because the vault stores it
 *    against a document id and a file with no document is an orphan;
 *  - the type is checked on the bytes the browser reports AND on the extension,
 *    and the server checks again — a declared MIME type is a claim, not a fact;
 *  - the bytes go to the Aicountly document vault through Inventory's own API,
 *    never into inv_* and never to a second store of our own.
 */
export function ReceiptAttachments({ documentId, disabled, unavailableReason }: ReceiptAttachmentsProps) {
  const [files, setFiles] = useState<ReceiptAttachment[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const live = unavailableReason === null

  useEffect(() => {
    if (!live || documentId === null) return undefined
    const controller = new AbortController()
    setLoading(true)
    receiptAttachmentsApi
      .list(documentId, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return
        setFiles(rows)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setError(errorMessage(err, 'Could not load the attachments.'))
        setLoading(false)
      })
    return () => controller.abort()
  }, [live, documentId])

  const reject = (file: File): string | null => {
    const byExtension = /\.(pdf|jpe?g|png)$/i.test(file.name)
    if (!byExtension || (file.type && !ACCEPT.includes(file.type))) return `${file.name}: only PDF, JPG and PNG are accepted.`
    if (file.size > MAX_BYTES) return `${file.name}: larger than 10 MB.`
    return null
  }

  const send = async (picked: FileList | null) => {
    if (!picked || picked.length === 0 || documentId === null) return
    setError(null)
    for (const file of Array.from(picked)) {
      const bad = reject(file)
      if (bad) {
        setError(bad)
        continue
      }
      setUploading((list) => [...list, file.name])
      try {
        const saved = await receiptAttachmentsApi.upload(documentId, file)
        setFiles((list) => [...list, saved])
        notify.success(`${file.name} attached.`)
      } catch (err) {
        setError(errorMessage(err, `Could not attach ${file.name}.`))
      } finally {
        setUploading((list) => list.filter((n) => n !== file.name))
      }
    }
  }

  const remove = async (attachment: ReceiptAttachment) => {
    if (documentId === null) return
    const previous = files
    setFiles((list) => list.filter((f) => f.attachment_id !== attachment.attachment_id))
    try {
      await receiptAttachmentsApi.remove(documentId, attachment.attachment_id)
    } catch (err) {
      setFiles(previous)
      setError(errorMessage(err, 'Could not remove the attachment.'))
    }
  }

  const blocked = !live || documentId === null || disabled

  return (
    <FormSectionCard
      title="Attachments"
      description="Supplier invoice, challan, quality report."
      icon={Paperclip}
      bodyClassName="space-y-2"
    >
      <div
        onDragOver={(e) => {
          if (blocked) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (blocked) return
          e.preventDefault()
          setDragging(false)
          void send(e.dataTransfer.files)
        }}
        className={cx(
          'rounded-xl border border-dashed px-4 py-6 text-center transition-colors',
          blocked
            ? 'border-gray-200 bg-gray-50'
            : dragging
              ? 'border-primary bg-primary-light'
              : 'border-gray-300 bg-white hover:border-primary/50',
        )}
      >
        <UploadCloud className={cx('w-6 h-6 mx-auto mb-1.5', blocked ? 'text-gray-300' : 'text-gray-400')} aria-hidden />
        {live ? (
          <>
            <p className="text-xs font-medium text-gray-700 m-0">
              {documentId === null ? 'Save the draft first, then attach files to it.' : 'Drag files here, or choose them below.'}
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5 mb-2">PDF, JPG or PNG · up to 10 MB each</p>
            <Button variant="secondary" size="sm" disabled={blocked} onClick={() => inputRef.current?.click()}>
              Choose files
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => {
                void send(e.target.files)
                e.target.value = ''
              }}
            />
          </>
        ) : (
          <p className="text-xs text-gray-500 m-0">{unavailableReason}</p>
        )}
      </div>

      {loading ? (
        <p className="text-[11px] text-gray-500 inline-flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Loading attachments…
        </p>
      ) : null}
      {error ? <p className="text-[11px] font-medium text-red-600">{error}</p> : null}

      {files.length > 0 || uploading.length > 0 ? (
        <ul className="space-y-1.5 list-none p-0 m-0">
          {files.map((file) => (
            <li key={String(file.attachment_id)} className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5">
              <FileText className="w-4 h-4 text-gray-400 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                {file.url ? (
                  <a href={file.url} target="_blank" rel="noreferrer" className="block text-xs font-medium text-primary truncate hover:underline">
                    {file.file_name}
                  </a>
                ) : (
                  <span className="block text-xs font-medium text-gray-900 truncate">{file.file_name}</span>
                )}
                <span className="block text-[10px] text-gray-500">{prettySize(file.size_bytes)}</span>
              </span>
              <button
                type="button"
                onClick={() => void remove(file)}
                disabled={disabled}
                aria-label={`Remove ${file.file_name}`}
                className="shrink-0 w-7 h-7 grid place-items-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden />
              </button>
            </li>
          ))}
          {uploading.map((name) => (
            <li key={name} className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden />
              <span className="truncate">{name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </FormSectionCard>
  )
}

export default ReceiptAttachments
