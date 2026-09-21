/**
 * Which item fields a bulk edit may set, how each one is entered, and what a
 * value has to look like before it is worth sending.
 *
 * ## The list is an allowlist, and it is narrower than the column list
 *
 * `POST /v1/items/bulk-update` refuses any field outside its own whitelist
 * (ItemsController::BULK_EDITABLE) rather than dropping it silently, and the
 * client mirrors that set in `services/items.ts`. This module narrows it
 * FURTHER, on purpose:
 *
 *   - units, the valuation method, batch / serial tracking and openings are not
 *     bulk-editable at all — they change how stock is counted or costed, and
 *     they stay one item at a time on the item form where the consequence is
 *     spelled out;
 *   - `item_alias` and `print_name` are bulk-editable on the server but are not
 *     offered here: the same alias across forty items is not a bulk edit, it is
 *     forty items that can no longer be told apart;
 *   - the Books ledger ids are references into another product's master with no
 *     picker on this side, so there is nothing honest to render for them.
 *
 * Everything that remains has the same worst case: a wrong label, a wrong
 * threshold or a wrong price — never a wrong valuation.
 *
 * ## HSN / SAC is here to be READ, not written
 *
 * Smart Books owns HSN / SAC and the tax category; it files the returns that
 * use them and re-asserts them from its own GST profile within the minute. The
 * API refuses an Inventory-side change with `409 books_owned_field`
 * (ItemsController::booksOwnedStatutoryEdit), so a screen that accepted the
 * value and posted it would be collecting typing the server is about to throw
 * away. The field is still listed — the column beside it is the fastest way to
 * see which items have no HSN at all — and it carries `owner: 'books'`, which
 * is what the editor renders read-only and what the Apply button refuses.
 */

import type { BulkEditableField, FormOptionBrand, FormOptionCategory, FormOptionGroup, ItemFormOptions, ItemListRow } from '../../../services/items'
import { formatMoney, formatQty } from '../../../utils/format'

/** How the new value is typed, and how the current one is read back. */
export type BulkFieldKind = 'code' | 'money' | 'quantity' | 'select' | 'status'

/** Which list in `GET /v1/items/form-options` fills a picker. */
export type BulkFieldOptionsKey = 'item_groups' | 'stock_categories' | 'brands'

export interface BulkFieldSpec {
  key: BulkEditableField
  label: string
  /** Column heading over the current value — "Current HSN / SAC". */
  columnLabel: string
  kind: BulkFieldKind
  optionsKey?: BulkFieldOptionsKey
  placeholder?: string
  /** One line under the editor, always true of the field. */
  hint?: string
  /** Another product maintains the value; Inventory may only display it. */
  owner?: 'books'
  ownerNote?: string
  /** Blank means "clear it on every ticked item" rather than "not filled in". */
  clearable: boolean
}

const BOOKS_NOTE =
  'Smart Books maintains the HSN / SAC, because it files the returns that use it. Change it on the item there and Inventory receives it — an edit made here is refused, and would be overwritten within the minute anyway.'

export const BULK_EDIT_FIELDS: readonly BulkFieldSpec[] = [
  {
    key: 'hsn_sac',
    label: 'HSN / SAC',
    columnLabel: 'Current HSN / SAC',
    kind: 'code',
    placeholder: '4 to 8 letters or digits',
    owner: 'books',
    ownerNote: BOOKS_NOTE,
    clearable: false,
  },
  {
    key: 'item_grp_id',
    label: 'Item group',
    columnLabel: 'Current group',
    kind: 'select',
    optionsKey: 'item_groups',
    hint: 'Leave blank to remove the group from every ticked item.',
    clearable: true,
  },
  {
    key: 'stock_cat_id',
    label: 'Stock category',
    columnLabel: 'Current category',
    kind: 'select',
    optionsKey: 'stock_categories',
    hint: 'Leave blank to remove the category from every ticked item.',
    clearable: true,
  },
  {
    key: 'brand_id',
    label: 'Brand',
    columnLabel: 'Current brand',
    kind: 'select',
    optionsKey: 'brands',
    hint: 'Leave blank to remove the brand from every ticked item.',
    clearable: true,
  },
  {
    key: 'mrp',
    label: 'MRP',
    columnLabel: 'Current MRP',
    kind: 'money',
    placeholder: 'e.g. 249.00',
    hint: 'The printed maximum retail price. Blank clears it.',
    clearable: true,
  },
  {
    key: 'min_stock_qty',
    label: 'Minimum stock',
    columnLabel: 'Current minimum',
    kind: 'quantity',
    placeholder: 'e.g. 10',
    hint: 'In the item’s base unit. Blank clears it.',
    clearable: true,
  },
  {
    key: 'max_stock_qty',
    label: 'Maximum stock',
    columnLabel: 'Current maximum',
    kind: 'quantity',
    placeholder: 'e.g. 500',
    hint: 'In the item’s base unit. Blank clears it.',
    clearable: true,
  },
  {
    key: 'reorder_point_qty',
    label: 'Reorder point',
    columnLabel: 'Current reorder point',
    kind: 'quantity',
    placeholder: 'e.g. 25',
    hint: 'The level at which the item counts as low stock. Blank clears it.',
    clearable: true,
  },
  {
    key: 'reorder_qty',
    label: 'Reorder quantity',
    columnLabel: 'Current reorder quantity',
    kind: 'quantity',
    placeholder: 'e.g. 100',
    hint: 'How much to buy when the reorder point is reached. Blank clears it.',
    clearable: true,
  },
  {
    key: 'is_active',
    label: 'Status',
    columnLabel: 'Current status',
    kind: 'status',
    hint: 'Deactivating hides an item from new documents; existing stock and history are untouched.',
    clearable: false,
  },
]

