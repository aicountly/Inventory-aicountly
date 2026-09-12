import type { PickedItem } from '../components/ItemPicker'
import type { FieldContext, FieldDef, FormValues } from './types'

/** Pure value ↔ payload plumbing for config-driven master forms. */

export function isPickedItem(v: unknown): v is PickedItem {
  return !!v && typeof v === 'object' && typeof (v as PickedItem).item_id === 'number'
}

/** Initial form values from a row (edit) or blanks (create). */
export function defaultValues<T>(fields: FieldDef<T>[], row: T | null): FormValues {
  const src = (row ?? {}) as Record<string, unknown>
  const out: FormValues = {}
  for (const f of fields) {
    const v = src[f.name]
    switch (f.type) {
      case 'checkbox':
        out[f.name] = row ? v === 1 || v === '1' || v === true : f.name === 'is_active'
        break
      case 'item':
        out[f.name] = isPickedItem(v) ? v : null
        break
      default:
        out[f.name] = v === null || v === undefined ? '' : String(v)
    }
  }
  return out
}

/** Request body from form values: numbers parsed, checkboxes as 1/0, blanks as null. */
export function defaultPayload<T>(fields: FieldDef<T>[], values: FormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const v = values[f.name]
    switch (f.type) {
      case 'checkbox':
        out[f.name] = v ? 1 : 0
        break
      case 'number': {
        const s = v === null || v === undefined ? '' : String(v).trim()
        out[f.name] = s === '' ? null : Number(s)
        break
      }
      case 'select': {
        const s = v === null || v === undefined ? '' : String(v).trim()
        out[f.name] = s === '' ? null : /^-?\d+$/.test(s) ? Number(s) : s
        break
      }
      case 'item':
        out[f.name] = isPickedItem(v) ? v.item_id : null
        break
      default: {
        const s = v === null || v === undefined ? '' : String(v).trim()
        out[f.name] = s === '' ? null : s
      }
    }
  }
  return out
}

/** Client-side checks before a request is made; keyed by field name. */
export function validateValues<T>(fields: FieldDef<T>[], ctx: FieldContext<T>): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const f of fields) {
    if (f.hidden?.(ctx)) continue
    const v = ctx.values[f.name]
    const empty = f.type === 'item' ? !isPickedItem(v) : f.type === 'checkbox' ? false : v === null || v === undefined || String(v).trim() === ''
    if (f.required && empty) {
      errors[f.name] = `${f.label} is required`
      continue
    }
    if (f.type === 'number' && !empty) {
      const n = Number(String(v).trim())
      if (!Number.isFinite(n)) errors[f.name] = `${f.label} must be a number`
      else if (f.min !== undefined && n < f.min) errors[f.name] = `${f.label} must be at least ${f.min}`
      else if (f.max !== undefined && n > f.max) errors[f.name] = `${f.label} must be at most ${f.max}`
    }
    if (f.type === 'date' && !empty && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
      errors[f.name] = `${f.label} must be a date`
    }
    if (!errors[f.name] && f.validate) {
      const msg = f.validate(v, ctx)
      if (msg) errors[f.name] = msg
    }
  }
  return errors
}
