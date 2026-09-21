/**
 * Bulk-edit templates — a named configuration a reader comes back to.
 *
 * Stored in `localStorage`, scoped by company AND by the signed-in member's
 * uuid, exactly as `registers/movement/savedViews.ts` stores saved views and
 * `registers/columnPrefs.ts` stores column choices: on a shared machine one
 * person's templates must not greet the next person who signs in, and a
 * template built against one company's item groups is meaningless in another.
 *
 * It is deliberately NOT presented as a team feature. Inventory's API has no
 * template resource, so nothing here can be shared with a colleague, survive a
 * cleared browser or reach a second device — and a control that implied
 * otherwise would be the worst kind of wrong, because the reader only finds out
 * when the template they relied on is gone. The dialog says where they live, in
 * as many words, and the store is written against this small interface so a
 * future `/v1/bulk-edit-templates` can replace the storage without touching the
 * UI.
 *
 * ## What a template may hold
 *
 * The QUESTION, never the answer: which field, optionally a default value, and
 * the filters that narrow the catalogue. It does not hold item ids. A list of
 * forty ids saved in March and applied in September would write to whichever
 * items still happen to carry those numbers, which is not what "the same bulk
 * edit as last time" means to anybody.
 */

export interface BulkEditTemplate {
  id: string
  name: string
  /** A `BulkEditableField` key. Validated on load — a stale key falls back. */
  field: string
  /** The default new value, as it would be typed. May be empty. */
  value: string
  /** `item_grp_id` filter, '' for all groups. */
  groupId: string
  /** `active` | `inactive` | '' (all). */
  status: string
  /** Epoch millis, for ordering and for "saved on". */
  savedAt: number
}

const KEY_PREFIX = 'inventory.items.bulkEditTemplates'

/** Enough for a working set; a hundred named templates is a filing system, not a shortcut. */
export const MAX_TEMPLATES = 20

export interface TemplateScope {
  cmpId: number | null | undefined
  userUuid: string | null | undefined
}

function storageKey({ cmpId, userUuid }: TemplateScope): string | null {
  const id = String(userUuid ?? '').trim()
  if (!id || cmpId === null || cmpId === undefined || !Number.isFinite(Number(cmpId))) return null
  return `${KEY_PREFIX}.${Number(cmpId)}.${id}`
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isTemplate(value: unknown): value is BulkEditTemplate {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.field === 'string' &&
    typeof v.value === 'string' &&
    typeof v.groupId === 'string' &&
    typeof v.status === 'string' &&
    typeof v.savedAt === 'number'
  )
}

/** Every template for this company and member, newest first. Never throws. */
export function loadTemplates(scope: TemplateScope): BulkEditTemplate[] {
  const key = storageKey(scope)
  const store = key ? safeStorage() : null
  if (!key || !store) return []
  try {
    const parsed: unknown = JSON.parse(store.getItem(key) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isTemplate).sort((a, b) => b.savedAt - a.savedAt)
  } catch {
    return []
  }
}

/**
 * Write the list, then hand back what can actually be read again.
 *
 * Reading back rather than returning the optimistic list is the point: with no
 * member uuid yet, or in a browser that refuses `localStorage`, the write is a
 * no-op, and a caller handed its own list would show a template that will not
 * be there when the panel is next opened. A shortcut that silently forgets is
 * worse than one that plainly did not save.
 */
function persist(scope: TemplateScope, templates: BulkEditTemplate[]): BulkEditTemplate[] {
  const key = storageKey(scope)
  const store = key ? safeStorage() : null
  if (!key || !store) return loadTemplates(scope)
  try {
    store.setItem(key, JSON.stringify(templates))
  } catch {
    // Quota, or a private window that allows reads and refuses writes.
  }
  return loadTemplates(scope)
}

/** True when this browser and session can actually keep a template. */
export function templatesAvailable(scope: TemplateScope): boolean {
  return storageKey(scope) !== null && safeStorage() !== null
}

export type TemplateDraft = Omit<BulkEditTemplate, 'id' | 'savedAt'>

/**
 * Save `draft` under its name, replacing a template of the same name.
 *
 * Replacing rather than duplicating is what a reader expects from "save": two
 * entries called "Monthly price list" differing by a filter nobody can see is a
 * list you cannot use. The name is trimmed and compared case-insensitively for
 * the same reason.
 */
export function saveTemplate(scope: TemplateScope, draft: TemplateDraft): BulkEditTemplate[] {
  const name = draft.name.trim()
  if (!name) return loadTemplates(scope)
  const existing = loadTemplates(scope).filter((t) => t.name.toLowerCase() !== name.toLowerCase())
  const template: BulkEditTemplate = {
    ...draft,
    name,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: Date.now(),
  }
  return persist(scope, [template, ...existing].slice(0, MAX_TEMPLATES))
}

export function deleteTemplate(scope: TemplateScope, id: string): BulkEditTemplate[] {
  return persist(
    scope,
    loadTemplates(scope).filter((t) => t.id !== id),
  )
}
