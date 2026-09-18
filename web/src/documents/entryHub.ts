/**
 * The document entry hub's model: every native document type, grouped the way
 * a stores clerk thinks about them, with a reason attached to the ones this
 * user may not raise.
 *
 * Why this exists at all
 * ----------------------
 * Books gave the user a Transactions mega-menu listing every voucher type,
 * always visible from the nav. Inventory put all twenty-one native types behind
 * one "New document ▾" button on one screen (`DocumentsListPage`), which is the
 * only place `NewDocumentMenu` is mounted anywhere in the app — nothing in
 * `config/navRegistry.ts` names a single creatable type. A user who never
 * opened that dropdown had no way to learn that a Stock Journal can be entered
 * here, which is what "nothing is showing" meant.
 *
 * Two rules the tiles obey, and the tests hold them:
 *
 *  1. A type the user may NOT create is SHOWN AND DISABLED with the reason
 *     named. Store Keeper deliberately holds `create` on only the operational
 *     types; hiding the rest tells that user the feature does not exist, which
 *     is exactly the confusion that produced the bug report. `unavailableReason`
 *     is the sentence the tile prints.
 *  2. Nothing is silently empty. Every group is emitted whether or not the user
 *     can use anything in it, so the hub is never a blank page.
 *
 * Pure on purpose — no React, no hooks — so the grouping is unit-testable and
 * the page below it only has to render what this returns.
 */

import {
  ArrowLeftRight,
  Coins,
  FlaskConical,
  PackageCheck,
  PackageMinus,
  SlidersHorizontal,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Can } from './actions'
import { canCreate } from './actions'
import { HIDDEN_FROM_NEW_MENU, NATIVE_DOCUMENT_TYPES, UNAVAILABLE_TYPES } from './registry'
import type { DocumentTypeSpec } from './registry'
import type { IconTone } from '../ui/IconTile'

export type EntryGroupKey =
  | 'receipts'
  | 'issues'
  | 'transfers'
  | 'adjustments'
  | 'production'
  | 'job_work'
  | 'valuation'

/** One glyph + tone per group — the entry hub tile and the create-form hero agree on both. */
export const GROUP_ICON: Record<EntryGroupKey, LucideIcon> = {
  receipts: PackageCheck,
  issues: PackageMinus,
  transfers: ArrowLeftRight,
  adjustments: SlidersHorizontal,
  production: FlaskConical,
  job_work: Wrench,
  valuation: Coins,
}

export const GROUP_TONE: Record<EntryGroupKey, IconTone> = {
  receipts: 'success',
  issues: 'warning',
  transfers: 'info',
  adjustments: 'violet',
  production: 'primary',
  job_work: 'teal',
  valuation: 'slate',
}

export interface EntryGroupSpec {
  key: EntryGroupKey
  label: string
  description: string
  /** Document codes in the order they are offered. */
  codes: readonly string[]
}

/**
 * Every creatable native type belongs to exactly one group.
 *
 * `entryHub.test.ts` asserts that against `NATIVE_DOCUMENT_TYPES`, so a type
 * added to the registry and forgotten here fails the suite rather than quietly
 * vanishing from the only screen that offers it — the failure mode this whole
 * module exists to prevent.
 */
export const ENTRY_GROUPS: readonly EntryGroupSpec[] = [
  {
    key: 'receipts',
    label: 'Receipts',
    description: 'Stock coming in — opening balances, material received and goods arriving on a challan.',
    codes: ['OPENING_STOCK', 'MATERIAL_RECEIPT', 'WRITE_IN', 'INWARD_CHALLAN'],
  },
  {
    key: 'issues',
    label: 'Issues and dispatch',
    description: 'Stock going out — issued to a job, consumed, written off, dispatched or packed for a consignee.',
    codes: ['MATERIAL_ISSUE', 'CONSUMPTION', 'WRITE_OFF', 'DELIVERY_CHALLAN', 'PACKING'],
  },
  {
    key: 'transfers',
    label: 'Transfers',
    description: 'Stock moving between your own warehouses. Quantity and value stay with you.',
    codes: ['STOCK_TRANSFER'],
  },
  {
    key: 'adjustments',
    label: 'Adjustments',
    description: 'Corrections to what the book says — counts, free-form in / out lines, batch and serial fixes.',
    codes: ['STOCK_JOURNAL', 'PHYSICAL_ADJUSTMENT', 'BATCH_ADJUSTMENT', 'SERIAL_ADJUSTMENT'],
  },
  {
    key: 'production',
    label: 'Production',
    description: 'Components out, finished goods in — against a bill of materials or a kit.',
    codes: ['PRODUCTION', 'ASSEMBLY', 'DISASSEMBLY'],
  },
  {
    key: 'job_work',
    label: 'Job work',
    description: 'Material sent to and settled with a job worker. Feeds the quarterly ITC-04 return.',
    codes: ['JOB_WORK_OUT', 'JOB_WORK_IN'],
  },
  {
    key: 'valuation',
    label: 'Valuation',
    description: 'What the stock cost — re-pricing on hand and spreading landing costs over a receipt.',
    codes: ['REVALUATION', 'LANDED_COST'],
  },
]

