/**
 * Reusable shapes for a stock journal.
 *
 * A template is the skeleton of a recurring adjustment — the reason, the
 * warehouse, and the items that are always on it — not a document. It holds no
 * quantities and no batch or serial selections, because those are what makes one
 * adjustment different from the next, and it is stored per company in this
 * browser rather than on the server: there is no template table in the API, and
 * inventing one would be a schema change nobody asked for.
 */

import type { HeaderDraft, LineDraft } from '../formModel'

const PREFIX = 'aic.inv.sj.templates'
const VERSION = 1

export interface TemplateLine {
  item_id: number
  item_name: string
  item_sku: string | null
  warehouse_id: number | null
  direction: 'in' | 'out' | null
  description: string
}

export interface JournalTemplate {
  id: string
  name: string
  createdAt: number
  reason_code: string
  movement_reason: string
  narration: string
  default_warehouse_id: number | null
  lines: TemplateLine[]
}

interface TemplateFile {
  version: number
  templates: JournalTemplate[]
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function key(cmpId: number | null): string {
  return `${PREFIX}.${cmpId ?? 0}`
}

export function listTemplates(cmpId: number | null): JournalTemplate[] {
  const store = storage()
  if (!store) return []
  try {
    const raw = store.getItem(key(cmpId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as TemplateFile
    if (parsed?.version !== VERSION || !Array.isArray(parsed.templates)) return []
    return parsed.templates
  } catch {
    return []
  }
}

function write(cmpId: number | null, templates: JournalTemplate[]): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(key(cmpId), JSON.stringify({ version: VERSION, templates } satisfies TemplateFile))
  } catch {
    /* quota — a template is a convenience, never data the user cannot recreate */
  }
}

export function templateFromDraft(name: string, header: HeaderDraft, lines: readonly LineDraft[]): JournalTemplate {
  return {
    id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim().slice(0, 80) || 'Untitled template',
    createdAt: Date.now(),
    reason_code: header.reason_code,
    movement_reason: header.movement_reason,
    narration: header.narration,
    default_warehouse_id: header.default_warehouse_id,
    lines: lines
      .filter((l) => l.item_id !== null)
      .map((l) => ({
        item_id: l.item_id as number,
        item_name: l.item_name,
        item_sku: l.item_sku,
        warehouse_id: l.warehouse_id,
        direction: l.direction,
        description: l.description,
      })),
  }
}

export function saveTemplate(cmpId: number | null, template: JournalTemplate): JournalTemplate[] {
  const next = [template, ...listTemplates(cmpId).filter((t) => t.id !== template.id)].slice(0, 30)
  write(cmpId, next)
  return next
}

export function deleteTemplate(cmpId: number | null, id: string): JournalTemplate[] {
  const next = listTemplates(cmpId).filter((t) => t.id !== id)
  write(cmpId, next)
  return next
}
