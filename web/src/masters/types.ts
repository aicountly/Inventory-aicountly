import type { Column } from '../components/DataTable'
import type { PickedItem } from '../components/ItemPicker'
import type { QueryParams, SortOrder } from '../services/api'
import type { ItemFormOptions, ItemSearchRow } from '../services/items'
import type { CrudApi } from '../services/masters'

/**
 * Declarative description of a master screen. One `MasterPage` renders every
 * simple master (list, filters, modal form, soft delete) from a `MasterConfig`.
 */

export type FormValues = Record<string, unknown>

export type FieldType = 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'date' | 'item'

export interface SelectOption {
  value: string | number
  label: string
}

export interface FieldContext<T> {
  values: FormValues
  mode: 'create' | 'edit'
  row: T | null
  options: ItemFormOptions | null
  /** Rows currently loaded in the list (all rows in tree mode). */
  rows: T[]
}

export interface FieldDef<T> {
  name: string
  label: string
  type: FieldType
  required?: boolean
  placeholder?: string
  help?: string
  /** Grid span inside the form. */
  span?: 1 | 2 | 'all'
  /** Select options — static, or derived from the context. */
  options?: SelectOption[] | ((ctx: FieldContext<T>) => SelectOption[])
  /**
   * Async select options, reloaded whenever any of `dependsOn` changes.
   * Takes precedence over `options`.
   */
  loadOptions?: (ctx: FieldContext<T>, signal: AbortSignal) => Promise<SelectOption[]>
  dependsOn?: string[]
  /** Label of the empty choice for optional selects. */
  emptyLabel?: string
  min?: number
  max?: number
  step?: number | 'any'
  maxLength?: number
  hidden?: (ctx: FieldContext<T>) => boolean
  disabled?: (ctx: FieldContext<T>) => boolean
  /** `item` fields: hide search rows that do not qualify. */
  itemFilter?: (row: ItemSearchRow) => boolean
  /** Extra client-side check; return a message to block submit. */
  validate?: (value: unknown, ctx: FieldContext<T>) => string | null
}

export interface FilterDef {
  name: string
  label: string
  options: SelectOption[] | ((options: ItemFormOptions | null) => SelectOption[])
  allLabel?: string
}

export interface TreeConfig {
  parentKey: string
}

export interface MasterConfig<T> {
  /** URL and API slug, e.g. `stock-categories`. */
  slug: string
  /** Permission slug, e.g. `stock_categories`. */
  permissionSlug: string
  title: string
  singular: string
  idKey: keyof T & string
  nameOf: (row: T) => string
  api: CrudApi<T>
  columns: Column<T>[]
  defaultSort: string
  defaultOrder?: SortOrder
  filters?: FilterDef[]
  /** Show the built-in Active / Inactive filter (masters with `is_active`). Default true. */
  hasActiveFilter?: boolean
  fields: FieldDef<T>[]
  toValues?: (row: T | null, options: ItemFormOptions | null) => FormValues
  toPayload?: (values: FormValues, row: T | null) => Record<string, unknown>
  searchPlaceholder?: string
  emptyMessage?: string
  listQuery?: QueryParams
  /** Fetch `/v1/items/form-options` for dropdowns. Default true. */
  needsFormOptions?: boolean
  modalSize?: 'md' | 'lg' | 'xl'
  /** Render the list as a tree by default (self-referencing masters). */
  tree?: TreeConfig
  /** Navigate to a route instead of opening the modal form. */
  createRoute?: string
  editRoute?: (row: T) => string
  /** Copy shown in the delete confirmation. */
  deleteHint?: string
  /** Delete is physical (no soft delete) — wording changes. */
  hardDelete?: boolean
}

/** Value held by an `item` field. */
export type ItemFieldValue = PickedItem | null
