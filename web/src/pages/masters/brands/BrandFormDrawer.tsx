import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { Input } from '../../../ui/Input'
import { Textarea } from '../../../ui/Textarea'
import { FormField } from '../../../ui/shell/FormSectionCard'
import { Notice } from '../../../components/Notice'
import { isApiError } from '../../../services/api'
import { errorMessage } from '../../../services/api'
import type { Brand } from '../../../services/masters'
import { BrandAvatar } from './BrandAvatar'

/**
 * One form for both verbs.
 *
 * Create and edit differ in their title, their buttons and what they send — not
 * in their fields, their validation or their wording — so they are one
 * component. Two would drift: a maximum length tightened on one and forgotten
 * on the other is how a form starts accepting what the API then rejects.
 *
 * A drawer rather than a modal because the list stays readable beside it: the
 * commonest reason to open this is that something in a row was wrong, and
 * hiding the row while it is corrected helps nobody.
 *
 * Duplicate names are NOT checked here. Only the database knows whether
 * "Samsung" already exists in this company, and it knows it only at the instant
 * of the insert; a browser-side check would be stale the moment another user
 * typed and would still have to be enforced again on the server. So the API is
 * the one authority, its 409 is caught, and the message it wrote is shown
 * against the field it named.
 */

export type BrandFormMode = 'create' | 'edit'

export interface BrandFormValues {
  brand_name: string
  brand_alias: string
  brand_code: string
  description: string
  is_active: boolean
}

export const EMPTY_BRAND_FORM: BrandFormValues = {
  brand_name: '',
  brand_alias: '',
  brand_code: '',
  description: '',
  is_active: true,
}

const LIMITS = { brand_name: 255, brand_alias: 64, brand_code: 64, description: 1000 }

export function brandToFormValues(brand: Brand | null): BrandFormValues {
  if (!brand) return { ...EMPTY_BRAND_FORM }
  return {
    brand_name: brand.brand_name ?? '',
    brand_alias: brand.brand_alias ?? '',
    brand_code: brand.brand_code ?? '',
    description: brand.description ?? '',
    is_active: Number(brand.is_active) === 1,
  }
}

/** The body the API is sent. Trimmed here so the server stores what was meant. */
export function brandFormPayload(values: BrandFormValues): Record<string, unknown> {
  return {
    brand_name: values.brand_name.trim(),
    brand_alias: values.brand_alias.trim() || null,
    brand_code: values.brand_code.trim() || null,
    description: values.description.trim() || null,
    is_active: values.is_active ? 1 : 0,
  }
}

/** Client-side checks: only what the file itself can prove. */
export function validateBrandForm(values: BrandFormValues): Partial<Record<keyof BrandFormValues, string>> {
  const errors: Partial<Record<keyof BrandFormValues, string>> = {}
  const name = values.brand_name.trim()
  if (!name) errors.brand_name = 'Brand name is required'
  else if (name.length > LIMITS.brand_name) errors.brand_name = `Use ${LIMITS.brand_name} characters or fewer`
  if (values.brand_alias.trim().length > LIMITS.brand_alias) {
    errors.brand_alias = `Use ${LIMITS.brand_alias} characters or fewer`
  }
  if (values.brand_code.trim().length > LIMITS.brand_code) {
    errors.brand_code = `Use ${LIMITS.brand_code} characters or fewer`
  }
  return errors
}

export interface BrandFormDrawerProps {
  open: boolean
  mode: BrandFormMode
  /** The record being edited, or the one being duplicated from. */
  brand: Brand | null
  initialValues?: BrandFormValues
  readOnly: boolean
  onClose: () => void
  /** Resolves when the API confirmed. `again` keeps the drawer open for the next one. */
  onSubmit: (payload: Record<string, unknown>, again: boolean) => Promise<void>
}

