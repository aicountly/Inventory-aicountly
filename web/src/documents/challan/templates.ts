/**
 * Challan templates — a recurring dispatch saved once and reapplied.
 *
 * Deliberately **local to the browser**. Inventory's API has no template store
 * and inventing one would mean a new table and a new endpoint for a
 * convenience, so a template lives in `localStorage`, scoped to the company it
 * was saved under, and the UI says so plainly. Nothing in a template is master
 * data: it is a list of item ids, quantities and the header choices the user
 * already typed, and every one of them is re-resolved against the live API when
 * the template is applied.
 *
 * What a template never carries: batch and serial selections. Those name
 * specific physical stock that will not be the same stock next month, so they
 * are always re-picked.
 *
 * Pure apart from the storage read/write, which is guarded — a browser with
 * storage disabled loses templates, not the page.
 */

import type { HeaderDraft, LineDraft } from '../formModel'
import { newLine } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import type { DispatchDetails, TransportDetails } from './challanMeta'

const KEY = 'aic.inventory.challan.templates.v1'
const MAX_TEMPLATES = 40

export interface TemplateLine {
  item_id: number
  item_name: string
  item_sku: string | null
  unit_id: number | null
  warehouse_id: number | null
  qty: string
  track_batch: boolean
  track_serial: boolean
}

export interface ChallanTemplate {
  id: string
  name: string
  cmp_id: number
  saved_at: string
  header: {
    party_ref: string
    party_name: string
    default_warehouse_id: number | null
    stock_effect: string
    returnable: boolean
    narration: string
  }
  transport: TransportDetails
  dispatch: DispatchDetails
  lines: TemplateLine[]
}

function read(): ChallanTemplate[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t): t is ChallanTemplate => {
      const c = t as Partial<ChallanTemplate>
      return typeof c?.id === 'string' && typeof c?.name === 'string' && Array.isArray(c?.lines)
    })
  } catch {
    return []
  }
}

function write(all: ChallanTemplate[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all.slice(0, MAX_TEMPLATES)))
    return true
  } catch {
    return false
  }
}

export function listTemplates(cmpId: number | null): ChallanTemplate[] {
  if (cmpId === null) return []
  return read()
    .filter((t) => t.cmp_id === cmpId)
    .sort((a, b) => (a.saved_at < b.saved_at ? 1 : -1))
}

export function newTemplateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `t${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Snapshot the draft. Blank lines and lines without an item are dropped. */
export function templateFromDraft(input: {
  name: string
  cmpId: number
  header: HeaderDraft
  lines: LineDraft[]
  transport: TransportDetails
  dispatch: DispatchDetails
  now?: Date
}): ChallanTemplate {
  const { name, cmpId, header, lines, transport, dispatch } = input
  return {
    id: newTemplateId(),
    name: name.trim().slice(0, 60) || 'Untitled template',
    cmp_id: cmpId,
    saved_at: (input.now ?? new Date()).toISOString(),
    header: {
      party_ref: header.party_ref,
      party_name: header.party_name,
      default_warehouse_id: header.default_warehouse_id,
      stock_effect: header.stock_effect,
      returnable: header.returnable,
      narration: header.narration,
    },
    transport,
    dispatch,
    lines: lines
      .filter((l) => l.item_id !== null)
      .map((l) => ({
        item_id: l.item_id as number,
        item_name: l.item_name,
        item_sku: l.item_sku,
        unit_id: l.unit_id,
        warehouse_id: l.warehouse_id,
        qty: l.qty,
        track_batch: l.track_batch,
        track_serial: l.track_serial,
      })),
  }
}

export function saveTemplate(template: ChallanTemplate): boolean {
  const all = read().filter((t) => t.id !== template.id)
  return write([template, ...all])
}

export function deleteTemplate(id: string): boolean {
  return write(read().filter((t) => t.id !== id))
}

/**
 * Draft lines for a template. Units come back as a single entry built from the
 * stored unit id — the real unit list is refreshed from the item lookup when
 * the form hydrates, exactly as it is for a saved document being edited.
 */
export function linesFromTemplate(template: ChallanTemplate, spec: DocumentTypeSpec, fallbackWarehouseId: number | null): LineDraft[] {
  return template.lines.map((l) =>
    newLine(spec, {
      item_id: l.item_id,
      item_name: l.item_name,
      item_sku: l.item_sku,
      unit_id: l.unit_id,
      units: l.unit_id ? [{ unit_id: l.unit_id, unit_symbol: null, unit_name: null, conversion_factor: 1, is_default: true }] : [],
      warehouse_id: l.warehouse_id ?? fallbackWarehouseId,
      qty: l.qty,
      track_batch: l.track_batch,
      track_serial: l.track_serial,
    }),
  )
}
