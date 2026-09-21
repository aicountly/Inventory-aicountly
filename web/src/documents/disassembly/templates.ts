/**
 * Disassembly templates — a named set of components a user tears down often.
 *
 * ## Where they live, and why that is stated on screen
 *
 * There is no template endpoint in the Inventory API, and inventing a server-side store for one
 * screen is not this change's job. Templates are therefore kept in this browser, scoped by
 * company and by the signed-in member — exactly how `registers/columnPrefs.ts` keeps a reader's
 * column choices — and every surface that offers them says "saved on this device" so nobody
 * expects a colleague to see one. They hold no stock, no costs and no quantities that post by
 * themselves: a template is a list of items and quantities that fills the form, which the user
 * then reviews and saves like anything else they typed.
 *
 * When a server-side catalogue is built (`GET/POST /v1/document-templates?document_type=…`),
 * swap the three functions below for API calls; the dialog above them does not change.
 */

import { toNumber } from '../../utils/format'

export interface TemplateComponent {
  item_id: number
  item_name: string
  item_sku: string | null
  qty: number
  unit_id: number | null
}

export interface DisassemblyTemplate {
  id: string
  name: string
  finished_item_id: number | null
  finished_item_name: string | null
  finished_qty: number
  components: TemplateComponent[]
  saved_at: string
}

const KEY_PREFIX = 'inventory.disassembly.templates'

function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function storageKey(cmpId: number | null, memberUuid: string | null): string | null {
  if (!cmpId) return null
  const who = String(memberUuid ?? '').trim() || 'anon'
  return `${KEY_PREFIX}.${cmpId}.${who}`
}

function parse(raw: string | null): DisassemblyTemplate[] {
  if (!raw) return []
  try {
    const list = JSON.parse(raw) as unknown
    if (!Array.isArray(list)) return []
    return list.filter(isTemplate)
  } catch {
    return []
  }
}

function isTemplate(value: unknown): value is DisassemblyTemplate {
  if (!value || typeof value !== 'object') return false
  const t = value as Record<string, unknown>
  return typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.components)
}

export function readTemplates(cmpId: number | null, memberUuid: string | null): DisassemblyTemplate[] {
  const key = storageKey(cmpId, memberUuid)
  const store = safeStorage()
  if (!key || !store) return []
  return parse(store.getItem(key)).sort((a, b) => (b.saved_at || '').localeCompare(a.saved_at || ''))
}

export function saveTemplate(cmpId: number | null, memberUuid: string | null, template: Omit<DisassemblyTemplate, 'id' | 'saved_at'>): DisassemblyTemplate[] {
  const key = storageKey(cmpId, memberUuid)
  const store = safeStorage()
  if (!key || !store) return []
  const existing = parse(store.getItem(key))
  const name = template.name.trim()
  const row: DisassemblyTemplate = {
    ...template,
    name,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    saved_at: new Date().toISOString(),
  }
  // Same name replaces: saving "Laptop teardown" twice means correcting it, not collecting two.
  const next = [row, ...existing.filter((t) => t.name.toLowerCase() !== name.toLowerCase())].slice(0, 50)
  try {
    store.setItem(key, JSON.stringify(next))
  } catch {
    /* a full or blocked store loses the template, never the document */
  }
  return next
}

export function deleteTemplate(cmpId: number | null, memberUuid: string | null, id: string): DisassemblyTemplate[] {
  const key = storageKey(cmpId, memberUuid)
  const store = safeStorage()
  if (!key || !store) return []
  const next = parse(store.getItem(key)).filter((t) => t.id !== id)
  try {
    store.setItem(key, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  return next
}

/** Rows a pasted or uploaded file produced, before they are resolved against the item master. */
export interface ImportedRow {
  line: number
  code: string
  qty: number | null
  warehouse: string | null
  raw: string
}

/**
 * Parse a pasted block or a CSV / TSV file into component rows.
 *
 * Deliberately forgiving about the separator (comma, tab or semicolon) and about a header row,
 * because what people actually paste comes out of a spreadsheet. It resolves nothing: the codes
 * are looked up against the live item master by the caller, so a typo fails as "not found"
 * rather than as a row that silently posts against the wrong item.
 */
export function parseImportText(text: string): ImportedRow[] {
  const rows: ImportedRow[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((raw, i) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    const cells = trimmed.split(/\t|,|;/).map((c) => c.trim().replace(/^"|"$/g, ''))
    const code = cells[0] ?? ''
    if (!code) return
    // A header row names its columns; it is not a component.
    if (i === 0 && /^(item|sku|code|barcode|item[_ ]?code)$/i.test(code)) return
    rows.push({
      line: i + 1,
      code,
      qty: toNumber(cells[1]),
      warehouse: cells[2] ? cells[2] : null,
      raw: trimmed,
    })
  })
  return rows
}
