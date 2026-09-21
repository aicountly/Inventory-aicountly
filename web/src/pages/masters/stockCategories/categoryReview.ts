import type { StockCategory } from '../../../services/masters'

/**
 * The deterministic review behind the side panel's quick actions.
 *
 * Every finding here is a fact about the rows it was handed — two names that
 * normalise to the same string, a category no item points at, an alias used
 * twice. Nothing is scored, ranked by confidence or guessed at, and nothing
 * here is presented to the reader as AI: the panel labels it as a check over
 * this company's categories, because that is what it is. Anything that would
 * need a model to answer lives behind `services/stockCategoryAi`, which says
 * so when no model is connected rather than inventing an answer.
 *
 * It runs over EVERY category, never the page on screen: "3 categories are
 * unused" computed from the fifty rows that happened to be fetched is a
 * different sentence from the one it appears to be.
 *
 * Pure: no React, no DOM, no network.
 */

export type ReviewKind =
  | 'duplicate_name'
  | 'similar_name'
  | 'duplicate_alias'
  | 'missing_alias'
  | 'unused'
  | 'inactive_in_use'

export type ReviewSeverity = 'warning' | 'info'

export interface ReviewFinding {
  /** Stable within one review — used as a React key. */
  id: string
  kind: ReviewKind
  severity: ReviewSeverity
  title: string
  detail: string
  /** The categories the finding is about, so the list can be filtered to them. */
  categoryIds: number[]
}

export interface CategoryReview {
  findings: ReviewFinding[]
  /** Categories examined — the sentence the panel prints under the result. */
  examined: number
}

/** Case, spacing, punctuation and a trailing plural all folded away. */
export function normaliseName(value: string | null | undefined): string {
  const base = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  if (base === '') return ''
  // "Raw Material" and "Raw Materials" are one category typed twice.
  return base.replace(/s\b/g, '')
}

/** Levenshtein distance, bounded — anything past `max` returns `max + 1`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      const value = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost)
      row.push(value)
      if (value < best) best = value
    }
    if (best > max) return max + 1
    prev = row
  }
  return prev[b.length] ?? max + 1
}

function nameOf(row: StockCategory): string {
  return String(row.cat_name ?? '').trim()
}

function joinNames(rows: readonly StockCategory[], limit = 3): string {
  const names = rows.map(nameOf)
  if (names.length <= limit) return names.join(', ')
  return `${names.slice(0, limit).join(', ')} and ${names.length - limit} more`
}

/** Guards an O(n²) pass on a company that has somehow grown thousands. */
const SIMILARITY_LIMIT = 600

