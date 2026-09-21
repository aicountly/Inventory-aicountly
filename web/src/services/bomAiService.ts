/**
 * The seam between the bill-of-materials workspace and an AI drafting service.
 *
 * ## Why this file exists at all
 *
 * The Inventory API has no AI endpoint today. The screen still needs the entry
 * point — choosing a source, describing what to build, reviewing a draft — so
 * the UI is written against THIS interface rather than against a URL that does
 * not answer. When the endpoint lands, `suggest()` stops returning
 * `unavailable` and nothing above it changes.
 *
 * ## What it will never do
 *
 * It does not fabricate a draft. `availability()` reports honestly, the drawer
 * shows a "not available yet" state, and no component list is ever invented to
 * make the feature look finished — a made-up bill of materials is a production
 * instruction, and the cost of one being believed is measured in material.
 *
 * A draft, when one does arrive, is a DRAFT: it opens in the editor for review
 * and is saved through the ordinary `POST /v1/bill-of-materials`, under the
 * same validation and the same permissions as a hand-typed one. Nothing here
 * activates a bill, and nothing here writes.
 */

import { getApiBaseUrl } from '../config'
import type { PickedItem } from '../components/ItemPicker'

/** How the user wants the first draft prepared. */
export type BomAiSourceType = 'item' | 'document' | 'text' | 'existing_bom' | 'template'

export interface BomAiRequest {
  source_type: BomAiSourceType
  /** The finished item the bill produces, when one has been chosen. */
  finished_item_id?: number | null
  /** An item id, a BOM id, a template key or an uploaded document reference. */
  source_reference?: string | number | null
  /** Pasted specification, or a note steering the draft. */
  instructions?: string
}

/** A component the service proposes. Quantities are per yield, like a BOM line. */
export interface BomAiDraftLine {
  item_id: number | null
  item_name: string
  item_sku?: string | null
  qty: number
  unit_id?: number | null
  unit_symbol?: string | null
  scrap_percent?: number
  line_kind?: 'component' | 'by_product' | 'scrap'
  /** Why the service proposed it — shown beside the row during review. */
  note?: string
}

export interface BomAiDraft {
  bom_name: string
  finished_item_id: number | null
  yield_qty: number
  yield_unit_id?: number | null
  lines: BomAiDraftLine[]
  /** Anything the service could not resolve and wants a human to settle. */
  warnings?: string[]
}

export type BomAiResult =
  | { status: 'ready'; draft: BomAiDraft }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; message: string }

export interface BomAiAvailability {
  available: boolean
  /** One sentence for the drawer when `available` is false. */
  reason: string
}

/**
 * The company's AI drafting capability.
 *
 * Deliberately synchronous and deliberately not a network probe: a request per
 * drawer open, to an endpoint that does not exist, would be a 404 in every
 * console for no gain. When the capability ships it will arrive with the rest
 * of the session's feature flags and be read from there.
 */
export function bomAiAvailability(): BomAiAvailability {
  return {
    available: false,
    reason:
      'AI drafting is not switched on for this company yet. You can still start a bill of materials from an existing one, from a template structure, or from scratch.',
  }
}

/**
 * Ask for a draft.
 *
 * Returns `unavailable` rather than throwing while the capability is off, so
 * the caller renders a state instead of a stack trace. The request shape is
 * fixed here so that the day the endpoint lands, only this function changes.
 *
 * Company, financial year and branch are NOT passed in: every Inventory request
 * carries the active scope through `services/api`, and a second copy of the
 * tenant in a payload is a second thing that can be wrong.
 */
export async function suggestBom(request: BomAiRequest, signal?: AbortSignal): Promise<BomAiResult> {
  const availability = bomAiAvailability()
  if (!availability.available) {
    return { status: 'unavailable', reason: availability.reason }
  }
  /* c8 ignore start -- unreachable until the capability is switched on */
  try {
    const res = await fetch(`${getApiBaseUrl()}/v1/bill-of-materials/ai/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(request),
      signal,
    })
    if (!res.ok) return { status: 'error', message: `The drafting service replied ${res.status}.` }
    const body = (await res.json()) as { data?: BomAiDraft }
    if (!body?.data) return { status: 'error', message: 'The drafting service returned nothing to review.' }
    return { status: 'ready', draft: body.data }
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'Could not reach the drafting service.' }
  }
  /* c8 ignore stop */
}

/* -------------------------------------------------------------------------- */
/* Starting points                                                             */
/* -------------------------------------------------------------------------- */

export interface BomAiSource {
  type: BomAiSourceType
  title: string
  description: string
  /** False while the source needs a capability this deployment does not have. */
  needsAi: boolean
}

/**
 * The five ways to begin, as the drawer lists them.
 *
 * Two of them — copying an existing bill and starting from a template — are
 * plain data operations this app can do today, so they are marked `needsAi:
 * false` and stay usable while the drafting service is off. Presenting all five
 * as equally unavailable would hide two working features behind a missing one.
 */
export const BOM_AI_SOURCES: readonly BomAiSource[] = [
  {
    type: 'item',
    title: 'From a finished item',
    description: 'Analyse the selected item and suggest its components and quantities.',
    needsAi: true,
  },
  {
    type: 'document',
    title: 'Upload a drawing or document',
    description: 'A PDF, an image or a written specification of the product.',
    needsAi: true,
  },
  {
    type: 'text',
    title: 'Paste a specification',
    description: 'Paste a manufacturing recipe or a component list and have it read.',
    needsAi: true,
  },
  {
    type: 'existing_bom',
    title: 'Copy an existing bill',
    description: 'Duplicate a bill of materials and edit the copy.',
    needsAi: false,
  },
  {
    type: 'template',
    title: 'Start from a template',
    description: 'Begin with a common manufacturing structure and fill in the items.',
    needsAi: false,
  },
]

/**
 * Template structures.
 *
 * These are EMPTY shapes — the number of component rows to open the editor
 * with and what to call the bill — not component data. No template names an
 * item, because an item that does not exist in this company would be a
 * fabricated master record the moment it was saved.
 */
export interface BomTemplate {
  key: string
  title: string
  description: string
  componentRows: number
  byProductRows: number
  scrapRows: number
}

export const BOM_TEMPLATES: readonly BomTemplate[] = [
  {
    key: 'manufactured',
    title: 'Manufactured product',
    description: 'A finished good built from several raw materials.',
    componentRows: 4,
    byProductRows: 0,
    scrapRows: 1,
  },
  {
    key: 'assembly',
    title: 'Assembly',
    description: 'Sub-assemblies and fasteners combined into one unit.',
    componentRows: 3,
    byProductRows: 0,
    scrapRows: 0,
  },
  {
    key: 'packaging_kit',
    title: 'Packaging kit',
    description: 'A product plus its packaging materials.',
    componentRows: 3,
    byProductRows: 0,
    scrapRows: 0,
  },
  {
    key: 'bundle',
    title: 'Bundle',
    description: 'Several finished items sold and built as one.',
    componentRows: 2,
    byProductRows: 0,
    scrapRows: 0,
  },
]

/** The notice shown above every AI-prepared draft, before it can be saved. */
export const BOM_AI_REVIEW_NOTICE =
  'AI suggestions may require review. Confirm component quantities, units and cost before activating the bill of materials.'

/** Convenience for the caller that has an item picked and wants a request. */
export function requestForItem(item: PickedItem | null, instructions = ''): BomAiRequest {
  return {
    source_type: 'item',
    finished_item_id: item?.item_id ?? null,
    source_reference: item?.item_id ?? null,
    instructions,
  }
}