export const DEFAULT_BULK_FIELD: BulkEditableField = 'hsn_sac'

/** The spec for `key`, or the default field when the key is unknown (a stale URL, a stale template). */
export function findBulkField(key: string | null | undefined): BulkFieldSpec {
  return (
    BULK_EDIT_FIELDS.find((f) => f.key === key) ??
    (BULK_EDIT_FIELDS.find((f) => f.key === DEFAULT_BULK_FIELD) as BulkFieldSpec)
  )
}

/** True when Inventory may not write the field at all. */
export function isReadOnlyField(field: BulkFieldSpec): boolean {
  return field.owner !== undefined
}

/* -------------------------------------------------------------------------- */
/* Options                                                                    */
/* -------------------------------------------------------------------------- */

export interface BulkFieldChoice {
  value: string
  label: string
}

/** The picker's choices, or `[]` for a field that is not a picker. */
export function fieldChoices(field: BulkFieldSpec, options: ItemFormOptions | null): BulkFieldChoice[] {
  if (field.kind === 'status') {
    return [
      { value: '1', label: 'Active' },
      { value: '0', label: 'Inactive' },
    ]
  }
  if (!field.optionsKey || !options) return []
  switch (field.optionsKey) {
    case 'item_groups':
      return options.item_groups.map((g: FormOptionGroup) => ({ value: String(g.item_grp_id), label: g.grp_name }))
    case 'stock_categories':
      return options.stock_categories.map((c: FormOptionCategory) => ({ value: String(c.stock_cat_id), label: c.cat_name }))
    case 'brands':
      return options.brands.map((b: FormOptionBrand) => ({ value: String(b.brand_id), label: b.brand_name }))
    default:
      return []
  }
}

/* -------------------------------------------------------------------------- */
/* Reading what an item holds today                                           */
/* -------------------------------------------------------------------------- */

function rawField(row: ItemListRow, key: BulkEditableField): unknown {
  return (row as unknown as Record<string, unknown>)[key]
}

/**
 * The item's value as a comparable string — `''` when it has none.
 *
 * Comparable, not printable: ids stay ids and numbers stay numbers, so that
 * "is this row already set to what is being applied?" is one string equality
 * and not a formatting round trip. `formatCurrentValue` is the printable one.
 */
export function currentValueKey(row: ItemListRow, field: BulkFieldSpec): string {
  if (field.kind === 'status') return Number(row.is_active) === 1 ? '1' : '0'
  const v = rawField(row, field.key)
  if (v === null || v === undefined || v === '') return ''
  if (field.kind === 'money' || field.kind === 'quantity') {
    const n = Number(v)
    return Number.isFinite(n) ? String(n) : ''
  }
  return String(v)
}

/** What the table cell reads. `—` when the item has no value, never a blank cell. */
export function formatCurrentValue(row: ItemListRow, field: BulkFieldSpec, options: ItemFormOptions | null): string {
  if (field.kind === 'status') return Number(row.is_active) === 1 ? 'Active' : 'Inactive'
  const key = currentValueKey(row, field)
  if (key === '') return '—'
  return formatFieldValue(field, key, options)
}

/**
 * A stored value rendered for a reader: an id becomes its name, a number is
 * formatted, a code is shown as typed.
 *
 * An id with no matching option is NOT silently dropped — the row genuinely
 * points at something, and `#12` tells the reader that the reference is there
 * and the name is not, which is the truth. A blank would read as "no group".
 */
export function formatFieldValue(field: BulkFieldSpec, value: string, options: ItemFormOptions | null): string {
  if (value === '') return '—'
  switch (field.kind) {
    case 'status':
      return value === '1' ? 'Active' : 'Inactive'
    case 'money':
      return formatMoney(value)
    case 'quantity':
      return formatQty(value)
    case 'select': {
      const hit = fieldChoices(field, options).find((c) => c.value === value)
      return hit ? hit.label : `#${value}`
    }
    default:
      return value
  }
}

