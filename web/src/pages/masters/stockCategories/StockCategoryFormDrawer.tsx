import { useEffect, useId, useMemo, useState } from 'react'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { IconTile } from '../../../ui/IconTile'
import { Input } from '../../../ui/Input'
import { Notice } from '../../../components/Notice'
import { SegmentedControl } from '../../../ui/SegmentedControl'
import { cx } from '../../../ui/cx'
import { isApiError } from '../../../services/api'
import type { StockCategory } from '../../../services/masters'
import { categoryAppearance } from './categoryAppearance'

/**
 * Create, duplicate and edit, in one right-hand drawer.
 *
 * A drawer rather than a modal because a category is entered *against* the
 * list: the reader is checking that the name they are about to add is not
 * already three rows up, and a sheet over the middle of the screen hides
 * exactly that. `Drawer` brings the dialog behaviour with it — Escape closes,
 * Tab is trapped, focus returns to the button that opened it.
 *
 * Validation is stated twice on purpose. The checks here catch the two things
 * the reader can fix without a round trip (an empty name, an over-long alias);
 * the API still validates everything, still owns the case-insensitive
 * uniqueness rule, and its `details.field` is mapped back onto the field it
 * names, so a duplicate name lands under the name box rather than in a banner.
 * Nothing here decides whether a write is allowed — `canWrite` only chooses
 * between a form and a read-only view of the same record.
 */

export type FormMode = 'create' | 'edit' | 'duplicate'

export interface StockCategoryFormValues {
  cat_name: string
  cat_alias: string
  is_active: number
}

export interface StockCategoryFormDrawerProps {
  open: boolean
  mode: FormMode
  row: StockCategory | null
  saving: boolean
  serverError: unknown
  canWrite: boolean
  onClose: () => void
  onSubmit: (values: StockCategoryFormValues) => void
}

const NAME_MAX = 255
const ALIAS_MAX = 64

function initialValues(mode: FormMode, row: StockCategory | null): StockCategoryFormValues {
  if (mode === 'create' || !row) return { cat_name: '', cat_alias: '', is_active: 1 }
  if (mode === 'duplicate') {
    // A copy cannot carry the original's name — the API refuses it — so the
    // suffix is added here, where the reader can see and edit it, rather than
    // letting them press Create and read a 409.
    return { cat_name: `${row.cat_name} (copy)`.slice(0, NAME_MAX), cat_alias: '', is_active: Number(row.is_active) === 1 ? 1 : 0 }
  }
  return { cat_name: row.cat_name ?? '', cat_alias: row.cat_alias ?? '', is_active: Number(row.is_active) === 1 ? 1 : 0 }
}

export function validateStockCategory(values: StockCategoryFormValues): Record<string, string> {
  const errors: Record<string, string> = {}
  const name = values.cat_name.trim()
  if (name === '') errors.cat_name = 'Category name is required.'
  else if (name.length > NAME_MAX) errors.cat_name = `Keep the name to ${NAME_MAX} characters.`
  if (values.cat_alias.trim().length > ALIAS_MAX) errors.cat_alias = `Keep the alias to ${ALIAS_MAX} characters.`
  return errors
}