export function reviewCategories(rows: readonly StockCategory[]): CategoryReview {
  const findings: ReviewFinding[] = []

  // ---- exact duplicates, by normalised name ------------------------------
  const byName = new Map<string, StockCategory[]>()
  for (const row of rows) {
    const key = normaliseName(row.cat_name)
    if (key === '') continue
    const bucket = byName.get(key)
    if (bucket) bucket.push(row)
    else byName.set(key, [row])
  }
  for (const [key, bucket] of byName) {
    if (bucket.length < 2) continue
    findings.push({
      id: `duplicate_name:${key}`,
      kind: 'duplicate_name',
      severity: 'warning',
      title: `${bucket.length} categories share one name`,
      detail: `${joinNames(bucket)} read as the same category. Items split between them will not add up in a report.`,
      categoryIds: bucket.map((r) => Number(r.stock_cat_id)),
    })
  }

  // ---- near-duplicates ----------------------------------------------------
  if (rows.length <= SIMILARITY_LIMIT) {
    const seen = new Set<string>()
    const keys = rows.map((row) => ({ row, key: normaliseName(row.cat_name) })).filter((e) => e.key.length >= 5)
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        const a = keys[i]
        const b = keys[j]
        if (!a || !b || a.key === b.key) continue
        if (editDistance(a.key, b.key) > 2) continue
        const pair = [Number(a.row.stock_cat_id), Number(b.row.stock_cat_id)].sort((x, y) => x - y)
        const id = `similar_name:${pair.join('-')}`
        if (seen.has(id)) continue
        seen.add(id)
        findings.push({
          id,
          kind: 'similar_name',
          severity: 'info',
          title: 'Two names differ by a character or two',
          detail: `"${nameOf(a.row)}" and "${nameOf(b.row)}" are easy to pick wrongly from a dropdown.`,
          categoryIds: pair,
        })
      }
    }
  }

  // ---- alias collisions ---------------------------------------------------
  const byAlias = new Map<string, StockCategory[]>()
  for (const row of rows) {
    const alias = String(row.cat_alias ?? '').trim().toLowerCase()
    if (alias === '') continue
    const bucket = byAlias.get(alias)
    if (bucket) bucket.push(row)
    else byAlias.set(alias, [row])
  }
  for (const [alias, bucket] of byAlias) {
    if (bucket.length < 2) continue
    findings.push({
      id: `duplicate_alias:${alias}`,
      kind: 'duplicate_alias',
      severity: 'warning',
      title: `Alias "${bucket[0]?.cat_alias}" is used ${bucket.length} times`,
      detail: `${joinNames(bucket)} all answer to it, so an import keyed on the alias cannot tell them apart.`,
      categoryIds: bucket.map((r) => Number(r.stock_cat_id)),
    })
  }

  // ---- missing aliases ----------------------------------------------------
  const noAlias = rows.filter((r) => Number(r.is_active) === 1 && String(r.cat_alias ?? '').trim() === '')
  if (noAlias.length > 0) {
    findings.push({
      id: 'missing_alias',
      kind: 'missing_alias',
      severity: 'info',
      title: `${noAlias.length} active ${noAlias.length === 1 ? 'category has' : 'categories have'} no alias`,
      detail: `${joinNames(noAlias)} will print their full name on every sheet and import file.`,
      categoryIds: noAlias.map((r) => Number(r.stock_cat_id)),
    })
  }

  // ---- unused -------------------------------------------------------------
  // Only where the API actually sent a count: a row with no `item_count` says
  // nothing about its usage, and calling it unused would be a guess.
  const counted = rows.filter((r) => typeof r.item_count === 'number')
  const unused = counted.filter((r) => Number(r.is_active) === 1 && Number(r.item_count) === 0)
  if (unused.length > 0) {
    findings.push({
      id: 'unused',
      kind: 'unused',
      severity: 'info',
      title: `${unused.length} active ${unused.length === 1 ? 'category has' : 'categories have'} no items`,
      detail: `${joinNames(unused)} ${unused.length === 1 ? 'is' : 'are'} offered on every item form but ${unused.length === 1 ? 'has' : 'have'} never been used.`,
      categoryIds: unused.map((r) => Number(r.stock_cat_id)),
    })
  }

  // ---- inactive but still carrying items ----------------------------------
  const inactiveInUse = counted.filter((r) => Number(r.is_active) !== 1 && Number(r.item_count) > 0)
  if (inactiveInUse.length > 0) {
    const total = inactiveInUse.reduce((sum, r) => sum + Number(r.item_count ?? 0), 0)
    findings.push({
      id: 'inactive_in_use',
      kind: 'inactive_in_use',
      severity: 'warning',
      title: `${inactiveInUse.length} inactive ${inactiveInUse.length === 1 ? 'category is' : 'categories are'} still on items`,
      detail: `${joinNames(inactiveInUse)} ${inactiveInUse.length === 1 ? 'carries' : 'carry'} ${total} ${total === 1 ? 'item' : 'items'}. Reassign them or make the category active again.`,
      categoryIds: inactiveInUse.map((r) => Number(r.stock_cat_id)),
    })
  }

  // Problems first; within a severity, the order the checks ran in.
  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1))

  return { findings, examined: rows.length }
}