export function BrandFormDrawer({
  open,
  mode,
  brand,
  initialValues,
  readOnly,
  onClose,
  onSubmit,
}: BrandFormDrawerProps) {
  const formId = useId()
  const [values, setValues] = useState<BrandFormValues>(() => initialValues ?? brandToFormValues(brand))
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<unknown>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  // Which button was pressed — read in the submit handler, which cannot see it
  // from the event on every browser.
  const againRef = useRef(false)

  // Re-seed whenever the drawer is opened on a different record. Keyed on the
  // id AND the mode: "duplicate Apple" and "edit Apple" open on the same row
  // with different starting values.
  useEffect(() => {
    if (!open) return
    setValues(initialValues ?? brandToFormValues(brand))
    setTouched(false)
    setServerError(null)
    setSaving(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed on open / record change only
  }, [open, mode, brand?.brand_id])

  const clientErrors = useMemo(() => validateBrandForm(values), [values])

  /** The server blamed a field: show it there rather than only in the banner. */
  const serverField = isApiError(serverError) ? serverError.field : null
  const errors: Partial<Record<keyof BrandFormValues, string>> = { ...clientErrors }
  if (serverField && serverField in EMPTY_BRAND_FORM) {
    errors[serverField as keyof BrandFormValues] = errorMessage(serverError)
  }

  const set = <K extends keyof BrandFormValues>(key: K, value: BrandFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    // A field the server rejected is being corrected: drop the stale complaint
    // rather than leaving it under a value that no longer has the problem.
    if (serverField === key) setServerError(null)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving || readOnly) return
    setTouched(true)
    if (Object.keys(clientErrors).length > 0) {
      nameRef.current?.focus()
      return
    }
    const again = againRef.current
    againRef.current = false
    setSaving(true)
    setServerError(null)
    try {
      await onSubmit(brandFormPayload(values), again)
      if (again) {
        setValues({ ...EMPTY_BRAND_FORM })
        setTouched(false)
        nameRef.current?.focus()
      }
    } catch (err) {
      setServerError(err)
    } finally {
      setSaving(false)
    }
  }

  const showError = (key: keyof BrandFormValues) => (touched || serverField === key ? errors[key] : undefined)

  const title = mode === 'create' ? 'New brand' : readOnly ? 'Brand' : 'Edit brand'

  return (
    <Drawer
      open={open}
      onClose={() => !saving && onClose()}
      title={title}
      description={
        mode === 'create'
          ? 'Brands group items for reporting, search and item defaults.'
          : brand?.brand_name
      }
      width="md"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && mode === 'create' ? (
            <Button
              variant="secondary"
              type="submit"
              form={formId}
              disabled={saving}
              onClick={() => {
                againRef.current = true
              }}
            >
              Save &amp; new
            </Button>
          ) : null}
          {!readOnly ? (
            <Button type="submit" form={formId} loading={saving}>
              {mode === 'create' ? 'Save brand' : 'Save changes'}
            </Button>
          ) : null}
        </div>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        {serverError && !serverField ? (
          <Notice kind="error" title="Could not save this brand">
            {errorMessage(serverError)}
          </Notice>
        ) : null}

        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2.5">
          <BrandAvatar name={values.brand_name || '?'} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900">
              {values.brand_name.trim() || 'Untitled brand'}
            </p>
            <p className="text-[11px] text-gray-500">
              Brands with no artwork use their initials, in a colour fixed by the name.
            </p>
          </div>
        </div>

        <FormField label="Brand name" htmlFor={`${formId}-name`} required error={showError('brand_name')}>
          <Input
            id={`${formId}-name`}
            ref={nameRef}
            size="md"
            value={values.brand_name}
            onChange={(e) => set('brand_name', e.target.value)}
            maxLength={LIMITS.brand_name}
            autoComplete="off"
            autoFocus
            disabled={readOnly || saving}
            invalid={Boolean(showError('brand_name'))}
            placeholder="e.g. Contoso Electricals"
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Alias"
            htmlFor={`${formId}-alias`}
            hint="A short display name used in pickers."
            error={showError('brand_alias')}
          >
            <Input
              id={`${formId}-alias`}
              size="md"
              value={values.brand_alias}
              onChange={(e) => set('brand_alias', e.target.value)}
              maxLength={LIMITS.brand_alias}
              autoComplete="off"
              disabled={readOnly || saving}
              invalid={Boolean(showError('brand_alias'))}
            />
          </FormField>

          <FormField
            label="Brand code"
            htmlFor={`${formId}-code`}
            hint="Unique in this company, if you use one."
            error={showError('brand_code')}
          >
            <Input
              id={`${formId}-code`}
              size="md"
              value={values.brand_code}
              onChange={(e) => set('brand_code', e.target.value)}
              maxLength={LIMITS.brand_code}
              autoComplete="off"
              disabled={readOnly || saving}
              invalid={Boolean(showError('brand_code'))}
              className="font-mono uppercase"
            />
          </FormField>
        </div>

        <FormField
          label="Description"
          htmlFor={`${formId}-description`}
          hint="Searchable. What this brand covers, for whoever files items under it next."
        >
          <Textarea
            id={`${formId}-description`}
            rows={4}
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            maxLength={LIMITS.description}
            disabled={readOnly || saving}
          />
        </FormField>

        <label className="flex items-start gap-3 rounded-xl border border-gray-200 px-3 py-2.5">
          <input
            type="checkbox"
            checked={values.is_active}
            onChange={(e) => set('is_active', e.target.checked)}
            disabled={readOnly || saving}
            className="mt-0.5 h-4 w-4 cursor-pointer accent-[rgb(var(--color-primary))]"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-gray-900">Active</span>
            <span className="block text-[11px] leading-relaxed text-gray-500">
              An inactive brand stays on the records that already use it but stops appearing in
              pickers on new documents.
            </span>
          </span>
        </label>
      </form>
    </Drawer>
  )
}

export default BrandFormDrawer
