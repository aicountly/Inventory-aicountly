import { useEffect, useRef, useState } from 'react'
import { Notice } from '../components/Notice'
import { Button } from '../ui/Button'
import { Drawer } from '../ui/Drawer'
import { Kbd } from '../ui/Kbd'
import { MasterForm } from '../masters/MasterForm'
import { useToast } from '../ui/ToastContext'
import { isApiError } from '../services/api'
import { serialsApi } from '../services/masters'
import type { Serial } from '../services/masters'
import type { ItemFormOptions } from '../services/items'
import type { FormValues } from '../masters/types'
import { serialFormFields, serialsConfig } from './serialsConfig'

/**
 * Create or edit one serial number.
 *
 * The form itself is `MasterForm` over `serialsConfig.fields` — the same
 * component every other master uses — so the item typeahead, the batch list
 * that reloads with the item, the location list that reloads with the
 * warehouse, the required-field checks and the mapping of a server
 * `{details:{field}}` error onto the field it names all come for free and
 * behave here exactly as they do everywhere else.
 *
 * What this adds is what a serial screen needs on top: Save and add another
 * (registering one unit at a time is rare; registering twelve is not),
 * Ctrl/Cmd+Enter to save, and a duplicate response that offers the serial that
 * already exists instead of only refusing.
 */
export interface SerialFormDrawerProps {
  open: boolean
  mode: 'create' | 'edit'
  row: Serial | null
  onClose: () => void
  onSaved: (serial: Serial, stayOpen: boolean) => void
  /** Opens the serial that a duplicate error pointed at. */
  onOpenExisting: (serialNo: string) => void
  /** Swaps this drawer for the bulk workflow. */
  onBulkAdd: () => void
  options: ItemFormOptions | null
  costVisible: boolean
  canWrite: boolean
}

export function SerialFormDrawer({
  open,
  mode,
  row,
  onClose,
  onSaved,
  onOpenExisting,
  onBulkAdd,
  options,
  costVisible,
  canWrite,
}: SerialFormDrawerProps) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [duplicate, setDuplicate] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const againRef = useRef(false)
  const formId = 'serial-form'

  useEffect(() => {
    if (!open) {
      setError(null)
      setDuplicate(null)
      setSaving(false)
      againRef.current = false
    }
  }, [open])

  const submit = async (values: FormValues) => {
    if (!canWrite) return
    setSaving(true)
    setError(null)
    setDuplicate(null)
    try {
      const payload = serialsConfig.toPayload?.(values, row) ?? {}
      const saved =
        mode === 'create'
          ? await serialsApi.create(payload)
          : await serialsApi.update(Number(row?.serial_id), payload)
      toast.success(mode === 'create' ? 'Serial number added' : 'Serial number saved')
      const again = againRef.current
      againRef.current = false
      if (again) {
        // A fresh form, with the item and warehouse still chosen: the next unit
        // off the same pallet differs only in its number.
        setNonce((n) => n + 1)
      }
      onSaved(saved, again)
    } catch (err) {
      setError(err)
      // The server is the authority on uniqueness — it normalises and it holds
      // the index. A duplicate is reported rather than guessed at here, and the
      // offer to open the existing record is the useful half of the answer.
      if (isApiError(err) && err.code === 'conflict') {
        const existing = typeof err.details?.serial_no === 'string' ? err.details.serial_no : null
        setDuplicate(existing)
      }
    } finally {
      setSaving(false)
    }
  }

  const save = (again: boolean) => {
    againRef.current = again
    document.getElementById(formId)?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="md"
      title={mode === 'create' ? 'New serial number' : canWrite ? 'Edit serial number' : 'Serial number'}
      description={
        mode === 'create'
          ? 'Registered serials are expected until a receipt document brings them into stock.'
          : row?.serial_no
      }
      footer={
        <div
          className="flex flex-wrap items-center justify-between gap-2"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              save(false)
            }
          }}
        >
          {/* The shortcut is a hint beside the buttons, not part of the save
              button's accessible name — otherwise it announces as
              "Save serial number Ctrl Enter". */}
          {canWrite ? (
            <span className="hidden items-center gap-1 text-[11px] text-gray-400 sm:inline-flex">
              <Kbd>Ctrl</Kbd>
              <Kbd>↵</Kbd>
              saves
            </span>
          ) : (
            <span />
          )}
          <span className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
              {canWrite ? 'Cancel' : 'Close'}
            </Button>
            {canWrite && mode === 'create' ? (
              <Button variant="outline" size="sm" onClick={() => save(true)} loading={saving}>
                Save &amp; add another
              </Button>
            ) : null}
            {canWrite ? (
              <Button size="sm" onClick={() => save(false)} loading={saving} title="Ctrl + Enter">
                {mode === 'create' ? 'Save serial number' : 'Save changes'}
              </Button>
            ) : null}
          </span>
        </div>
      }
    >
      <div
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            save(false)
          }
        }}
      >
        {duplicate ? (
          <div className="mb-3">
            <Notice kind="error" title="Serial number already exists">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onOpenExisting(duplicate)}
              >
                Show the existing “{duplicate}”
              </button>
            </Notice>
          </div>
        ) : null}

        <MasterForm<Serial>
          key={`${mode}-${row?.serial_id ?? 'new'}-${nonce}`}
          formId={formId}
          fields={serialFormFields(costVisible)}
          mode={mode}
          row={row}
          options={options}
          rows={[]}
          initialValues={serialsConfig.toValues?.(mode === 'edit' ? row : null, options)}
          readOnly={!canWrite}
          serverError={duplicate ? null : error}
          onSubmit={submit}
        />

        {mode === 'create' && canWrite ? (
          <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
            Registering many at once?{' '}
            <button
              type="button"
              className="font-semibold text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:underline"
              onClick={onBulkAdd}
            >
              Bulk add
            </button>{' '}
            takes a pasted list, a CSV or a generated range.
          </p>
        ) : null}
      </div>
    </Drawer>
  )
}

export default SerialFormDrawer
