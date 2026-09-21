/**
 * "AI Assistant" data for the Consumption form.
 *
 * Every function here reads real inventory-documents history through the existing
 * `documentsApi` — there is no AI/ML backend, so nothing here fabricates a response. Each
 * suggestion is a plain, explainable aggregate (most recently/frequently consumed items,
 * items consumed under the same reason code, quantity vs. recent history) that the panel
 * shows to the user for explicit acceptance; nothing here inserts or changes a line by itself.
 */

import { documentsApi } from '../../services/documentsApi'
import { formatQty, toNumber } from '../../utils/format'
import { POSTED_STATUSES } from '../actions'
import { lineBaseQty, round4 } from '../formModel'
import type { LineDraft } from '../formModel'
import type { DocumentLine, InventoryDocument } from '../types'

const POSTED = POSTED_STATUSES.join(',')
const RECENT_DOC_LIMIT = 12
const REASON_DOC_LIMIT = 10
const ANOMALY_DOC_LIMIT = 8
const ANOMALY_MAX_LINES = 12
const ANOMALY_MULTIPLIER = 2.5
const ANOMALY_STRONG_MULTIPLIER = 4
const ANOMALY_MIN_SAMPLES = 2

export interface ConsumptionItemSuggestion {
  item_id: number
  item_name: string
  item_sku: string | null
  unit_id: number | null
  unit_symbol: string | null
  /** Quantity on the most recent matching line — a starting point, not a recommendation to post it unchanged. */
  last_qty: number
  occurrences: number
  last_document_date: string | null
}

/** Exported for unit testing; also used internally by the two suggestion functions below. */
export function aggregateLines(linesByDoc: Record<number, DocumentLine[]>, docDates: Map<number, string>): ConsumptionItemSuggestion[] {
  const byItem = new Map<number, ConsumptionItemSuggestion>()
  for (const [docIdStr, lines] of Object.entries(linesByDoc)) {
    const date = docDates.get(Number(docIdStr)) ?? null
    for (const line of lines) {
      if (line.direction !== 'out') continue
      const existing = byItem.get(line.item_id)
      if (!existing) {
        byItem.set(line.item_id, {
          item_id: line.item_id,
          item_name: line.item_label ?? line.item_name ?? `Item #${line.item_id}`,
          item_sku: line.item_sku ?? null,
          unit_id: line.unit_id,
          unit_symbol: line.unit_symbol ?? null,
          last_qty: Number(line.qty) || 0,
          occurrences: 1,
          last_document_date: date,
        })
        continue
      }
      existing.occurrences += 1
      if (date && (!existing.last_document_date || date > existing.last_document_date)) {
        existing.last_document_date = date
        existing.last_qty = Number(line.qty) || 0
      }
    }
  }
  return [...byItem.values()].sort((a, b) => {
    const byDate = (b.last_document_date ?? '').localeCompare(a.last_document_date ?? '')
    return byDate !== 0 ? byDate : b.occurrences - a.occurrences
  })
}

/** Items most recently/frequently issued on posted Consumption documents, newest first. */
export async function recentlyConsumedItems(limit = 8, signal?: AbortSignal): Promise<ConsumptionItemSuggestion[]> {
  const list = await documentsApi.list({ document_type: 'CONSUMPTION', status: POSTED, sort: 'document_date', order: 'desc', limit: RECENT_DOC_LIMIT }, signal)
  if (list.data.length === 0) return []
  const docDates = new Map(list.data.map((d) => [d.document_id, d.document_date]))
  const linesByDoc = await documentsApi.lines(list.data.map((d) => d.document_id), signal)
  return aggregateLines(linesByDoc, docDates).slice(0, limit)
}