export function StockCategoryFormDrawer({
  open,
  mode,
  row,
  saving,
  serverError,
  canWrite,
  onClose,
  onSubmit,
}: StockCategoryFormDrawerProps) {
  const formId = useId()
  const nameId = useId()
  const aliasId = useId()
  const [values, setValues] = useState<StockCategoryFormValues>(() => initialValues(mode, row))
  const [errors, setErrors] = useState<Record<string, string>>({})

  // A fresh draft each time the drawer opens on a different record — not a
  // stale one carried over from the row the reader looked at before.
  const key = `${mode}:${row ? row.stock_cat_id : 'new'}:${open}`
  useEffect(() => {
    if (!open) return
    setValues(initialValues(mode, row))
    setErrors({})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open / record change only
  }, [key])

  const serverMessage = serverError ? (serverError instanceof Error ? serverError.message : String(serverError)) : null
  const serverField = isApiError(serverError) ? serverError.field : null
  const fieldError = (name: keyof StockCategoryFormValues): string | undefined =>
    errors[name] ?? (serverField === name ? serverMessage ?? undefined : undefined)

  const preview = useMemo(
    () => categoryAppearance({ stock_cat_id: row?.stock_cat_id, cat_name: values.cat_name, cat_alias: values.cat_alias }),
    [row?.stock_cat_id, values.cat_name, values.cat_alias],
  )

  const set = (name: keyof StockCategoryFormValues, value: string | number) => {
    setValues((v) => ({ ...v, [name]: value }))
    setErrors((e) => {
      if (!e[name]) return e
      const next = { ...e }
      delete next[name]
      return next
    })
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canWrite || saving) return
    const found = validateStockCategory(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    onSubmit({
      cat_name: values.cat_name.trim(),
      cat_alias: values.cat_alias.trim(),
      is_active: values.is_active,
    })
  }

  const title = !canWrite ? 'Stock category' : mode === 'edit' ? 'Edit stock category' : mode === 'duplicate' ? 'Duplicate stock category' : 'New stock category'
  const description =
    mode === 'duplicate'
      ? `Copied from ${row?.cat_name ?? 'the selected category'}. Give it a name of its own.`
      : mode === 'edit'
        ? 'Changes apply to every item already in this category.'
        : 'Categories group items for classification, reporting and control.'

  return (
    <Drawer
      open={open}
      title={title}
      description={description}
      width="md"
      onClose={() => {
        if (!saving) onClose()
      }}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {canWrite ? 'Cancel' : 'Close'}
          </Button>
          {canWrite ? (
            <Button type="submit" form={formId} loading={saving}>
              {mode === 'edit' ? 'Save changes' : 'Create category'}
            </Button>
          ) : null}
        </div>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        {serverMessage && !serverField ? <Notice kind="error">{serverMessage}</Notice> : null}

        {/* The row the list will draw, drawn here first. The icon and wash are
            derived from the name, so this is the actual appearance, not a
            mock-up of one. */}
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
          <IconTile icon={preview.icon} tone={preview.tone} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900">
              {values.cat_name.trim() || <span className="text-gray-400">Category name</span>}
            </p>
            <p className="truncate text-xs text-gray-500">
              {values.cat_alias.trim() ? <span className="font-mono">{values.cat_alias.trim()}</span> : 'No alias'}
            </p>
          </div>
        </div>

        <div>
          <label htmlFor={nameId} className="mb-1 block text-xs font-medium text-gray-700">
            Category name <span className="text-red-500">*</span>
          </label>
          <Input
            id={nameId}
            size="md"
            value={values.cat_name}
            maxLength={NAME_MAX}
            autoFocus={canWrite}
            disabled={!canWrite || saving}
            invalid={Boolean(fieldError('cat_name'))}
            aria-invalid={fieldError('cat_name') ? true : undefined}
            aria-describedby={fieldError('cat_name') ? `${nameId}-error` : undefined}
            placeholder="Raw Material"
            onChange={(e) => set('cat_name', e.target.value)}
          />
          {fieldError('cat_name') ? (
            <p id={`${nameId}-error`} className="mt-1 text-xs text-red-600">
              {fieldError('cat_name')}
            </p>
          ) : (
            <p className="mt-1 text-xs text-gray-500">Must be unique in this company.</p>
          )}
        </div>

        <div>
          <label htmlFor={aliasId} className="mb-1 block text-xs font-medium text-gray-700">
            Alias
          </label>
          <Input
            id={aliasId}
            size="md"
            value={values.cat_alias}
            maxLength={ALIAS_MAX}
            disabled={!canWrite || saving}
            invalid={Boolean(fieldError('cat_alias'))}
            aria-invalid={fieldError('cat_alias') ? true : undefined}
            aria-describedby={fieldError('cat_alias') ? `${aliasId}-error` : undefined}
            placeholder="RM"
            onChange={(e) => set('cat_alias', e.target.value)}
          />
          {fieldError('cat_alias') ? (
            <p id={`${aliasId}-error`} className="mt-1 text-xs text-red-600">
              {fieldError('cat_alias')}
            </p>
          ) : (
            <p className="mt-1 text-xs text-gray-500">A short code for sheets and imports. Optional.</p>
          )}
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-gray-700">Status</span>
          <SegmentedControl<'active' | 'inactive'>
            value={values.is_active === 1 ? 'active' : 'inactive'}
            onChange={(v) => set('is_active', v === 'active' ? 1 : 0)}
            size="md"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
            className={cx(!canWrite || saving ? 'pointer-events-none opacity-60' : undefined)}
          />
          <p className="mt-1 text-xs text-gray-500">
            An inactive category stays on the items that already use it, but is not offered on new ones.
          </p>
        </div>
      </form>
    </Drawer>
  )
}

export default StockCategoryFormDrawer