/* -------------------------------------------------------------------------- */
/* Validating what is about to be written                                     */
/* -------------------------------------------------------------------------- */

export type ValueCheckLevel = 'ok' | 'empty' | 'error'

export interface ValueCheck {
  level: ValueCheckLevel
  /** One line for the editor and the validation rail. */
  message: string
  /** Blocks Apply. `empty` on a clearable field does not. */
  blocking: boolean
}

const CODE_SHAPE = /^[0-9A-Za-z]{4,8}$/

/**
 * Is this value writable, as far as the browser can tell?
 *
 * Shape only. For HSN / SAC in particular the wording is deliberate: this
 * checks that the value LOOKS like a code (the same 4–8 alphanumeric rule the
 * server enforces) and says "Format valid". It is not a classification check,
 * nothing here knows whether the code is the right one for the goods, and no
 * message on this screen may imply that it does.
 */
export function checkNewValue(field: BulkFieldSpec, raw: string): ValueCheck {
  const value = raw.trim()

  if (isReadOnlyField(field)) {
    return { level: 'error', message: field.ownerNote ?? 'This field cannot be changed from Inventory.', blocking: true }
  }

  if (value === '') {
    if (!field.clearable) {
      return {
        level: 'error',
        message: field.kind === 'status' ? 'Choose Active or Inactive.' : `Enter a ${field.label.toLowerCase()}.`,
        blocking: true,
      }
    }
    return { level: 'empty', message: `Blank clears ${field.label.toLowerCase()} on every ticked item.`, blocking: false }
  }

  switch (field.kind) {
    case 'code':
      return CODE_SHAPE.test(value)
        ? { level: 'ok', message: 'Format valid — 4 to 8 letters or digits.', blocking: false }
        : { level: 'error', message: `${field.label} must be 4 to 8 letters or digits.`, blocking: true }
    case 'money':
    case 'quantity': {
      const n = Number(value)
      if (!Number.isFinite(n)) return { level: 'error', message: 'Enter a number.', blocking: true }
      if (n < 0) return { level: 'error', message: 'Enter zero or more.', blocking: true }
      return { level: 'ok', message: field.kind === 'money' ? `Will be set to ${formatMoney(n)}.` : `Will be set to ${formatQty(n)}.`, blocking: false }
    }
    case 'select':
      return Number.isInteger(Number(value)) && Number(value) > 0
        ? { level: 'ok', message: 'Ready to apply.', blocking: false }
        : { level: 'error', message: `Choose a ${field.label.toLowerCase()}.`, blocking: true }
    case 'status':
      return value === '1' || value === '0'
        ? { level: 'ok', message: 'Ready to apply.', blocking: false }
        : { level: 'error', message: 'Choose Active or Inactive.', blocking: true }
    default:
      return { level: 'ok', message: 'Ready to apply.', blocking: false }
  }
}

/**
 * The tidied-up form of what was typed, when tidying it would change anything.
 *
 * OFFERED, never applied: the user presses the suggestion to take it. A code
 * carries legal weight, and rewriting one while somebody is still typing —
 * dropping a space they meant to keep, "fixing" a value they pasted from a
 * return — is exactly the silent alteration this screen must not make.
 *
 * Deterministic and tiny on purpose. It removes separators a spreadsheet adds
 * (`1234 5678`, `1234-5678`) and trims; it never invents a value, never looks
 * an item up, and never proposes a code for an item that has none.
 */
export function suggestNormalizedValue(field: BulkFieldSpec, raw: string): string | null {
  if (field.kind === 'code') {
    const cleaned = raw.replace(/[\s -]+/g, '')
    return cleaned !== raw && cleaned !== '' ? cleaned : null
  }
  if (field.kind === 'money' || field.kind === 'quantity') {
    // Thousands separators and stray currency marks: a pasted "₹ 1,250.00".
    const cleaned = raw.replace(/[\s ,₹]/g, '')
    return cleaned !== raw && cleaned !== '' && Number.isFinite(Number(cleaned)) ? cleaned : null
  }
  const trimmed = raw.trim()
  return trimmed !== raw && trimmed !== '' ? trimmed : null
}

/** What goes on the wire. `null` clears the column; status is the API's 1 / 0. */
export function toPayloadValue(field: BulkFieldSpec, raw: string): string | number | null {
  const value = raw.trim()
  if (field.kind === 'status') return value === '1' ? 1 : 0
  if (value === '') return null
  if (field.kind === 'money' || field.kind === 'quantity' || field.kind === 'select') return Number(value)
  return value
}