/** Items consumed under the same reason code recently — [] when there is no reason set or no history yet. */
export async function suggestItemsForReason(reasonCode: string, limit = 6, signal?: AbortSignal): Promise<ConsumptionItemSuggestion[]> {
  const reason = reasonCode.trim().toLowerCase()
  if (!reason) return []
  const list = await documentsApi.list({ document_type: 'CONSUMPTION', status: POSTED, sort: 'document_date', order: 'desc', limit: REASON_DOC_LIMIT }, signal)
  if (list.data.length === 0) return []
  // The list row does not carry reason_code (a header field), so the matching documents are
  // fetched in full — bounded to REASON_DOC_LIMIT recent Consumption documents and only on
  // explicit user action, never in the background.
  const docs = await Promise.all(
    list.data.map((d) =>
      documentsApi.get(d.document_id, signal).catch((): InventoryDocument | null => null),
    ),
  )
  const matching = docs.filter((d): d is InventoryDocument => d !== null && (d.reason_code ?? '').trim().toLowerCase() === reason)
  if (matching.length === 0) return []
  const linesByDoc: Record<number, DocumentLine[]> = {}
  const docDates = new Map<number, string>()
  for (const d of matching) {
    linesByDoc[d.document_id] = d.lines
    docDates.set(d.document_id, d.document_date)
  }
  return aggregateLines(linesByDoc, docDates).slice(0, limit)
}

export interface ConsumptionAnomaly {
  lineKey: string
  itemId: number
  itemName: string
  currentQty: number
  averageQty: number
  sampleSize: number
  severity: 'info' | 'warning'
  message: string
}

/**
 * Flags lines whose quantity is far above the recent posted average for that item, so the user
 * can double-check before posting. Purely advisory: it never touches a line's quantity.
 */
export async function detectConsumptionAnomalies(lines: readonly LineDraft[], signal?: AbortSignal): Promise<ConsumptionAnomaly[]> {
  const candidates = lines.filter((l) => l.item_id !== null && (toNumber(l.qty) ?? 0) > 0).slice(0, ANOMALY_MAX_LINES)
  if (candidates.length === 0) return []
  const uniqueItemIds = [...new Set(candidates.map((l) => l.item_id as number))]
  const perItem = await Promise.all(
    uniqueItemIds.map(async (itemId) => {
      try {
        const res = await documentsApi.list({ document_type: 'CONSUMPTION', item_id: itemId, status: POSTED, sort: 'document_date', order: 'desc', limit: ANOMALY_DOC_LIMIT }, signal)
        return { itemId, ids: res.data.map((d) => d.document_id) }
      } catch {
        return { itemId, ids: [] as number[] }
      }
    }),
  )
  const allIds = [...new Set(perItem.flatMap((p) => p.ids))]
  const linesByDoc = allIds.length > 0 ? await documentsApi.lines(allIds, signal) : {}
  const idsByItem = new Map(perItem.map((p) => [p.itemId, p.ids]))

  const out: ConsumptionAnomaly[] = []
  for (const line of candidates) {
    const itemId = line.item_id as number
    const docIds = idsByItem.get(itemId) ?? []
    const history: number[] = []
    for (const docId of docIds) {
      for (const dl of linesByDoc[docId] ?? []) {
        if (dl.item_id === itemId && dl.direction === 'out') history.push(Number(dl.base_qty ?? dl.qty) || 0)
      }
    }
    if (history.length < ANOMALY_MIN_SAMPLES) continue
    const avg = history.reduce((a, b) => a + b, 0) / history.length
    const currentBase = lineBaseQty(line)
    if (avg <= 0 || currentBase <= avg * ANOMALY_MULTIPLIER) continue
    const times = currentBase / avg
    out.push({
      lineKey: line.key,
      itemId,
      itemName: line.item_name || `Item #${itemId}`,
      currentQty: currentBase,
      averageQty: round4(avg),
      sampleSize: history.length,
      severity: times > ANOMALY_STRONG_MULTIPLIER ? 'warning' : 'info',
      message: `${line.item_name || 'This item'}: ${formatQty(currentBase)} is ${times.toFixed(1)}× the recent average of ${formatQty(avg)} over the last ${history.length} posted consumption${history.length === 1 ? '' : 's'}.`,
    })
  }
  return out
}
