import { Badge } from './Badge'
import type { BadgeSize, BadgeTone } from './Badge'
import { humanize } from '../utils/format'
import { cx } from './cx'

/**
 * Status chip. Merges Books' STATUS_MAP with the inventory statuses Inventory
 * already had, so a document, a batch and a posting all read the same way.
 *
 * `Tone` keeps Inventory's original vocabulary (`good` / `critical`) as an
 * alias of the Badge tones, because reports/helpers.ts and every report config
 * are typed against it and must keep compiling untouched.
 */
export type Tone = 'neutral' | 'good' | 'warning' | 'critical' | 'info' | BadgeTone

const TONE_ALIAS: Record<string, BadgeTone> = {
  good: 'success',
  critical: 'danger',
}

function toBadgeTone(tone: Tone): BadgeTone {
  return TONE_ALIAS[tone] ?? (tone as BadgeTone)
}

interface StatusPreset {
  tone: Tone
  label?: string
}

/** Lower-cased status key → tone + display label. */
const STATUS_MAP: Record<string, StatusPreset> = {
  // ---- Books' shared vocabulary ----
  valid: { tone: 'good', label: 'Valid' },
  expired: { tone: 'critical', label: 'Expired' },
  optional: { tone: 'neutral', label: 'Optional' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
  canceled: { tone: 'neutral', label: 'Cancelled' },
  active: { tone: 'good', label: 'Active' },
  inactive: { tone: 'neutral', label: 'Inactive' },
  draft: { tone: 'neutral', label: 'Draft' },
  posted: { tone: 'good', label: 'Posted' },
  pending: { tone: 'warning', label: 'Pending' },
  issued: { tone: 'neutral', label: 'Issued' },
  approved: { tone: 'good', label: 'Approved' },
  rejected: { tone: 'critical', label: 'Rejected' },
  due: { tone: 'warning', label: 'Due' },
  overdue: { tone: 'critical', label: 'Overdue' },
  filed: { tone: 'good', label: 'Filed' },
  synced: { tone: 'info', label: 'Synced' },
  reconciled: { tone: 'good', label: 'Reconciled' },
  unreconciled: { tone: 'warning', label: 'Unreconciled' },
  matched: { tone: 'good', label: 'Matched' },
  unmatched: { tone: 'warning', label: 'Unmatched' },
  yes: { tone: 'good', label: 'Yes' },
  no: { tone: 'neutral', label: 'No' },
  enabled: { tone: 'good', label: 'Enabled' },
  disabled: { tone: 'neutral', label: 'Disabled' },
  open: { tone: 'info', label: 'Open' },
  closed: { tone: 'neutral', label: 'Closed' },
  beta: { tone: 'beta', label: 'Beta' },
  warning: { tone: 'warning', label: 'Warning' },
  error: { tone: 'critical', label: 'Error' },
  success: { tone: 'good', label: 'Success' },
  info: { tone: 'info', label: 'Info' },
  system: { tone: 'info', label: 'System' },
  // ---- Inventory's own ----
  in_stock: { tone: 'good' },
  completed: { tone: 'good' },
  processed: { tone: 'good' },
  acked: { tone: 'good' },
  balanced: { tone: 'good' },
  expected: { tone: 'info' },
  reserved: { tone: 'info' },
  in_transit: { tone: 'info' },
  running: { tone: 'info' },
  pending_approval: { tone: 'warning' },
  quarantine: { tone: 'warning' },
  returned: { tone: 'warning' },
  reversed: { tone: 'warning' },
  recalled: { tone: 'critical' },
  damaged: { tone: 'critical' },
  scrapped: { tone: 'critical' },
  failed: { tone: 'critical' },
  dead: { tone: 'critical' },
}

export interface StatusBadgeProps {
  /** Inventory's prop name. */
  value?: string | null
  /** Books' prop name — both are accepted so ported markup drops straight in. */
  status?: string | null
  tone?: Tone
  label?: string
  size?: BadgeSize
  className?: string
}

/**
 * The words this badge puts on the screen for a raw status token.
 *
 * Exported because an export has to reproduce the screen: a column whose cell
 * is a `StatusBadge` writes `DEAD` / `in_stock` into the file unless it resolves
 * its own value, and a printed register that reads DEAD where the screen read
 * Dead is the same column saying two different things. Calling this rather than
 * `humanize` directly means a status that later gains an explicit label in
 * STATUS_MAP changes the sheet and the screen together.
 */
export function statusBadgeLabel(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const preset = STATUS_MAP[String(value).toLowerCase()]
  return preset?.label ?? humanize(value) ?? String(value)
}

export function StatusBadge({ value, status, tone, label, size = 'sm', className }: StatusBadgeProps) {
  const raw = value ?? status
  const key = raw ? String(raw).toLowerCase() : null
  const preset = key ? STATUS_MAP[key] : undefined
  const finalTone = toBadgeTone(tone ?? preset?.tone ?? 'neutral')
  const finalLabel = label ?? preset?.label ?? humanize(raw) ?? 'Unknown'
  return (
    <Badge tone={finalTone} size={size} className={cx('normal-case', className)}>
      {finalLabel}
    </Badge>
  )
}

export function ActiveBadge({ active }: { active: unknown }) {
  const on = active === 1 || active === '1' || active === true
  return <StatusBadge value={on ? 'active' : 'inactive'} />
}

export default StatusBadge
