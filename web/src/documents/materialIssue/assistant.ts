/**
 * The Aicountly assistant's suggestions for a material issue.
 *
 * Deterministic rules over the draft on screen — no model, no network, no
 * dependency that can make the form unusable when it is down. It reads the same
 * state the validator and the availability check read, so what it says and what
 * posting does can never disagree.
 *
 * Pure, so every rule is unit-tested. If an Aicountly AI service is ever wired
 * in, it belongs behind the same `AssistantSuggestion[]` shape and must stay
 * additive: the issue posts with or without it.
 */

import type { AvailabilityCheckResult } from '../../services/stockApi'
import { shortBy } from '../../services/stockApi'
import { formatQty } from '../../utils/format'
import { isBlankLine, lineBaseQty } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'

export type SuggestionTone = 'info' | 'warning' | 'danger'

export interface AssistantSuggestion {
  id: string
  tone: SuggestionTone
  message: string
}

export interface AssistantInput {
  header: HeaderDraft
  lines: LineDraft[]
  availability: Record<string, AvailabilityCheckResult>
  /** Resolves a warehouse id to its name, so a message can name the place. */
  warehouseName: (id: number | null | undefined) => string
}

/** Shown when the draft is empty or entirely healthy — what the screen can do. */
const RESTING_TIPS: readonly AssistantSuggestion[] = [
  { id: 'tip-search', tone: 'info', message: 'Search items by name, SKU or barcode — or scan straight into a line.' },
  { id: 'tip-stock', tone: 'info', message: 'Stock availability is checked live as you type, and again before posting.' },
  { id: 'tip-trace', tone: 'info', message: 'Batch and serial selection keeps the issue traceable to the exact stock that left.' },
  { id: 'tip-valuation', tone: 'info', message: 'Posting values the issue and reflects it in COGS and stock valuation immediately.' },
]

/** How close to the whole of what is on hand a line has to be before it is worth saying. */
const HEAVY_CONSUMPTION_RATIO = 0.8

function itemLabel(line: LineDraft): string {
  return line.item_name || (line.item_id ? `Item #${line.item_id}` : 'this line')
}

/**
 * A key that means "the same stock": the same item out of the same warehouse
 * and the same batch. Two lines for one item in different warehouses are
 * ordinary; two for the same bucket are almost always a double entry.
 */
function stockKey(line: LineDraft, header: HeaderDraft): string {
  const warehouse = line.warehouse_id ?? header.default_warehouse_id ?? 0
  return `${line.item_id}:${warehouse}:${line.batch_id ?? 0}`
}

export function assistantSuggestions({ header, lines, availability, warehouseName }: AssistantInput): AssistantSuggestion[] {
  const out: AssistantSuggestion[] = []
  const active = lines.filter((l) => !isBlankLine(l))

  if (active.length === 0) return [...RESTING_TIPS]

  if (!header.reason_code.trim()) {
    out.push({ id: 'reason', tone: 'info', message: 'Add a reason code — it is what makes this issue answerable in an audit.' })
  }

  // Positions come from the full list, not from the active subset: the grid
  // numbers every row it draws, blank ones included, so "line 1" has to mean
  // the row the reader can actually see.
  const seen = new Map<string, number>()
  lines.forEach((line, index) => {
    if (!line.item_id || isBlankLine(line)) return
    const key = stockKey(line, header)
    const first = seen.get(key)
    if (first === undefined) seen.set(key, index + 1)
    else if (first > 0) {
      out.push({ id: `dup-${key}`, tone: 'warning', message: `${itemLabel(line)} is already on line ${first} from the same warehouse and batch.` })
      seen.set(key, 0)
    }
  })

  for (const line of active) {
    if (!line.item_id) continue
    const label = itemLabel(line)

    if (line.track_batch && line.batch_id === null) {
      out.push({ id: `batch-${line.key}`, tone: 'warning', message: `${label} is batch-tracked — pick the batch the stock leaves from.` })
    }

    if (line.track_serial) {
      const required = lineBaseQty(line)
      if (required > 0 && line.serials.length !== required) {
        out.push({
          id: `serial-${line.key}`,
          tone: 'warning',
          message: `${label} needs ${formatQty(required)} serial number${required === 1 ? '' : 's'}; ${line.serials.length} selected.`,
        })
      }
    }

    const result = availability[line.key]
    if (!result) continue
    if (!result.ok) {
      out.push({
        id: `short-${line.key}`,
        tone: 'danger',
        message: `${label} is short by ${formatQty(shortBy(result))} in ${warehouseName(line.warehouse_id ?? header.default_warehouse_id) || 'the selected warehouse'}.`,
      })
      continue
    }
    if (result.available > 0 && result.requested >= result.available * HEAVY_CONSUMPTION_RATIO) {
      const left = result.available - result.requested
      out.push({
        id: `heavy-${line.key}`,
        tone: 'warning',
        message: `${label} takes most of what is available — ${formatQty(left)} left after this issue.`,
      })
    }
  }

  return out.length > 0 ? out : [...RESTING_TIPS]
}
