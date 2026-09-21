import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Modal } from '../../../components/Modal'
import { Notice } from '../../../components/Notice'
import { Button } from '../../../ui/Button'
import { Input } from '../../../ui/Input'
import { formatGeneratedStamp } from '../../../utils/format'
import type { BulkFieldSpec } from './bulkEditFields'
import { fieldLabel } from './bulkEditHistory'
import type { BulkEditTemplate, TemplateDraft } from './bulkEditTemplates'

/**
 * Save the current configuration under a name, and manage the ones already
 * saved.
 *
 * What is saved is the QUESTION — the field, an optional default value and the
 * filters — never the ticked items. A list of item ids saved in March and
 * applied in September would write to whichever items still carry those
 * numbers, which is not what "the same bulk edit as last time" means.
 *
 * The dialog says where templates live, because the answer ("this browser")
 * matters: Inventory has no template endpoint, so nothing here reaches a
 * colleague or a second device, and a reader must not find that out the hard
 * way.
 */

export interface BulkEditTemplateDialogProps {
  open: boolean
  onClose: () => void
  onSave: (draft: TemplateDraft) => void
  onDelete: (id: string) => void
  onApply: (template: BulkEditTemplate) => void
  templates: readonly BulkEditTemplate[]
  available: boolean
  field: BulkFieldSpec
  newValue: string
  groupId: string
  groupLabel: string | null
  status: string
}

const STATUS_LABEL: Record<string, string> = { active: 'Active only', inactive: 'Inactive only', all: 'All statuses' }

export function BulkEditTemplateDialog({
  open,
  onClose,
  onSave,
  onDelete,
  onApply,
  templates,
  available,
  field,
  newValue,
  groupId,
  groupLabel,
  status,
}: BulkEditTemplateDialogProps) {
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const trimmed = name.trim()
  const duplicate = templates.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())

  const save = () => {
    setTouched(true)
    if (!trimmed) return
    onSave({ name: trimmed, field: field.key, value: newValue, groupId, status })
    setName('')
    setTouched(false)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Bulk edit templates"
      description="A saved field, value and set of filters — not a saved list of items."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={save} disabled={!available || trimmed === ''}>
            {duplicate ? 'Replace template' : 'Save template'}
          </Button>
        </>
      }
    >
      {!available ? (
        <Notice kind="warning" title="Templates cannot be saved here">
          Templates are kept in this browser for your sign-in. This one is not allowing that — a private window, or
          storage turned off.
        </Notice>
      ) : null}

      <div className="space-y-3">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500" htmlFor="bulk-template-name">
            Template name
          </label>
          <div className="mt-1">
            <Input
              id="bulk-template-name"
              size="md"
              value={name}
              disabled={!available}
              invalid={touched && trimmed === ''}
              placeholder="e.g. Quarterly reorder points"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  save()
                }
              }}
            />
          </div>
          {touched && trimmed === '' ? <p className="mt-1 text-xs text-red-600">Give the template a name.</p> : null}
          {duplicate ? (
            <p className="mt-1 text-xs text-amber-700">A template of this name already exists and will be replaced.</p>
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Field</dt>
            <dd className="mt-0.5 font-medium text-gray-900">{field.label}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Default value</dt>
            <dd className="mt-0.5 truncate font-medium text-gray-900">{newValue.trim() || 'None'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Item group</dt>
            <dd className="mt-0.5 truncate font-medium text-gray-900">{groupLabel ?? 'All groups'}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Status</dt>
            <dd className="mt-0.5 font-medium text-gray-900">{STATUS_LABEL[status] ?? status}</dd>
          </div>
        </dl>

        <p className="text-[11px] leading-relaxed text-gray-500">
          Templates are stored in this browser, for your sign-in and this company only. They are not shared with
          colleagues and do not follow you to another device.
        </p>

        {templates.length > 0 ? (
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Saved templates</h3>
            <ul className="mt-1.5 divide-y divide-gray-100 rounded-xl border border-gray-200">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onApply(t)}
                    className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded"
                  >
                    <span className="block truncate text-xs font-medium text-gray-900">{t.name}</span>
                    <span className="block truncate text-[10px] text-gray-500">
                      {fieldLabel(t.field)}
                      {t.value ? ` · ${t.value}` : ''} · saved {formatGeneratedStamp(new Date(t.savedAt))}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="xs"
                    icon={Trash2}
                    aria-label={`Delete template ${t.name}`}
                    onClick={() => onDelete(t.id)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
