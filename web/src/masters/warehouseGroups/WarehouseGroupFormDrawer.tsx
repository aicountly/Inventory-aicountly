import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Wand2 } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Textarea } from '../../ui/Textarea'
import { Notice } from '../../components/Notice'
import { cx } from '../../ui/cx'
import { isApiError } from '../../services/api'
import type { WarehouseGroup } from '../../services/masters'
import { formatDateTime } from '../../utils/format'
import { buildTree, descendantIds } from '../tree'
import { actorLabel, suggestCode } from './model'

/**
 * Create and edit, in one form.
 *
 * A right-hand drawer rather than a centred modal: a group is edited *against*
 * the list it came from — "is this the same as the one two rows down?" is the
 * commonest question here, and the rows stay readable at the left edge.
 *
 * Validation is on both sides on purpose. What is checked here is what the
 * screen can already see (a blank name, a name or code another loaded row has,
 * a value past the column's width) so the reader is told before a round trip.
 * The API remains the authority: it re-checks every one of them, and a 409 it
 * returns is attached to the field it names rather than shown as a stray banner.
 */

export const NAME_MAX = 255
export const CODE_MAX = 32
export const DESCRIPTION_MAX = 500

export interface WarehouseGroupFormValues {
  grp_name: string
  grp_code: string
  description: string
  parent_grp_id: string
  is_active: boolean
}

export type FormMode = 'create' | 'edit' | 'view'

export interface WarehouseGroupFormDrawerProps {
  open: boolean
  mode: FormMode
  /** The row being edited, or the row a create is seeded from (Duplicate). */
  row: WarehouseGroup | null
  /** Every group on record — for the parent picker and the duplicate checks. */
  allRows: readonly WarehouseGroup[]
  saving: boolean
  serverError: unknown
  onClose: () => void
  onSubmit: (values: WarehouseGroupFormValues, andAnother: boolean) => void
}

function initialValues(mode: FormMode, row: WarehouseGroup | null): WarehouseGroupFormValues {
  if (!row) return { grp_name: '', grp_code: '', description: '', parent_grp_id: '', is_active: true }
  return {
    grp_name: mode === 'create' ? `${row.grp_name} (copy)` : row.grp_name,
    // A duplicate starts with no code: codes are unique, so carrying one over
    // would guarantee the 409 the reader is about to hit on save.
    grp_code: mode === 'create' ? '' : (row.grp_code ?? ''),
    description: row.description ?? '',
    parent_grp_id: row.parent_grp_id ? String(row.parent_grp_id) : '',
    is_active: mode === 'create' ? true : Number(row.is_active) === 1,
  }
}

