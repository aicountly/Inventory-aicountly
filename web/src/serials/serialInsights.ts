/**
 * The serial workspace's findings panel.
 *
 * ## Why this is arithmetic and not a model
 *
 * The same reasoning as the dashboard's Pulse briefing (see `dashboard/pulse.ts`),
 * and deliberately the same shape so the two read alike: there is no
 * application-owned LLM configured for Inventory, so the honest options were to
 * ship nothing, to ship a card that says "AI insights coming soon", or to ship
 * findings built from figures the server actually computed and to label them
 * for what they are. This is the third. Every line below is a rule over a
 * number in `GET /v1/serials/summary`; the card calls it a rule-based summary,
 * never a forecast, and attaches no confidence to anything.
 *
 * `serialsAi.ts` holds the boundary an application-owned assistant would arrive
 * behind. When it does, it should EXPLAIN these findings — not replace them
 * with numbers of its own, and never write to a serial: a change to stock goes
 * through the authorised workflow that audits it.
 *
 * ## The rules
 *
 * A finding is emitted only when its figure is genuinely known and genuinely
 * actionable:
 *
 *  - `null` (still loading, or the summary failed) emits nothing, so the panel
 *    never says "all clear" because it could not count;
 *  - a zero emits nothing, because "nothing has expired" is not a finding;
 *  - every finding carries the filtered list that resolves it, so it is a task
 *    rather than an observation.
 */

import type { SerialSummary } from '../services/masters'

export type SerialFindingSeverity = 'critical' | 'warning' | 'info'

export interface SerialFinding {
  key: string
  /** One sentence. States the fact; does not editorialise. */
  text: string
  severity: SerialFindingSeverity
  /** The filters that show exactly the serials the sentence counted. */
  filters: Record<string, string>
  /** A verb — it reads as the next action. */
  actionLabel: string
}

const SEVERITY_RANK: Record<SerialFindingSeverity, number> = { critical: 0, warning: 1, info: 2 }

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-IN')} ${count === 1 ? one : many}`
}

interface Rule {
  key: string
  severity: SerialFindingSeverity
  /** The figure this rule watches. Null or ≤ 0 and the rule stays silent. */
  value: (s: SerialSummary) => number | null | undefined
  text: (n: number, s: SerialSummary) => string
  filters: (s: SerialSummary) => Record<string, string>
  actionLabel: string
}

const RULES: Rule[] = [
  {
    key: 'warranty_expired',
    severity: 'critical',
    value: (s) => s.warranty?.expired,
    text: (n) => `${plural(n, 'serial number')} ${n === 1 ? 'is' : 'are'} past warranty expiry.`,
    filters: () => ({ warranty_status: 'expired' }),
    actionLabel: 'Show expired warranties',
  },
  {
    key: 'warranty_soon',
    severity: 'warning',
    value: (s) => s.warranty?.soon,
    text: (n, s) =>
      `${plural(n, 'warranty', 'warranties')} expire${n === 1 ? 's' : ''} within ${s.warranty.soon_days} days.`,
    filters: (s) => ({ warranty_status: 'expiring', warranty_days: String(s.warranty.soon_days) }),
    actionLabel: 'Show them',
  },
  {
    key: 'unplaced',
    severity: 'warning',
    value: (s) => s.unplaced,
    text: (n) =>
      `${plural(n, 'serial number')} ${n === 1 ? 'is' : 'are'} held or expected with no warehouse recorded, so ${n === 1 ? 'it does' : 'they do'} not appear in any warehouse view.`,
    filters: () => ({ placed: '0' }),
    actionLabel: 'Place them',
  },
  {
    key: 'damaged',
    severity: 'warning',
    value: (s) => (s.by_status?.damaged ?? 0) + (s.by_status?.scrapped ?? 0),
    text: (n) => `${plural(n, 'serial number')} ${n === 1 ? 'is' : 'are'} recorded as damaged or scrapped.`,
    filters: () => ({ status: 'damaged,scrapped' }),
    actionLabel: 'Review them',
  },
  {
    key: 'in_transit',
    severity: 'info',
    value: (s) => s.by_status?.in_transit,
    text: (n) => `${plural(n, 'serial number')} ${n === 1 ? 'is' : 'are'} in transit between warehouses.`,
    filters: () => ({ status: 'in_transit' }),
    actionLabel: 'Track them',
  },
  {
    key: 'expected',
    severity: 'info',
    value: (s) => s.by_status?.expected,
    text: (n) =>
      `${plural(n, 'serial number')} ${n === 1 ? 'is' : 'are'} registered but not yet received — ${n === 1 ? 'it stays' : 'they stay'} out of stock until a receipt is posted.`,
    filters: () => ({ status: 'expected' }),
    actionLabel: 'Show expected',
  },
  {
    key: 'warranty_missing',
    severity: 'info',
    value: (s) => s.warranty?.none,
    text: (n) => `${plural(n, 'serial number')} carr${n === 1 ? 'ies' : 'y'} no warranty date.`,
    filters: () => ({ warranty_status: 'none' }),
    actionLabel: 'Fill them in',
  },
]

/**
 * Findings for a summary, most severe first.
 *
 * `null` in, empty out: no summary means nothing is known, and a panel that
 * reported "all clear" from a failed request would be worse than a blank one.
 */
export function buildSerialFindings(summary: SerialSummary | null): SerialFinding[] {
  if (!summary) return []
  const findings: SerialFinding[] = []
  for (const rule of RULES) {
    const raw = rule.value(summary)
    if (raw === null || raw === undefined || !Number.isFinite(raw) || raw <= 0) continue
    findings.push({
      key: rule.key,
      text: rule.text(raw, summary),
      severity: rule.severity,
      filters: rule.filters(summary),
      actionLabel: rule.actionLabel,
    })
  }
  return findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}

/** The one line above the findings. */
export function serialInsightHeadline(findings: readonly SerialFinding[], summary: SerialSummary | null): string {
  if (!summary) return 'Figures are still loading.'
  if (summary.total === 0) return 'No serial numbers are registered in this scope yet.'
  if (findings.length === 0) return 'Nothing needs attention across these serial numbers.'
  const critical = findings.filter((f) => f.severity === 'critical').length
  if (critical > 0) return `${plural(critical, 'thing')} need${critical === 1 ? 's' : ''} attention now.`
  return `${plural(findings.length, 'thing')} to look at.`
}
