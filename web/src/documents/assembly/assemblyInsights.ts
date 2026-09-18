/**
 * What the assistant panel has to say about the assembly currently on screen.
 *
 * Every insight here is DERIVED — from the draft, from the availability check the form already
 * ran, from the valuation costs it already fetched, from the recent assemblies it already listed.
 * Nothing is requested from a model and nothing is invented: an assistant that guesses a quantity
 * or a cost on an inventory document is not a convenience, it is a second, unaccountable author
 * of a stock movement.
 *
 * Pure, so the rules are unit-testable and the panel only has to render what this returns.
 */

import { formatQty } from '../../utils/format'
import { lineBaseQty } from '../formModel'
import type { LineDraft } from '../formModel'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { shortBy } from '../../services/stockApi'
import type { AssemblyCostSummary, AssemblyMode } from './assemblyModel'
import { filledComponents } from './assemblyModel'

export type InsightKind =
  | 'shortage'
  | 'missing_serials'
  | 'no_output'
  | 'bom_available'
  | 'cost_concentration'
  | 'repeat_last'

export type InsightTone = 'critical' | 'warning' | 'info'

export interface AssemblyInsight {
  kind: InsightKind
  tone: InsightTone
  /** One sentence, already written for a reader. */
  message: string
  /** Label of the button beside it, when there is something to do about it. */
  actionLabel?: string
}

export interface InsightInput {
  components: readonly LineDraft[]
  finished: LineDraft | null
  availability: Record<string, AvailabilityCheckResult>
  cost: AssemblyCostSummary
  /** A bill of materials whose finished item is the one on the form, when one exists. */
  bomForFinished: { bom_id: number; bom_name: string } | null
  /**
   * The assembly type the user chose.
   *
   * `custom` is a statement that this kit is NOT a saved recipe, so offering the BOM of its
   * finished item second-guesses a decision the user has already made on the form.
   */
  mode: AssemblyMode
  /** The most recent posted assembly, for "do that again". */
  lastAssembly: { document_id: number; document_no: string | null; finished_item: string | null } | null
}

/** Share of the component cost above which one line is worth remarking on. */
const CONCENTRATION_THRESHOLD = 0.6

/**
 * The insights that apply, most urgent first.
 *
 * Capped by the caller, not here: the rules are cheap, and which of them fit on the screen is a
 * layout question the panel is better placed to answer than this is.
 */
export function assemblyInsights(input: InsightInput): AssemblyInsight[] {
  const out: AssemblyInsight[] = []
  const components = filledComponents(input.components)

  const short = components.filter((line) => {
    const result = input.availability[line.key]
    return result !== undefined && !result.ok
  })
  if (short.length > 0) {
    const worst = short
      .map((line) => ({ line, gap: shortBy(input.availability[line.key]) }))
      .sort((a, b) => b.gap - a.gap)[0]
    out.push({
      kind: 'shortage',
      tone: 'critical',
      message:
        short.length === 1
          ? `${worst.line.item_name || 'One component'} is short by ${formatQty(worst.gap)}.`
          : `${short.length} components are short of stock — ${worst.line.item_name || 'one of them'} by ${formatQty(worst.gap)}.`,
      actionLabel: 'Review shortages',
    })
  }

  const serialGaps = [...components, ...(input.finished ? [input.finished] : [])].filter((line) => {
    if (!line.item_id || !line.track_serial) return false
    const need = lineBaseQty(line)
    return need > 0 && line.serials.length !== need
  })
  if (serialGaps.length > 0) {
    out.push({
      kind: 'missing_serials',
      tone: 'warning',
      message:
        serialGaps.length === 1
          ? `${serialGaps[0].item_name || 'One line'} needs its serial numbers picked before this can post.`
          : `${serialGaps.length} lines are serial-tracked and do not have the right number of serials picked.`,
    })
  }

  if (components.length > 0 && (!input.finished || input.finished.item_id === null)) {
    out.push({
      kind: 'no_output',
      tone: 'warning',
      message: 'Components are listed but nothing is being built — pick the assembled item.',
    })
  }

  if (input.bomForFinished && components.length === 0 && input.mode !== 'custom') {
    out.push({
      kind: 'bom_available',
      tone: 'info',
      message: `${input.bomForFinished.bom_name} is a bill of materials for this item — import it instead of typing the components.`,
      actionLabel: 'Import from BOM',
    })
  }

  if (input.cost.componentCost > 0 && !input.cost.partial && input.cost.rows.length > 1) {
    const dearest = [...input.cost.rows].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0]
    const share = (dearest.amount ?? 0) / input.cost.componentCost
    if (share >= CONCENTRATION_THRESHOLD) {
      const name = components.find((c) => c.key === dearest.key)?.item_name
      out.push({
        kind: 'cost_concentration',
        tone: 'info',
        message: `${name || 'One component'} carries ${Math.round(share * 100)}% of the expected cost — worth checking the quantity.`,
      })
    }
  }

  if (components.length === 0 && input.lastAssembly) {
    const number = input.lastAssembly.document_no ?? `#${input.lastAssembly.document_id}`
    out.push({
      kind: 'repeat_last',
      tone: 'info',
      message: input.lastAssembly.finished_item
        ? `Your last assembly ${number} built ${input.lastAssembly.finished_item}. Start from it?`
        : `Start from your last assembly, ${number}?`,
      actionLabel: 'Copy last assembly',
    })
  }

  return out
}