export function WarehouseGroupFormDrawer({
  open,
  mode,
  row,
  allRows,
  saving,
  serverError,
  onClose,
  onSubmit,
}: WarehouseGroupFormDrawerProps) {
  const readOnly = mode === 'view'
  const editingId = mode === 'edit' && row ? row.warehouse_group_id : null

  const [values, setValues] = useState<WarehouseGroupFormValues>(() => initialValues(mode, row))
  const [touched, setTouched] = useState(false)
  const [codeTouched, setCodeTouched] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  // Reset whenever the drawer opens on a different record: a form that kept the
  // previous group's values would let an edit be saved onto the wrong row.
  const formKey = `${mode}:${row?.warehouse_group_id ?? 'new'}:${open}`
  const lastKey = useRef(formKey)
  useEffect(() => {
    if (lastKey.current === formKey) return
    lastKey.current = formKey
    setValues(initialValues(mode, row))
    setTouched(false)
    setCodeTouched(false)
    setSubmitted(false)
    setConfirmingDiscard(false)
  }, [formKey, mode, row])

  const takenCodes = useMemo(
    () => allRows.filter((r) => r.warehouse_group_id !== editingId).map((r) => (r.grp_code ?? '').toUpperCase()).filter(Boolean),
    [allRows, editingId],
  )

  const parentOptions = useMemo(() => {
    const blocked = editingId
      ? descendantIds(
          buildTree(allRows, { idKey: 'warehouse_group_id', parentKey: 'parent_grp_id', labelOf: (r) => r.grp_name }),
          editingId,
        )
      : new Set<number>()
    return allRows
      .filter((r) => !blocked.has(r.warehouse_group_id))
      .slice()
      .sort((a, b) => a.grp_name.localeCompare(b.grp_name, undefined, { sensitivity: 'base' }))
  }, [allRows, editingId])

  const set = (patch: Partial<WarehouseGroupFormValues>) => {
    setTouched(true)
    setValues((prev) => {
      const next = { ...prev, ...patch }
      // While the reader has not touched the code, it follows the name. The
      // moment they type one it is theirs and nothing overwrites it.
      if (patch.grp_name !== undefined && mode !== 'edit' && !codeTouched) {
        next.grp_code = suggestCode(next.grp_name, takenCodes)
      }
      return next
    })
  }

  const name = values.grp_name.trim()
  const code = values.grp_code.trim().toUpperCase()
  const description = values.description.trim()

  const duplicateName = name !== '' && allRows.some(
    (r) => r.warehouse_group_id !== editingId && r.grp_name.trim().toLowerCase() === name.toLowerCase(),
  )
  const duplicateCode = code !== '' && takenCodes.includes(code)

  const errors: Partial<Record<keyof WarehouseGroupFormValues, string>> = {}
  if (name === '') errors.grp_name = 'A group name is required.'
  else if (name.length > NAME_MAX) errors.grp_name = `Keep the name to ${NAME_MAX} characters.`
  else if (duplicateName) errors.grp_name = 'Another warehouse group already has this name.'
  if (code.length > CODE_MAX) errors.grp_code = `Keep the code to ${CODE_MAX} characters.`
  else if (duplicateCode) errors.grp_code = 'Another warehouse group already uses this code.'
  if (description.length > DESCRIPTION_MAX) errors.description = `Keep the description to ${DESCRIPTION_MAX} characters.`

  const serverField = isApiError(serverError) ? serverError.field : null
  const serverMessage = serverError instanceof Error ? serverError.message : null
  const invalid = Object.keys(errors).length > 0
  const showError = (field: keyof WarehouseGroupFormValues) =>
    (submitted && errors[field]) || (serverField === field ? serverMessage : null)

  const requestClose = () => {
    if (saving) return
    if (touched && !readOnly) {
      setConfirmingDiscard(true)
      return
    }
    onClose()
  }

  const submit = (andAnother: boolean) => {
    setSubmitted(true)
    if (invalid) {
      nameRef.current?.focus()
      return
    }
    onSubmit({ ...values, grp_name: name, grp_code: code, description }, andAnother)
  }

  const title = mode === 'create' ? 'New warehouse group' : mode === 'edit' ? 'Edit warehouse group' : row?.grp_name ?? 'Warehouse group'

  return (
    <Drawer
      open={open}
      onClose={requestClose}
      title={title}
      description={
        mode === 'create'
          ? 'Groups organise warehouses for reporting, operations and access control.'
          : row?.grp_name
      }
      width="md"
      footer={
        confirmingDiscard ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex min-w-0 flex-1 items-center gap-2 text-xs font-medium text-amber-700">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              Discard your unsaved changes?
            </span>
            <Button variant="secondary" size="md" onClick={() => setConfirmingDiscard(false)}>
              Keep editing
            </Button>
            <Button variant="danger" size="md" onClick={onClose}>
              Discard
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" size="md" onClick={requestClose} disabled={saving}>
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {mode === 'create' ? (
              <Button variant="outline" size="md" onClick={() => submit(true)} loading={saving}>
                Save &amp; create another
              </Button>
            ) : null}
            {!readOnly ? (
              <Button variant="primary" size="md" onClick={() => submit(false)} loading={saving}>
                {mode === 'create' ? 'Save group' : 'Save changes'}
              </Button>
            ) : null}
          </div>
        )
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit(false)
        }}
      >
        {serverMessage && !serverField ? <Notice kind="error">{serverMessage}</Notice> : null}

        <div className="space-y-1.5">
          <label htmlFor="wg-name" className="block text-xs font-semibold text-gray-700">
            Warehouse group name <span className="text-red-600" aria-hidden>*</span>
          </label>
          <Input
            id="wg-name"
            ref={nameRef}
            size="md"
            value={values.grp_name}
            maxLength={NAME_MAX}
            required
            disabled={readOnly || saving}
            invalid={Boolean(showError('grp_name'))}
            aria-describedby={showError('grp_name') ? 'wg-name-error' : undefined}
            onChange={(e) => set({ grp_name: e.target.value })}
          />
          {showError('grp_name') ? (
            <p id="wg-name-error" className="text-[11px] font-medium text-red-600">
              {showError('grp_name')}
            </p>
          ) : (
            <p className="text-[11px] text-gray-500">Unique within this company.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="wg-code" className="block text-xs font-semibold text-gray-700">
            Group code
          </label>
          <div className="flex items-start gap-2">
            <Input
              id="wg-code"
              size="md"
              className="flex-1 font-mono uppercase"
              value={values.grp_code}
              maxLength={CODE_MAX}
              disabled={readOnly || saving}
              invalid={Boolean(showError('grp_code'))}
              aria-describedby={showError('grp_code') ? 'wg-code-error' : 'wg-code-hint'}
              onChange={(e) => {
                setCodeTouched(true)
                set({ grp_code: e.target.value.toUpperCase() })
              }}
            />
            {!readOnly ? (
              <Button
                variant="secondary"
                size="md"
                icon={Wand2}
                disabled={saving || name === ''}
                onClick={() => {
                  setCodeTouched(true)
                  set({ grp_code: suggestCode(values.grp_name, takenCodes) })
                }}
              >
                Suggest
              </Button>
            ) : null}
          </div>
          {showError('grp_code') ? (
            <p id="wg-code-error" className="text-[11px] font-medium text-red-600">
              {showError('grp_code')}
            </p>
          ) : (
            <p id="wg-code-hint" className="text-[11px] text-gray-500">
              Optional short handle used by exports and printed registers. The API confirms it is unique.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="wg-parent" className="block text-xs font-semibold text-gray-700">
            Parent group
          </label>
          <Select
            id="wg-parent"
            size="md"
            value={values.parent_grp_id}
            disabled={readOnly || saving}
            onChange={(e) => set({ parent_grp_id: e.target.value })}
          >
            <option value="">— Top-level group (no parent) —</option>
            {parentOptions.map((r) => (
              <option key={r.warehouse_group_id} value={String(r.warehouse_group_id)}>
                {r.grp_name}
              </option>
            ))}
          </Select>
          <p className="text-[11px] text-gray-500">
            A group cannot sit under itself or under one of its own sub-groups, so those are not listed.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="wg-description" className="block text-xs font-semibold text-gray-700">
            Description
          </label>
          <Textarea
            id="wg-description"
            rows={3}
            value={values.description}
            maxLength={DESCRIPTION_MAX}
            disabled={readOnly || saving}
            invalid={Boolean(showError('description'))}
            onChange={(e) => set({ description: e.target.value })}
          />
          <p className={cx('text-[11px]', showError('description') ? 'font-medium text-red-600' : 'text-gray-500')}>
            {showError('description') ?? `What this group is for. ${values.description.length}/${DESCRIPTION_MAX}`}
          </p>
        </div>

        <label className="flex items-start gap-2.5 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))]"
            checked={values.is_active}
            disabled={readOnly || saving}
            onChange={(e) => set({ is_active: e.target.checked })}
          />
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-gray-700">Active</span>
            <span className="block text-[11px] leading-relaxed text-gray-500">
              An inactive group stays on every record that already uses it, but stops being offered when a
              warehouse is created or edited.
            </span>
          </span>
        </label>

        {row && mode !== 'create' ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-gray-100 pt-3 text-[11px]">
            <div>
              <dt className="font-semibold uppercase tracking-wide text-gray-400">Created</dt>
              <dd className="mt-0.5 text-gray-600">
                {formatDateTime(row.created_at)}
                {actorLabel(row.created_by, row.created_by_name) ? (
                  <span className="block text-gray-400">by {actorLabel(row.created_by, row.created_by_name)}</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="font-semibold uppercase tracking-wide text-gray-400">Last modified</dt>
              <dd className="mt-0.5 text-gray-600">
                {formatDateTime(row.updated_at)}
                {actorLabel(row.updated_by, row.updated_by_name) ? (
                  <span className="block text-gray-400">by {actorLabel(row.updated_by, row.updated_by_name)}</span>
                ) : null}
              </dd>
            </div>
          </dl>
        ) : null}

        {/* Enter submits the form from any field, the way every other entry
            form in the product behaves. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          Save
        </button>
      </form>
    </Drawer>
  )
}

export default WarehouseGroupFormDrawer
