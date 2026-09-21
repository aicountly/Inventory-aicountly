import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Upload, X } from 'lucide-react'
import { cx } from '../ui/cx'
import { notify } from '../ui/notify'

export interface StagedAttachment {
  id: string
  file: File
  /** Object URL for an image preview; null for a PDF or other type. */
  previewUrl: string | null
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']
const ACCEPTED_LABEL = 'JPG, PNG, PDF (max 10MB each)'
const MAX_SIZE_BYTES = 10 * 1024 * 1024

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function newAttachmentId(): string {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

interface AttachmentUploaderProps {
  value: StagedAttachment[]
  onChange: (files: StagedAttachment[]) => void
  disabled?: boolean
  maxFiles?: number
}

/**
 * Drag/drop + click-to-browse staging area for proof photos and documents.
 *
 * Inventory has no attachment-storage endpoint yet (no upload route anywhere in
 * server-php), so this deliberately stops at the client: files are validated,
 * previewed and held in the caller's draft state, ready to be posted the moment
 * a real `POST /v1/inventory-documents/{id}/attachments` (or similar) exists.
 * Wiring it in is then a single call from the caller's submit handler — this
 * component does not need to change.
 */
export function AttachmentUploader({ value, onChange, disabled, maxFiles = 6 }: AttachmentUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const valueRef = useRef(value)
  valueRef.current = value

  // Object URLs are per-tab memory; release whatever is still staged if the form unmounts.
  useEffect(
    () => () => {
      for (const f of valueRef.current) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl)
    },
    [],
  )

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList)
      const accepted: StagedAttachment[] = []
      const rejected: string[] = []
      let room = maxFiles - value.length
      for (const file of incoming) {
        if (room <= 0) {
          rejected.push(`${file.name} — only ${maxFiles} attachments allowed`)
          continue
        }
        if (!ACCEPTED_TYPES.includes(file.type)) {
          rejected.push(`${file.name} — unsupported file type`)
          continue
        }
        if (file.size > MAX_SIZE_BYTES) {
          rejected.push(`${file.name} — larger than 10MB`)
          continue
        }
        accepted.push({ id: newAttachmentId(), file, previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null })
        room -= 1
      }
      if (accepted.length) onChange([...value, ...accepted])
      if (rejected.length) notify.error(rejected.join('; '))
    },
    [value, onChange, maxFiles],
  )

  const remove = (id: string) => {
    const target = value.find((f) => f.id === id)
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
    onChange(value.filter((f) => f.id !== id))
  }

  return (
    <div className="aic flex h-full flex-col gap-2">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-label={`Upload supporting documents. ${ACCEPTED_LABEL}`}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (disabled) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (disabled) return
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
        }}
        className={cx(
          'flex min-h-[6.75rem] flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-4 text-center transition-colors',
          dragOver ? 'border-primary bg-primary-light/40' : 'border-gray-300 bg-gray-50/60 hover:border-primary/50 hover:bg-primary-light/20',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <Upload className="h-5 w-5 text-gray-400" aria-hidden />
        <p className="text-sm font-semibold text-gray-700">
          Attach proof <span className="font-normal text-gray-400">(optional)</span>
        </p>
        <p className="text-xs text-gray-500">Drag &amp; drop images, or click to upload</p>
        <p className="text-[11px] text-gray-400">{ACCEPTED_LABEL}</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(',')}
          className="sr-only"
          disabled={disabled}
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white py-1 pl-1.5 pr-2 text-xs">
              {f.previewUrl ? (
                <img src={f.previewUrl} alt="" className="h-8 w-8 rounded object-cover" />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-red-50 text-red-500">
                  <FileText className="h-4 w-4" aria-hidden />
                </span>
              )}
              <span className="flex min-w-0 flex-col">
                <span className="max-w-[9rem] truncate font-medium text-gray-700">{f.file.name}</span>
                <span className="text-[10px] text-gray-400">{formatBytes(f.file.size)}</span>
              </span>
              {!disabled ? (
                <button type="button" className="ml-1 shrink-0 rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-red-600" aria-label={`Remove ${f.file.name}`} onClick={() => remove(f.id)}>
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
