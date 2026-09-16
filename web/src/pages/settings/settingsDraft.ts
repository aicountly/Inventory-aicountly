/**
 * The Company Settings form, as a value.
 *
 * Everything here is pure, so the rules that decide whether the Save button is live — and which
 * fields the PUT actually carries — are testable without mounting a screen.
 *
 * The one idea worth stating: the draft is DERIVED from the server's answer, never held beside it.
 * `GET /v1/settings` returns a database row, so booleans arrive as `1` / `"0"`, the excluded
 * landed-cost set arrives both as a comma string and as a resolved policy block, and a currency may
 * carry whitespace. Comparing those raw shapes marks the form dirty the moment it loads and a Save
 * that no one asked for rewrites `updated_by` on a valuation policy. Both sides are normalised into
 * the same shape first; only a real difference counts.
 */

import { LANDED_COST_TYPES } from '../../documents/landedCost'
import type { LandedCostPolicy, LandedCostType } from '../../documents/landedCost'
import { NEGATIVE_STOCK_POLICIES, VALUATION_METHODS } from '../../services/settingsApi'
import type {
  CogsRevisionMode,
  CompanySettings,
  NegativeStockPolicy,
  SettingsPatch,
  ValuationMethod,
  ValuationScope,
} from '../../services/settingsApi'
import { isOn } from '../../utils/format'

/** The editable settings, normalised. Metadata (cmp_id, updated_at, updated_by) is not in here. */
export interface SettingsDraft {
  default_valuation_method: ValuationMethod
  valuation_scope: ValuationScope
  negative_stock_policy: NegativeStockPolicy
  approval_required: boolean
  fefo_enabled: boolean
  cogs_revision_mode: CogsRevisionMode
  base_currency_code: string
  /** The types this company does NOT capitalise, in vocabulary order. */
  landed_cost_excluded_types: LandedCostType[]
}

/**
 * Which charges this company capitalises into stock, and which of them it may switch off.
 *
 * Taken from the server's own answer (landed_cost_policy.switchable_cost_types), never re-listed
 * here. A hard-coded copy drifts silently in one direction only: add a sixth switchable type to
 * InventorySettingsService::LANDED_COST_SWITCHABLE_TYPES and the PHP parity test stays green, the
 * policy endpoint reports it, the landed-cost panel offers it as capitalisable — and this screen
 * simply never renders a control for it, so no company can ever switch it off.
 *
 * The fallback is used only when the response predates the policy block; non_creditable_tax is
 * never in this list, because it is always capitalised and the screen says so in its own tile.
 */
const SWITCHABLE_FALLBACK: LandedCostType[] = ['freight', 'duty', 'insurance', 'handling', 'other']

export function switchableCostTypes(policy?: LandedCostPolicy): LandedCostType[] {
  const offered = policy?.switchable_cost_types
  return Array.isArray(offered) && offered.length > 0 ? offered : SWITCHABLE_FALLBACK
}

/**
 * The types that are capitalised whatever the form says.
 *
 * Read from the server for the same reason as the switchable list: the screen must not be the place
 * that decides a tax is not a choice, it must be the place that repeats what the server decided.
 */
export function alwaysCapitalisedCostTypes(policy?: LandedCostPolicy): LandedCostType[] {
  const always = policy?.always_capitalised_cost_types
  return Array.isArray(always) && always.length > 0 ? always : ['non_creditable_tax']
}

function normaliseMethod(value: unknown): ValuationMethod {
  const v = String(value ?? '').trim().toUpperCase()
  return (VALUATION_METHODS as string[]).includes(v) ? (v as ValuationMethod) : 'FIFO'
}

function normaliseScope(value: unknown): ValuationScope {
  return String(value ?? '').trim().toLowerCase() === 'warehouse' ? 'warehouse' : 'company'
}

function normalisePolicy(value: unknown): NegativeStockPolicy {
  const v = String(value ?? '').trim().toLowerCase()
  return (NEGATIVE_STOCK_POLICIES as string[]).includes(v) ? (v as NegativeStockPolicy) : 'allow'
}

function normaliseCogsMode(value: unknown): CogsRevisionMode {
  return String(value ?? '').trim().toLowerCase() === 'adjustment' ? 'adjustment' : 'inline'
}

/**
 * The excluded set, in the vocabulary's order, de-duplicated, and holding only types the server
 * says are switchable — which mirrors InventorySettingsService::parseExcludedTypes. Two equal
 * policies therefore compare equal however they arrived, so a settings row written by the migration
 * does not read as an edit.
 */
export function normaliseExcluded(raw: unknown, policy?: LandedCostPolicy): LandedCostType[] {
  const parts = Array.isArray(raw) ? raw : String(raw ?? '').split(',')
  const switchable = switchableCostTypes(policy)
  const seen = new Set<string>()
  for (const part of parts) {
    const t = String(part ?? '').trim().toLowerCase()
    if (switchable.includes(t as LandedCostType)) seen.add(t)
  }
  const order = [...LANDED_COST_TYPES.filter((t) => switchable.includes(t)), ...switchable.filter((t) => !LANDED_COST_TYPES.includes(t))]
  return order.filter((t) => seen.has(t))
}

