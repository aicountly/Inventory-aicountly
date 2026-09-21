import { useState } from 'react'
import { Modal } from '../../../components/Modal'
import { Button } from '../../../ui/Button'
import { useToast } from '../../../ui/ToastContext'
import { MasterForm } from '../../../masters/MasterForm'
import { batchesConfig } from '../../../masters/configs'
import type { FormValues } from '../../../masters/types'
import { defaultPayload, defaultValues } from '../../../masters/formValues'
import { batchesApi } from '../../../services/masters'
import type { Batch } from '../../../services/masters'

/**
 * Create / edit a batch.
 *
 * Deliberately the SAME form the masters have always used: the fields, their
 * validation and the value ↔ payload mapping all come from `batchesConfig`, so
 * a rule added there (the item must be batch-tracked, expiry cannot precede
 * manufacture, the item is fixed once the batch exists) reaches this dialog
 * without being written twice. The only thing this file owns is the dialog
 * around it and what happens after a successful save.
 *
 * Client-side validation is UX assistance only. Every domain rule — the
 * per-item uniqueness of a batch number, the shelf-life fallback, the date
 * ordering — is enforced by `POST/PUT /v1/batches`, and a `{details:{field}}`
 * error comes back onto the field that caused it.
 */

export type BatchFormMode = 'create' | 'edit'

export interface BatchFormDialogProps {
  open: boolean
  mode: BatchFormMode
  /** The row being edited; null for a new batch. */
  row: Batch | null
  /** Read-only view for a user without write permission. */
  readOnly?: boolean
  onClose: () => void
  onSaved: (batch: Batch, mode: BatchFormMode) => void
}

const FORM_ID = 'batch-form'

export function BatchFormDialog({ open, mode, row, readOnly = false, onClose, onSaved }: BatchFormDialogProps) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const submit = async (values: FormValues) => {
    setSaving(true)
    setError(null)
    try {
      const payload = batchesConfig.toPayload
        ? batchesConfig.toPayload(values, row)
        : defaultPayload(batchesConfig.fields, values)
      const saved =
        mode === 'create'
          ? await batchesApi.create(payload)
          : await batchesApi.update(Number(row?.batch_id), payload)
      toast.success(mode === 'create' ? 'Batch created successfully.' : 'Batch updated successfully.')
      onSaved(saved, mode)
    } catch (err) {
      setError(err)
    } finally {
      setSaving(false)
    }
  }

  const close = () => {
    if (saving) return
    setError(null)
    onClose()
  }

  return (
    <Modal
      open={open}
      title={mode === 'create' ? 'New batch' : readOnly ? 'Batch' : 'Edit batch'}
      description={
        mode === 'create'
          ? 'Only batch-tracked items can carry batches. Expiry is filled from the item’s shelf life when left empty.'
          : 'The item cannot be changed once a batch exists — its movements are already recorded against it.'
      }
      onClose={close}
      busy={saving}
      size={batchesConfig.modalSize ?? 'md'}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={saving}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {readOnly ? null : (
            <Button type="submit" form={FORM_ID} loading={saving}>
              {mode === 'create' ? 'Create batch' : 'Save changes'}
            </Button>
          )}
        </>
      }
    >
      {open ? (
        <MasterForm<Batch>
          key={`${mode}-${row?.batch_id ?? 'new'}`}
          formId={FORM_ID}
          fields={batchesConfig.fields}
          mode={mode}
          row={row}
          options={null}
          rows={[]}
          initialValues={
            batchesConfig.toValues
              ? batchesConfig.toValues(row, null)
              : defaultValues(batchesConfig.fields, row)
          }
          readOnly={readOnly}
          serverError={error}
          onSubmit={submit}
        />
      ) : null}
    </Modal>
  )
}

export default BatchFormDialog