export interface EntryTypeEntry {
  spec: DocumentTypeSpec
  /** `/documents/new/<slug>` — only meaningful when `allowed`. */
  to: string
  allowed: boolean
  /** Sentence naming why the tile is disabled; null when it is not. */
  unavailableReason: string | null
}

export interface EntryGroup extends EntryGroupSpec {
  entries: readonly EntryTypeEntry[]
  /** At least one entry in this group can actually be raised. */
  anyAllowed: boolean
}

/** Types the hub offers at all — the creatable natives, in registry order. */
export function entryHubTypes(): DocumentTypeSpec[] {
  return NATIVE_DOCUMENT_TYPES.filter((t) => !HIDDEN_FROM_NEW_MENU.has(t.code))
}

/**
 * Why this type cannot be raised, in a sentence that names the type.
 *
 * "You do not have permission" alone sends a reader to support; naming the
 * document and the profile lets them ask for the right thing.
 */
export function unavailableReason(spec: DocumentTypeSpec, can: Can): string | null {
  if (UNAVAILABLE_TYPES.has(spec.code)) {
    return `A ${spec.label} cannot be raised yet: the type is declared but nothing happens when it posts.`
  }
  if (!canCreate(spec.code, can)) {
    return `Your profile does not allow creating a ${spec.label}.`
  }
  return null
}

/** The hub, grouped. Every group is returned, empty of permission or not. */
export function buildEntryHub(can: Can): EntryGroup[] {
  const byCode = new Map(entryHubTypes().map((t) => [t.code, t]))
  return ENTRY_GROUPS.map((group) => {
    const entries: EntryTypeEntry[] = []
    for (const code of group.codes) {
      const spec = byCode.get(code)
      if (!spec) continue
      const reason = unavailableReason(spec, can)
      entries.push({
        spec,
        to: `/documents/new/${spec.slug}`,
        allowed: reason === null,
        unavailableReason: reason,
      })
    }
    return { ...group, entries, anyAllowed: entries.some((e) => e.allowed) }
  })
}

/** How many types this user may actually raise — drives the "why" line. */
export function allowedTypeCount(groups: readonly EntryGroup[]): number {
  return groups.reduce((n, g) => n + g.entries.filter((e) => e.allowed).length, 0)
}

/** Which group a native code belongs to, if any. */
export function groupForCode(code: string): EntryGroupSpec | null {
  return ENTRY_GROUPS.find((g) => g.codes.includes(code)) ?? null
}

/**
 * Tone overrides for the create-form hero only — never the register glyph
 * (documentTypeIcon.tsx is deliberately judgement-free there). A write-off is
 * a loss, not a routine issue, and the one thing every version of the approved
 * mock agrees on is that it reads as red, not amber.
 */
const HERO_TONE_OVERRIDE: Partial<Record<string, IconTone>> = {
  WRITE_OFF: 'danger',
}

/** Icon + tone for a create-form hero: the same glyph as its entry-hub tile, tone overridable. */
export function heroPresentation(code: string): { icon: LucideIcon; tone: IconTone } {
  const group = groupForCode(code)
  const key = group?.key ?? 'issues'
  return { icon: GROUP_ICON[key], tone: HERO_TONE_OVERRIDE[code] ?? GROUP_TONE[key] }
}
