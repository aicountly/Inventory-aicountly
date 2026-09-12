import { humanize } from '../utils/format'

export type Tone = 'neutral' | 'good' | 'warning' | 'critical' | 'info'

const TONES: Record<string, Tone> = {
  active: 'good',
  in_stock: 'good',
  posted: 'good',
  completed: 'good',
  processed: 'good',
  acked: 'good',
  balanced: 'good',
  expected: 'info',
  reserved: 'info',
  in_transit: 'info',
  pending: 'warning',
  pending_approval: 'warning',
  quarantine: 'warning',
  returned: 'warning',
  draft: 'neutral',
  closed: 'neutral',
  inactive: 'neutral',
  issued: 'neutral',
  expired: 'critical',
  recalled: 'critical',
  damaged: 'critical',
  scrapped: 'critical',
  failed: 'critical',
  dead: 'critical',
  cancelled: 'neutral',
  reversed: 'warning',
}

interface StatusBadgeProps {
  value: string | null | undefined
  tone?: Tone
  label?: string
}

/** A status chip: the colour is a hint, the label carries the meaning. */
export function StatusBadge({ value, tone, label }: StatusBadgeProps) {
  const key = (value ?? '').toLowerCase()
  const t = tone ?? TONES[key] ?? 'neutral'
  return (
    <span className={`badge badge-${t}`}>
      <span className="dot" aria-hidden />
      {label ?? humanize(value) ?? '—'}
    </span>
  )
}

export function ActiveBadge({ active }: { active: unknown }) {
  const on = active === 1 || active === '1' || active === true
  return <StatusBadge value={on ? 'active' : 'inactive'} />
}
