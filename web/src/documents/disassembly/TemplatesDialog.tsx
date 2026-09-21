import { useEffect, useState } from 'react'
import { BookmarkPlus, MonitorSmartphone, Trash2 } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { Input } from '../../ui/Input'
import { formatDateTime, formatQty } from '../../utils/format'
import { deleteTemplate, readTemplates, saveTemplate } from './templates'
import type { DisassemblyTemplate } from './templates'

export interface TemplatesDialogProps {
  open: boolean
  onClose: () => void
  cmpId: number | null
  memberUuid: string | null
  /** The draft as it stands, offered for saving. Null when there is nothing worth saving. */
  current: Omit<DisassemblyTemplate, 'id' | 'saved_at'> | null
  onApply: (template: DisassemblyTemplate) => void
}

/** Save the current teardown under a name, or fill the form from one saved earlier. */
export function TemplatesDialog({ open, onClose, cmpId, memberUuid, current, onApply }: TemplatesDialogProps) {
  const [rows, setRows] = useState<DisassemblyTemplate[]>([])
  const [name, setName] = useState('')
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setRows(readTemplates(cmpId, memberUuid))
    setName(current?.name ?? '')
    setSaved(null)
  }, [open, cmpId, memberUuid, current?.name])

  const save = () => {
    if (!current || !name.trim()) return
    setRows(saveTemplate(cmpId, memberUuid, { ...current, name: name.trim() }))
    setSaved(name.trim())
  }

  return (
    <Modal
      open={open}
      title="Disassembly templates"
      description="A named set of components you tear down often."
      onClose={onClose}
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <Notice kind="info">
        <span className="inline-flex items-center gap-1.5">
          <MonitorSmartphone className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Templates are saved on this device for this company, not shared with your team.
        </span>
      </Notice>

      {current ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 p-3">
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Save this document as</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Laptop Pro teardown" />
          </label>
          <Button icon={BookmarkPlus} onClick={save} disabled={!name.trim()}>
            Save template
          </Button>
          {saved ? <span className="text-[12px] text-emerald-700">Saved “{saved}”.</span> : null}
        </div>
      ) : (
        <Notice kind="warning" className="mt-3">
          Add a finished product and at least one component before saving a template.
        </Notice>
      )}

      {rows.length === 0 ? (
        <EmptyState className="mt-4" icon={BookmarkPlus} title="No templates yet" description="Save one from a document you enter often." />
      ) : (
        <ul className="mt-4 divide-y divide-gray-100">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-gray-900">{row.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-gray-500">
                  {row.finished_item_name ? `${row.finished_item_name} × ${formatQty(row.finished_qty)} · ` : ''}
                  {row.components.length} component{row.components.length === 1 ? '' : 's'} · saved {formatDateTime(row.saved_at)}
                </p>
              </div>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => {
                  onApply(row)
                  onClose()
                }}
              >
                Use
              </Button>
              <button
                type="button"
                className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                aria-label={`Delete template ${row.name}`}
                onClick={() => setRows(deleteTemplate(cmpId, memberUuid, row.id))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