/**
 * The server's answer as a form value.
 *
 * `landed_cost_policy.excluded_cost_types` is preferred over the raw column: it is the resolved
 * shape the server itself works in, and the column is only a fallback for a response that predates
 * the policy block.
 */
export function toDraft(settings: CompanySettings): SettingsDraft {
  const policy = settings.landed_cost_policy
  const excludedSource = policy?.excluded_cost_types ?? settings.landed_cost_excluded_types ?? []
  return {
    default_valuation_method: normaliseMethod(settings.default_valuation_method),
    valuation_scope: normaliseScope(settings.valuation_scope),
    negative_stock_policy: normalisePolicy(settings.negative_stock_policy),
    approval_required: isOn(settings.approval_required),
    fefo_enabled: isOn(settings.fefo_enabled),
    cogs_revision_mode: normaliseCogsMode(settings.cogs_revision_mode),
    base_currency_code: String(settings.base_currency_code ?? '').trim().toUpperCase(),
    landed_cost_excluded_types: normaliseExcluded(excludedSource, policy),
  }
}

function sameExcluded(a: LandedCostType[], b: LandedCostType[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i])
}

/**
 * Only what actually changed.
 *
 * Sending the whole form back would work — the server takes a partial patch either way — but it
 * would also rewrite fields nobody touched, and a concurrent change made in another tab or by
 * another user would be silently reverted by whoever saved last. A patch of one field overwrites
 * one field.
 */
export function draftPatch(server: SettingsDraft, draft: SettingsDraft): SettingsPatch {
  const patch: SettingsPatch = {}
  if (draft.default_valuation_method !== server.default_valuation_method) patch.default_valuation_method = draft.default_valuation_method
  if (draft.valuation_scope !== server.valuation_scope) patch.valuation_scope = draft.valuation_scope
  if (draft.negative_stock_policy !== server.negative_stock_policy) patch.negative_stock_policy = draft.negative_stock_policy
  if (draft.approval_required !== server.approval_required) patch.approval_required = draft.approval_required
  if (draft.fefo_enabled !== server.fefo_enabled) patch.fefo_enabled = draft.fefo_enabled
  if (draft.cogs_revision_mode !== server.cogs_revision_mode) patch.cogs_revision_mode = draft.cogs_revision_mode
  if (draft.base_currency_code !== server.base_currency_code) patch.base_currency_code = draft.base_currency_code
  if (!sameExcluded(server.landed_cost_excluded_types, draft.landed_cost_excluded_types)) {
    patch.landed_cost_excluded_types = draft.landed_cost_excluded_types
  }
  return patch
}

export function isDirty(server: SettingsDraft | null, draft: SettingsDraft | null): boolean {
  if (!server || !draft) return false
  return Object.keys(draftPatch(server, draft)).length > 0
}

/** Everything the server would refuse, said next to the field instead. */
export function validateDraft(draft: SettingsDraft): Partial<Record<keyof SettingsDraft, string>> {
  const errors: Partial<Record<keyof SettingsDraft, string>> = {}
  if (!/^[A-Z]{3}$/.test(draft.base_currency_code)) {
    errors.base_currency_code = 'Use the three-letter ISO code, e.g. INR.'
  }
  return errors
}

export type HealthTone = 'good' | 'attention'

export interface ConfigurationHealth {
  tone: HealthTone
  title: string
  detail: string
}

/**
 * The status card beside the Save button.
 *
 * It reports what IS configured, in one line, rather than grading it: "optimised" is not something
 * a screen can know about someone else's accounting policy, and every valuation method and negative
 * stock policy here is a legitimate choice some company makes deliberately.
 *
 * Exactly one thing earns the amber: a charge type switched off. That is the setting whose effect
 * is felt somewhere else entirely — Inventory REFUSES a purchase line or allocation carrying an
 * excluded type — so it is worth naming on the way past rather than discovering as a 422 on a
 * voucher three screens away.
 */
export function configurationHealth(draft: SettingsDraft | null): ConfigurationHealth {
  if (!draft) return { tone: 'good', title: 'Current configuration', detail: 'Loading this company’s settings…' }

  const method = draft.default_valuation_method
  const scope = draft.valuation_scope === 'warehouse' ? 'per warehouse' : 'company-wide'
  const negative = { allow: 'negative stock allowed', warn: 'negative stock flagged', block: 'negative stock blocked' }[
    draft.negative_stock_policy
  ]
  const excluded = draft.landed_cost_excluded_types.length

  if (excluded > 0) {
    return {
      tone: 'attention',
      title: 'Current configuration',
      detail: `${method}, ${scope} · ${excluded} charge ${excluded === 1 ? 'type is' : 'types are'} expensed, not capitalised`,
    }
  }
  return { tone: 'good', title: 'Current configuration', detail: `${method}, ${scope} · ${negative}` }
}
